import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * M-72 — the integration lane (`docs/DIRECTIVE-tracking` §27, restored by
 * `FINAL-IMPLEMENTATION-PLAN` §4 as M-83b; this is its first instalment).
 *
 * Separate from `vitest.config.ts` on purpose. That lane is secretless, has no
 * database and must stay that way — 353 unit tests depend on it running
 * anywhere. This one requires a live PostgreSQL 16 that
 * `scripts/run-integration-tests.sh` has already built from the migration
 * chain, so it can never be part of the default `npm test`.
 *
 * Single-threaded and sequential: every test in the lane shares one database.
 * Parallel workers would interleave transitions on the same shipment and turn
 * a compare-and-swap conflict — the thing this lane exists to prove works —
 * into a flake.
 */
/**
 * Every database call in this lane is a fresh `psql` subprocess (see
 * tests/integration/helpers/psql-invoke.ts). On Linux that is a few
 * milliseconds; on Windows, process creation plus a TCP connect and auth costs
 * roughly two seconds EACH, so a fixture running twenty statements needs forty
 * seconds before it has asserted anything.
 *
 * Left at the defaults, the lane did not fail — it lied. Twelve `beforeAll`
 * hooks blew the 10s hook budget, and vitest reports a file whose hook failed
 * as *skipped* tests: 346 of 369 "skipped", 1 timed out, and not one assertion
 * actually disagreed with the code. A suite that reports skips instead of
 * failures is worse than a red one.
 *
 * So the budgets are scaled by platform rather than raised globally: a real
 * hang on Linux still trips in seconds, and Windows gets the room its process
 * model costs. The proper fix is a persistent connection instead of a
 * subprocess per statement, which would make this scaling unnecessary — see
 * docs/FINAL-WEBSITE-TECHNICAL-READINESS.md §9.
 */
const SPAWN_COST_FACTOR = process.platform === "win32" ? 6 : 1;

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/unit/stubs/server-only.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    // psql subprocesses on a cold database are slower than a pure unit test.
    testTimeout: 30_000 * SPAWN_COST_FACTOR,
    // Was never set, so it sat at vitest's 10s default while testTimeout was
    // tripled — the asymmetry is what turned a slow lane into a silent one.
    // Fixtures here do strictly more work than the tests they set up.
    hookTimeout: 30_000 * SPAWN_COST_FACTOR,
  },
});
