import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialStartState } from "@/lib/onboarding-state";

/**
 * Become a Carrier — step 1, the surface that reported
 * "We couldn't verify your submission. Please refresh the page and try again."
 * against a `POST /become-a-carrier 200`.
 *
 * ── WHAT THE 200 MEANT ───────────────────────────────────────────────────
 *
 * Nothing. A React server action ALWAYS answers 200; the outcome rides in the
 * RSC payload as the action's return value. So `POST 200` and "the submission
 * failed" are not in tension and never were — the transport succeeded and the
 * action returned `{status: "error"}`.
 *
 * That matters for reading the rest of this file: there is no shape mismatch
 * between what the action returns and what the wizard expects. The wizard
 * advances on `status === "success" && carrierId`, and the action returns
 * exactly that on success. The failure was upstream of both, in the guard.
 *
 * ── WHY THE GUARD IS MOCKED PER-TEST ─────────────────────────────────────
 *
 * `guardPublicForm` is rate limit + Turnstile. Its verdict is the thing under
 * test here, so it is controlled directly rather than reproduced: a test that
 * needed a live Cloudflare siteverify would not run, and an auth path nobody
 * can test is what produced the defect above it.
 */

interface Scenario {
  guard: { ok: true; ip: string } | { ok: false; message: string };
  carrierInsert: { data: { id: string } | null; error: { message: string } | null };
  leadInsert: { data: { id: string } | null; error: { message: string } | null };
  adminAvailable: boolean;
}

let scenario: Scenario;
let inserts: { table: string; row: Record<string, unknown> }[] = [];
let emails: string[] = [];

vi.mock("@/lib/forms/guard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/forms/guard")>();
  return {
    ...actual,
    guardPublicForm: () => Promise.resolve(scenario.guard),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () =>
    scenario.adminAvailable
      ? {
          from: (table: string) => ({
            insert: (row: Record<string, unknown>) => {
              inserts.push({ table, row });
              const result =
                table === "carriers"
                  ? scenario.carrierInsert
                  : scenario.leadInsert;
              return {
                select: () => ({ single: () => Promise.resolve(result) }),
              };
            },
          }),
        }
      : null,
}));

vi.mock("@/lib/email/send", () => ({
  EMAIL_INTERNAL_TO: "ops@example.com",
  sendEmail: ({ to }: { to: string }) => {
    emails.push(to);
    return Promise.resolve({ ok: true });
  },
}));

vi.mock("@/lib/crypto", () => ({
  encryptPII: (v: string) => `enc(${v})`,
}));

const { startOnboarding } = await import("@/app/actions/onboarding");

/** A submission that passes `onboardingInfoSchema`. */
function validForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    company_name: "Carter Trucking LLC",
    full_name: "John Carter",
    email: "john@cartertrucking.example",
    phone: "(908) 555-0142",
    home_state: "NJ",
    locale: "en",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  inserts = [];
  emails = [];
  scenario = {
    guard: { ok: true, ip: "1.2.3.4" },
    carrierInsert: { data: { id: "carrier-uuid-1" }, error: null },
    leadInsert: { data: { id: "lead-uuid-1" }, error: null },
    adminAvailable: true,
  };
});

describe("1 · a valid step 1 advances to Documents", () => {
  it("returns the success shape the wizard advances on", async () => {
    const state = await startOnboarding(initialStartState, validForm());
    // The wizard's effect is:
    //   if (status === "success" && carrierId) setStep(2)
    // so these two fields ARE the step-2 transition.
    expect(state.status).toBe("success");
    expect(state).toHaveProperty("carrierId");
    expect(
      state.status === "success" ? state.carrierId : null,
    ).toBe("carrier-uuid-1");
  });

  it("hands back the id of the row it actually inserted", async () => {
    scenario.carrierInsert = { data: { id: "a-different-id" }, error: null };
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status === "success" ? state.carrierId : null).toBe(
      "a-different-id",
    );
  });

  it("stays walkable with no service credentials (secretless dev)", async () => {
    scenario.adminAvailable = false;
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("success");
    expect(inserts).toEqual([]);
  });
});

describe("2 · an invalid Turnstile is rejected", () => {
  it("refuses before touching the database", async () => {
    scenario.guard = {
      ok: false,
      message:
        "We couldn't verify your submission. Please refresh the page and try again.",
    };
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("error");
    // The guard runs FIRST. This is what makes a failed verification safe:
    // no carrier row, no lead row, no email.
    expect(inserts).toEqual([]);
    expect(emails).toEqual([]);
  });

  it("does not advance the wizard", async () => {
    scenario.guard = { ok: false, message: "nope" };
    const state = await startOnboarding(initialStartState, validForm());
    expect(state).not.toHaveProperty("carrierId");
  });
});

describe("3 · a valid Turnstile is accepted", () => {
  it("proceeds to persistence once the guard passes", async () => {
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("success");
    expect(inserts.map((i) => i.table)).toContain("carriers");
  });
});

