import { expect, test } from "@playwright/test";

/**
 * M-97 — the MFA surface must not be able to log anybody out.
 *
 * ── WHAT THIS LANE CAN AND CANNOT PROVE ──────────────────────────────────
 *
 * It cannot walk the real flow. Enrolling needs an authenticated staff
 * session, and verifying needs a valid TOTP code computed from the secret the
 * enrollment just issued; this lane runs secretless, with no session and no
 * Supabase project. The AAL1 → AAL2 transition is covered in
 * `tests/unit/mfa-enrollment.test.tsx` and confirmed by hand against the live
 * project.
 *
 * What it CAN prove is the half that broke: that the journalling endpoint —
 * the thing which used to be a Server Action bound to a gated page — answers
 * without a redirect, and that the gated page itself still bounces strangers.
 * Those two facts together are the regression.
 */

test.describe("MFA route protection", () => {
  test("an unauthenticated visitor is sent to /login, not into the page", async ({
    page,
  }) => {
    const response = await page.goto("/portal/admin/mfa");
    expect(response?.status()).toBeLessThan(500);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toMatch(/\/login$/);

    const body = (await page.locator("body").textContent()) ?? "";
    for (const leak of [
      "Generate QR code",
      "6-digit code",
      "Two-factor authentication is active",
    ]) {
      expect(body, `leaked "${leak}"`).not.toContain(leak);
    }
  });
});

test.describe("the journal endpoint", () => {
  const JOURNAL = "/api/portal/mfa-journal";

  test("NEVER answers with a redirect — that is the whole fix", async ({
    request,
  }) => {
    // The defect: as a Server Action this POST went to /portal/admin/mfa,
    // Next re-rendered that gated route, `requireStaffNoMfa()` redirected, and
    // the browser followed a 303 to /login immediately after a correct MFA
    // verification. A route handler cannot do that, and this asserts it: no
    // 3xx, no Location header, for a caller with no session at all.
    const res = await request.post(JOURNAL, {
      data: { kind: "enrolled" },
      maxRedirects: 0,
    });
    expect(res.status(), "must not be a redirect").toBeLessThan(300);
    expect(res.headers()["location"]).toBeUndefined();
  });

  test("writes nothing for an unauthenticated caller, and says nothing either", async ({
    request,
  }) => {
    const res = await request.post(JOURNAL, { data: { kind: "verified" } });
    // 204 whether or not you are staff: a journalling endpoint is not an
    // oracle for who is signed in.
    expect(res.status()).toBe(204);
    expect((await res.text()).trim()).toBe("");
  });

  test("refuses a body that is not one of the two kinds", async ({ request }) => {
    for (const data of [{ kind: "admin" }, { kind: "" }, { nope: 1 }]) {
      const res = await request.post(JOURNAL, { data, maxRedirects: 0 });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }
  });

  test("refuses a cross-site POST", async ({ request }) => {
    const res = await request.post(JOURNAL, {
      data: { kind: "enrolled" },
      headers: { origin: "https://evil.example" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
  });

  test("is not reachable by GET", async ({ request }) => {
    const res = await request.get(JOURNAL, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
