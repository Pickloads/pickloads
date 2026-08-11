import { expect, test } from "@playwright/test";

/**
 * Become a Carrier — the carrier acquisition surface, on top of the certified
 * onboarding.
 *
 * The point of these tests is that this page must remain a FRONT DOOR, not a
 * parallel system. The failure mode worth guarding is a second application
 * form appearing here "just to capture the lead", which would create carrier
 * records outside `CarrierWizard` and outside the document, agreement and
 * audit architecture that M-20/M-21/M-22 built.
 */

test.describe("Become a Carrier", () => {
  test("hosts the REAL onboarding wizard, not a copy of it", async ({ page }) => {
    await page.goto("/become-a-carrier");
    await expect(page.locator("h1")).toBeVisible();

    // Exactly one application form. A second one here would mean a second way
    // to create a carrier record.
    const forms = page.locator("main form");
    expect(await forms.count()).toBeLessThanOrEqual(1);
    await expect(page.locator("main").first()).toContainText(
      /MC\/DOT|W-9|insurance/i,
    );
  });

  test("NEVER exposes internal carrier ratings or scores", async ({ page }) => {
    await page.goto("/become-a-carrier");
    const body = (await page.locator("main").textContent()) ?? "";
    // §25 / directive C: carrier performance data is internal operational
    // data. It has no public surface and must never acquire one.
    for (const pattern of [
      /carrier (rating|score|ranking)/i,
      /performance score/i,
      /\b\d(\.\d)?\s*\/\s*5\b/,
      /\b\d{1,3}\s*%\s*(on-time|acceptance)/i,
    ]) {
      expect(body, `page exposes internal carrier data: ${pattern}`).not.toMatch(
        pattern,
      );
    }
    expect(body.length).toBeGreaterThan(500);
  });

  test("makes no earnings or guaranteed-load claim", async ({ page }) => {
    await page.goto("/become-a-carrier");
    const body = (await page.locator("main").textContent()) ?? "";
    for (const pattern of [
      /guarantee[ds]?\s+(loads?|freight|miles|weekly|gross|income|pay)/i,
      /\$\s?[\d,]+\s*(\/|per\s+)?\s*(week|mile)/i,
    ]) {
      expect(body).not.toMatch(pattern);
    }
  });

  test("links onward to the dispatch funnel rather than dead-ending", async ({
    page,
  }) => {
    await page.goto("/become-a-carrier");
    const main = page.locator("main");
    await expect(
      main.locator('a[href*="/dispatch-services"]').first(),
    ).toBeVisible();
    await expect(
      main.locator('a[href*="/start-your-trucking-company"]').first(),
    ).toBeVisible();
  });

  test("is the destination the dispatch CTA promises", async ({ page }) => {
    await page.goto("/dispatch-services");
    await page.getByRole("link", { name: /start dispatching/i }).first().click();
    await expect(page).toHaveURL(/\/become-a-carrier/);
    await expect(page.locator("main")).toContainText(/MC\/DOT|insurance/i);
  });
});
