import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialStartState } from "@/lib/onboarding-state";

/**
 * `startOnboarding` — the action that creates the `carriers` row.
 *
 * ── WHAT THIS FILE ORIGINALLY PROVED ─────────────────────────────────────
 *
 * That step 1 of the wizard survived the Turnstile bug: a React server action
 * always answers 200, the outcome rides in the RSC payload, and the reported
 * "We couldn't verify your submission" against a `POST 200` was the guard
 * refusing a spent single-use token — not a shape mismatch. Sections 2, 5b and
 * 6 below are unchanged and still prove that.
 *
 * ── WHAT M-94 CHANGED ────────────────────────────────────────────────────
 *
 * This is no longer step 1, and "a valid submission" is no longer enough. The
 * action now requires a live, eligible, unclaimed pre-registration — the
 * record the FMCSA pre-check writes — and CLAIMS it in the same call. So the
 * file gained the set of tests that matter most: what happens when there is no
 * pre-registration, when it is expired, when it was already spent, when the
 * risk engine said manual review, and when the browser sends identity fields
 * that disagree with the ones that were actually verified.
 *
 * Two earlier expectations are now INVERTED, deliberately:
 *
 *   • "stays walkable with no service credentials" — it does not. Without the
 *     service role the pre-registration cannot be read, and an unverifiable
 *     claim is refused rather than assumed. The old shortcut handed the
 *     browser a wizard handle with no database behind it, which is the exact
 *     bypass shape §16 asks to close.
 *
 *   • "NON-VACUITY: two guard-passing submits really would write twice" — they
 *     no longer do. The conditional claim is the idempotency key the old note
 *     honestly recorded as missing.
 *
 * ── WHY THE GUARD IS MOCKED AND THE GATE IS NOT ──────────────────────────
 *
 * `guardPublicForm` is rate limit + Turnstile; reproducing it would need a
 * live Cloudflare siteverify. The GATE, by contrast, runs for real against a
 * fake supabase client — `loadEligiblePreRegistration` and
 * `claimPreRegistration` are the code under test here, and mocking them would
 * leave this file asserting that a mock returns what it was told to.
 */

interface PreRegistrationRow {
  id: string;
  legal_name_entered: string;
  usdot_number_entered: string;
  mc_number_entered: string | null;
  email: string;
  locale: string;
  decision: string | null;
  expires_at: string;
  claimed_carrier_id: string | null;
}

interface Scenario {
  guard: { ok: true; ip: string } | { ok: false; message: string };
  carrierInsert: { data: { id: string } | null; error: { message: string } | null };
  leadInsert: { data: { id: string } | null; error: { message: string } | null };
  adminAvailable: boolean;
  /** What the browser presents. `null` = no pre-check has been done. */
  cookie: string | null;
  /** What the database holds for that id. `null` = no such row. */
  preRegistration: PreRegistrationRow | null;
  preRegistrationError: { message: string } | null;
  /** Whether the conditional UPDATE matched a row (i.e. won the race). */
  claimSucceeds: boolean;
  /**
   * M-95. What `carrier_onboarding_payments` holds for this applicant — the
   * LEDGER the payment gate reads. Not a flag the action is handed: the fake
   * returns rows and the real `readFeePaymentState` interprets them.
   */
  paymentRows: Array<{
    provider_session_id: string | null;
    status: string;
    paid_at: string | null;
  }>;
}

let scenario: Scenario;
let inserts: { table: string; row: Record<string, unknown> }[] = [];
let updates: { table: string; row: Record<string, unknown> }[] = [];
let deletes: { table: string }[] = [];
let emails: string[] = [];
let auditActions: string[] = [];
let cookieCleared = false;

const FUTURE = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

/** An eligible, live, unclaimed pre-registration. */
function eligiblePreRegistration(
  over: Partial<PreRegistrationRow> = {},
): PreRegistrationRow {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    legal_name_entered: "Carter Trucking LLC",
    usdot_number_entered: "76830",
    mc_number_entered: "123456",
    email: "john@cartertrucking.example",
    locale: "en",
    decision: "eligible_to_continue",
    expires_at: FUTURE,
    claimed_carrier_id: null,
    ...over,
  };
}

vi.mock("@/lib/forms/guard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/forms/guard")>();
  return {
    ...actual,
    guardPublicForm: () => Promise.resolve(scenario.guard),
  };
});

vi.mock("@/lib/carrier-authority/precheck-session", () => ({
  readPrecheckCookie: () => Promise.resolve(scenario.cookie),
  clearPrecheckCookie: () => {
    cookieCleared = true;
    return Promise.resolve();
  },
  setPrecheckCookie: () => Promise.resolve(),
}));

