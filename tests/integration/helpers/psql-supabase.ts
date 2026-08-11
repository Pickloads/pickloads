import { exec, lit } from "./db";
import { execFileSync } from "node:child_process";

/**
 * M-73 — a PostgREST-shaped client backed by `psql`, for the integration lane.
 *
 * WHY THIS EXISTS. `lookupPublicTracking` is the function §19 describes, and
 * the only way to prove it works is to RUN IT — not a re-implementation of it,
 * not the sum of its parts. It reaches the database through a supabase-js
 * client, and the integration lane has a real PostgreSQL 16 built from the
 * migration chain but no PostgREST server in front of it. This adapter is the
 * missing inch: it implements exactly the query shapes M-73 uses, translating
 * them into SQL that the real schema either accepts or rejects.
 *
 * WHAT THAT BUYS, concretely — none of which the unit lane's mock can give:
 *
 *   * the SELECT projection is checked against the REAL `shipments` table, so
 *     a mistyped column name fails here instead of in production;
 *   * the ledger INSERT is checked against 0020's REAL enum, CHECKs and
 *     append-only trigger;
 *   * the `public_access_hash` round-trips through a REAL `text` column, so a
 *     truncation or encoding problem would surface;
 *   * `to_jsonb` reproduces PostgREST's own type rendering — `numeric` as a
 *     JSON number, `timestamptz` as text — so the DTO is built from values
 *     shaped the way production shapes them.
 *
 * WHAT IT IS NOT. It is not a PostgREST implementation and does not try to be:
 * no `or`, no embedded resources, no range headers, no RLS (the lane runs as
 * the owner). It supports the four calls M-73 makes and throws loudly on
 * anything else, so a future query shape cannot silently take an untested
 * path. Honest limits, stated rather than discovered.
 */

const DB = process.env.INTEGRATION_TEST_DB ?? "pickloads_integration";

const PSQL_ENV = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? "/tmp/pgsock",
  PGPORT: process.env.PGPORT ?? "5433",
  PGUSER: process.env.PGUSER ?? "postgres",
};

interface PgError {
  message: string;
}

