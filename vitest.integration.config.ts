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
    testTimeout: 30_000,
  },
});
