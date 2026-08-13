import { expect, test } from "@playwright/test";

/**
 * Session termination — the browser-observable half.
 *
 * ── WHAT THIS LANE CAN AND CANNOT PROVE ──────────────────────────────────
 *
 * The e2e lane runs on a PLACEHOLDER Supabase project, so there is no auth
 * server and no way to establish a real session. The sign-out control lives
 * in the portal sidebar, which only renders WITH a session — so clicking the
 * real button end-to-end is not reachable here, and pretending otherwise
 * would be a test that asserts nothing.
 *
 * The action's own behaviour — Supabase `signOut`, the `sb-*` cookie sweep
 * including chunked tokens, surviving an unreachable Supabase, the redirect
 * target and locale — is covered against the action itself in
 * `tests/unit/sign-out-action.test.ts`.
 *
 * What belongs HERE is what only a real browser can answer: that the routes
 * a signed-out user might reach for are closed, and that the back button
 * cannot paint an authenticated page from cache.
 */

const PORTAL_ROUTES = [
  "/portal/shipper",
  "/portal/carrier",
  "/portal/admin",
  "/portal/broker",
];

test.describe("after sign-out, every portal route is closed", () => {
  for (const route of PORTAL_ROUTES) {
    test(`${route} sends an anonymous visitor to /login`, async ({ page }) => {
      await page.goto(route);
      expect(page.url()).toMatch(/\/login/);
      // It must be the auth surface, not a portal page that merely looks empty.
      await expect(page.locator('input[name="password"]')).toBeVisible();
      // Assert on the CONTROL, not on body text. `textContent` includes inline
      // script payloads, and the embedded i18n catalogue legitimately contains
      // the string "Sign out" — the first draft of this test matched that and
      // reported a passing gate as a leak.
      await expect(page.locator(".psignout")).toHaveCount(0);
      await expect(page.locator(".pside")).toHaveCount(0);
    });
  }

  test("the bounce preserves where the user was going", async ({ page }) => {
    await page.goto("/portal/shipper");
    expect(page.url()).toContain("next=");
    expect(decodeURIComponent(page.url())).toContain("/portal/shipper");
  });
});

test.describe("the back button cannot restore an authenticated page", () => {
  test("portal responses are no-store, which disables bfcache", async ({
    request,
  }) => {
    // `no-store` is the specific directive that makes Chrome refuse to put a
    // page in the back/forward cache. Without it, pressing Back after signing
    // out repaints the last authenticated render from memory — the data is
    // stale and the session is gone, but the customer sees their dashboard.
    //
    // `/portal` is the one portal-shell route reachable signed-out, so it is
    // the only one this lane can measure. Every /portal/* page is declared
    // `force-dynamic` exactly as this one is, which is what produces the
    // header.
    const res = await request.get("/portal");
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toContain("no-store");
    expect(cc).toContain("private");
  });

  test("returning to a portal route re-runs the gate", async ({ page }) => {
    await page.goto("/");
    await page.goto("/portal/carrier"); // bounced to /login
    await page.waitForURL(/\/login/);

    await page.goBack();
    await page.waitForLoadState("domcontentloaded");

    // Re-entering the portal route is what a back/forward walk amounts to.
    // The gate must run again rather than painting a cached portal render.
    await page.goto("/portal/carrier");
    await page.waitForURL(/\/login/);

    await expect(page.locator(".psignout")).toHaveCount(0);
    await expect(page.locator(".pside")).toHaveCount(0);
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });
});

test.describe("no GET route can terminate or fake a session", () => {
  test("there is no /logout or /signout GET endpoint", async ({ request }) => {
    // A GET sign-out is CSRF-able and gets fired by link prefetchers and
    // antivirus scanners. If one is ever added, this fails.
    for (const path of ["/logout", "/signout", "/sign-out", "/api/logout"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(
        res.status(),
        `${path} should not exist as a GET endpoint`,
      ).toBeGreaterThanOrEqual(400);
    }
  });
});
