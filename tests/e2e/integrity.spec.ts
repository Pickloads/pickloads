import { expect, test } from "@playwright/test";

/**
 * M-69 — Production Integrity Pack, end-to-end.
 *
 * Runs in the same SECRETLESS lane as the M-41 smoke suite (placeholder
 * Supabase env, no service-role key, no Turnstile/Upstash/Resend). That is
 * deliberate and it shapes what can be asserted here:
 *
 *   * The gates (P-2 referral, P-3 brokerage label) are proved directly:
 *     with no switchboard reachable the accessor fails CLOSED, which is
 *     exactly the production default, so the promise strings must be absent.
 *   * The unsubscribe flow is proved as far as a database-free environment
 *     honestly can: the GET page renders real states instead of crashing,
 *     the one-click endpoint refuses a GET-side effect, and repeated POSTs
 *     return an identical, non-5xx-by-accident response. The
 *     "POST unsubscribes → second POST is idempotent (no second UPDATE)"
 *     assertion needs a real row and lives in tests/unit/newsletter.test.ts,
 *     which stubs the admin client.
 */

const WELL_FORMED_TOKEN = "3f2b1c7e-9a41-4d2b-8e77-0c5a1d9f4b62";
const REFERRAL_COPY = "Refer a carrier who signs up";

test.describe("P-1 — newsletter unsubscribe page (GET never mutates)", () => {
  test("renders the honest invalid-link state with no token", async ({
    page,
  }) => {
    const response = await page.goto("/newsletter/unsubscribe");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Unsubscribe" })).toBeVisible();
    await expect(page.locator("main")).toContainText(
      "isn't complete or is no longer valid",
    );
    // No confirmation button to press: there is nothing to unsubscribe.
    await expect(page.getByRole("button", { name: /unsubscribe me/i })).toHaveCount(0);
  });

  test("a well-formed token renders an honest state, never a fake success", async ({
    page,
  }) => {
    await page.goto(`/newsletter/unsubscribe?token=${WELL_FORMED_TOKEN}`);
    await expect(page.getByRole("heading", { name: "Unsubscribe" })).toBeVisible();
    // Secretless: the list is unreachable. The page must say so and must NOT
    // claim the address was removed.
    await expect(page.locator("main")).toContainText("nothing was changed");
    await expect(page.locator("main")).not.toContainText("UNSUBSCRIBED —");
  });

  test("the page is noindex (it is a per-recipient credential URL)", async ({
    page,
  }) => {
    await page.goto(`/newsletter/unsubscribe?token=${WELL_FORMED_TOKEN}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });

  test("localised: /es renders the Spanish page", async ({ page }) => {
    await page.goto("/es/newsletter/unsubscribe");
    await expect(
      page.getByRole("heading", { name: "Cancelar suscripción" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
  });
});

test.describe("P-1 — RFC 8058 one-click endpoint", () => {
  test("GET redirects to the confirmation page instead of unsubscribing", async ({
    request,
  }) => {
    // The whole point: mail scanners prefetch GETs. This one must have no
    // side effect at all.
    const res = await request.get(
      `/api/newsletter/unsubscribe?token=${WELL_FORMED_TOKEN}`,
      { maxRedirects: 0 },
    );
    expect([302, 303, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toContain("/newsletter/unsubscribe");
  });

  test("POST without a token is rejected 400", async ({ request }) => {
    const res = await request.post("/api/newsletter/unsubscribe", {
      form: { "List-Unsubscribe": "One-Click" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST with a malformed token is rejected 400 (no enumeration signal)", async ({
    request,
  }) => {
    const res = await request.post(
      "/api/newsletter/unsubscribe?token=subscriber@example.com",
      { form: { "List-Unsubscribe": "One-Click" } },
    );
    expect(res.status()).toBe(400);
  });

  test("repeated one-click POSTs return an identical response (idempotent)", async ({
    request,
  }) => {
    const post = () =>
      request.post(`/api/newsletter/unsubscribe?token=${WELL_FORMED_TOKEN}`, {
        form: { "List-Unsubscribe": "One-Click" },
      });
    const first = await post();
    const second = await post();
    expect(second.status()).toBe(first.status());
    // Secretless ⇒ 503 "retry", which our idempotency makes safe. What must
    // never happen is an unhandled 500 or a 4xx that reads as a broken
    // opt-out to the mailbox provider.
    expect(first.status()).toBe(503);
  });
});

test.describe("P-2 — the referral promise is gated off", () => {
  for (const path of ["/", "/dispatch/dry-van", "/truck-dispatch/new-jersey"]) {
    test(`no referral bonus promise on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator(".cta-band")).toBeVisible();
      await expect(page.locator("body")).not.toContainText(REFERRAL_COPY);
      await expect(page.locator(".cta-band .mono-note")).toHaveCount(0);
      // The rest of the approved band is untouched.
      await expect(page.locator(".cta-band")).toContainText(
        "Ready to stop hunting loads?",
      );
    });
  }

  test("gated in every locale, not just English", async ({ page }) => {
    await page.goto("/es");
    await expect(page.locator("body")).not.toContainText("Refiere a un carrier");
    await page.goto("/fr");
    await expect(page.locator("body")).not.toContainText("Parrainez un carrier");
  });
});

test.describe("P-3 — the brokerage label is gated off", () => {
  test('footer says "For Shippers", not "Freight Brokerage"', async ({
    page,
  }) => {
    await page.goto("/");
    const footer = page.locator("#contact-foot");
    await expect(footer).toBeVisible();
    await expect(footer).not.toContainText("Freight Brokerage");
    // The link is never removed — only the unearned claim.
    await expect(footer.locator('a[href="/shippers"]').first()).toBeVisible();
  });
});

test.describe("P-6 — dead config is wired", () => {
  test("packet downloads show the honest pending toast while the flag is off", async ({
    page,
  }) => {
    await page.goto("/#packet");
    const first = page.locator(".packet-item .dl").first();
    await expect(first).toHaveAttribute("href", "#");
    await first.click();
    await expect(page.locator(".portal-toast")).toContainText(
      /available at launch|legal review/i,
    );
  });

  test("no testimonials band renders while the flag is off", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".testis")).toHaveCount(0);
    // And absolutely no prototype sample quotes leaked back in.
    await expect(page.locator("body")).not.toContainText("J. Baptiste");
  });
});
