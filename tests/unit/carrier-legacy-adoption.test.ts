import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialFormState } from "@/lib/form-state";

/**
 * M-94 — bringing a pre-M-94 `carriers` row through the gate.
 *
 * ── THE TWO WAYS THIS COULD BE WRONG ─────────────────────────────────────
 *
 * Too strict and a legitimate carrier who applied the day before M-94 shipped
 * is locked out forever by a rule that did not exist when they applied. Too
 * loose and "legacy" becomes the word that means "skip the check" — which is a
 * gate with a documented way around it, i.e. not a gate.
 *
 * So the tests come in pairs: adoption RUNS the real pre-check and binds only
 * what the engine cleared, AND an unverifiable application stays unbound no
 * matter how many times the button is pressed.
 */

interface CarrierRow {
  id: string;
  company_name: string;
  mc_number: string | null;
  dot_number: string | null;
  profile_id: string | null;
}

interface PreRegRow {
  id: string;
  decision: string;
  expires_at: string;
  reason_codes: string[];
}

interface Scenario {
  session: { userId: string; role: string; status: string } | null;
  carrier: CarrierRow | null;
  /** A pre-registration already bound to this carrier. */
  alreadyBound: { id: string } | null;
  /** An existing LEGACY_ADOPTION application for this USDOT. */
  existing: PreRegRow | null;
  precheck: {
    decision: "eligible_to_continue" | "manual_review" | "not_eligible";
    preRegistrationId: string | null;
  };
  claimSucceeds: boolean;
  adminAvailable: boolean;
}

let scenario: Scenario;
let precheckRuns = 0;
let claims: { preRegistrationId: string; carrierId: string }[] = [];
let updates: { table: string; row: Record<string, unknown> }[] = [];
let audits: { action: string; detail: Record<string, unknown> | null | undefined }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/auth", () => ({
  getSessionProfile: () => Promise.resolve(scenario.session),
  isStaffRole: (role: string) => role === "admin" || role === "dispatcher",
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (e: {
    action: string;
    detail?: Record<string, unknown> | null;
  }) => {
    audits.push({ action: e.action, detail: e.detail });
    return Promise.resolve();
  },
}));

vi.mock("@/lib/carrier-authority/pre-registration", () => ({
  runCarrierPrecheck: () => {
    precheckRuns += 1;
    return Promise.resolve({
      ...scenario.precheck,
      publicReasonCodes: [],
    });
  },
  claimPreRegistration: (
    _admin: unknown,
    preRegistrationId: string,
    carrierId: string,
  ) => {
    if (!scenario.claimSucceeds) return Promise.resolve(false);
    claims.push({ preRegistrationId, carrierId });
    return Promise.resolve(true);
  },
}));

function chain(result: unknown, onUpdate?: (row: Record<string, unknown>) => void) {
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "contains", "order", "limit", "select"]) {
    b[m] = () => b;
  }
  b.maybeSingle = () => Promise.resolve(result);
  b.single = () => Promise.resolve(result);
  b.then = (f?: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(f, r);
  void onUpdate;
  return b;
}

/**
 * The action asks `carrier_pre_registrations` two DIFFERENT questions in
 * order — "is one already bound to this carrier?" and then "is there an
 * adoptable one for this USDOT?" — and answering both with the same row is
 * how the first version of this double reported failures that were its own.
 * So the cookie client counts its selects against that table.
 */
let cookiePreRegSelects = 0;

/** The row the pre-check just created, as the admin client would re-read it. */
function markedRow() {
  return {
    id: scenario.existing?.id ?? scenario.precheck.preRegistrationId ?? "pre-new-1",
    reason_codes: scenario.existing?.reason_codes ?? [],
    legal_name_entered: "Verified Freight LLC",
    usdot_number_entered: "76830",
    mc_number_entered: "123456",
  };
}

