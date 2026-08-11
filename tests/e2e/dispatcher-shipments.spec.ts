import { expect, test } from "@playwright/test";

/**
 * M-75 — `/portal/admin/shipments`, `/new` and `/[shipmentId]` in a real
 * browser.
 *
 * ── WHAT THIS LANE CAN AND CANNOT PROVE, STATED UP FRONT ──────────────────
 *
 * All three routes sit behind a real Supabase session AND the M-61 staff MFA
 * gate. This lane runs `next start` on PLACEHOLDER credentials by design
 * (M-41) — there is no Supabase, no service-role key and no way to mint a
 * staff session — so a browser here can only ever reach the login bounce. That
 * is not a gap being papered over; it is ASSERTED below, so the limitation is
 * proved rather than assumed, and what it displaces is covered where it can
 * actually be proved:
 *
 *   "the board renders / the filters narrow / a column paginates"
 *       → `tests/integration/dispatcher-operations.test.ts` runs the REAL
 *         column rules and the REAL scope expression against a REAL
 *         PostgreSQL 16, including dispatcher A vs dispatcher B.
 *       → `tests/unit/shipment-board.test.ts` asserts the query SHAPE — the
 *         §25 bound, the scope-before-column ordering, the eight fixed
 *         queries.
 *
 *   "the page is accessible / the tables card up at 320px"
 *       → `tests/unit/dispatcher-shipments-a11y.test.tsx` axe-scans BOTH
 *         views (the same components these routes render) in seven states.
 *
 *   "a dispatcher cannot act on another dispatcher's shipment"
 *       → `tests/unit/dispatcher-shipment-actions.test.ts` drives EVERY
 *         exported action through the refusal; the integration lane proves the
 *         same thing against real rows.
 *
 * Seeding a staff session and a shipment into this lane would mean shipping a
 * fabricated shipment fixture into the product, which §30 forbids in the same
 * breath as fake GPS and fake ETAs.
 */

const BOARD = "/portal/admin/shipments";
const NEW = `${BOARD}/new`;
const DETAIL = `${BOARD}/11111111-1111-1111-1111-111111111111`;
const BAD_ID = `${BOARD}/not-a-uuid`;

test("all three routes exist and are session-gated (no anonymous read path)", async ({
  page,
}) => {
  for (const path of [BOARD, NEW, DETAIL, BAD_ID]) {
    await page.goto(path);
    await expect(
      page,
      `${path} must bounce to /login rather than render`,
    ).toHaveURL(/\/login\?next=/);
  }
});

test("the board's query parameters cannot be used to reach it unauthenticated", async ({
  page,
}) => {
  // Every §14/§5 entry point on the board is a GET parameter. None of them is
  // a second door: the gate is the route, not the query.
  for (const query of [
    "?col=delayed",
    "?col=completed&page=3",
    "?q=PL-2026-000458",
    "?q=000458",
    "?status=in_transit&origin=Newark",
    "?col=../../etc/passwd",
    "?page=999999999",
  ]) {
    await page.goto(`${BOARD}${query}`);
    await expect(page, `${BOARD}${query} must be gated`).toHaveURL(
      /\/login\?next=/,
    );
  }
});

test("the quote-conversion entry point is gated too", async ({ page }) => {
  await page.goto(`${NEW}?quote=11111111-1111-1111-1111-111111111111`);
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("the login bounce preserves the destination, including the shipment id", async ({
  page,
}) => {
  await page.goto(DETAIL);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toContain("/portal/admin/shipments/");
  expect(next).toContain("11111111-1111-1111-1111-111111111111");
});

test("no dispatcher route is indexable or reachable from the sitemap", async ({
  request,
}) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/portal/admin/shipments");
  expect(sitemap).not.toContain("/portal/");
  // §5: a tracking number must never leak into a public artifact.
  expect(sitemap).not.toMatch(/PL-\d{4}-\d{6}/);
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /portal");
});

test("the routes are gated identically in all five locales", async ({ page }) => {
  for (const prefix of ["", "/es", "/fr", "/ru", "/ht"]) {
    for (const path of [BOARD, NEW]) {
      await page.goto(`${prefix}${path}`);
      await expect(page, `${prefix}${path} must be gated`).toHaveURL(
        /\/login\?next=/,
      );
    }
  }
});

test("a shipment id in the URL is never echoed into an indexable page", async ({
  page,
}) => {
  await page.goto(DETAIL);
  const robots = await page
    .locator('meta[name="robots"]')
    .first()
    .getAttribute("content");
  expect(robots ?? "").toContain("noindex");
});

test("a bare POST to a §14 surface reaches the login gate, never the board", async ({
  request,
}) => {
  // A server action is a POST to the page's own URL carrying a Next action
  // header. A bare POST without one must not reach the surface at all: the
  // gate is `requireStaff`, which redirects, so the response an unauthenticated
  // caller gets back is the LOGIN page — never a rendered board or a rendered
  // shipment. Asserting on the BODY rather than the status is the point: the
  // redirect is followed by default, so a 200 here proves nothing on its own.
  for (const path of [BOARD, DETAIL, NEW]) {
    const response = await request.post(path, { data: "shipment_id=x" });
    expect(response.url(), `${path} did not bounce`).toContain("/login");
    const body = await response.text();
    for (const marker of [
      "Needs Carrier",
      "POD Pending",
      "Update status",
      "Record a call",
    ]) {
      expect(body, `${path} leaked "${marker}" to an unauthenticated POST`).not.toContain(
        marker,
      );
    }
    // §5: and no REAL tracking number. Matched as a pattern rather than as the
    // "PL-" prefix (which occurs in hashed asset filenames), and with M-73's
    // documented format EXAMPLE removed first — the login page carries the
    // whole next-intl catalogue, and `tracking_number_hint` says "Format:
    // PL-2026-000458" in it. That string is documentation, not data, and
    // matching it would make this assertion pass or fail on a copy change.
    const FORMAT_EXAMPLE = /PL-2026-000458/g;
    expect(
      body.replace(FORMAT_EXAMPLE, ""),
      `${path} leaked a tracking number`,
    ).not.toMatch(/PL-\d{4}-\d{6}/);
  }
});
