import { expect, test } from "@playwright/test";

/**
 * M-95 — the payment return page does not believe its own URL.
 *
 * ── THE ATTACK THIS IS ABOUT ─────────────────────────────────────────────
 *
 * Stripe sends the applicant back to `…/payment?return=success`. That URL is
 * in their address bar, in their history, and typeable by anyone. If the page
 * treated it as evidence, the $9.99 gate would be bypassable by editing a
 * query string — which is the single most obvious way a payment flow goes
 * wrong, and the reason the requirement names URL parameters first.
 *
 * The e2e lane runs with no service-role key and no session, so nothing here
 * can possibly be paid. Every request below is therefore the forged case: a
 * stranger asserting success. The page must never agree.
 */

const FORGED = [
  "/become-a-carrier/payment?return=success",
  "/become-a-carrier/payment?return=success&session_id=cs_test_forged",
  "/become-a-carrier/payment?return=success&paid=true&amount=999",
  "/become-a-carrier/payment?paid=true",
  "/become-a-carrier/payment",
];

test.describe("carrier fee — the return URL is not evidence", () => {
  for (const url of FORGED) {
    test(`${url} does not claim the fee is paid`, async ({ page }) => {
      const response = await page.goto(url);
      expect(response?.status(), `${url} must render`).toBeLessThan(400);

      const body = (await page.locator("main").textContent()) ?? "";

      // The confirmed-payment wording may only appear when the LEDGER says so,
      // and in this lane the ledger cannot say so.
      for (const claim of [
        "Payment received",
        "verification fee is confirmed",
        "Continue to Company Info",
      ]) {
        expect(body, `${url} claimed "${claim}" with no payment`).not.toContain(
          claim,
        );
      }
    });
  }

  test("the cancelled return says plainly that nothing was charged", async ({
    page,
  }) => {
    await page.goto("/become-a-carrier/payment?return=cancelled");
    const body = (await page.locator("main").textContent()) ?? "";
    expect(body).toMatch(/nothing (has been|was) charged/i);
    expect(body).not.toContain("Payment received");
  });

  test("never exposes a Stripe secret or a price id", async ({ page }) => {
    const html = (await (await page.goto(
      "/become-a-carrier/payment?return=success",
    ))?.text()) ?? "";
    for (const secret of ["sk_live", "sk_test", "whsec_", "STRIPE_SECRET"]) {
      expect(html, `leaked ${secret}`).not.toContain(secret);
    }
  });

  test("is not indexable", async ({ page }) => {
    await page.goto("/become-a-carrier/payment");
    const robots = await page
      .locator('head meta[name="robots"]')
      .getAttribute("content");
    expect(robots ?? "").toMatch(/noindex/i);
  });
});