function clientFor(kind: "cookie" | "admin") {
  return {
    from: (table: string) => ({
      select: () => {
        if (table === "carriers") {
          return chain({ data: scenario.carrier, error: null });
        }
        if (table === "carrier_pre_registrations") {
          // The admin client only ever re-reads the row it just wrote.
          if (kind === "admin") {
            return chain({ data: markedRow(), error: null });
          }
          cookiePreRegSelects += 1;
          return cookiePreRegSelects === 1
            ? chain({ data: scenario.alreadyBound, error: null })
            : chain({ data: scenario.existing, error: null });
        }
        return chain({ data: null, error: null });
      },
      update: (row: Record<string, unknown>) => {
        updates.push({ table, row });
        return chain({ data: [{ id: "x" }], error: null });
      },
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(clientFor("cookie")),
}));

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () =>
    scenario.adminAvailable ? clientFor("admin") : null,
}));

const { adoptLegacyCarrier } = await import("@/app/actions/carrier-legacy");

const CARRIER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FUTURE = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    carrier_id: CARRIER_ID,
    email: "owner@legacy.example",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  precheckRuns = 0;
  claims = [];
  updates = [];
  audits = [];
  cookiePreRegSelects = 0;
  scenario = {
    session: { userId: "staff-1", role: "dispatcher", status: "active" },
    carrier: {
      id: CARRIER_ID,
      company_name: "Legacy Freight LLC",
      mc_number: "123456",
      dot_number: "76830",
      profile_id: null,
    },
    alreadyBound: null,
    existing: null,
    precheck: {
      decision: "eligible_to_continue",
      preRegistrationId: "pre-new-1",
    },
    claimSucceeds: true,
    adminAvailable: true,
  };
});

describe("who may adopt", () => {
  it("refuses anonymous and non-staff callers", async () => {
    for (const session of [
      null,
      { userId: "u", role: "carrier", status: "active" },
      { userId: "u", role: "shipper", status: "active" },
      { userId: "u", role: "admin", status: "suspended" },
    ]) {
      precheckRuns = 0;
      claims = [];
      scenario.session = session;
      const state = await adoptLegacyCarrier(initialFormState, form());
      expect(state.status).toBe("error");
      expect(precheckRuns, "no FMCSA call for a caller who may not ask").toBe(0);
      expect(claims).toEqual([]);
    }
  });
});

describe("which carriers are adoptable", () => {
  it("refuses a carrier that already has an account", async () => {
    scenario.carrier = { ...scenario.carrier!, profile_id: "user-1" };
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(precheckRuns).toBe(0);
  });

  it("refuses a carrier that is already bound to a verification", async () => {
    scenario.alreadyBound = { id: "pre-existing" };
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(precheckRuns).toBe(0);
    expect(claims).toEqual([]);
  });

  it("refuses, with guidance, when there is no USDOT anywhere", async () => {
    // The old wizard made USDOT optional, so this is common rather than
    // exotic. There is nothing to check, and inventing one is not an option.
    scenario.carrier = { ...scenario.carrier!, dot_number: null };
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(state.message ?? "").toMatch(/USDOT/i);
    expect(precheckRuns).toBe(0);
  });

  it("accepts a USDOT the reviewer supplies when the row has none", async () => {
    scenario.carrier = { ...scenario.carrier!, dot_number: null };
    const state = await adoptLegacyCarrier(
      initialFormState,
      form({ usdot_number: "76830" }),
    );
    expect(state.status).toBe("success");
    expect(precheckRuns).toBe(1);
  });
});

