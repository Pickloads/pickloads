import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * M-40 unit test runner. Node environment by default (pure lib modules);
 * DOM-dependent suites opt in per-file via `// @vitest-environment jsdom`.
 * The `server-only` package throws outside a React Server context, so it is
 * aliased to an empty stub — tests exercise the same modules the server runs.
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
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
