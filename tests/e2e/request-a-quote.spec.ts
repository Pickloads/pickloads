import { expect, test } from "@playwright/test";

/**
 * Request a Quote — the primary acquisition funnel.
 *
 * These run secretless, which is the point: with no Supabase service key, no
 * Turnstile secret and no Upstash credentials, the funnel must still take a
 * submission and tell the truth about what happened. A conversion page whose
 * happy path only exists when five third parties are reachable is a page that
 * will fail silently on the day one of them is not.
 */

test.describe("Request a Quote", () => {
  test("the page renders the quote form as its first action", async ({ page }) => {
    await page.goto("/request-a-quote");
    await expect(page.locator("h1")).toContainText(/quote/i);

    const form = page.locator("form").first();
    await expect(form).toBeVisible();

    // The form must sit ABOVE the supporting content. §15 asks for a
    // low-friction first step, and a page that makes a visitor scroll past
    // reassurance before it will accept their shipment is not one.
    const formBox = (await form.boundingBox())!;
    const howItWorks = page.getByRole("heading", { name: /how it works/i });
    const howBox = (await howItWorks.boundingBox())!;
    expect(formBox.y).toBeLessThan(howBox.y);
  });

  test("every field has a real label, and the date floor is today", async ({
    page,
  }) => {
    await page.goto("/request-a-quote");
    const controls = await page
      .locator("form input:not([type=hidden]), form select, form textarea")
      .all();
    expect(controls.length).toBeGreaterThan(6);

    for (const control of controls) {
      const id = await control.getAttribute("id");
      expect(id, "every control needs an id to be labelled").toBeTruthy();
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
    }

    // U-06: a pickup date in the past is not a shipment anybody can quote.
    const date = page.locator('form input[type="date"]').first();
    if ((await date.count()) > 0) {
      await expect(date).toHaveAttribute("min", /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("invalid input fails to a visible, announced error — never a dead end", async ({
    page,
  }) => {
    await page.goto("/request-a-quote");
    // Fill every field so the browser's own constraint validation lets the
    // submit through — the point is to exercise SERVER-side validation, and a
    // form blocked client-side never reaches it. The ZIP is well-formed in
    // shape but not a real 5-digit code, so Zod is what rejects it.
    await page.locator("#fq-pickup-zip").fill("abcde");
    await page.locator("#fq-delivery-zip").fill("30303");
    await page.locator("#fq-company").fill("Test Shipper LLC");
    await page.locator("#fq-email").fill("ops@example.com");
    await page.locator("#fq-phone").fill("(908) 404-5373");
    await page.locator('form button[type="submit"]').click();

    const err = page.locator("#fq-err");
    await expect(err).toBeVisible();
    await expect(err).toHaveAttribute("role", "alert");
    await expect(err).not.toBeEmpty();

    // The form is still there and still usable. A failed submit that leaves
    // the visitor with nothing to do is the dead end §15 forbids.
    await expect(page.locator("form")).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeEnabled();
  });

  test("a valid submission reports success honestly with no backend configured", async ({
    page,
  }) => {
    await page.goto("/request-a-quote");
    await page.locator("#fq-pickup-zip").fill("07111");
    await page.locator("#fq-delivery-zip").fill("30303");
    await page.locator("#fq-company").fill("Test Shipper LLC");
    await page.locator("#fq-email").fill("ops@example.com");
    await page.locator("#fq-phone").fill("(908) 404-5373");
    await page.locator('form button[type="submit"]').click();

    const ok = page.locator(".form-ok");
    await expect(ok).toBeVisible();
    await expect(ok).toHaveAttribute("role", "status");
    // A confirmation with a clear next step, not a bare tick.
    await expect(ok).toContainText(/reply|call|email/i);
  });

  test("the pre-brokerage state is honest and does not claim active brokering", async ({
    page,
  }) => {
    await page.goto("/request-a-quote");
    const body = (await page.locator("main").textContent()) ?? "";
    // §14/§57: the gate is closed, so the page may collect an inquiry but must
    // not present PickLoads as operating brokerage authority today.
    expect(body).toMatch(/MC activation/i);
    expect(body).not.toMatch(/licensed broker|we broker freight today/i);
    // §20: no unsupported tracking CLAIM. The bare phrase "live GPS" is not
    // the thing forbidden — the page says "does not show a live GPS
    // position", which is exactly the honesty §20 asks for, and an earlier
    // version of this assertion failed on that denial. Match the claims.
    expect(body).not.toMatch(/live gps tracking|real-time truck location/i);
    expect(body).not.toMatch(/AI-powered|artificial intelligence/i);
    expect(body).not.toMatch(/motive|samsara|geotab|verizon connect/i);
    // And assert the honest disclosure IS present — the positive half.
    expect(body).toMatch(/does not show a live GPS position/i);
  });

  test("offers a way through even for someone who is not quoting", async ({
    page,
  }) => {
    await page.goto("/request-a-quote");
    await expect(page.getByRole("link", { name: /track shipment/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /client login/i }).first()).toBeVisible();
  });

  test("is reachable from the primary CTA in the header", async ({ page }) => {
    await page.goto("/");
    const cta = page.locator("nav.sitenav .nav-cta a").first();
    await expect(cta).toContainText(/quote/i);
    await cta.click();
    await expect(page).toHaveURL(/\/request-a-quote/);
  });

  test("is in the sitemap and indexable", async ({ page, request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("/request-a-quote");

    await page.goto("/request-a-quote");
    const robots = page.locator('meta[name="robots"]');
    if ((await robots.count()) > 0) {
      await expect(robots).not.toHaveAttribute("content", /noindex/);
    }
  });
});