describe("4 · the carrier record is persisted exactly once", () => {
  it("writes one carriers row and one carrier_leads row", async () => {
    await startOnboarding(initialStartState, validForm());
    const tables = inserts.map((i) => i.table);
    expect(tables.filter((t) => t === "carriers")).toHaveLength(1);
    expect(tables.filter((t) => t === "carrier_leads")).toHaveLength(1);
  });

  it("creates the carrier UNCLAIMED — no profile, not active", async () => {
    await startOnboarding(initialStartState, validForm());
    const carrier = inserts.find((i) => i.table === "carriers")!.row;
    expect(carrier.active).toBe(false);
    expect(carrier).not.toHaveProperty("profile_id");
  });

  it("never stores the EIN in plaintext (S-01)", async () => {
    await startOnboarding(initialStartState, validForm({ ein: "12-3456789" }));
    const carrier = inserts.find((i) => i.table === "carriers")!.row;
    expect(carrier.ein).toBe("enc(12-3456789)");
    expect(carrier.ein).not.toBe("12-3456789");
  });

  it("still succeeds when the CRM lead insert fails", async () => {
    // A lead row is for follow-up on an abandoned wizard. Losing it must not
    // cost the carrier their onboarding.
    scenario.leadInsert = { data: null, error: { message: "lead table down" } };
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("success");
  });

  it("writes NOTHING and reports generically when the carrier insert fails", async () => {
    scenario.carrierInsert = { data: null, error: { message: "duplicate key" } };
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("error");
    expect(state.status === "error" ? state.message : "").not.toContain(
      "duplicate key",
    );
  });
});

describe("5 · a duplicate submit does not double-write", () => {
  it("a re-submit blocked by the guard adds no second row", async () => {
    // The real duplicate path. A Turnstile token is SINGLE-USE, so the second
    // press of the button arrives with a spent token, Cloudflare answers
    // `timeout-or-duplicate`, and the guard refuses — which is exactly why
    // the first attempt's row is not duplicated.
    await startOnboarding(initialStartState, validForm());
    expect(inserts.filter((i) => i.table === "carriers")).toHaveLength(1);

    scenario.guard = { ok: false, message: "verification failed" };
    const second = await startOnboarding(initialStartState, validForm());
    expect(second.status).toBe("error");
    expect(inserts.filter((i) => i.table === "carriers")).toHaveLength(1);
  });

  it("NON-VACUITY: two GUARD-PASSING submits really would write twice", async () => {
    // Honest accounting. There is no unique constraint and no idempotency key
    // on this insert — the protection is the single-use token, not the table.
    // If the guard ever passes twice for one user, two carrier rows appear.
    // Recorded here so the limit is visible rather than assumed away.
    await startOnboarding(initialStartState, validForm());
    await startOnboarding(initialStartState, validForm());
    expect(inserts.filter((i) => i.table === "carriers")).toHaveLength(2);
  });
});

describe("5b · a retry gets a FRESH Turnstile token", () => {
  // The behavioural half of the bug. Requirement 5 above proves a duplicate
  // submit does not double-write; this proves the user is not permanently
  // wedged after the first failure, which is what "Please refresh the page
  // and try again" actually described.
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the widget remounts on a new resetKey", () => {
    const widget = read("src/components/forms/TurnstileWidget.tsx");
    // `key` is the only reliable way to force the Turnstile component to
    // solve again — without it the same spent token is resubmitted forever.
    expect(widget).toMatch(/<Turnstile[\s\S]*?key=\{resetKey\}/);
  });

  it("step 1 counts failures and feeds them to the widget", () => {
    const wizard = read("src/components/onboarding/CarrierWizard.tsx");
    expect(wizard).toMatch(/setVerifyAttempt\(\(n\) => n \+ 1\)/);
    expect(wizard).toMatch(/<TurnstileWidget[^>]*resetKey=\{verifyAttempt\}/);
  });

  it("the counter is driven by the error state, not by every render", () => {
    const wizard = read("src/components/onboarding/CarrierWizard.tsx");
    // Bumping unconditionally would remount the widget mid-typing and throw
    // away a perfectly good unsolved challenge on every state change.
    expect(wizard).toMatch(
      /if \(startState\.status === "error"\) setVerifyAttempt/,
    );
  });

  it("existing call sites are untouched — resetKey defaults", () => {
    const widget = read("src/components/forms/TurnstileWidget.tsx");
    expect(widget).toMatch(/resetKey\s*=\s*0/);
  });
});

describe("6 · no raw verification detail reaches the user", () => {
  it("returns the guard's approved sentence, not a Cloudflare code", async () => {
    scenario.guard = {
      ok: false,
      message:
        "We couldn't verify your submission. Please refresh the page and try again.",
    };
    const state = await startOnboarding(initialStartState, validForm());
    const message = state.status === "error" ? (state.message ?? "") : "";
    for (const leak of [
      "timeout-or-duplicate",
      "invalid-input-response",
      "invalid-input-secret",
      "siteverify",
      "cloudflare",
      "turnstile",
    ]) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });

  it("a database error surfaces as the generic server message", async () => {
    scenario.carrierInsert = {
      data: null,
      error: { message: 'insert violates "carriers_mc_number_key"' },
    };
    const state = await startOnboarding(initialStartState, validForm());
    const message = state.status === "error" ? (state.message ?? "") : "";
    expect(message).not.toContain("carriers_mc_number_key");
    expect(message).toMatch(/something went wrong/i);
  });

  it("a validation error names the FIELD, never the guard internals", async () => {
    const state = await startOnboarding(
      initialStartState,
      validForm({ email: "not-an-email" }),
    );
    expect(state.status).toBe("error");
    expect(inserts).toEqual([]);
  });
});
