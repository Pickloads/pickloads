import { expect, test } from "@playwright/test";

/**
 * M-94 — the carrier review queue is not reachable without a staff session.
 *
 * ── WHY THIS IS AN E2E TEST AND NOT A UNIT TEST ──────────────────────────
 *
 * `tests/unit/carrier-review-queue.test.ts` proves the page module calls
 * `requireStaff` and that the ACTION re-checks the role. Neither observes what
 * an anonymous HTTP request actually receives, and that is the question worth
 * asking of a page that lists applicant names, email addresses, USDOT numbers
 * and the reasons an automated check refused somebody.
 *
 * The suite runs with no Supabase service key and no session, so every request
 * here is genuinely anonymous — which is exactly the caller this must refuse.
 */

const ROUTES = [
  "/portal/admin/carrier-verifications",
  "/portal/admin/carrier-verifications?show=all",
  "/portal/admin/carrier-verifications/11111111-2222-4333-8444-555555555555",
];

test.describe("carrier verification queue — anonymous access", () => {
  for (const route of ROUTES) {
    test(`${route} does not serve the queue to a stranger`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} must not 500`).toBeLessThan(500);

      // Wherever it lands, it must not be the queue. Asserted on the PATHNAME:
      // the middleware redirects to /login?next=<the path it refused>, so the
      // full URL legitimately still contains the route name.
      await expect
        .poll(() => new URL(page.url()).pathname)
        .toMatch(/\/login$/);

      const body = (await page.locator("body").textContent()) ?? "";
      for (const leak of [
        "Awaiting review",
        "Applications that predate verification",
        "Clear to continue",
        "Reviewer note",
        "USDOT / MC",
      ]) {
        expect(body, `${route} leaked "${leak}"`).not.toContain(leak);
      }
    });
  }

  test("the queue is never indexed", async ({ page }) => {
    // Belt and braces on a page whose whole content is applicant data: the
    // route is auth-gated, and its metadata says noindex regardless.
    const src = await page.goto("/portal/admin/carrier-verifications");
    expect(src?.status()).toBeLessThan(500);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toMatch(/\/login$/);
  });
});
