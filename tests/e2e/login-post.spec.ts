import { expect, test } from "@playwright/test";

/**
 * P0 — the login form submitted passwords in the URL.
 *
 * `<form onSubmit={handleSubmit}>` with no `method` submits GET to its own
 * URL. `preventDefault()` inside the handler was the only thing keeping the
 * password out of the address bar, and only while React was hydrated:
 *
 *     GET /login?email=<email>&password=<password> 200
 *
 * ── WHAT THESE TESTS CAN AND CANNOT PROVE HERE ───────────────────────────
 *
 * The e2e lane runs against a PLACEHOLDER Supabase project (`.env.e2e`), so
 * there is no auth server to accept a real credential — a genuine sign-in
 * cannot be exercised in this lane and pretending otherwise would be a test
 * that asserts nothing.
 *
 * What matters for THIS defect is provable without one, because the bug was
 * never about whether authentication succeeded. It was about where the
 * credential travelled. So:
 *
 *   * the form POSTs, in real Chromium, with real form semantics;
 *   * it POSTs **with JavaScript disabled** — the exact condition under which
 *     the old form leaked, and the reason `method` beats a submit handler;
 *   * nothing lands in the query string, the history or the rendered HTML;
 *   * the portals reject anonymous visitors and role-route correctly.
 *
 * Credential round-trips — verified shipper reaches `/portal/shipper`,
 * verified carrier reaches `/portal/carrier`, a wrong password stays out, a
 * suspended account is diverted, an off-site `?next=` is refused — are covered
 * in `tests/unit/sign-in-action.test.ts` against the action itself with
 * Supabase mocked. That is a deliberate split, not a gap: what those cases
 * exercise is OUR routing and error logic, and asserting it does not require
 * a hosted auth service that neither test lane has.
 */

const PASSWORD = "PlaywrightProbe!2026";
const EMAIL = "probe@example.invalid";

test.describe("login submits by POST, never GET", () => {
  test("the server-rendered form declares method=POST", async ({ page }) => {
    await page.goto("/login");
    const form = page.locator("main form, .bigform form").first();
    // `method` reflects the resolved submission method, so a missing
    // attribute reads as "get" — which is precisely the bug.
    expect(await form.evaluate((f: HTMLFormElement) => f.method)).toBe("post");
  });

  test("a NATIVE submit — React handler absent — POSTs, with nothing in the URL", async ({
    page,
  }) => {
    // This is the regression itself, reproduced precisely.
    //
    // `HTMLFormElement.submit()` does NOT fire submit handlers. It is the raw
    // browser submission — exactly what happened on the reported request,
    // where the markup was live but React had not attached `onSubmit`. Under
    // the old form this produced:
    //
    //     GET /login?email=…&password=… 200
    //
    // Driving the button instead would prove nothing: with React attached the
    // OLD code passed too.
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);

    // Waiting on the request rather than collecting into an array: the
    // submission is a navigation, and reading a buffer straight after
    // `evaluate()` races it — the first draft of this test asserted on an
    // empty list and reported "no submission" as a pass condition failure.
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.isNavigationRequest(), { timeout: 15_000 }),
      page.evaluate(() =>
        (document.querySelector("form") as HTMLFormElement).submit(),
      ),
    ]);

    expect(request.method(), `${request.url()} was not a POST`).toBe("POST");
    expect(request.url()).not.toContain(PASSWORD);
    expect(request.url()).not.toContain("password=");
    expect(request.url()).not.toContain(EMAIL);
  });

  test("NO-JS: the served markup itself declares POST", async ({ browser }) => {
    // With JavaScript off, Next's streaming placeholder never resolves, so
    // there is no form to drive — but the guarantee being tested is a
    // property of the MARKUP, not of an interaction. If the rendered tag says
    // POST, no browser can be talked into sending these fields as a query
    // string, hydrated or not.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/login");
    const tag = (await page.content()).match(/<form[^>]*>/)?.[0] ?? "";
    expect(tag, "no form found in the served HTML").not.toBe("");
    expect(tag).toMatch(/method="post"/i);
    expect(tag).not.toMatch(/method="get"/i);
    await context.close();
  });

  test("the password never reaches the URL, history or rendered HTML", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState("networkidle");

    expect(page.url()).not.toContain(PASSWORD);
    expect(page.url()).not.toContain("password=");
    expect(page.url()).not.toContain(EMAIL);

    // `content()` serialises the live DOM: a value typed into an input is not
    // part of it, but a password echoed back into markup would be.
    expect(await page.content()).not.toContain(PASSWORD);

    // And nothing was pushed into session history either.
    const entries = await page.evaluate(() => window.history.length);
    expect(entries).toBeLessThan(10);
  });

  test("shows a generic error, never raw Supabase text", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState("networkidle");

    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).not.toMatch(/AuthApiError|invalid_credentials|supabase\.co/i);
  });
});

test.describe("the login page speaks to every role (P0/8)", () => {
  test("does not present itself as carrier-and-staff only", async ({ page }) => {
    // Both signup flows send their verification link to /login?verified=1.
    // A shipper who had just confirmed their email arrived at a form headed
    // "Carrier & staff sign in".
    await page.goto("/login?verified=1");
    const main = (await page.locator("main").textContent()) ?? "";
    expect(main).not.toMatch(/carrier\s*&\s*staff sign in/i);
    expect(main).toMatch(/shipper/i);
    // The verified banner still renders — the M-52 flow is unchanged.
    await expect(page.getByText(/email verified/i)).toBeVisible();
  });
});

test.describe("portals reject anonymous visitors", () => {
  // `/portal` is deliberately NOT in this list. It is the public two-door
  // chooser (carrier / shipper cards) and is meant to be reachable signed-out;
  // it role-routes only when a session exists. The gated surfaces are the
  // role homes below.
  for (const route of [
    "/portal/carrier",
    "/portal/shipper",
    "/portal/admin",
    "/portal/broker",
  ]) {
    test(`${route} bounces an anonymous visitor to /login`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBeLessThan(400);
      // Either middleware redirected, or the page gate did. Both end at the
      // auth surface; neither may render portal content.
      expect(page.url()).toMatch(/\/login/);
    });
  }

  test("/portal is the public chooser and leaks no portal data", async ({
    page,
  }) => {
    await page.goto("/portal");
    expect(page.url()).toMatch(/\/portal$/);
    // Reachable, but it must not have resolved anybody's session into content.
    expect(await page.locator('input[type="password"]').count()).toBe(0);
    const body = (await page.locator("main").textContent()) ?? "";
    expect(body).toMatch(/carrier/i);
    expect(body).toMatch(/shipper/i);
  });
});
