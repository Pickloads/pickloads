import { expect, test } from "@playwright/test";

/**
 * M-73 — §27's **public tracking flow**, end to end:
 *
 *   enter tracking number → enter secondary verification →
 *   view approved public shipment data → invalid access fails safely.
 *
 * ── WHAT THIS LANE CAN AND CANNOT REACH, stated up front ──────────────────
 *
 * The e2e lane runs `next start` on PLACEHOLDER credentials (M-41): no
 * Supabase project, no service-role key, no `TRACKING_ACCESS_SECRET`. So step
 * three — *approved public shipment data* — cannot be produced here without
 * seeding a fabricated shipment into the product, which §30 forbids next to
 * fake GPS and fake ETAs.
 *
 * The flow is therefore split across three lanes, each proving the part it
 * honestly can:
 *
 *   * HERE — the form, the mandatory second factor, and that an invalid
 *     lookup fails safely: one honest message, no shipment data, no leak of
 *     which factor was wrong.
 *   * `tests/integration/public-tracking.test.ts` — the real lookup against a
 *     real PostgreSQL 16: approved data returned, and three refusals proved
 *     byte-identical.
 *   * `tests/unit/tracking-result-a11y.test.tsx` — the result view itself,
 *     rendered and axe-scanned in every state.
 *
 * Writing that down is the point. A green e2e suite that quietly skipped the
 * middle of the flow would be the vacuous kind of green.
 */

const NUMBER = "#tk-number";
const SECONDARY = "#tk-secondary";

test("the /track page offers a TWO-factor lookup (§4)", async ({ page }) => {
  await page.goto("/track");

  await expect(page.locator("main#main h1")).toHaveText("Track a shipment");
  await expect(page.locator(NUMBER)).toBeVisible();
  await expect(page.locator(SECONDARY)).toBeVisible();

  // §4: "do not allow tracking by shipment number alone". Both inputs are
  // required, and the label of the second says what it is.
  await expect(page.locator(NUMBER)).toHaveAttribute("required", "");
  await expect(page.locator(SECONDARY)).toHaveAttribute("required", "");
  await expect(
    page.locator('label[for="tk-secondary"]'),
  ).toHaveText("Delivery ZIP code or access code");
});

test("submitting the number alone does not submit at all", async ({ page }) => {
  await page.goto("/track");
  await page.fill(NUMBER, "PL-2026-000458");
  await page.click('button[type="submit"]');

  // The browser blocks it: the second factor is not an optional refinement.
  const valid = await page
    .locator(SECONDARY)
    .evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(valid).toBe(false);
  await expect(page.locator("#track-result")).toHaveCount(0);
});

test("invalid access fails safely — one honest message, no data", async ({
  page,
}) => {
  await page.goto("/track");
  await page.fill(NUMBER, "PL-2026-999999");
  await page.fill(SECONDARY, "99999");
  await page.click('button[type="submit"]');

  const error = page.locator("#tk-err");
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("role", "alert");
  const message = (await error.textContent())?.trim() ?? "";
  expect(message.length).toBeGreaterThan(10);

  // Nothing about a shipment appears. Not a status, not a timeline, not a
  // partial. The result panel is the only thing that renders shipment data and
  // it is absent.
  await expect(page.locator("#track-result")).toHaveCount(0);
  await expect(page.locator(".track-timeline")).toHaveCount(0);

  // And the message says nothing about WHICH factor was wrong — §19's
  // enumeration rule reaching all the way to the rendered sentence.
  for (const leak of [
    "tracking number not found",
    "no such shipment",
    "wrong zip",
    "incorrect access code",
    "invalid code",
  ]) {
    expect(message.toLowerCase()).not.toContain(leak);
  }
});

test("a malformed number and an unknown number fail the same way", async ({
  page,
}) => {
  const attempt = async (number: string) => {
    await page.goto("/track");
    await page.fill(NUMBER, number);
    await page.fill(SECONDARY, "07111");
    await page.click('button[type="submit"]');
    await expect(page.locator("#tk-err")).toBeVisible();
    return (await page.locator("#tk-err").textContent())?.trim();
  };

  const malformed = await attempt("not-a-tracking-number");
  const unknown = await attempt("PL-2026-999999");
  expect(malformed).toBe(unknown);
});

test("the tracking number never enters the URL", async ({ page }) => {
  await page.goto("/track");
  await page.fill(NUMBER, "PL-2026-000458");
  await page.fill(SECONDARY, "07111");
  await page.click('button[type="submit"]');
  await expect(page.locator("#tk-err")).toBeVisible();

  // The lookup is a POST server action, so neither factor reaches the address
  // bar, the browser history, a `Referer` header or a proxy log — and there is
  // no result URL for a crawler to index.
  const url = new URL(page.url());
  expect(url.pathname).toBe("/track");
  expect(url.search).toBe("");
});

test("/track is indexable and in the sitemap; results are not", async ({
  page,
  request,
}) => {
  await page.goto("/track");
  // The FORM page carries no robots meta of its own — it is a legitimate
  // public landing page.
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/track$/,
  );

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/track");
  // Every locale, and nothing shipment-shaped.
  for (const locale of ["/es/track", "/fr/track", "/ru/track", "/ht/track"]) {
    expect(sitemap).toContain(locale);
  }
  expect(sitemap).not.toMatch(/PL-\d{4}-\d{6}/);

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).not.toContain("Disallow: /track");
});

test("the honest pre-brokerage state is shown, not a fake empty tracker", async ({
  page,
}) => {
  await page.goto("/track");
  // `getBooleanSetting` fails closed with no Supabase, so this lane always
  // renders the §2 waitlist wording — which is exactly what production shows
  // until `brokerage_active` flips.
  await expect(page.locator(".track-banner.is-neutral")).toContainText(
    "FMCSA broker authority",
  );
  // §30: no claim of live tracking in this page's own copy.
  //
  // Scoped to `main#main` and read as INNER TEXT, deliberately. `body`'s
  // textContent includes <script> bodies, and next-intl serializes the whole
  // `v4` dictionary into the RSC payload of every page — so a body-wide scan
  // would match the /shippers marketing string "Live tracking" sitting in a
  // dictionary this page never renders. What §30 governs is what a visitor
  // READS, and that is `main`.
  //
  // (Noted for the record, out of M-73's scope: `/shippers` does render
  // "Live tracking" as a V4 prototype marketing claim while tracking is
  // Mode A / manual. That is a §30 audit finding against M-12's page, filed
  // in docs/modules/M-73-public-tracking.md for M-74/M-85 — not something to
  // silently rewrite from inside this module.)
  const main = (await page.locator("main#main").innerText()).toLowerCase();
  for (const claim of ["live tracking", "real-time", "ai-powered"]) {
    expect(main).not.toContain(claim);
  }
});

test("the lookup form is fully keyboard reachable", async ({ page }) => {
  await page.goto("/track");
  await page.locator(NUMBER).focus();
  await page.keyboard.type("PL-2026-000458");
  await page.keyboard.press("Tab");
  await expect(page.locator(SECONDARY)).toBeFocused();
  await page.keyboard.type("07111");
  await page.keyboard.press("Tab");
  await expect(page.locator('button[type="submit"]')).toBeFocused();
});
