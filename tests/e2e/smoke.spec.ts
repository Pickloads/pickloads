import { expect, test } from "@playwright/test";

/**
 * M-41 — production-build smoke suite (secretless: placeholder Supabase env,
 * no Turnstile/Upstash/Resend keys). Asserts the graceful-degradation
 * contracts the modules promise, plus core rendering, i18n, SEO surface and
 * the portal auth wall.
 */

test.describe("home page", () => {
  test("renders hero and 3 pricing plans", async ({ page }) => {
    await page.goto("/");
    // rich_hero_title renders through t.rich — proves the V4 dictionary path
    await expect(page.locator(".hero h1")).toContainText("Your truck stays");
    await expect(page.locator(".hero h1 em")).toHaveText("loaded");
    await expect(
      page.getByRole("heading", {
        name: "One flat percentage. Nothing hidden.",
      }),
    ).toBeVisible();
    await expect(page.locator(".pricing-grid .plan")).toHaveCount(3);
    await expect(page.locator(".pricing-grid .plan h3")).toHaveText([
      "Owner-Operator",
      "Small Fleet",
      "Box Truck & Hot Shot",
    ]);
  });
});

test.describe("i18n", () => {
  test("/es home renders the Spanish dictionary", async ({ page }) => {
    await page.goto("/es");
    await expect(
      page.getByRole("heading", { name: "¿Necesitas un dispatcher?" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
  });
});

test.describe("quick-quote lead form (server action, secretless)", () => {
  test("invalid phone surfaces the Zod error in .form-err", async ({
    page,
  }) => {
    await page.goto("/");
    const quote = page.locator("#quote");
    await quote.locator("#q-phone").fill("abc");
    await quote.getByRole("button", { name: /Get Started/ }).click();
    const err = quote.locator(".form-err.show");
    await expect(err).toBeVisible();
    await expect(err).toContainText("Enter a valid phone number.");
  });

  test("valid phone completes gracefully without env (no crash, .form-ok)", async ({
    page,
  }) => {
    // Verified behavior: rate-limit + Turnstile are no-ops (env unset), the
    // DB write is skipped (no service-role key) and email runs log-only —
    // the action reports success instead of erroring or throwing.
    await page.goto("/");
    const quote = page.locator("#quote");
    await quote.locator("#q-phone").fill("(908) 404-5373");
    await quote.getByRole("button", { name: /Get Started/ }).click();
    await expect(quote.locator(".form-ok.show")).toBeVisible();
    await expect(quote.locator(".form-ok.show")).toContainText("RECEIVED");
  });
});

test.describe("interior pages", () => {
  test("/faq accordions open on click", async ({ page }) => {
    await page.goto("/faq");
    await expect(
      page.getByRole("heading", { name: "Straight answers. No fine print." }),
    ).toBeVisible();
    const items = page.locator("details");
    expect(await items.count()).toBeGreaterThanOrEqual(6);
    const first = items.first();
    await expect(first).not.toHaveAttribute("open", "");
    await first.locator("summary").click();
    await expect(first).toHaveAttribute("open", "");
  });

  test("/dispatch/dry-van responds 200 with equipment content", async ({
    page,
  }) => {
    const response = await page.goto("/dispatch/dry-van");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toContainText(/dry van/i);
    await expect(page.locator("body")).toContainText("Dry Van");
  });
});

test.describe("portal doors (M-51)", () => {
  test("/portal shows the pre-auth selection page with both cards", async ({
    page,
  }) => {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal$/);
    await expect(
      page.getByRole("heading", { name: "Choose your portal" }),
    ).toBeVisible();
    await expect(page.locator(".svc.dispatch h3")).toHaveText("Carriers");
    await expect(page.locator(".svc.broker h3")).toHaveText("Shippers");
    await expect(
      page.getByRole("link", { name: "Carrier Sign In →" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Shipper Sign In →" }),
    ).toBeVisible();
  });

  test("/portal/carrier redirects unauthenticated visitors to /login", async ({
    page,
  }) => {
    await page.goto("/portal/carrier");
    await expect(page).toHaveURL(
      /\/login\?next=%2Fportal%2Fcarrier|\/login\?next=\/portal\/carrier/,
    );
    await expect(
      page.getByRole("heading", { name: "Sign in to PickLoads" }),
    ).toBeVisible();
  });
});

test.describe("create account (M-52, secretless)", () => {
  test("/create-account chooser renders both doors", async ({ page }) => {
    await page.goto("/create-account");
    await expect(
      page.getByRole("heading", { name: "Get started with PickLoads" }),
    ).toBeVisible();
    await expect(page.locator(".svc.dispatch h3")).toHaveText("I run trucks");
    await expect(page.locator(".svc.broker h3")).toHaveText("I ship freight");
    await expect(
      page.getByRole("link", { name: "Create Carrier Account →" }),
    ).toBeVisible();
  });

  test("carrier registration degrades honestly without env", async ({
    page,
  }) => {
    await page.goto("/create-account/carrier");
    await page.locator("#ca-company").fill("Smoke Test Trucking LLC");
    await page.locator("#ca-name").fill("Smoke Tester");
    await page.locator("#ca-email").fill("smoke@example.com");
    await page.locator("#ca-phone").fill("(908) 404-5373");
    await page.locator("#ca-mc").fill("MC-123456");
    await page.locator("#ca-pass").fill("hunter22b");
    await page.getByRole("button", { name: /Create Account/ }).click();
    // No Supabase env → the action must state that NOTHING was created —
    // never a fake "check your email" (audit §6.4 honest-states rule).
    await expect(page.locator(".form-err.show")).toContainText(
      "no account was created",
    );
  });

  test("shipper registration (M-53) renders directive fields and degrades honestly", async ({
    page,
  }) => {
    await page.goto("/create-account/shipper");
    await expect(
      page.getByRole("heading", { name: "Create your shipper account" }),
    ).toBeVisible();
    // Directive fields: industry / frequency / regions
    await expect(page.locator("#sa-industry")).toBeVisible();
    await expect(page.locator("#sa-frequency")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Midwest" })).toBeVisible();
    await page.locator("#sa-company").fill("Smoke Shipping Inc");
    await page.locator("#sa-name").fill("Smoke Shipper");
    await page.locator("#sa-email").fill("shipper-smoke@example.com");
    await page.locator("#sa-phone").fill("(908) 404-5373");
    await page.locator("#sa-pass").fill("hunter22b");
    await page.getByRole("button", { name: /Create Account/ }).click();
    await expect(page.locator(".form-err.show")).toContainText(
      "no account was created",
    );
  });
});

test.describe("auth states (M-54)", () => {
  test("/login renders the clear expired / suspended / continue states", async ({
    page,
  }) => {
    await page.goto("/login?next=%2Fportal%2Fcarrier");
    await expect(page.locator("main")).toContainText(
      "Sign in to continue where you left off.",
    );
    await page.goto("/login?next=%2Fportal%2Fcarrier&expired=1");
    await expect(page.locator(".form-err.show").first()).toContainText(
      "Your session expired",
    );
    await page.goto("/login?error=suspended");
    await expect(page.locator(".form-err.show").first()).toContainText(
      "Your account is suspended",
    );
  });
});

test.describe("password recovery (M-42, secretless)", () => {
  test("/login links to /forgot-password, which degrades gracefully", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(
      page.getByRole("heading", { name: "Reset your password" }),
    ).toBeVisible();
    // Placeholder Supabase env → the form must refuse with a clear message,
    // not crash or fire a network call.
    await page.locator("#forgot-email").fill("driver@example.com");
    await page.getByRole("button", { name: /Send Reset Link/ }).click();
    await expect(page.locator(".form-err.show")).toContainText(
      "not configured",
    );
  });

  test("/reset-password renders and flags the missing recovery session", async ({
    page,
  }) => {
    await page.goto("/reset-password");
    await expect(
      page.getByRole("heading", { name: "Choose a new password" }),
    ).toBeVisible();
    await expect(page.locator(".form-err.show")).toContainText(
      "invalid or has expired",
    );
  });
});

test.describe("SEO surface", () => {
  test("sitemap.xml lists localized public routes", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");
    const body = await response.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("/dispatch/dry-van");
    expect(body).toContain("/es"); // locale alternates present
    expect(body).toContain("hreflang");
  });

  test("robots.txt blocks portal/api and points at the sitemap", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("Disallow: /portal");
    expect(body).toContain("Disallow: /api");
    expect(body).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });
});

test.describe("404", () => {
  test("unknown routes return HTTP 404 with the branded page", async ({
    page,
  }) => {
    const response = await page.goto("/this-lane-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "This lane doesn't exist." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Home" })).toBeVisible();
  });
});
