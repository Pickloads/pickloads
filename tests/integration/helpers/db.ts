import { runPsql } from "./psql-invoke";

/**
 * M-72 — the integration lane's database access.
 *
 * `psql` as a subprocess rather than a Node driver. `pg` would be a new
 * devDependency to keep `npm audit` at zero for, in a lane that runs a handful
 * of statements per test, and `scripts/run-integration-tests.sh` already needs
 * `psql` to build the database from the migration chain. One tool, one code
 * path, no new supply-chain surface.
 *
 * Every helper raises on an unexpected failure; `sqlstateOf` is the one that
 * deliberately swallows an error and hands back its SQLSTATE.
 */

const DB = process.env.INTEGRATION_TEST_DB ?? "pickloads_integration";

function psql(sql: string): string {
  // `-q` matters: without it psql prints the command tag ("INSERT 0 1")
  // alongside a RETURNING row, and `scalar()` would hand back both lines.
  // The SQL itself goes in on stdin, not as an argv element — see
  // `psql-invoke.ts` for why that is load-bearing on Windows.
  return runPsql(["-d", DB, "-q", "-v", "ON_ERROR_STOP=1", "-At"], sql);
}

/** Run a statement for effect. Throws with psql's message on failure. */
export function exec(sql: string): void {
  psql(sql);
}

/** A single scalar, as text. `null` for a SQL NULL or an empty result. */
export function scalar(sql: string): string | null {
  const out = psql(sql);
  return out === "" ? null : out;
}

/** A single scalar as a number. */
export function count(sql: string): number {
  return Number(scalar(sql) ?? "0");
}

/**
 * A single row as JSON. Wrap the query so it returns one `jsonb` column, e.g.
 * `select to_jsonb(t) from (select …) t`.
 */
export function json<T>(sql: string): T {
  const out = psql(sql);
  if (out === "") throw new Error(`no row returned for: ${sql}`);
  return JSON.parse(out) as T;
}

/**
 * The SQLSTATE a statement raises, or `"OK"` if it succeeds.
 *
 * Exact codes matter here: 0019 raises PL404 / PL409 / PL422 for three
 * genuinely different failures, and a test that accepted any of them would
 * pass while a validation bug masqueraded as a race.
 */
export function sqlstateOf(stmt: string): string {
  return scalar(`select itest.sqlstate_of(${lit(stmt)})`) ?? "";
}

/** Quote a value as a SQL string literal. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Quote a nullable value as a literal or the keyword NULL. */
export function litOrNull(value: string | null): string {
  return value === null ? "null" : lit(value);
}

export function openBrokerageGate(): void {
  exec("select itest.open_brokerage_gate()");
}

export function closeBrokerageGate(): void {
  exec("select itest.close_brokerage_gate()");
}
