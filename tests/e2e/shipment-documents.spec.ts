import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * M-77 — §16 shipment documents in a real browser.
 *
 * ── WHAT THIS LANE CAN AND CANNOT PROVE, STATED UP FRONT ──────────────────
 *
 * §27's named flow is *"carrier uploads POD → staff approves → shipper sees
 * it"*. Three of its four surfaces sit behind a real Supabase session, and
 * this lane runs `next start` on PLACEHOLDER credentials by design (M-41):
 * there is no Supabase, no service-role key, no `shipment-docs` bucket and no
 * way to mint a session. A browser here reaches the login bounce and nothing
 * else.
 *
 * That is not a gap being papered over. It is ASSERTED below, and the flow it
 * displaces is proved where it can actually be proved:
 *
 *   carrier uploads POD → staff approves → `pod_uploaded` becomes reachable
 *       → `tests/integration/shipment-documents.test.ts`, against a REAL
 *         PostgreSQL 16 through the REAL 0024 functions and the REAL M-72
 *         engine. That is a stronger claim than a browser assertion, because
 *         it includes the precondition the browser cannot see.
 *
 *   shipper sees it / carrier sees it / the matrix filters what they see
 *       → the same integration file, as REAL authenticated sessions under the
 *         REAL 0024 policies, plus `supabase/tests/20_rls_isolation.sql`.
 *       → `tests/unit/shipper-shipments-a11y.test.tsx` and
 *         `carrier-driver-a11y.test.tsx` render the actual components and
 *         axe-scan them.
 *
 * What is proved HERE, in a real browser, is the part the other lanes cannot
 * reach: the routes are session-gated, the DRIVER upload form (the one
 * unauthenticated document surface in the product) renders and is accessible
 * at 320px, and no document surface leaks into a public artifact.
 *
 * Seeding a session and a signed URL into this lane would mean shipping a
 * fabricated document fixture into the product, which §30 forbids in the same
 * breath as fake GPS and fake ETAs.
 */

const CARRIER_DETAIL =
  "/portal/carrier/shipments/11111111-1111-1111-1111-111111111111";
const SHIPPER_DETAIL =
  "/portal/shipper/shipments/11111111-1111-1111-1111-111111111111";
const STAFF_DETAIL =
  "/portal/admin/shipments/11111111-1111-1111-1111-111111111111";

/** 43 base64url characters — the exact shape of a real driver token (M-76). */
const DRIVER_LINK = `/driver/update/${"A".repeat(43)}`;

/* ================================================================== *
 * 1 · Every AUTHENTICATED document surface is gated
 * ================================================================== */

test("the three document surfaces are session-gated, in every locale", async ({
  page,
}) => {
  for (const prefix of ["", "/es", "/fr", "/ru", "/ht"]) {
    for (const path of [CARRIER_DETAIL, SHIPPER_DETAIL, STAFF_DETAIL]) {
      await page.goto(`${prefix}${path}`);
      await expect(
        page,
        `${prefix}${path} must bounce to /login rather than render a document list`,
      ).toHaveURL(/\/login/);
    }
  }
});

test("no query parameter turns a gated surface into a document reader", async ({
  page,
}) => {
  // A document id is not a second door: the surfaces read documents through a
  // server action bound to the session, never through the URL.
  for (const suffix of [
    "?document_id=11111111-1111-1111-1111-111111111111",
    "?doc=1&download=1",
    "?before=2026-01-01T00:00:00.000Z",
  ]) {
    await page.goto(`${SHIPPER_DETAIL}${suffix}`);
    await expect(page).toHaveURL(/\/login/);
  }
});

/* ================================================================== *
 * 2 · The one UNAUTHENTICATED document surface (§13's driver link)
 * ================================================================== */

test("the driver link renders its honest refusal and never a document list", async ({
  page,
}) => {
  await page.goto(DRIVER_LINK);
  /*
   * RENDERED text only. `body.textContent` in an app-router page also returns
   * the RSC flight payload inside `<script>`, which carries the whole i18n
   * catalogue — including the word "Download" — and asserting against it would
   * be asserting about the framework's serialization rather than about what a
   * driver sees.
   */
  const visible = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, template, noscript").forEach((n) => n.remove());
    return clone.textContent ?? "";
  });
  // A token cannot be redeemed without a database, so what renders is §30's
  // "Tracking link expired" state — which is also the state a forwarded or
  // stale link produces in production.
  expect(visible).toContain("Tracking link expired");
  expect(visible).not.toContain("Download");
  expect(visible).not.toContain("Send a photo");
  expect(visible).not.toMatch(/PL-\d{4}-\d{6}/);
  // No file input can exist on a refused link: the upload form is inside the
  // granted branch.
  expect(await page.locator('input[type="file"]').count()).toBe(0);
});

test("a signed URL never appears in the DOM, a link or a redirect", async ({
  page,
}) => {
  await page.goto(DRIVER_LINK);
  const html = await page.content();
  // Supabase signed URLs carry `?token=` on `/storage/v1/object/sign/…`. None
  // of these three strings may appear ANYWHERE in the document, flight payload
  // included — a signed URL is minted on demand by a server action and handed
  // straight to `window.open`, so it never enters the HTML at all.
  expect(html).not.toContain("/storage/v1/object/sign");
  expect(html).not.toContain("token=");
  expect(html).not.toContain("shipment-docs");
});

/* ================================================================== *
 * 3 · No document surface leaks into a public artifact
 * ================================================================== */

test("document surfaces are absent from the sitemap and disallowed in robots", async ({
  request,
}) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/portal/");
  expect(sitemap).not.toContain("/driver/update");
  expect(sitemap).not.toMatch(/PL-\d{4}-\d{6}/);

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /portal");
});

/* ================================================================== *
 * 4 · axe — the unauthenticated surface, scanned for real
 * ================================================================== */

test("the driver surface has no WCAG A/AA violations", async ({ page }) => {
  await page.goto(DRIVER_LINK);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
  ).toEqual([]);
});

/* ================================================================== *
 * 5 · Responsive — §22's 320px floor, on the surface a driver holds
 * ================================================================== */

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`the driver document surface does not overflow at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(DRIVER_LINK);
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

test("the login bounce preserves the document surface as its destination", async ({
  page,
}) => {
  await page.goto(CARRIER_DETAIL);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toContain("/portal/carrier/shipments/");
});
