import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * M-78 — §10's ETA architecture and §21's exceptions in a real browser.
 *
 * ── WHAT THIS LANE CAN AND CANNOT PROVE, STATED UP FRONT ──────────────────
 *
 * The named flow is *"a dispatcher logs a delay → the shipper and the public
 * tracking page both show the honest explanation."* Two of its three surfaces
 * sit behind a real Supabase session and the third behind the §4 two-factor
 * lookup, and this lane runs `next start` on PLACEHOLDER credentials by design
 * (M-41): no Supabase project, no service-role key, no `TRACKING_ACCESS_SECRET`.
 * A browser here reaches the login bounce and the refusal state, and nothing
 * else.
 *
 * That is not a gap being papered over — producing the middle of the flow
 * would mean seeding a fabricated shipment and a fabricated delay into the
 * product, which §30 forbids in the same breath as fake GPS and fake ETAs. The
 * flow is split across four lanes, each proving the part it honestly can:
 *
 *   dispatcher logs the delay → the exception row, its event and its
 *       lifecycle → `tests/integration/shipment-eta-exceptions.test.ts`,
 *       against a REAL PostgreSQL 16 through the REAL 0025 functions.
 *   the shipper sees it → the same file, as a REAL authenticated session under
 *       the REAL policy, plus `supabase/tests/20_rls_isolation.sql`.
 *   the WORDING is honest and translated → `tests/unit/shipment-exceptions.test.ts`
 *       (the D-6 library ×5 locales) and `tracking-result-a11y.test.tsx` /
 *       `shipper-shipments-a11y.test.tsx`, which render the actual banner
 *       components and axe-scan them.
 *
 * What is proved HERE, in a real browser, is the part the other lanes cannot
 * reach: the delay surfaces are session-gated in every locale, the PUBLIC
 * refusal never leaks an exception, the honest ETA labels exist in the built
 * catalogue rather than only in a test fixture, and nothing anywhere claims a
 * predictive or AI ETA.
 */

const STAFF_DETAIL =
  "/portal/admin/shipments/11111111-1111-1111-1111-111111111111";
const SHIPPER_DETAIL =
  "/portal/shipper/shipments/11111111-1111-1111-1111-111111111111";
const CARRIER_DETAIL =
  "/portal/carrier/shipments/11111111-1111-1111-1111-111111111111";

const LOCALES = ["", "/es", "/fr", "/ru", "/ht"] as const;

/** Rendered text only — the RSC flight payload carries the whole catalogue. */
async function visibleText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, template, noscript").forEach((n) => n.remove());
    return clone.textContent ?? "";
  });
}

/* ================================================================== *
 * 1 · The delay surfaces are gated, in every locale
 * ================================================================== */

test("the exception and ETA surfaces are session-gated, in every locale", async ({
  page,
}) => {
  for (const prefix of LOCALES) {
    for (const path of [STAFF_DETAIL, SHIPPER_DETAIL, CARRIER_DETAIL]) {
      await page.goto(`${prefix}${path}`);
      await expect(
        page,
        `${prefix}${path} must bounce to /login rather than render an exception`,
      ).toHaveURL(/\/login/);
    }
  }
});

test("no query parameter turns a gated surface into an exception reader", async ({
  page,
}) => {
  for (const suffix of [
    "?exception_id=88888888-8888-4888-8888-888888888888",
    "?resolve=1&severity=critical",
    "?eta_source=provider",
  ]) {
    await page.goto(`${STAFF_DETAIL}${suffix}`);
    await expect(page).toHaveURL(/\/login/);
  }
});

/* ================================================================== *
 * 2 · The PUBLIC surface never leaks an exception
 * ================================================================== */

test("a refused public lookup shows no exception banner and no internal wording", async ({
  page,
}) => {
  await page.goto("/track");
  await page.fill("#tk-number", "PL-2026-000458");
  await page.fill("#tk-secondary", "07102");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(400);

  const text = await visibleText(page);
  // §21's banner heading must not appear on a refusal, and neither may any of
  // the internal vocabulary an exception carries on the staff side.
  expect(text).not.toContain("There is an issue with this shipment");
  for (const internal of ["Resolution:", "Internal", "assigned to", "blame"]) {
    expect(text.toLowerCase()).not.toContain(internal.toLowerCase());
  }
});

test("no exception surface leaks into a public artifact", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/portal/");
  expect(sitemap).not.toMatch(/PL-\d{4}-\d{6}/);

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /portal");
});

/* ================================================================== *
 * 3 · §30 — the honest labels exist in the BUILT app, not only in a test
 * ================================================================== */

test("the /track page ships §30's honest ETA vocabulary and claims nothing more", async ({
  page,
}) => {
  await page.goto("/track");
  const html = await page.content();

  // The two ETA claims this product can make, both present in the shipped
  // catalogue. `eta_by_dispatcher` is §30's own wording; `eta_estimated` is
  // M-78's, and it exists because rendering a CALCULATED ETA under the
  // dispatcher label would be a lie in the other direction.
  expect(html).toContain("ETA provided by dispatcher");
  expect(html).toContain("Estimated from distance and standard transit times");

  // …and the claims it must never make, anywhere in the document — flight
  // payload included, because that is where the whole catalogue lives.
  for (const forbidden of [
    "AI-powered",
    "AI powered",
    "predictive ETA",
    "predicted arrival",
    "machine learning",
    "real-time GPS",
  ]) {
    expect(html, `the built app must never say "${forbidden}" (§30)`).not.toContain(
      forbidden,
    );
  }
});

test("the honest ETA labels ship in all five locales", async ({ page }) => {
  // Not a fixture assertion: this reads the BUILT page in each locale. A key
  // added to `en.json` alone would render as the key here.
  for (const prefix of LOCALES) {
    await page.goto(`${prefix}/track`);
    const html = await page.content();
    expect(
      html,
      `${prefix || "/"} must carry a translated eta_estimated label`,
    ).not.toContain("shipment.label.eta_estimated");
    expect(html).not.toContain("shipment.phrase.resolution.");
  }
});

/* ================================================================== *
 * 4 · axe — the public surface, scanned for real
 * ================================================================== */

test("the public tracking surface has no WCAG A/AA violations after a refusal", async ({
  page,
}) => {
  await page.goto("/track");
  await page.fill("#tk-number", "PL-2026-000458");
  await page.fill("#tk-secondary", "07102");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
  ).toEqual([]);
});

/* ================================================================== *
 * 5 · Responsive — §22's 320px floor on the surface a customer holds
 * ================================================================== */

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`the tracking surface does not overflow at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/track");
    await page.fill("#tk-number", "PL-2026-000458");
    await page.fill("#tk-secondary", "07102");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `horizontal overflow of ${overflow}px at ${viewport.name} (WCAG 1.4.10)`,
    ).toBeLessThanOrEqual(1);
  });
}

test("the login bounce preserves the exception surface as its destination", async ({
  page,
}) => {
  await page.goto(STAFF_DETAIL);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toContain("/portal/admin/shipments/");
});
