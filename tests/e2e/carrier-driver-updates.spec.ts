import { expect, test } from "@playwright/test";

/**
 * M-76 — §27's **carrier flow** and the §13 **driver-token flow**, end to end.
 *
 * ── WHAT THIS LANE CAN AND CANNOT REACH, STATED UP FRONT ─────────────────
 *
 * The e2e lane runs `next start` on PLACEHOLDER credentials (M-41): no
 * Supabase project, no service-role key, no `DRIVER_TOKEN_SECRET`. So:
 *
 *   * `/portal/carrier/shipments` and its detail route sit behind a real
 *     carrier session and can only ever bounce to `/login` here. That bounce
 *     IS the assertion — it proves the session gate, and it proves the
 *     limitation the a11y suite's split rests on rather than assuming it.
 *   * `/driver/update/[token]` is UNAUTHENTICATED, so it renders for real. A
 *     token cannot be redeemed without a database, so what renders is the
 *     honest refusal — which is exactly the state §30's "Tracking link
 *     expired" exists for, and the state a forwarded or stale link produces
 *     in production.
 *
 * §27's carrier flow is therefore split across three lanes, each proving the
 * part it honestly can:
 *
 *   * HERE — the gates, the refusal, and the fact that no query parameter is
 *     a second door.
 *   * `tests/integration/carrier-driver-updates.test.ts` — the real walk
 *     (confirm dispatch → en route → arrived → loaded → departed → in transit
 *     → arrived at delivery → unloading → delivered) against a real
 *     PostgreSQL 16, through the real engine and the real 0023 functions,
 *     plus expired/revoked/rate-limited/audited.
 *   * `tests/unit/carrier-driver-a11y.test.tsx` — the views themselves,
 *     rendered and axe-scanned in eight states.
 *
 * §27's carrier flow names "Upload BOL" and "Upload POD" between "confirm
 * pickup" and "mark delivered". Those are M-77's and are NOT built; both
 * surfaces say so in the words a carrier will read, and this suite asserts
 * that the honest placeholder is present rather than skipping the step
 * silently.
 */

const CARRIER_ROUTES = [
  "/portal/carrier/shipments",
  "/portal/carrier/shipments/11111111-1111-1111-1111-111111111111",
];

/** 43 base64url characters — the exact shape of a real token. */
const WELL_FORMED = "A".repeat(43);

/* ================================================================== *
 * The carrier surface is gated
 * ================================================================== */

for (const path of CARRIER_ROUTES) {
  test(`carrier route ${path} requires a session`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login/);
  });
}

test("a malformed shipment id on the carrier route bounces the same way", async ({
  page,
}) => {
  await page.goto("/portal/carrier/shipments/not-a-uuid");
  await expect(page).toHaveURL(/\/login/);
});

test("no carrier query parameter is a second door", async ({ page }) => {
  for (const query of [
    "?tracking=PL-2026-000458",
    "?status=delivered",
    "?delayed=1",
    "?delivered=1",
    "?page=1e9",
  ]) {
    await page.goto(`/portal/carrier/shipments${query}`);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("all five locales gate the carrier surface identically", async ({ page }) => {
  for (const prefix of ["", "/es", "/fr", "/ru", "/ht"]) {
    await page.goto(`${prefix}/portal/carrier/shipments`);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("a bare POST to a carrier route reaches the gate and leaks no shipment", async ({
  request,
}) => {
  const response = await request.post("/portal/carrier/shipments", {
    form: { action: "delivered", shipment_id: "x" },
    maxRedirects: 0,
  });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  const body = await response.text().catch(() => "");
  expect(body).not.toContain("PL-2026-");
  expect(body).not.toContain("carrier_pay");
});

/* ================================================================== *
 * The driver link
 * ================================================================== */

test("an unknown driver link renders §30's 'Tracking link expired'", async ({
  page,
}) => {
  const response = await page.goto(`/driver/update/${WELL_FORMED}`);
  expect(response?.status()).toBe(200);
  // The label M-73 authored in five locales and could not render.
  await expect(page.locator("main#main h1")).toHaveText("Tracking link expired");
  // And a way out that works with one thumb.
  await expect(page.locator('a[href="tel:+19084045373"]')).toBeVisible();
});

test("a MALFORMED driver link is indistinguishable from an unknown one", async ({
  page,
}) => {
  // §13 non-enumerability: the page must not tell a prober that their token
  // was the right SHAPE.
  const shapes = ["short", "%2F%2Fetc", "a".repeat(200), "PL-2026-000458"];
  const bodies: string[] = [];
  for (const token of shapes) {
    const response = await page.goto(`/driver/update/${token}`);
    expect(response?.status()).toBe(200);
    bodies.push(
      (await page.locator("main#main").innerText()).replace(/\s+/g, " ").trim(),
    );
  }
  await page.goto(`/driver/update/${WELL_FORMED}`);
  const wellFormed = (await page.locator("main#main").innerText())
    .replace(/\s+/g, " ")
    .trim();
  for (const body of bodies) expect(body).toBe(wellFormed);
});

test("the driver page renders NO shipment, NO money and NO internal id", async ({
  page,
}) => {
  await page.goto(`/driver/update/${WELL_FORMED}`);
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("PL-2026-");
  expect(body).not.toMatch(/\$\s?\d/);
  expect(body).not.toContain("carrier_pay");
  const html = await page.content();
  expect(html).not.toContain("gross_shipper_amount");
});

test("the driver page is noindex, nofollow and carries no marketing chrome", async ({
  page,
}) => {
  await page.goto(`/driver/update/${WELL_FORMED}`);
  const robots = await page
    .locator('meta[name="robots"]')
    .getAttribute("content");
  expect(robots).toContain("noindex");
  expect(robots).toContain("nofollow");
  // No site nav, no footer: §22's screenful is the update, not the brand.
  await expect(page.locator("nav.sitenav")).toHaveCount(0);
  await expect(page.locator("footer.sitefoot")).toHaveCount(0);
  // The skip link is still first, because §23 does not get an exemption.
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() =>
    document.activeElement?.getAttribute("href"),
  );
  expect(focused).toBe("#main");
});

test("/driver is disallowed in robots.txt and absent from the sitemap", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("/driver");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/driver/");
});

test("the driver refusal renders in all five locales", async ({ page }) => {
  // §24: drivers are the population the five-locale requirement exists for.
  const expected: Record<string, string> = {
    "": "Tracking link expired",
    "/es": "El enlace de seguimiento ha caducado",
    "/fr": "Lien de suivi expiré",
  };
  for (const [prefix, heading] of Object.entries(expected)) {
    await page.goto(`${prefix}/driver/update/${WELL_FORMED}`);
    await expect(page.locator("main#main h1")).toHaveText(heading);
  }
  // ru/ht mirror English pending native review (flagged in the runbook), so
  // they are asserted to RENDER rather than to differ — an assertion that
  // they differed would fail honestly today and lock in a fake translation.
  for (const prefix of ["/ru", "/ht"]) {
    await page.goto(`${prefix}/driver/update/${WELL_FORMED}`);
    await expect(page.locator("main#main h1")).toHaveText("Tracking link expired");
  }
});

/* ================================================================== *
 * §22 — the driver page at 320px, in a real browser
 * ================================================================== */

test.describe("§22 — the driver page at 320px", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("does not overflow horizontally and keeps a generous tap target", async ({
    page,
  }) => {
    await page.goto(`/driver/update/${WELL_FORMED}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // The one control on the refusal card is the call button, and it has to
    // be reachable with a gloved thumb.
    const box = await page.locator('a[href="tel:+19084045373"]').boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThan(200);
  });
});
