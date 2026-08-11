import { expect, test } from "@playwright/test";

/**
 * Carrier Resources — a hub, proved to stay one.
 *
 * Two properties matter here and neither is visible in a screenshot: the page
 * must never grow a form, and it must never learn anything about a carrier.
 * Both are the kind of change that arrives later with a good reason attached.
 */

/** Internal carrier data that has no public surface (§25, directive C). */
const INTERNAL_CARRIER_DATA: Array<[label: string, pattern: RegExp]> = [
  ["a carrier rating", /carrier (rating|score|ranking)/i],
  ["a performance score", /performance (score|rating)/i],
  ["an x/5 score", /\b\d(\.\d)?\s*\/\s*5\b/],
  ["an on-time percentage", /\b\d{1,3}\s*%\s*(on[- ]time|acceptance|approval)/i],
  ["compliance notes", /(compliance|insurance) (note|review note)/i],
  ["an EIN", /\b\d{2}-\d{7}\b/],
];

test.describe("Carrier Resources", () => {
  test("renders every section as a real hub", async ({ page }) => {
    await page.goto("/carrier-resources");
    await expect(page.locator("h1")).toBeVisible();
    for (const id of ["start-here", "learn", "documents", "account", "support"]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test("HAS NO FORM — it must never become a second capture point", async ({
    page,
  }) => {
    await page.goto("/carrier-resources");
    // A second carrier capture point creates records outside CarrierWizard,
    // and therefore outside the document, agreement and audit architecture.
    expect(await page.locator("main form").count()).toBe(0);
    expect(await page.locator("main input").count()).toBe(0);
    expect(await page.locator("main textarea").count()).toBe(0);
  });

  test("exposes no internal carrier data", async ({ page }) => {
    await page.goto("/carrier-resources");
    const body = (await page.locator("main").textContent()) ?? "";
    for (const [label, pattern] of INTERNAL_CARRIER_DATA) {
      expect(body, `page exposes ${label}`).not.toMatch(pattern);
    }
    expect(body.length).toBeGreaterThan(400);
  });

  test("NON-VACUITY: the patterns catch the data they exist to catch", async () => {
    const wouldBeBad = [
      "Your carrier rating is high",
      "Performance score: excellent",
      "4.8/5",
      "98% on-time",
      "Insurance review note",
      "12-3456789",
    ];
    for (const sentence of wouldBeBad) {
      expect(
        INTERNAL_CARRIER_DATA.some(([, p]) => p.test(sentence)),
        `pattern set missed: ${sentence}`,
      ).toBe(true);
    }
  });

  test("every link lands on a real page, not a 404", async ({ page }) => {
    await page.goto("/carrier-resources");
    const hrefs = await page
      .locator("main a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThanOrEqual(8);

    for (const href of new Set(hrefs)) {
      const res = await page.request.get(href);
      // /portal bounces to /login, which is a 200 after the redirect.
      expect(res.status(), `${href} returned ${res.status()}`).toBeLessThan(400);
    }
  });

  test("links to the Downloads Center rather than copying it", async ({
    page,
  }) => {
    await page.goto("/carrier-resources");
    const main = page.locator("main");
    await expect(main.locator('a[href*="/downloads"]').first()).toBeVisible();

    // None of the Downloads Center's own machinery is duplicated here.
    const html = await page.content();
    for (const needle of ["/packet/", ".pdf", "createSignedUrl", "storage/v1/object"]) {
      expect(html, `duplicates downloads machinery: ${needle}`).not.toContain(
        needle,
      );
    }
  });

  test("points at the REAL onboarding, and only via existing routes", async ({
    page,
  }) => {
    await page.goto("/carrier-resources");
    await page.getByRole("link", { name: /become a carrier/i }).first().click();
    await expect(page).toHaveURL(/\/become-a-carrier/);
    await expect(page.locator("main")).toContainText(/MC\/DOT|insurance/i);
  });

  test("is in the sitemap and reachable from the nav", async ({
    page,
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(await res.text()).toContain("/carrier-resources");

    await page.goto("/");
    const links = await page
      .locator("nav.sitenav a")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(links.some((h) => h.includes("/carrier-resources"))).toBe(true);
  });
});
