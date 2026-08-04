import { defineConfig, devices } from "@playwright/test";

/**
 * M-41 e2e smoke suite. Runs against a production build:
 *   npm run build && npm run test:e2e
 * The webServer block starts `next start` on :4321 (it does NOT build —
 * building inside the webServer timeout window is flaky by design).
 * Chromium binary is pinned to the container-provisioned executable.
 */
const PORT = 4321;

export default defineConfig({
  testDir: "tests/e2e",
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
        launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
      },
    },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
