import { lit } from "./db";
import { execFileSync } from "node:child_process";

/**
 * M-74 — a PostgREST-shaped client that runs **under RLS as a real session**,
 * for the integration lane.
 *
 * ── WHY A SECOND ADAPTER AND NOT AN EXTENSION OF THE M-73 ONE ─────────────
 *
 * `psql-supabase.ts` exists to run `lookupPublicTracking`, which uses the
 * SERVICE ROLE and deliberately bypasses RLS — its whole design is "the
 * service-role client is the only door". It runs every statement as the
 * database owner because that is what it is modelling.
 *
 * This adapter models the opposite thing: the COOKIE-BOUND session client that
 * `src/lib/shipments/shipper-{list,detail,tiles}.ts` take. Its defining
 * behaviour is that every statement runs inside a transaction as
 * `authenticated` with `request.jwt.claim.sub` set — which is precisely what
 * `auth.uid()` reads, and therefore what makes `my_shipper_ids()` and every
 * 0018/0019/0021 policy fire. Bolting a "sometimes bypass RLS, sometimes
 * don't" switch onto the M-73 adapter would make the file's central claim
 * conditional, and a security adapter whose isolation is a flag is worse than
 * two small honest ones.
 *
 * ── WHAT THIS BUYS OVER THE SQL-ONLY RLS SUITE ────────────────────────────
 *
 * `supabase/tests/20_rls_isolation.sql` proves a SESSION cannot cross a tenant
 * boundary. It cannot prove that the shipper portal's real query-building code
 * — `applyShipmentFilters`, the range, the projection, the tile predicates —
 * produces SQL the real schema accepts and the real policies scope. That is
 * the gap the task names: *"through the real client, not just RLS SQL"*. The
 * functions under test here are imported unmodified from `src/`.
 *
 * ── HONEST LIMITS ─────────────────────────────────────────────────────────
 *
 * This is not PostgREST. It implements the operators M-74 uses — `eq`, `in`,
 * `gte`, `lte`, `lt`, `ilike`, `or`, `order`, `range`, `limit`, `maybeSingle`,
 * and `count`/`head` — and THROWS on anything else, so a future query shape
 * cannot silently take an untested path. Embedded resources, `not`, `filter`
 * and range headers are absent because M-74 uses none of them.
 */

const DB = process.env.INTEGRATION_TEST_DB ?? "pickloads_integration";

const PSQL_ENV = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? "/tmp/pgsock",
  PGPORT: process.env.PGPORT ?? "5433",
  PGUSER: process.env.PGUSER ?? "postgres",
};

export interface PgError {
  message: string;
}

/** Who the statement runs as. `null` sub = anon. */
export interface Session {
  role: "authenticated" | "anon";
  sub: string | null;
}

/** Every SQL statement this adapter issued — the audit trail for a test. */
export const issuedSql: string[] = [];

export function resetIssuedSql(): void {
  issuedSql.length = 0;
}

function runAsSession(
  session: Session,
  sql: string,
): {
  rows: unknown[];
  error: PgError | null;
} {
  // `set local` requires a transaction, and the transaction is what makes the
  // role + claim apply to exactly this statement and nothing after it.
  const wrapped =
    `begin; ` +
    `set local role ${session.role}; ` +
    `set local "request.jwt.claim.sub" = ${lit(session.sub ?? "")}; ` +
    `${sql}; ` +
    `commit;`;
  issuedSql.push(sql);
  try {
    const out = execFileSync(
      "psql",
      ["-d", DB, "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", wrapped],
      { env: PSQL_ENV, encoding: "utf8" },
    ).trim();
    const lines = out.split("\n").filter((l) => l !== "");
    const payload = lines[lines.length - 1] ?? "";
    return {
      rows: payload === "" ? [] : (JSON.parse(payload) as unknown[]),
      error: null,
    };
  } catch (err) {
    return { rows: [], error: { message: String(err) } };
  }
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return lit(String(value));
}

interface Predicate {
  sql: string;
}

interface Ordering {
  column: string;
  ascending: boolean;
}

/**
 * Translate one PostgREST `or()` operand (`col.op.value`) into SQL.
 *
 * The three operators M-74 generates: `ilike` (with `*` as the wildcard, which
 * is PostgREST's spelling inside a logical operator), `eq` and `gt`.
 */
function operandToSql(operand: string): string {
  const [column, op, ...rest] = operand.split(".");
  const value = rest.join(".");
  if (column === undefined || op === undefined) {
    throw new Error(`psql-rls: malformed or() operand "${operand}"`);
  }
  switch (op) {
    case "ilike":
      return `"${column}"::text ilike ${lit(value.replace(/\*/g, "%"))}`;
    case "eq":
      return `"${column}"::text = ${lit(value)}`;
    case "gt":
      return `"${column}" > ${literal(Number(value))}`;
    default:
      throw new Error(`psql-rls: or() operator "${op}" is not supported`);
  }
}

export interface RlsResult {
  data: unknown[] | null;
  count: number | null;
  error: PgError | null;
}

export interface RlsSingleResult {
  data: unknown;
  error: PgError | null;
}

class RlsSelectBuilder implements PromiseLike<RlsResult> {
  private readonly predicates: Predicate[] = [];
  private readonly orderings: Ordering[] = [];
  private rowLimit: number | null = null;
  private rowOffset = 0;

  constructor(
    private readonly session: Session,
    private readonly table: string,
    private readonly columns: string,
    private readonly options: { count?: string; head?: boolean } | undefined,
  ) {}

