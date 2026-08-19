import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MFA_GRACE_DAYS, isAuthConfigured, requirementFor } from "@/lib/mfa";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/uploads";

/**
 * M-61 — security-review regression pins.
 *
 * Three things this file guarantees for every future module:
 *   1. the D3 MFA enforcement matrix (admin hard / dispatcher 14-day grace /
 *      customers never gated) and its fail-safe edges;
 *   2. graceful degradation on placeholder env — the entire test + e2e lane
 *      runs without Supabase credentials, so nothing here may require them;
 *   3. static invariants the RLS suite cannot see: signed-URL TTL ≤ 300s at
 *      every call site, and an audit_events write in every sensitive staff
 *      action.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const DAY = 24 * 60 * 60 * 1000;

describe("MFA enforcement matrix (audit §6.1, decision D3)", () => {
  const now = new Date("2026-08-05T12:00:00Z");

  it("admins are hard-required from day one, regardless of account age", () => {
    const fresh = requirementFor("admin", now.toISOString(), now);
    expect(fresh.requirement).toBe("hard");
    expect(fresh.graceEndsAt).toBeNull();
    const old = requirementFor(
      "admin",
      new Date(now.getTime() - 400 * DAY).toISOString(),
      now,
    );
    expect(old.requirement).toBe("hard");
  });

  it("dispatchers get a 14-day grace measured from profile creation", () => {
    const created = new Date(now.getTime() - 3 * DAY).toISOString();
    const state = requirementFor("dispatcher", created, now);
    expect(state.requirement).toBe("grace");
    expect(state.graceDaysLeft).toBe(MFA_GRACE_DAYS - 3);
    expect(state.graceEndsAt).toBe(
      new Date(Date.parse(created) + MFA_GRACE_DAYS * DAY).toISOString(),
    );
  });

  it("a dispatcher on the last day still has 1 day, not 0", () => {
    const created = new Date(now.getTime() - (MFA_GRACE_DAYS * DAY - 1000));
    const state = requirementFor("dispatcher", created.toISOString(), now);
    expect(state.requirement).toBe("grace");
    expect(state.graceDaysLeft).toBe(1);
  });

  it("dispatchers flip to hard the moment the window closes", () => {
    const created = new Date(now.getTime() - (MFA_GRACE_DAYS + 1) * DAY);
    const state = requirementFor("dispatcher", created.toISOString(), now);
    expect(state.requirement).toBe("hard");
    expect(state.graceDaysLeft).toBe(0);
  });

  it("FAIL SAFE: a dispatcher with no creation timestamp is hard-required", () => {
    expect(requirementFor("dispatcher", null, now).requirement).toBe("hard");
    expect(requirementFor("dispatcher", "not-a-date", now).requirement).toBe(
      "hard",
    );
  });

  it("customers are never MFA-gated (D3 scope is staff only)", () => {
    expect(requirementFor("carrier", null, now).requirement).toBe("none");
    expect(requirementFor("shipper", null, now).requirement).toBe("none");
  });
});

describe("MFA graceful degradation without Supabase env", () => {
  it("reports auth unconfigured for placeholder and empty URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
    expect(isAuthConfigured()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(isAuthConfigured()).toBe(false);
  });

  it("reports auth configured only for a real project URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
    expect(isAuthConfigured()).toBe(true);
  });

  it("getMfaState never throws and gates nothing on placeholder env", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
    const { getMfaState } = await import("@/lib/mfa");
    const state = await getMfaState("admin", null);
    expect(state.configured).toBe(false);
    // satisfied:true is what keeps the placeholder build and e2e lane green;
    // the middleware has already bounced anonymous /portal traffic.
    expect(state.satisfied).toBe(true);
    expect(state.enrolled).toBe(false);
    expect(state.verified).toBe(false);
  });
});

describe("signed URLs for the private buckets (S-01, §16)", () => {
  const CALL_SITES = [
    "src/app/actions/admin.ts",
    "src/app/actions/carrier.ts",
    // M-77 — `shipment-docs`, the second private bucket. Same constant, same
    // ceiling, same scan: a numeric literal here would be a 24-hour link to a
    // proof of delivery.
    "src/lib/shipments/document-store.ts",
  ];

  it("the shared TTL is 5 minutes or less", () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  for (const file of CALL_SITES) {
    it(`${file} generates signed URLs through the shared TTL constant`, () => {
      const src = readFileSync(file, "utf8");
      const calls = [...src.matchAll(/createSignedUrl\(([^)]*)\)/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[1]).toContain("SIGNED_URL_TTL_SECONDS");
        // No bare numeric TTL may sneak back in.
        expect(call[1]).not.toMatch(/,\s*\d+/);
      }
    });
  }
});

describe("audit_events coverage for sensitive staff actions (audit §6.2)", () => {
  /** action file → the audit action strings it must emit. */
  const REQUIRED: ReadonlyArray<[string, readonly string[]]> = [
    ["src/app/actions/admin.ts", ["document.review", "document.download", "settings.update"]],
    ["src/app/actions/billing.ts", ["invoice.generate"]],
    ["src/app/actions/staff.ts", ["user.suspend", "carrier.activate", "carrier.assign_dispatcher", "staff.invite", "staff.invite_accepted"]],
    ["src/app/actions/quotes.ts", ["quote.status_change"]],
    ["src/app/actions/carrier-portal.ts", ["carrier.change_request", "agreement.resend_requested"]],
    ["src/app/actions/account.tsx", ["account.signup"]],
    // M-97 — moved from `src/app/actions/security.ts`. It was a Server Action,
    // which POSTs to the CURRENT route and re-renders it; called straight
    // after `mfa.verify()` rotated the auth cookies, that re-render hit
    // `requireStaffNoMfa()`, found no readable session and redirected — so a
    // best-effort audit row was logging admins out of the page that had just
    // authenticated them. A route handler renders nothing and sits outside the
    // middleware matcher, so it has no way to redirect. Same two actions, same
    // server-side identity check, same ledger.
    [
      "src/app/api/portal/mfa-journal/route.ts",
      ["staff.mfa_enrolled", "staff.mfa_verified"],
    ],
    // M-77 — §15's document-access history for SHIPMENT documents. Same
    // `document.download` action string as the carrier-document paths above,
    // so the admin security log is one query rather than two.
    [
      "src/lib/shipments/document-store.ts",
      ["document.download", "shipment_document.upload", "shipment_document.review"],
    ],
  ];

  for (const [file, actions] of REQUIRED) {
    for (const action of actions) {
      it(`${file} journals "${action}"`, () => {
        expect(readFileSync(file, "utf8")).toContain(`"${action}"`);
      });
    }
  }
});

describe("error messages surfaced to clients carry no provider detail", () => {
  it("billing never echoes the Stripe error message back to the UI", () => {
    const src = readFileSync("src/app/actions/billing.ts", "utf8");
    // The message must be logged, never interpolated into a returned error.
    expect(src).toContain("console.error(\"[billing] invoice generation failed\"");
    expect(src).not.toMatch(/error:\s*`Stripe error: \$\{message\}`/);
  });

  it("public form actions return a fixed message, never the DB error", () => {
    for (const file of [
      "src/app/actions/carrier-lead.tsx",
      "src/app/actions/freight-quote.tsx",
      "src/app/actions/contact-message.tsx",
      "src/app/actions/newsletter.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("SERVER_ERROR_MESSAGE");
      expect(src).not.toMatch(/message:\s*(err|error)\.message/);
    }
  });
});
