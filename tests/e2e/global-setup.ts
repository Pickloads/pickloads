import { execFileSync } from "node:child_process";

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
];

export default function globalSetup(): void {
  execFileSync("npx", ["vitest", "run", ...SUITES], {
    stdio: "inherit",
    env: process.env,
  });
}
