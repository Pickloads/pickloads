/**
 * M-74 — a RECORDING supabase-js client for the unit lane.
 *
 * WHY. §25 makes claims a page cannot prove by reading: *"server-side
 * pagination"*, *"do not load every shipment into the browser"*, *"query
 * current summary separately from full history"*, *"no N+1"*. Those are
 * statements about the SHAPE OF THE QUERIES a module issues — which table,
 * which filters, which bound — and the only way to assert them without a
 * database is to record the calls and look.
 *
 * This is not a database. It executes nothing, returns whatever the test
 * hands it, and implements exactly the builder methods
 * `src/lib/shipments/shipper-{list,detail,tiles}.ts` use. Anything else
 * THROWS, so a future query shape cannot silently take an unrecorded path —
 * the same honesty rule `tests/integration/helpers/psql-supabase.ts` applies
 * to its own adapter.
 *
 * The integration lane proves the queries WORK against real SQL and real RLS.
 * This lane proves they are BOUNDED and SCOPED. Neither answers the other's
 * question.
 */

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface RecordedQuery {
  table: string;
  calls: RecordedCall[];
  /** Convenience: the `select()` column string, if select was called. */
  columns: string | null;
  /** Convenience: the `select()` options object, if any. */
  selectOptions: Record<string, unknown> | null;
}

export interface QueryResult {
  data?: unknown;
  count?: number | null;
  error?: { message: string } | null;
}

/** Per-table canned results. `default` applies when a table has no entry. */
export type ResultMap = Record<string, QueryResult>;

const SUPPORTED = new Set([
  "eq",
  "in",
  "gte",
  "lte",
  "lt",
  "ilike",
  "or",
  "order",
  "range",
  "limit",
]);

class RecordingBuilder implements PromiseLike<QueryResult> {
  constructor(
    private readonly query: RecordedQuery,
    private readonly result: QueryResult,
  ) {}

  private record(method: string, args: unknown[]): this {
    this.query.calls.push({ method, args });
    return this;
  }

  eq(column: string, value: unknown) {
    return this.record("eq", [column, value]);
  }
  in(column: string, values: readonly unknown[]) {
    return this.record("in", [column, values]);
  }
  gte(column: string, value: unknown) {
    return this.record("gte", [column, value]);
  }
  lte(column: string, value: unknown) {
    return this.record("lte", [column, value]);
  }
  lt(column: string, value: unknown) {
    return this.record("lt", [column, value]);
  }
  ilike(column: string, pattern: string) {
    return this.record("ilike", [column, pattern]);
  }
  or(expression: string) {
    return this.record("or", [expression]);
  }
  order(column: string, options?: unknown) {
    return this.record("order", [column, options]);
  }
  range(from: number, to: number) {
    this.record("range", [from, to]);
    return Promise.resolve(this.result);
  }
  limit(n: number) {
    this.record("limit", [n]);
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    this.record("maybeSingle", []);
    return Promise.resolve(this.result);
  }
  then<R1, R2 = never>(
    onfulfilled?: ((v: QueryResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

export interface RecordingClient {
  /** Every query issued, in call order. */
  queries: RecordedQuery[];
  /** Distinct tables touched, in first-touch order. */
  tables(): string[];
  /** All queries against one table. */
  forTable(table: string): RecordedQuery[];
  /** Calls of one method across every query. */
  callsOf(method: string): RecordedCall[];
}

/**
 * Build a recorder. The returned object is BOTH the client passed to the
 * module under test and the recording read afterwards, so a test never has to
 * hold two references in step.
 *
 * The `unknown` cast at the call site is the test's own business: the module
 * signatures take a real `SupabaseClient`, and typing this stub to satisfy
 * that generic would mean reproducing PostgREST's type machinery for no
 * assertion value. `src/**` contains no assertion of any kind (CLAUDE.md).
 */
export function createRecordingClient(results: ResultMap = {}): {
  client: unknown;
  recorder: RecordingClient;
} {
  const queries: RecordedQuery[] = [];

  const client = {
    from(table: string) {
      return {
        select(columns: string, options?: Record<string, unknown>) {
          const query: RecordedQuery = {
            table,
            calls: [{ method: "select", args: [columns, options] }],
            columns,
            selectOptions: options ?? null,
          };
          queries.push(query);
          const result = results[table] ?? results.default ?? { data: [] };
          return new RecordingBuilder(query, result);
        },
        insert() {
          throw new Error(
            `recording-supabase: insert into "${table}" is not supported — ` +
              "M-74 is a read-only module and a write here is a bug, not a gap.",
          );
        },
        update() {
          throw new Error(
            `recording-supabase: update on "${table}" is not supported — ` +
              "M-74 is a read-only module and a write here is a bug, not a gap.",
          );
        },
      };
    },
    rpc() {
      throw new Error("recording-supabase: rpc() is not supported");
    },
  };

  const recorder: RecordingClient = {
    queries,
    tables: () => [...new Set(queries.map((q) => q.table))],
    forTable: (table) => queries.filter((q) => q.table === table),
    callsOf: (method) =>
      queries.flatMap((q) => q.calls.filter((c) => c.method === method)),
  };

  return { client, recorder };
}

/** Method names the recorder knows about — used by the "no unknown call" guard. */
export const RECORDER_SUPPORTED_METHODS = SUPPORTED;
