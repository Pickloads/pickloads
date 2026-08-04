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
  for (const path of ["/", "/about", "/contact", "/shippers", "/login"]) {
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
