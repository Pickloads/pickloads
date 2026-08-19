import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * M-82 — regenerate the browser-harness fixtures before the Playwright run.
 *
 * The six a11y suites listed below render every session-gated tracking surface
 * from the real components and write the resulting DOM to
 * `test-results/tracking-harness/` (see `tests/harness/emit.ts`).
 * `tracking-responsive-a11y.spec.ts` then measures those files in Chromium
 * behind the real compiled stylesheets.
 *
 * Running them HERE rather than relying on `npm test` having run first is
 * deliberate: a gate that only passes when two commands are run in the right
 * order is a gate that will eventually be run in the wrong order and pass
 * anyway. This costs ~15s and makes `npx playwright test` self-sufficient.
 *
 * There is no skip switch. If this step fails, the run fails — the fixtures
 * being stale is exactly the failure mode the module exists to prevent.
 */
const SUITES = [
  "tests/unit/tracking-result-a11y.test.tsx",
  "tests/unit/shipper-shipments-a11y.test.tsx",
  "tests/unit/dispatcher-shipments-a11y.test.tsx",
  "tests/unit/carrier-driver-a11y.test.tsx",
  "tests/unit/broker-portal-a11y.test.tsx",
  "tests/unit/shipment-map-a11y.test.tsx",
  // M-99 — the admin verification surfaces emit their own fixtures for
  // tests/e2e/admin-responsive-a11y.spec.ts, for the same reason: they are
  // session-gated, so the browser lane cannot reach the real route.
  "tests/unit/admin-verifications-a11y.test.tsx",
  "tests/unit/admin-mapped-vocabulary.test.tsx",
  "tests/unit/leads-board-harness.test.tsx",
  "tests/unit/security-log-a11y.test.tsx",
  "tests/unit/settings-harness.test.tsx",
];

/**
 * vitest's real entry script, resolved from this package's own dependency.
 *
 * Anchored on the project's `package.json` rather than `import.meta.url`:
 * Playwright loads this setup file as CommonJS, where `import.meta` is a
 * syntax error. `process.cwd()` is the project root under `playwright test`.
 */
const VITEST_BIN = createRequire(resolve(process.cwd(), "package.json")).resolve(
  "vitest/vitest.mjs",
);

export default function globalSetup(): void {
  // `npx` is a shell shim (`npx.cmd`) on Windows, so execFileSync cannot find
  // it without a shell and the whole run dies at setup with a bare
  // `spawnSync npx ENOENT`. Resolve vitest's own entry point instead: it is a
  // real .mjs file on every platform, needs no shell, and cannot pick up a
  // different `vitest` from the PATH.
  execFileSync(process.execPath, [VITEST_BIN, "run", ...SUITES], {
    stdio: "inherit",
    env: process.env,
  });
}
