import { expect, test } from "@playwright/test";

/**
 * M-74 — `/portal/shipper/shipments` and `/portal/shipper/shipments/[id]` in a
 * real browser.
 *
 * ── WHAT THIS LANE CAN AND CANNOT PROVE, STATED UP FRONT ──────────────────
 *
 * Both routes sit behind a real Supabase session. This lane runs `next start`
 * on PLACEHOLDER credentials by design (M-41) — there is no Supabase, no
 * service-role key and no way to mint a session — so a browser here can only
 * ever reach the login bounce. That is not a gap being papered over; it is
 * ASSERTED below, so the limitation is proved rather than assumed, and the
 * three things it displaces are covered where they can actually be proved:
 *
 *   "list renders" / "filter narrows" / "detail opens"
 *       → `tests/integration/shipper-shipments.test.ts` runs the REAL query
 *         builders against a REAL PostgreSQL 16 as a REAL authenticated
 *         session, and asserts each of the nine §11 filters narrows a real
 *         result set. That is a stronger claim than a browser assertion,
 *         because it includes the RLS policy.
 *       → `tests/unit/shipper-shipments-a11y.test.tsx` renders BOTH views
 *         (the same components the routes render) and asserts the table, the
 *         card transform, the filter labels, the pager hrefs and the ten §11
 *         detail blocks.
 *
 *   "unauthorized shipmentId 404s"
 *       → the route's `notFound()` path is driven by `getShipmentSummary`
 *         returning null, which the integration lane proves for a malformed
 *         id, a nonexistent id AND another shipper's id. Here we prove the
 *         layer in front of it: an unauthenticated request never reaches the
 *         handler at all.
 *
 * Seeding a session and a shipment into this lane would mean shipping a
 * fabricated shipment fixture into the product, which §30 forbids in the same
 * breath as fake GPS and fake ETAs.
 */

const LIST = "/portal/shipper/shipments";
const DETAIL = `${LIST}/11111111-1111-1111-1111-111111111111`;
const BAD_ID = `${LIST}/not-a-uuid`;

test("both routes exist and are session-gated (no anonymous read path)", async ({
  page,
}) => {
  for (const path of [LIST, DETAIL, BAD_ID]) {
    await page.goto(path);
    await expect(
      page,
      `${path} must bounce to /login rather than render`,
    ).toHaveURL(/\/login\?next=/);
  }
});

test("the login bounce preserves the destination, including the shipment id", async ({
  page,
}) => {
  await page.goto(DETAIL);
  const url = new URL(page.url());
  const next = url.searchParams.get("next");
  expect(next).toContain("/portal/shipper/shipments/");
  expect(next).toContain("11111111-1111-1111-1111-111111111111");
});

test("neither route is indexable or reachable from the sitemap", async ({
  request,
}) => {
  // §11's surfaces are private. The pages carry `robots: index:false`, but the
  // stronger property is that they never appear in the sitemap at all.
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/portal/shipper/shipments");
  expect(sitemap).not.toContain("/portal/");

  // And a tracking number must never leak into a public artifact.
  expect(sitemap).not.toMatch(/PL-\d{4}-\d{6}/);
  // M-15's rule is `Disallow: /portal`, which covers every path beneath it.
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /portal");
});

test("the localized routes are gated identically in all five locales", async ({
  page,
}) => {
  for (const prefix of ["", "/es", "/fr", "/ru", "/ht"]) {
    await page.goto(`${prefix}${LIST}`);
    await expect(page, `${prefix}${LIST} must be gated`).toHaveURL(
      /\/login\?next=/,
    );
  }
});

test("a shipment id in the URL is never echoed into an indexable page", async ({
  page,
}) => {
  // The bounce target is a query parameter on /login, which is `noindex`.
  await page.goto(DETAIL);
  const robots = await page
    .locator('meta[name="robots"]')
    .first()
    .getAttribute("content");
  expect(robots ?? "").toContain("noindex");
});
