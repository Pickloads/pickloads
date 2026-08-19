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

  /* ── M-94: verification is the first thing that happens ───────────────── */

  test("opens on the FMCSA pre-check, not on a company-info form", async ({
    page,
  }) => {
    await page.goto("/become-a-carrier");
    // The three fields the check consumes.
    await expect(page.locator('input[name="legal_name"]')).toBeVisible();
    await expect(page.locator('input[name="usdot_number"]')).toBeVisible();
    await expect(page.locator('input[name="mc_number"]')).toBeVisible();

    // And NOT the fields that used to create a carrier row on submit. They
    // belong to a later step now, and a name that reaches the database before
    // anything is verified is the defect M-94 exists to remove.
    await expect(page.locator('input[name="company_name"]')).toHaveCount(0);
    await expect(page.locator('input[name="ein"]')).toHaveCount(0);
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
  });

  test("the step strip puts verification before onboarding", async ({
    page,
  }) => {
    await page.goto("/become-a-carrier");
    const steps = page.locator(".wizard .steps li");
    // §23: the four-step presentation that started with company info is gone.
    expect(await steps.count()).toBeGreaterThanOrEqual(5);
    await expect(steps.first()).toContainText(/verification/i);
    await expect(page.locator(".wizard .steps")).toContainText(/9\.99/);
  });

  test("claims nothing it has not done", async ({ page }) => {
    await page.goto("/become-a-carrier");
    const body = (await page.locator("main").textContent()) ?? "";
    // §23: no "you're onboarded" and no "approved" before anything is either.
    // The words appear only in a form that names what is still outstanding.
    expect(body).not.toMatch(/you'?re onboarded/i);
    expect(body).not.toMatch(/\bapproved\b/i);
    // And no fake payment: nothing may say the fee has been taken.
    expect(body).not.toMatch(/payment (received|complete|successful)/i);
    expect(body).not.toMatch(/\bpaid\b/i);
  });

  test("the USDOT field offers a numeric keypad on a phone", async ({
    page,
  }) => {
    // §24. `inputMode` rather than `type="number"`, which brings spinners and
    // a scroll wheel that silently edits a registration number.
    await page.goto("/become-a-carrier");
    await expect(page.locator('input[name="usdot_number"]')).toHaveAttribute(
      "inputmode",
      "numeric",
    );
  });

  test("every pre-check field is labelled and its hint is associated", async ({
    page,
  }) => {
    // §25/WCAG 1.3.1 + 3.3.2. `axe.spec.ts` scans this route as a whole; this
    // asserts the specific relationships a scanner cannot infer intent for.
    await page.goto("/become-a-carrier");
    for (const name of ["legal_name", "usdot_number", "mc_number", "email"]) {
      const input = page.locator(`input[name="${name}"]`);
      const id = await input.getAttribute("id");
      expect(id, `${name} has no id to label`).toBeTruthy();
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
      const describedBy = await input.getAttribute("aria-describedby");
      if (describedBy) {
        await expect(page.locator(`#${describedBy}`)).toHaveCount(1);
      }
    }
  });
});