  eq(column: string, value: unknown): this {
    this.predicates.push({ sql: `"${column}" = ${literal(value)}` });
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    const list = values.map(literal).join(", ");
    this.predicates.push({
      sql: values.length === 0 ? "false" : `"${column}"::text in (${list})`,
    });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.predicates.push({ sql: `"${column}" >= ${literal(value)}` });
    return this;
  }
  lte(column: string, value: unknown): this {
    this.predicates.push({ sql: `"${column}" <= ${literal(value)}` });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.predicates.push({ sql: `"${column}" < ${literal(value)}` });
    return this;
  }
  ilike(column: string, pattern: string): this {
    this.predicates.push({
      sql: `"${column}"::text ilike ${lit(pattern)}`,
    });
    return this;
  }
  or(expression: string): this {
    const sql = expression.split(",").map(operandToSql).join(" or ");
    this.predicates.push({ sql: `(${sql})` });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderings.push({
      column,
      ascending: options?.ascending ?? true,
    });
    return this;
  }
  range(from: number, to: number): Promise<RlsResult> {
    this.rowOffset = from;
    this.rowLimit = to - from + 1;
    return Promise.resolve(this.execute());
  }
  limit(n: number): Promise<RlsResult> {
    this.rowLimit = n;
    return Promise.resolve(this.execute());
  }
  maybeSingle(): Promise<RlsSingleResult> {
    this.rowLimit = 2;
    const result = this.execute();
    if (result.error)
      return Promise.resolve({ data: null, error: result.error });
    const rows = result.data ?? [];
    if (rows.length > 1) {
      return Promise.resolve({
        data: null,
        error: { message: "more than one row returned" },
      });
    }
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  then<R1, R2 = never>(
    onfulfilled?: ((v: RlsResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private where(): string {
    return this.predicates.length === 0
      ? ""
      : ` where ${this.predicates.map((p) => p.sql).join(" and ")}`;
  }

  private execute(): RlsResult {
    const where = this.where();
    const wantsCount = this.options?.count === "exact";
    // PostgREST returns the count over the FILTERED set, ignoring the range —
    // which is exactly what a pager needs, and the reason the count is a
    // separate statement here rather than a window function over the page.
    let count: number | null = null;
    if (wantsCount) {
      const countSql =
        `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ` +
        `(select count(*) as n from public."${this.table}"${where}) t`;
      const result = runAsSession(this.session, countSql);
      if (result.error) return { data: null, count: null, error: result.error };
      const first = result.rows[0] as { n: number } | undefined;
      count = Number(first?.n ?? 0);
    }
    if (this.options?.head === true) {
      return { data: null, count, error: null };
    }
    const order =
      this.orderings.length === 0
        ? ""
        : ` order by ${this.orderings
            .map((o) => `"${o.column}" ${o.ascending ? "asc" : "desc"}`)
            .join(", ")}`;
    const limit = this.rowLimit === null ? "" : ` limit ${this.rowLimit}`;
    const offset = this.rowOffset === 0 ? "" : ` offset ${this.rowOffset}`;
    const sql =
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ` +
      `(select ${this.columns} from public."${this.table}"${where}${order}${limit}${offset}) t`;
    const result = runAsSession(this.session, sql);
    if (result.error) return { data: null, count, error: result.error };
    return { data: result.rows, count, error: null };
  }
}

/**
 * A cookie-bound-shaped client for one session.
 *
 * Writes are refused outright: M-74 is a read-only module, so a write through
 * this adapter is a bug in the module rather than a gap in the harness.
 */
export function createRlsSupabaseClient(session: Session) {
  return {
    from(table: string) {
      return {
        select(columns: string, options?: { count?: string; head?: boolean }) {
          return new RlsSelectBuilder(session, table, columns, options);
        },
        insert() {
          throw new Error(
            "psql-rls: writes are not supported (M-74 is read-only)",
          );
        },
        update() {
          throw new Error(
            "psql-rls: writes are not supported (M-74 is read-only)",
          );
        },
        delete() {
          throw new Error(
            "psql-rls: writes are not supported (M-74 is read-only)",
          );
        },
      };
    },
    /**
     * M-77 — `rpc()` under the SAME session, role and JWT claim as a select.
     *
     * §11's ninth tile is a SECURITY DEFINER count (0024): §16 keeps
     * unapproved documents out of customer hands, so a plain count under a
     * shipper session would report 0 for a queue of five. The point of running
     * it here is that the function derives its own scope from
     * `my_shipper_ids()` — which only resolves if `request.jwt.claim.sub` is
     * set, which is exactly what this adapter sets. A helper that ran it as
     * the owner would prove nothing.
     *
     * Arguments are refused: nothing M-77 calls through this door takes any,
     * and accepting them would mean writing a PostgREST argument encoder that
     * no test exercises.
     */
    rpc(fn: string, args?: Record<string, unknown>) {
      if (args !== undefined && Object.keys(args).length > 0) {
        throw new Error(
          `psql-rls: rpc("${fn}") with arguments is not supported — ` +
            "add an encoder when a caller needs one.",
        );
      }
      const result = runAsSession(
        session,
        `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (select ${fn}() as v) t`,
      );
      if (result.error) return Promise.resolve({ data: null, error: result.error });
      const row = (result.rows[0] ?? null) as { v: unknown } | null;
      return Promise.resolve({ data: row?.v ?? null, error: null });
    },
  };
}
