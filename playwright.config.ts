import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e suite (M-41 → M-84). Runs against a production build:
 *   npm run build && npm run test:e2e
 * The webServer block starts `next start` on :4321 (it does NOT build —
 * building inside the webServer timeout window is flaky by design).
 *
 * BROWSER RESOLUTION. This config used to hard-pin
 *   launchOptions: { executablePath: "/opt/pw-browsers/chromium" }
 * which is a path that exists on exactly one container. Every one of the 371
 * tests failed in ~1 ms anywhere else — on a developer machine and on any
 * standard CI runner — so the responsive and accessibility guarantees the
 * suite exists to prove had never actually been executed outside that image.
 * M-84's own acceptance criterion forbids calling the module complete while
 * that is true.
 *
 * The default is now Playwright's own resolution (`npx playwright install
 * chromium`). An explicit binary is still supported for image-provisioned
 * environments, but it is OPT-IN via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH and
 * never required. Setting the variable to a path that does not exist is a
 * configuration error worth failing loudly on, so it is passed through as
 * given rather than silently ignored.
 */
const PORT = 4321;

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();

export default defineConfig({
  testDir: "tests/e2e",
  // M-82: rebuild the session-gated tracking fixtures the responsive/a11y
  // suite measures. See tests/e2e/global-setup.ts for why it is not optional.
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Omitted entirely when the variable is unset — Playwright then uses
        // the browser it installed, which is the portable default.
        ...(CHROMIUM_PATH
          ? { launchOptions: { executablePath: CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    /**
     * NEVER REUSE. This was `true`, and it cost a whole session.
     *
     * A server left running on :4321 from an earlier build is invisible to the
     * suite: Playwright attaches to it, every test runs against stale HTML, and
     * the failures look like defects in the code you just wrote. During the PWA
     * work that produced hours of false evidence and a revert of work that was
     * probably correct.
     *
     * With `false`, an occupied port makes the run FAIL IMMEDIATELY with an
     * address-in-use error instead of quietly testing yesterday's build. A loud
     * failure you can fix in ten seconds beats a silent one you chase for an
     * afternoon.
     *
     * The cost is one server start per run (~2s). That is the correct trade for
     * a suite whose entire value is telling the truth about the current build.
     */
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