// Journaling is asserted by ACTION NAME here. The ledger's own contract
// (service-role only, no browser insert policy) is the RLS suite's job.
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (event: { action: string }) => {
    auditActions.push(event.action);
    return Promise.resolve();
  },
}));

/** A thenable that answers every builder method with itself. */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "is", "gt", "order", "limit", "select"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.single = () => Promise.resolve(result);
  builder.then = (
    onfulfilled?: (v: unknown) => unknown,
    onrejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () =>
    scenario.adminAvailable
      ? {
          from: (table: string) => ({
            insert: (row: Record<string, unknown>) => {
              inserts.push({ table, row });
              return chain(
                table === "carriers"
                  ? scenario.carrierInsert
                  : scenario.leadInsert,
              );
            },
            select: () => {
              if (table === "carrier_pre_registrations") {
                return chain({
                  data: scenario.preRegistration,
                  error: scenario.preRegistrationError,
                });
              }
              if (table === "carrier_onboarding_payments") {
                return chain({ data: scenario.paymentRows, error: null });
              }
              return chain({ data: null, error: null });
            },
            update: (row: Record<string, unknown>) => {
              updates.push({ table, row });
              return chain({
                data: scenario.claimSucceeds ? [{ id: "claimed" }] : [],
                error: null,
              });
            },
            delete: () => {
              deletes.push({ table });
              return chain({ data: null, error: null });
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
    full_name: "John Carter",
    email: "john@cartertrucking.example",
    phone: "(908) 555-0142",
    home_state: "NJ",
    locale: "en",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

function carrierRow(): Record<string, unknown> {
  return inserts.find((i) => i.table === "carriers")!.row;
}

beforeEach(() => {
  inserts = [];
  updates = [];
  deletes = [];
  emails = [];
  auditActions = [];
  cookieCleared = false;
  scenario = {
    guard: { ok: true, ip: "1.2.3.4" },
    carrierInsert: { data: { id: "carrier-uuid-1" }, error: null },
    leadInsert: { data: { id: "lead-uuid-1" }, error: null },
    adminAvailable: true,
    cookie: "11111111-2222-4333-8444-555555555555",
    preRegistration: eligiblePreRegistration(),
    preRegistrationError: null,
    claimSucceeds: true,
    // The default applicant has PAID. Every pre-M-95 test in this file
    // describes the FMCSA half of the gate and would otherwise be refused by
    // the payment half before reaching what it is actually testing.
    paymentRows: [
      {
        provider_session_id: "cs_test_1",
        status: "paid",
        paid_at: "2026-08-19T00:00:00.000Z",
      },
    ],
  };
});

describe("1 · a verified applicant advances to Documents", () => {
  it("returns the success shape the wizard advances on", async () => {
    const state = await startOnboarding(initialStartState, validForm());
    // The wizard's effect is:
    //   if (status === "success" && carrierId) setStep(4)
    // so these two fields ARE the documents-step transition.
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

  it("echoes the VERIFIED company name back for the account step", async () => {
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status === "success" ? state.companyName : null).toBe(
      "Carter Trucking LLC",
    );
  });

  it("REFUSES with no service credentials — it cannot verify, so it does not", async () => {
    // Inverted from the pre-M-94 behaviour on purpose. The old shortcut
    // returned `{status:"success", carrierId: randomUUID()}` here, which is a
    // wizard handle minted for a caller nobody checked.
    scenario.adminAvailable = false;
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("error");
    expect(inserts).toEqual([]);
    expect(auditActions).toContain("onboarding_gate_denied");
  });
});

describe("1b · the gate — no pre-registration, no carrier row", () => {
  const REFUSALS: ReadonlyArray<[string, () => void]> = [
    ["no pre-check was ever done (no cookie)", () => {
      scenario.cookie = null;
    }],
    ["the id is not even a UUID", () => {
      scenario.cookie = "verified=true";
    }],
    ["the id names no row", () => {
      scenario.preRegistration = null;
    }],
    ["the pre-registration has expired", () => {
      scenario.preRegistration = eligiblePreRegistration({ expires_at: PAST });
    }],
    ["it was already spent on another carrier", () => {
      scenario.preRegistration = eligiblePreRegistration({
        claimed_carrier_id: "some-other-carrier",
      });
    }],
    ["the risk engine said manual review", () => {
      scenario.preRegistration = eligiblePreRegistration({
        decision: "manual_review",
      });
    }],
    ["the risk engine said not eligible", () => {
      scenario.preRegistration = eligiblePreRegistration({
        decision: "not_eligible",
      });
    }],
    ["the check never completed, so no decision was stored", () => {
      scenario.preRegistration = eligiblePreRegistration({ decision: null });
    }],
    ["the gate read itself failed", () => {
      scenario.preRegistration = null;
      scenario.preRegistrationError = { message: "connection reset" };
    }],
  ];

  for (const [name, arrange] of REFUSALS) {
    it(`refuses when ${name}`, async () => {
      arrange();
      const state = await startOnboarding(initialStartState, validForm());
      expect(state.status).toBe("error");
      // The whole point: no carrier row, no lead row, no email, no account.
      expect(inserts).toEqual([]);
      expect(emails).toEqual([]);
      expect(auditActions).toContain("onboarding_gate_denied");
    });
  }

  it("tells the applicant one neutral sentence, never which check failed", async () => {
    // §20: "expired" and "somebody is replaying a spent token" are very
    // different operational events and both are audited — neither is shown.
    const messages = new Set<string>();
    for (const [, arrange] of REFUSALS) {
      inserts = [];
      auditActions = [];
      scenario.preRegistration = eligiblePreRegistration();
      scenario.preRegistrationError = null;
      scenario.cookie = "11111111-2222-4333-8444-555555555555";
      arrange();
      const state = await startOnboarding(initialStartState, validForm());
      messages.add(state.status === "error" ? (state.message ?? "") : "");
    }
    expect(messages.size).toBe(1);
    const [only] = [...messages];
    for (const leak of ["expired", "claimed", "eligible", "decision", "uuid"]) {
      expect((only ?? "").toLowerCase()).not.toContain(leak);
    }
  });
});

describe("1d · M-95 — the FMCSA gate AND the payment gate, both from the database", () => {
  const UNPAID: Array<[string, Scenario["paymentRows"]]> = [
    ["no payment has ever been attempted", []],
    [
      "a Checkout was created but never completed",
      [{ provider_session_id: "cs_1", status: "session_created", paid_at: null }],
    ],
    [
      "the payment failed",
      [{ provider_session_id: "cs_1", status: "failed", paid_at: null }],
    ],
    [
      "the Checkout expired",
      [{ provider_session_id: "cs_1", status: "unpaid", paid_at: null }],
    ],
    [
      "the fee was paid and then refunded",
      [{ provider_session_id: "cs_1", status: "refunded", paid_at: "2026-08-01" }],
    ],
  ];

  for (const [name, rows] of UNPAID) {
    it(`refuses when ${name}`, async () => {
      scenario.paymentRows = rows;
      const state = await startOnboarding(initialStartState, validForm());
      expect(state.status).toBe("error");
      // No carrier row, no lead, no email — the same closed door the FMCSA
      // half produces, for the other reason.
      expect(inserts).toEqual([]);
      expect(emails).toEqual([]);
      expect(auditActions).toContain("onboarding_gate_denied");
    });
  }

  it("proceeds only when the ledger says paid", async () => {
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("success");
  });

  it("a ledger READ FAILURE is not a pass", async () => {
    // "We could not ask" must never resolve to "go ahead". The fake returns a
    // shape `readFeePaymentState` treats as no rows, which is unpaid.
    scenario.paymentRows = [];
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("error");
  });

  it("PAYMENT DOES NOT OVERRIDE ELIGIBILITY — the two conditions are ANDed", async () => {
    // The rule this exists to prove: somebody in manual review who pays is
    // still in manual review. Money buys the fee, not the verdict.
    for (const decision of ["manual_review", "not_eligible", null]) {
      inserts = [];
      scenario.preRegistration = eligiblePreRegistration({ decision });
      scenario.paymentRows = [
        {
          provider_session_id: "cs_paid",
          status: "paid",
          paid_at: "2026-08-19T00:00:00.000Z",
        },
      ];
      const state = await startOnboarding(initialStartState, validForm());
      expect(state.status, String(decision)).toBe("error");
      expect(inserts, String(decision)).toEqual([]);
    }
  });

  it("no client-supplied payment field can stand in for the ledger", async () => {
    scenario.paymentRows = [];
    const state = await startOnboarding(
      initialStartState,
      validForm({
        paid: "true",
        payment_status: "paid",
        stripe_session_id: "cs_test_forged",
        checkout_session_id: "cs_test_forged",
        amount_paid: "999",
      }),
    );
    expect(state.status).toBe("error");
    expect(inserts).toEqual([]);
  });

  it("tells the applicant something they can act on, without internals", async () => {
    scenario.paymentRows = [];
    const state = await startOnboarding(initialStartState, validForm());
    const message = state.status === "error" ? (state.message ?? "") : "";
    expect(message).toMatch(/\$9\.99|verification fee/i);
    for (const leak of ["cs_", "sk_", "price_", "stripe_secret", "webhook"]) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });
});

describe("1c · the browser cannot substitute an identity it did not verify", () => {
  it("takes company name, MC and USDOT from the VERIFIED record", async () => {
    // The attack this closes: verify as a real carrier, then register as a
    // different one by editing three fields between the two requests.
    await startOnboarding(
      initialStartState,
      validForm({
        company_name: "Someone Else Freight Inc",
        mc_number: "999999",
        dot_number: "999999",
      }),
    );
    const carrier = carrierRow();
    expect(carrier.company_name).toBe("Carter Trucking LLC");
    expect(carrier.mc_number).toBe("123456");
    expect(carrier.dot_number).toBe("76830");
  });

  it("no client-supplied boolean can stand in for the stored decision", async () => {
    scenario.cookie = null;
    const state = await startOnboarding(
      initialStartState,
      validForm({
        verified: "true",
        eligible: "true",
        fmcsaPassed: "true",
        paid: "true",
        approved: "true",
        active: "true",
        pre_registration_id: "11111111-2222-4333-8444-555555555555",
      }),
    );
    expect(state.status).toBe("error");
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
    // The guard runs FIRST — before the gate, before the database. This is
    // what makes a failed verification safe: no carrier row, no lead row, no
    // email, and no FMCSA-derived state consulted either.
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
  it("proceeds to persistence once the guard and the gate pass", async () => {
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
    const carrier = carrierRow();
    expect(carrier.active).toBe(false);
    expect(carrier).not.toHaveProperty("profile_id");
  });

  it("never stores the EIN in plaintext (S-01)", async () => {
    await startOnboarding(initialStartState, validForm({ ein: "12-3456789" }));
    expect(carrierRow().ein).toBe("enc(12-3456789)");
    expect(carrierRow().ein).not.toBe("12-3456789");
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

describe("4b · the pre-registration is SPENT, atomically", () => {
  it("claims it in the same call that creates the carrier", async () => {
    await startOnboarding(initialStartState, validForm());
    const claim = updates.find((u) => u.table === "carrier_pre_registrations");
    expect(claim).toBeDefined();
    expect(claim!.row.claimed_carrier_id).toBe("carrier-uuid-1");
    expect(claim!.row.claimed_at).toEqual(expect.any(String));
  });

  it("clears the browser's copy once it has been spent", async () => {
    await startOnboarding(initialStartState, validForm());
    expect(cookieCleared).toBe(true);
  });

  it("DELETES the carrier row when the claim loses the race", async () => {
    // Two requests, one verification. Postgres matches the conditional UPDATE
    // for exactly one of them; the loser must not leave behind a carriers row
    // with no verification bound to it — that orphan is the thing this whole
    // milestone exists to stop creating.
    scenario.claimSucceeds = false;
    const state = await startOnboarding(initialStartState, validForm());
    expect(state.status).toBe("error");
    expect(deletes).toEqual([{ table: "carriers" }]);
    expect(emails).toEqual([]);
    expect(auditActions).toContain("onboarding_gate_denied");
  });
});

describe("5 · a duplicate submit does not double-write", () => {
  it("a re-submit blocked by the guard adds no second row", async () => {
    // A Turnstile token is SINGLE-USE, so the second press of the button
    // arrives with a spent token, Cloudflare answers `timeout-or-duplicate`,
    // and the guard refuses.
    await startOnboarding(initialStartState, validForm());
    expect(inserts.filter((i) => i.table === "carriers")).toHaveLength(1);

    scenario.guard = { ok: false, message: "verification failed" };
    const second = await startOnboarding(initialStartState, validForm());
    expect(second.status).toBe("error");
    expect(inserts.filter((i) => i.table === "carriers")).toHaveLength(1);
  });

  it("two GUARD-PASSING submits no longer produce two carriers", async () => {
    // This assertion is the inverse of the one it replaces. The old note was
    // honest about the gap — "there is no unique constraint and no idempotency
    // key on this insert" — and the conditional claim is now that key: the
    // second submit finds the pre-registration spent and its carrier row is
    // rolled back.
    await startOnboarding(initialStartState, validForm());
    scenario.claimSucceeds = false;
    scenario.preRegistration = eligiblePreRegistration({
      claimed_carrier_id: "carrier-uuid-1",
    });
    const second = await startOnboarding(initialStartState, validForm());
    expect(second.status).toBe("error");
    expect(inserts.filter((i) => i.table === "carriers")).toHaveLength(1);
  });
});

describe("5b · a retry gets a FRESH Turnstile token", () => {
  // The behavioural half of the original bug. Section 5 proves a duplicate
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

  it("the company-details step counts failures and feeds them to the widget", () => {
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

  it("the pre-check screen resets its own widget too", () => {
    // M-94 added a second public form to this funnel. It uses the shared
    // `useTurnstileReset` hook rather than its own counter, which is the
    // safety default the hook exists to be.
    const precheck = read("src/components/onboarding/CarrierPrecheck.tsx");
    expect(precheck).toMatch(/useTurnstileReset\(state\)/);
    expect(precheck).toMatch(
      /<TurnstileWidget[^>]*resetKey=\{turnstileAttempt\}/,
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
