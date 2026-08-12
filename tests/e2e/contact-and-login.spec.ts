import { expect, test } from "@playwright/test";

/**
 * Contact routing and the Login Center.
 *
 * The Login Center is the higher-risk of the two: it is a page whose entire
 * job is to talk about signing in, which makes it the natural place for
 * somebody to later add a convenient email field, or a helpful "Admin" link.
 * Both would be wrong, and neither is visible in a screenshot.
 */

test.describe("Contact — inquiry routing", () => {
  test("offers the seven inquiry types as a real, labelled control", async ({
    page,
  }) => {
    await page.goto("/contact");
    const subject = page.locator("#ct-subject");
    await expect(subject).toBeVisible();
    await expect(page.locator('label[for="ct-subject"]')).toHaveCount(1);

    const options = await subject.locator("option").allTextContents();
    expect(options.length).toBe(7);
  });

  test("routes a quote enquiry to the quote funnel rather than capturing it twice", async ({
    page,
  }) => {
    await page.goto("/contact");
    await page.locator("#ct-subject").selectOption({ label: "Freight / Quote" });
    // A hint, not a redirect: the visitor may still send a message.
    const hint = page.locator('main a[href*="/request-a-quote"]');
    await expect(hint.first()).toBeVisible();
    await expect(page.locator("main form")).toBeVisible();
  });

  test("still submits, with the selected type as the subject", async ({
    page,
  }) => {
    await page.goto("/contact");
    await page.locator("#ct-subject").selectOption({ label: "Support" });
    await page.locator("#ct-name").fill("Test Person");
    await page.locator("#ct-email").fill("ops@example.com");
    await page.locator("#ct-message").fill("Testing the contact routing.");
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator(".form-ok")).toBeVisible();
  });

  test("renders no fake map and no fake booking availability", async ({
    page,
  }) => {
    await page.goto("/contact");
    const html = await page.content();
    // No booking provider is configured; embedding one would show invented
    // availability.
    expect(html).not.toMatch(/calendly|calendar-embed|book-a-slot/i);
    // And no operational coordinates, ever.
    expect(html).not.toMatch(/-?\d{1,3}\.\d{5,}\s*,\s*-?\d{1,3}\.\d{5,}/);
  });
});

test.describe("Login Center", () => {
  test("offers the three approved customer doors", async ({ page }) => {
    await page.goto("/login-center");
    const main = page.locator("main");
    for (const label of [/client login/i, /carrier login/i, /broker partner/i]) {
      await expect(main.getByRole("heading", { name: label })).toBeVisible();
    }
  });

  test("AUTHENTICATES NOTHING — no credential field on the page", async ({
    page,
  }) => {
    await page.goto("/login-center");
    // A routing surface. A second place that takes credentials is a second
    // place to get session handling wrong.
    expect(await page.locator("main form").count()).toBe(0);
    expect(await page.locator('main input[type="password"]').count()).toBe(0);
    expect(await page.locator('main input[type="email"]').count()).toBe(0);
  });

  test("exposes NO admin or dispatcher portal path", async ({ page }) => {
    await page.goto("/login-center");
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect(href).not.toContain("/portal/admin");
      expect(href).not.toContain("/portal/dispatcher");
    }
    // Nor does it name them in prose.
    const body = (await page.locator("main").textContent()) ?? "";
    expect(body).not.toMatch(/admin login|dispatcher login/i);
  });

  test("carries exactly ONE staff entry, and it is low-emphasis", async ({
    page,
  }) => {
    await page.goto("/login-center");
    const staff = page.locator("main a.foot-staff");
    await expect(staff).toHaveCount(1);
    await expect(staff).toHaveAttribute("href", /\/login$/);
  });

  test("every door lands on the real auth surface", async ({ page }) => {
    await page.goto("/login-center");
    const hrefs = await page
      .locator("main a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    for (const href of hrefs) {
      const res = await page.request.get(href);
      expect(res.status(), `${href} returned ${res.status()}`).toBeLessThan(400);
    }
  });

  test("role routing stays server-side — the page decides nothing", async ({
    page,
  }) => {
    await page.goto("/login-center");
    await page.getByRole("heading", { name: /carrier login/i }).click();
    // Following a door reaches the shared auth surface, not a role-specific
    // portal URL chosen by this page.
    const carrierDoor = page
      .locator("main a[href]")
      .filter({ hasText: /sign in/i })
      .first();
    const href = await carrierDoor.getAttribute("href");
    expect(href).toMatch(/\/(portal|login)$/);
  });
});
