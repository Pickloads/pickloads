import { execFileSync } from "node:child_process";

/**
 * The one place the integration lane spawns `psql`.
 *
 * WHY THIS EXISTS. The lane used to pass SQL as an argv element (`psql -c
 * "<sql>"`). That is lossy on Windows: `psql` is a C program taking
 * `main(int, char **)`, so the CRT converts the UTF-16 command line to the
 * process ANSI code page before `psql` ever sees it. A fixture containing an
 * em-dash — `'unreadable — photograph it again'` in the M-77 document-review
 * tests — arrived at the server as CP1252 `0x97` and was refused:
 *
 *     ERROR:  invalid byte sequence for encoding "UTF8": 0x97
 *
 * The identical string succeeds through stdin, because stdin is a byte stream
 * with no code-page conversion in the path. On Linux and macOS argv is already
 * UTF-8, which is why the suite was green in CI and red on a developer's
 * Windows machine — the worst shape a portability bug can take.
 *
 * WHAT CHANGED, PRECISELY. `-c <sql>` became stdin. Nothing else. The flags,
 * the database, the environment and the output parsing are untouched, and no
 * assertion was weakened to accommodate the change.
 *
 * WHY STDIN IS SEMANTICALLY SAFE HERE. `-c` sends a whole multi-statement
 * string as one simple-Query message, so it runs in a single implicit
 * transaction; stdin executes statement by statement, autocommitting each.
 * That difference cannot bite this suite:
 *
 *   - `db.ts` passes **single statements only** — no call site in
 *     `tests/integration/*.test.ts` puts a semicolon inside a helper call;
 *   - the two Supabase adapters build multi-statement strings but wrap them
 *     in an explicit `begin; … commit;`, which behaves identically either
 *     way — and is required regardless, because `set local` has no effect
 *     outside a transaction.
 *
 * Verified against PostgreSQL directly before the change: an unterminated
 * final statement still executes at EOF, an explicit transaction block still
 * prints only its payload line under `-q -At`, and `ON_ERROR_STOP=1` still
 * exits non-zero on a failing statement.
 */

/** Environment every psql invocation in the lane shares. */
export function psqlEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: process.env.PGHOST ?? "/tmp/pgsock",
    PGPORT: process.env.PGPORT ?? "5433",
    PGUSER: process.env.PGUSER ?? "postgres",
    // Declare the encoding of what we send rather than inheriting whatever
    // the console happens to be set to. stdin already carries UTF-8 bytes.
    PGCLIENTENCODING: "UTF8",
  };
}

/**
 * Run `sql` through `psql` with `extraArgs`, returning trimmed stdout.
 *
 * The SQL goes in on **stdin**, never as an argv element — see the note above.
 * Throws whatever `execFileSync` throws, so callers keep psql's own message
 * and exit status.
 */
export function runPsql(extraArgs: readonly string[], sql: string): string {
  return execFileSync("psql", [...extraArgs], {
    env: psqlEnv(),
    encoding: "utf8",
    // A trailing newline is not required for the final statement to run, but
    // it keeps psql's own error line numbers honest when a fixture spans
    // several lines.
    input: sql.endsWith("\n") ? sql : `${sql}\n`,
  }).trim();
}
