import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * M-59 — automated WCAG 2.2 AA scans (axe-core) over the major public +
 * auth surfaces, plus the pre-auth /portal selection page.
 *
 * Portal-internal pages (carrier/shipper/admin) sit behind a real Supabase
 * session and cannot be scanned in the secretless e2e lane; their markup
 * shares the same audited vocabulary (portal.css + the components scanned
 * here) and the manual audit is documented in docs/modules/M-59.
 *
 * Scope: wcag2a/wcag2aa/wcag21a/wcag21aa/wcag22aa tags. The V4 palette's
 * two known AA contrast exceptions are token-level decisions (Q7,
 * docs/modules/M-00) — anything newly reported fails the build.
 */

const PAGES = [
  "/",
  "/about",
  "/contact",
  "/faq",
  /* M-73: the public tracking LOOKUP page. The RESULT view cannot be scanned
   * here — a live result needs a shipment in a database and this lane runs on
   * placeholder credentials by design — so it is scanned with the same
   * axe-core engine against the same component in
   * tests/unit/tracking-result-a11y.test.tsx, which explains the split. */
  "/track",
  /* M-76: the DRIVER update link. Unlike every other tracking surface this is
   * unauthenticated, so the real page is scanned in a real browser — which is
   * what makes its colour contrast (jsdom cannot see it) covered. What renders
   * here is the honest refusal card, because a token cannot be redeemed
   * without a database; the GRANTED state is scanned with the same axe-core
   * engine in tests/unit/carrier-driver-a11y.test.tsx. 43 "A"s is the exact
   * shape of a real token. */
  `/driver/update/${"A".repeat(43)}`,
  "/shippers",
  "/become-a-carrier",
  "/start-your-trucking-company",
  "/truck-dispatch",
  "/dispatch/dry-van",
  "/blog",
  "/login",
  "/create-account",
  "/create-account/carrier",
  "/create-account/shipper",
  "/forgot-password",
  "/portal",
];

/*
 * M-74 — `/portal/shipper/shipments` and its `[shipmentId]` detail are NOT in
 * the list above, for the same reason the note at the top of this file gives:
 * they sit behind a Supabase session this lane cannot mint. They are scanned
 * with the SAME axe-core engine, in nine states and three locales, against the
 * same components the routes render, in
 * `tests/unit/shipper-shipments-a11y.test.tsx` — and
 * `tests/e2e/shipper-shipments.spec.ts` asserts the session gate, so the
 * split is proved rather than assumed.
 *
 * M-75 — `/portal/admin/shipments`, its `new` and `[shipmentId]` routes are
 * absent for the same reason and are covered the same way: they sit behind a
 * staff session AND the M-61 MFA step-up, they are axe-scanned in seven states
 * in `tests/unit/dispatcher-shipments-a11y.test.tsx` (board, scoped board,
 * expanded column, failed column, full detail, dispatcher detail, terminal
 * detail), and `tests/e2e/dispatcher-shipments.spec.ts` asserts the gate.
 *
 * M-76 — `/portal/carrier/shipments` and its `[shipmentId]` detail are absent
 * for the same reason (a carrier session this lane cannot mint) and are
 * covered the same way: eight axe states in
 * `tests/unit/carrier-driver-a11y.test.tsx`, with the session gate asserted in
 * `tests/e2e/carrier-driver-updates.spec.ts`. The DRIVER page is in the list
 * above precisely because it needs no session — that is the point of it.
 */

for (const path of PAGES) {
  test(`axe: ${path} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}

test("skip link is the first focusable element and targets #main", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const active = page.locator(":focus");
  await expect(active).toHaveClass("skip-link");
  await expect(active).toHaveAttribute("href", "#main");
  await expect(page.locator("main#main")).toHaveCount(1);
});

test("no horizontal overflow at 320px on key public pages", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 800 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  for (const path of ["/", "/about", "/contact", "/shippers", "/login", "/track"]) {
    await page.goto(path);
    const over = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(over, `${path} overflows horizontally by ${over}px`).toBeLessThanOrEqual(1);
  }
  await ctx.close();
});
