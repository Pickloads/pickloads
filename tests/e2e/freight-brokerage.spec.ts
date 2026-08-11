import { expect, test } from "@playwright/test";

/**
 * Freight Brokerage — the shipper-side service page, while the gate is CLOSED.
 *
 * `company_settings.brokerage_active` is false and stays false until the MC
 * authority and the BMC-84 bond are real. The database enforces that
 * (`trg_shipments_brokerage_gate` refuses shipment creation regardless of what
 * any page says) and the RLS suite proves it.
 *
 * What the database cannot enforce is what the page CLAIMS. Operating as a
 * broker without authority is an FMCSA matter, not a marketing one, and the
 * cheapest way to imply it is a confident sentence nobody re-reads. These are
 * the assertions that keep the copy honest while the gate is shut.
 */

/** Claims that assert PickLoads brokers freight TODAY. */
const ACTIVE_BROKERAGE_CLAIMS: Array<[label: string, pattern: RegExp]> = [
  ["licensed/bonded broker", /(licensed|bonded|authorized)\s+(freight\s+)?broker/i],
  ["holds an MC number", /MC\s*#?\s*\d{4,}/i],
  // is/are/now — the first version only matched "is" and the non-vacuity
  // case caught it on "Brokerage operations ARE active".
  ["broker authority is active", /broker(age)?\s+(authority|operations)\s+(is|are|now)?\s*(active|live|open now)/i],
  ["we broker freight today", /we (are|now)\s+brok(er|ing)/i],
  ["bond in place", /(BMC[- ]?84|surety bond)\s+(in place|active|secured)/i],
];

/** Fabrications the directive names explicitly. */
const FABRICATION_CLAIMS: Array<[label: string, pattern: RegExp]> = [
  ["carrier network size", /\b[\d,]{3,}\+?\s+(vetted\s+)?carriers\b/i],
  ["shipment volume", /\b[\d,]{3,}\+?\s+(shipments|loads)\s+(moved|delivered|hauled)/i],
  ["a rate or price", /\$\s?[\d,]+/],
  ["savings claim", /save\s+(up to\s+)?\d+\s?%/i],
  ["live GPS", /live gps tracking|real-time truck location/i],
  ["ELD provider integration", /(motive|samsara|geotab|verizon connect)\s+(integrat|connect)/i],
];

test.describe("Freight Brokerage (gate closed)", () => {
  test("renders the shipper service page", async ({ page }) => {
    await page.goto("/shippers");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("main")).toContainText(/freight|shipper/i);
  });

  test("claims NO active broker authority", async ({ page }) => {
    await page.goto("/shippers");
    const body = (await page.locator("main").textContent()) ?? "";
    for (const [label, pattern] of ACTIVE_BROKERAGE_CLAIMS) {
      expect(body, `page claims ${label}`).not.toMatch(pattern);
    }
    expect(body.length).toBeGreaterThan(600);
  });

  test("fabricates no network size, volume, rate, saving or GPS capability", async ({
    page,
  }) => {
    await page.goto("/shippers");
    const body = (await page.locator("main").textContent()) ?? "";
    for (const [label, pattern] of FABRICATION_CLAIMS) {
      expect(body, `page fabricates ${label}`).not.toMatch(pattern);
    }
  });

  test("NON-VACUITY: the patterns catch the claims they exist to catch", async () => {
    const wouldBeBad: Array<[string, RegExp[]]> = [
      ["We are a licensed freight broker", ACTIVE_BROKERAGE_CLAIMS.map(([, p]) => p)],
      ["MC #1234567", ACTIVE_BROKERAGE_CLAIMS.map(([, p]) => p)],
      ["Brokerage operations are active", ACTIVE_BROKERAGE_CLAIMS.map(([, p]) => p)],
      ["12,000 vetted carriers", FABRICATION_CLAIMS.map(([, p]) => p)],
      ["Save up to 30%", FABRICATION_CLAIMS.map(([, p]) => p)],
      ["Live GPS tracking on every load", FABRICATION_CLAIMS.map(([, p]) => p)],
    ];
    for (const [sentence, patterns] of wouldBeBad) {
      expect(
        patterns.some((p) => p.test(sentence)),
        `pattern set missed: ${sentence}`,
      ).toBe(true);
    }
  });

  test("shows the honest pre-launch state", async ({ page }) => {
    await page.goto("/shippers");
    const body = (await page.locator("main").textContent()) ?? "";
    expect(body).toMatch(/launching soon/i);
    expect(body).toMatch(/MC activation/i);
  });

  test("STRUCTURED DATA respects the gate — no Service node while closed", async ({
    page,
  }) => {
    await page.goto("/shippers");
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const parsed = blocks.flatMap((b) => JSON.parse(b) as unknown[]);
    const types = parsed.map((n) => (n as { "@type": string })["@type"]);

    // BreadcrumbList is fine — it asserts navigation, not capability.
    expect(types).toContain("BreadcrumbList");

    // A Service node saying PickLoads provides freight brokerage is a
    // MACHINE-READABLE claim that it brokes freight today: published to search
    // engines, cached, and far harder to walk back than a page sentence.
    expect(types, "Service node must not be emitted while the gate is closed").not.toContain(
      "Service",
    );
    expect(JSON.stringify(parsed)).not.toMatch(/freight brokerage/i);
  });

  test("routes to the ONE quote funnel, not a second one", async ({ page }) => {
    await page.goto("/shippers");
    const main = page.locator("main");
    await expect(main.locator('a[href*="/request-a-quote"]').first()).toBeVisible();

    // The embedded form posts to the same action as /request-a-quote. If a
    // second, differently-shaped quote form ever appears here, this catches it.
    await expect(main.locator("#fq-pickup-zip")).toHaveCount(1);
    await expect(main.locator("form")).toHaveCount(1);
  });

  test("the quote form still works with the gate closed — an inquiry is not a booking", async ({
    page,
  }) => {
    await page.goto("/shippers");
    await page.locator("#fq-pickup-zip").fill("07111");
    await page.locator("#fq-delivery-zip").fill("30303");
    await page.locator("#fq-company").fill("Test Shipper LLC");
    await page.locator("#fq-email").fill("ops@example.com");
    await page.locator("#fq-phone").fill("(908) 404-5373");
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator(".form-ok")).toBeVisible();
  });
});