function query(sql: string): { rows: unknown[]; error: PgError | null } {
  try {
    const out = execFileSync(
      "psql",
      ["-d", DB, "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
      { env: PSQL_ENV, encoding: "utf8" },
    ).trim();
    return { rows: out === "" ? [] : (JSON.parse(out) as unknown[]), error: null };
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

interface Filter {
  column: string;
  value: unknown;
  /** M-78 — `not(column, "is", null)`, the one negation the module uses. */
  negated?: boolean;
  operator?: "eq" | "is";
}

interface Ordering {
  column: string;
  ascending: boolean;
}

class SelectBuilder implements PromiseLike<{ rows: unknown[]; error: PgError | null }> {
  private readonly filters: Filter[] = [];
  private readonly orderings: Ordering[] = [];
  private rowLimit: number | null = null;

  constructor(
    private readonly table: string,
    private readonly columns: string,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value, operator: "eq" });
    return this;
  }

  /**
   * M-78 — `not(column, "is", null)`, which `lookupPublicTracking` uses so an
   * exception with nothing honest to publish never enters the process. Only
   * `is` is implemented; anything else THROWS, so a future query shape cannot
   * silently take an untested path (the same rule the RLS adapter follows).
   */
  not(column: string, operator: string, value: unknown): this {
    if (operator !== "is") {
      throw new Error(
        `psql-supabase: not("${column}", "${operator}") is not supported`,
      );
    }
    this.filters.push({ column, value, negated: true, operator: "is" });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderings.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(n: number): Promise<{ data: unknown[] | null; error: PgError | null }> {
    this.rowLimit = n;
    const { rows, error } = query(this.toSql());
    return Promise.resolve({ data: error ? null : rows, error });
  }

  async maybeSingle(): Promise<{ data: unknown; error: PgError | null }> {
    this.rowLimit = 2;
    const { rows, error } = query(this.toSql());
    if (error) return { data: null, error };
    if (rows.length > 1) {
      return { data: null, error: { message: "more than one row returned" } };
    }
    return { data: rows[0] ?? null, error: null };
  }

  then<R1, R2 = never>(
    onfulfilled?:
      | ((v: { rows: unknown[]; error: PgError | null }) => R1 | PromiseLike<R1>)
      | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(query(this.toSql())).then(onfulfilled, onrejected);
  }

  private toSql(): string {
    const where =
      this.filters.length === 0
        ? ""
        : ` where ${this.filters
            .map((f) =>
              f.operator === "is"
                ? `"${f.column}" is ${f.negated ? "not " : ""}${literal(f.value)}`
                : `"${f.column}" = ${literal(f.value)}`,
            )
            .join(" and ")}`;
    const order =
      this.orderings.length === 0
        ? ""
        : ` order by ${this.orderings
            .map((o) => `"${o.column}" ${o.ascending ? "asc" : "desc"}`)
            .join(", ")}`;
    const limit = this.rowLimit === null ? "" : ` limit ${this.rowLimit}`;
    return (
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ` +
      `(select ${this.columns} from public."${this.table}"${where}${order}${limit}) t`
    );
  }
}

/** Every insert this adapter performs, for assertions that need the payload. */
export const capturedInserts: { table: string; row: Record<string, unknown> }[] =
  [];

export function resetCapturedInserts(): void {
  capturedInserts.length = 0;
}

function insert(
  table: string,
  row: Record<string, unknown>,
): Promise<{ error: PgError | null }> {
  capturedInserts.push({ table, row });
  const columns = Object.keys(row);
  const sql =
    `insert into public."${table}" (${columns.map((c) => `"${c}"`).join(", ")}) ` +
    `values (${columns.map((c) => literal(row[c])).join(", ")})`;
  try {
    exec(sql);
    return Promise.resolve({ error: null });
  } catch (err) {
    return Promise.resolve({ error: { message: String(err) } });
  }
}

/**
 * The client object `tryCreateAdminClient` is mocked to return.
 *
 * `insert` is refused for any table outside the allow-list, so a future module
 * that starts writing through this adapter has to add itself deliberately.
 */
export function createPsqlSupabaseClient() {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          return new SelectBuilder(table, columns);
        },
        insert(row: Record<string, unknown>) {
          if (table !== "shipment_tracking_access") {
            throw new Error(
              `psql-supabase: insert into "${table}" is not supported by this adapter`,
            );
          }
          return insert(table, row);
        },
      };
    },
    /**
     * M-83 — `rpc()` as the OWNER.
     *
     * `redeemDriverToken` and every other service-role path in `src/` reaches
     * the database through `admin.rpc(...)`. Until M-83 this adapter threw,
     * so the integration lane could only call 0023's functions from SQL — it
     * could exercise the DATABASE half of a bearer-credential redemption and
     * never the TypeScript half that shapes the driver page's props. §19's
     * route-level key-set proof needs both halves in one call.
     *
     * The encoder is `psql-rls-supabase`'s, deliberately: same accepted
     * argument shapes (string/number/boolean/null), same catalog-driven
     * detection of set-returning functions (`proretset`), same refusal to
     * guess at anything else. Two encoders that drifted would make one lane's
     * passing test meaningless in the other.
     */
    rpc(fn: string, args?: Record<string, unknown>) {
      const entries = Object.entries(args ?? {});
      for (const [name, value] of entries) {
        const kind = value === null ? "null" : typeof value;
        if (!["string", "number", "boolean", "null"].includes(kind)) {
          throw new Error(
            `psql-supabase: rpc("${fn}") argument "${name}" is a ${kind} — ` +
              "add an encoder when a caller needs one.",
          );
        }
      }
      const call =
        entries.length === 0
          ? `${fn}()`
          : `${fn}(${entries
              .map(([name, value]) => `${name} => ${literal(value)}`)
              .join(", ")})`;

      const setReturning = query(
        `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
           select p.proretset as v from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = ${lit(fn)}
           limit 1) t`,
      ).rows[0] as { v: boolean } | undefined;

      const sql = setReturning?.v
        ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${call} t`
        : `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (select ${call} as v) t`;

      const result = query(sql);
      if (result.error) {
        return Promise.resolve({ data: null, error: result.error });
      }
      if (setReturning?.v) {
        return Promise.resolve({ data: result.rows, error: null });
      }
      const row = result.rows[0] as { v: unknown } | undefined;
      return Promise.resolve({ data: row?.v ?? null, error: null });
    },
  };
}