describe("adoption runs the REAL check", () => {
  it("binds only after the engine cleared the carrier", async () => {
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("success");
    expect(precheckRuns).toBe(1);
    expect(claims).toEqual([
      { preRegistrationId: "pre-new-1", carrierId: CARRIER_ID },
    ]);
  });

  it("does NOT bind when the engine could not decide", async () => {
    scenario.precheck = { decision: "manual_review", preRegistrationId: null };
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(claims).toEqual([]);
    // And it tells the reviewer where the work went, rather than looking
    // like a failure they should retry into a pile of duplicates.
    expect(state.message ?? "").toMatch(/review queue/i);
  });

  it("does NOT bind when FMCSA refused the carrier", async () => {
    scenario.precheck = { decision: "not_eligible", preRegistrationId: null };
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(claims).toEqual([]);
  });

  it("aligns the carrier row's identity with what was verified", async () => {
    await adoptLegacyCarrier(initialFormState, form());
    const carrierUpdate = updates.find((u) => u.table === "carriers");
    expect(carrierUpdate).toBeDefined();
    expect(carrierUpdate!.row.company_name).toBe("Verified Freight LLC");
    expect(carrierUpdate!.row.dot_number).toBe("76830");
    // The thing this must never do.
    expect(carrierUpdate!.row).not.toHaveProperty("active");
    expect(carrierUpdate!.row).not.toHaveProperty("profile_id");
  });

  it("never activates, whatever the outcome", async () => {
    for (const decision of [
      "eligible_to_continue",
      "manual_review",
      "not_eligible",
    ] as const) {
      updates = [];
      scenario.precheck = {
        decision,
        preRegistrationId:
          decision === "eligible_to_continue" ? "pre-new-1" : null,
      };
      await adoptLegacyCarrier(initialFormState, form());
      for (const u of updates) {
        expect(u.row, decision).not.toHaveProperty("active");
      }
    }
  });
});

describe("pressing the button twice", () => {
  it("binds an adoption that has since been CLEARED, without a second check", async () => {
    // The common path: run it, it goes to manual review, a dispatcher clears
    // it in the queue, somebody presses this again.
    scenario.existing = {
      id: "pre-existing-1",
      decision: "eligible_to_continue",
      expires_at: FUTURE,
      reason_codes: ["PROVIDER_UNAVAILABLE", "LEGACY_ADOPTION"],
    };
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("success");
    // No duplicate application.
    expect(precheckRuns).toBe(0);
    expect(claims).toEqual([
      { preRegistrationId: "pre-existing-1", carrierId: CARRIER_ID },
    ]);
  });

  it("refuses to create a duplicate while one is still awaiting review", async () => {
    scenario.existing = {
      id: "pre-existing-1",
      decision: "manual_review",
      expires_at: FUTURE,
      reason_codes: ["LEGACY_ADOPTION"],
    };
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(precheckRuns).toBe(0);
    expect(claims).toEqual([]);
    expect(state.message ?? "").toMatch(/awaiting review/i);
  });

  it("will not re-check a USDOT already found not eligible", async () => {
    scenario.existing = {
      id: "pre-existing-1",
      decision: "not_eligible",
      expires_at: FUTURE,
      reason_codes: ["USDOT_NOT_FOUND", "LEGACY_ADOPTION"],
    };
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(precheckRuns).toBe(0);
    expect(claims).toEqual([]);
  });

  it("reports a lost claim race instead of pretending it bound", async () => {
    scenario.claimSucceeds = false;
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(claims).toEqual([]);
  });
});

describe("the audit trail", () => {
  it("records the run and the bind separately", async () => {
    await adoptLegacyCarrier(initialFormState, form());
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("legacy_carrier_verification_run");
    expect(actions).toContain("legacy_carrier_verification_bound");
  });

  it("records a run that did NOT bind", async () => {
    scenario.precheck = { decision: "manual_review", preRegistrationId: null };
    await adoptLegacyCarrier(initialFormState, form());
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("legacy_carrier_verification_run");
    expect(actions).not.toContain("legacy_carrier_verification_bound");
  });
});

describe("without service credentials", () => {
  it("changes nothing rather than half-adopting", async () => {
    scenario.adminAvailable = false;
    const state = await adoptLegacyCarrier(initialFormState, form());
    expect(state.status).toBe("error");
    expect(precheckRuns).toBe(0);
    expect(claims).toEqual([]);
    expect(updates).toEqual([]);
  });
});
