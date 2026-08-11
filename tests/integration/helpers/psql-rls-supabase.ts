import { lit } from "./db";
import { runPsql } from "./psql-invoke";

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
 * `gte`, `lte`, `lt`, `is` (null only, M-81), `ilike`, `or`, `order`, `range`,
 * `limit`, `maybeSingle` and `count`/`head` — and THROWS on anything else, so a future query shape
 * cannot silently take an untested path. Embedded resources, `not`, `filter`
 * and range headers are absent because M-74 uses none of them.
 */

const DB = process.env.INTEGRATION_TEST_DB ?? "pickloads_integration";

export interface PgError {
  message: string;
  /**
   * The PostgreSQL SQLSTATE, when psql reported one (M-83).
   *
   * The wrapper runs psql with `-v VERBOSITY=verbose`, which makes it print
   * `ERROR:  42501: permission denied for table shipments` instead of
   * dropping the code. Without it a test can only match on English prose,
   * and "the row was filtered by RLS" (no error) and "the COLUMN privilege
   * was revoked" (42501) are exactly the distinction M-83 exists to assert.
   * `undefined` when the failure was not a Postgres error at all.
   */
  code?: string;
}

/** Pull the SQLSTATE out of a verbose psql failure. */
function sqlstateOf(text: string): string | undefined {
  return /\bERROR:\s+([0-9A-Z]{5}):/.exec(text)?.[1];
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
    // SQL on stdin, never argv — see `psql-invoke.ts`.
    const out = runPsql(
      // `-v VERBOSITY=verbose` (M-83) makes psql print the SQLSTATE in the
      // error line, so `PgError.code` is a real code rather than prose.
      [
        "-d",
        DB,
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-At",
      ],
      wrapped,
    );
    const lines = out.split("\n").filter((l) => l !== "");
    const payload = lines[lines.length - 1] ?? "";
    return {
      rows: payload === "" ? [] : (JSON.parse(payload) as unknown[]),
      error: null,
    };
  } catch (err) {
    const message = String(err);
    const code = sqlstateOf(message);
    return { rows: [], error: code ? { message, code } : { message } };
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
  /**
   * M-81 — `.is(column, null)`. PostgREST spells the null test separately from
   * `eq` because SQL does: `= null` is never true, and a revoked-at filter
   * written as `eq(…, null)` would silently return nothing. The adapter models
   * ONLY the null case, because that is the only one the module uses and a
   * broader `is` would be untested surface.
   */
  is(column: string, value: null): this {
    if (value !== null) {
      throw new Error("psql-rls: is() supports null only");
    }
    this.predicates.push({ sql: `"${column}" is null` });
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
  /**
   * CHAINABLE, unlike `range()`. supabase-js allows `.limit(1).maybeSingle()`
   * — the shape every membership helper uses (`getMyCarrierId`,
   * `getMyShipperId`, and M-81's `getMyBrokerPartnerId`) — so returning a
   * Promise here would make those helpers unrunnable in this lane while
   * working perfectly in production. The builder is `PromiseLike`, so an
   * `await` on the result of `.limit(n)` still resolves to an `RlsResult`.
   */
  limit(n: number): this {
    this.rowLimit = n;
    return this;
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
/** SQL literal for one `rpc()` argument. Strings are quoted; nothing else is. */
function rpcLiteral(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return lit(String(value));
}

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
     * M-78 EXTENDED IT, narrowly. `my_shipment_exceptions(p_shipment_id)`
     * takes one uuid and returns a SET of rows rather than a scalar, so this
     * encoder handles exactly that shape: named arguments whose values are
     * strings, numbers, booleans or null. Anything else still THROWS, so a
     * future caller with an array or a composite argument has to add its own
     * encoding deliberately rather than getting a silently wrong query.
     *
     * The SET-returning case is detected from the catalog (`proretset`), not
     * guessed: a set-returning function selected as a scalar would collapse to
     * its first row and the test would prove the opposite of what it claims.
     */
    rpc(fn: string, args?: Record<string, unknown>) {
      const entries = Object.entries(args ?? {});
      for (const [name, value] of entries) {
        const kind = value === null ? "null" : typeof value;
        if (!["string", "number", "boolean", "null"].includes(kind)) {
          throw new Error(
            `psql-rls: rpc("${fn}") argument "${name}" is a ${kind} — ` +
              "add an encoder when a caller needs one.",
          );
        }
      }
      const call =
        entries.length === 0
          ? `${fn}()`
          : `${fn}(${entries
              .map(([name, value]) => `${name} => ${rpcLiteral(value)}`)
              .join(", ")})`;

      const setReturning =
        runAsSession(
          session,
          `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
             select p.proretset as v from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = ${lit(fn)}
             limit 1) t`,
        ).rows[0] as { v: boolean } | undefined;

      const sql = setReturning?.v
        ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${call} t`
        : `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (select ${call} as v) t`;

      const result = runAsSession(session, sql);
      if (result.error) return Promise.resolve({ data: null, error: result.error });
      if (setReturning?.v) {
        return Promise.resolve({ data: result.rows, error: null });
      }
      const row = (result.rows[0] ?? null) as { v: unknown } | null;
      return Promise.resolve({ data: row?.v ?? null, error: null });
    },
  };
}
