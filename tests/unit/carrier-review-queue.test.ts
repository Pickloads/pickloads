import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialFormState } from "@/lib/form-state";
import {
  REASON_CODE_LABEL,
  matchLabel,
  sortReasonCodes,
  triStateLabel,
} from "@/lib/carrier-authority/review-labels";
import { APPLICANT_SAFE_REASON_CODES } from "@/lib/carrier-authority/risk-engine";

/**
 * M-94 — the staff manual-review queue.
 *
 * ── THE THING A REVIEW SURFACE CAN QUIETLY BECOME ────────────────────────
 *
 * An approval button. The whole point of the M-93 activation gate is that
 * payment, documents, the agreement, insurance and risk are evaluated
 * together, by `evaluateActivationEligibility()`, and that nothing shortcuts
 * it. A staff screen that resolves a manual review is one refactor away from a
 * screen that sets `carriers.active`, and at that point every requirement
 * upstream of it is decorative.
 *
 * So the assertions below are in two halves: what the action DOES (resolve a
 * pre-registration, audited, atomically), and what no code path in this module
 * is allowed to TOUCH.
 */

interface PreRegRow {
  id: string;
  decision: string | null;
  reason_codes: string[];
  claimed_carrier_id: string | null;
}

interface Scenario {
  session:
    | { userId: string; role: string; status: string; fullName: string | null }
    | null;
  row: PreRegRow | null;
  readError: { message: string } | null;
  updateMatches: number;
  updateError: { message: string } | null;
}

let scenario: Scenario;
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

function chain(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "contains", "order", "limit", "select"]) {
    b[m] = () => b;
  }
  b.maybeSingle = () => Promise.resolve(result);
  b.single = () => Promise.resolve(result);
  b.then = (f?: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(f, r);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      from: (table: string) => ({
        select: () =>
          chain({ data: scenario.row, error: scenario.readError }),
        update: (row: Record<string, unknown>) => {
          updates.push({ table, row });
          return chain({
            data: Array.from({ length: scenario.updateMatches }, () => ({
              id: "x",
            })),
            error: scenario.updateError,
          });
        },
      }),
    }),
}));

const { reviewCarrierPreRegistration } = await import(
  "@/app/actions/carrier-review"
);

const ID = "11111111-2222-4333-8444-555555555555";

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    pre_registration_id: ID,
    outcome: "clear",
    note: "Called FMCSA and confirmed the docket by hand.",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  updates = [];
  audits = [];
  scenario = {
    session: {
      userId: "staff-1",
      role: "dispatcher",
      status: "active",
      fullName: "Dana",
    },
    row: {
      id: ID,
      decision: "manual_review",
      reason_codes: ["PROVIDER_UNAVAILABLE", "INSURANCE_REVIEW_REQUIRED"],
      claimed_carrier_id: null,
    },
    readError: null,
    updateMatches: 1,
    updateError: null,
  };
});

describe("the staff gate", () => {
  it("refuses an anonymous caller", async () => {
    scenario.session = null;
    const state = await reviewCarrierPreRegistration(initialFormState, form());
    expect(state.status).toBe("error");
    expect(updates).toEqual([]);
  });

  it("refuses a carrier, a shipper and a broker", async () => {
    for (const role of ["carrier", "shipper", "broker"]) {
      updates = [];
      scenario.session = {
        userId: "u",
        role,
        status: "active",
        fullName: null,
      };
      const state = await reviewCarrierPreRegistration(
        initialFormState,
        form(),
      );
      expect(state.status, role).toBe("error");
      expect(updates, role).toEqual([]);
    }
  });

  it("refuses a SUSPENDED staff account", async () => {
    scenario.session = {
      userId: "staff-1",
      role: "admin",
      status: "suspended",
      fullName: null,
    };
    const state = await reviewCarrierPreRegistration(initialFormState, form());
    expect(state.status).toBe("error");
    expect(updates).toEqual([]);
  });

  it("reads the role from the SESSION, never from the form", async () => {
    scenario.session = {
      userId: "u",
      role: "carrier",
      status: "active",
      fullName: null,
    };
    const state = await reviewCarrierPreRegistration(
      initialFormState,
      form({ role: "admin", is_staff: "true", staff: "1" }),
    );
    expect(state.status).toBe("error");
  });
});

describe("the decision", () => {
  it("clearing sets eligible_to_continue and stamps the reviewer", async () => {
    const state = await reviewCarrierPreRegistration(initialFormState, form());
    expect(state.status).toBe("success");
    const row = updates[0]!.row;
    expect(row.decision).toBe("eligible_to_continue");
    expect(row.manual_review_required).toBe(false);
    expect(row.reviewed_by).toBe("staff-1");
    expect(row.reviewed_at).toEqual(expect.any(String));
    expect(row.review_note).toContain("Called FMCSA");
    expect(row.reason_codes).toContain("STAFF_REVIEW_CLEARED");
    // The engine's own codes survive: the record must still show WHY it came
    // to a human, next to what the human did.
    expect(row.reason_codes).toContain("PROVIDER_UNAVAILABLE");
  });

  it("refusing sets not_eligible", async () => {
    const state = await reviewCarrierPreRegistration(
      initialFormState,
      form({ outcome: "refuse" }),
    );
    expect(state.status).toBe("success");
    expect(updates[0]!.row.decision).toBe("not_eligible");
    expect(updates[0]!.row.reason_codes).toContain("STAFF_REVIEW_REFUSED");
  });

  it("NEVER writes the provider's own statement, or payment, or expiry", async () => {
    await reviewCarrierPreRegistration(initialFormState, form());
    const row = updates[0]!.row;
    // A human clearing an applicant after an FMCSA outage has not made FMCSA
    // answer. Overwriting this would erase the difference between "the
    // authority confirmed it" and "somebody decided it was fine".
    expect(row).not.toHaveProperty("verification_status");
    expect(row).not.toHaveProperty("payment_status");
    expect(row).not.toHaveProperty("expires_at");
    expect(row).not.toHaveProperty("claimed_carrier_id");
    expect(row).not.toHaveProperty("risk_tier");
  });

  it("touches no table but carrier_pre_registrations", async () => {
    await reviewCarrierPreRegistration(initialFormState, form());
    expect(new Set(updates.map((u) => u.table))).toEqual(
      new Set(["carrier_pre_registrations"]),
    );
  });

  it("requires a real note", async () => {
    for (const note of ["", "ok", "fine        "]) {
      updates = [];
      const state = await reviewCarrierPreRegistration(
        initialFormState,
        form({ note }),
      );
      expect(state.status, note).toBe("error");
      expect(updates, note).toEqual([]);
    }
  });

  it("rejects an outcome that is not one of the two", async () => {
    for (const outcome of ["approve", "activate", "", "eligible_to_continue"]) {
      updates = [];
      const state = await reviewCarrierPreRegistration(
        initialFormState,
        form({ outcome }),
      );
      expect(state.status, outcome).toBe("error");
      expect(updates, outcome).toEqual([]);
    }
  });
});

describe("what may be re-decided", () => {
  it("refuses an application that is not in manual review", async () => {
    for (const decision of ["eligible_to_continue", "not_eligible", null]) {
      updates = [];
      scenario.row = {
        id: ID,
        decision,
        reason_codes: [],
        claimed_carrier_id: null,
      };
      const state = await reviewCarrierPreRegistration(
        initialFormState,
        form(),
      );
      expect(state.status, String(decision)).toBe("error");
      expect(updates, String(decision)).toEqual([]);
    }
  });

  it("refuses an application already spent on a carrier account", async () => {
    scenario.row = {
      id: ID,
      decision: "manual_review",
      reason_codes: [],
      claimed_carrier_id: "carrier-1",
    };
    const state = await reviewCarrierPreRegistration(initialFormState, form());
    expect(state.status).toBe("error");
    expect(updates).toEqual([]);
  });

  it("loses gracefully when another reviewer got there first", async () => {
    // The read said manual_review, the UPDATE matched nothing — two
    // dispatchers pressed at once. The conditions are re-asserted in the
    // statement, so exactly one of them wins.
    scenario.updateMatches = 0;
    const state = await reviewCarrierPreRegistration(initialFormState, form());
    expect(state.status).toBe("error");
    expect(audits.map((a) => a.action)).not.toContain(
      "pre_registration_staff_review",
    );
  });

  it("reports a read failure as a failure, never as 'already resolved'", async () => {
    scenario.row = null;
    scenario.readError = { message: "connection reset" };
    const state = await reviewCarrierPreRegistration(initialFormState, form());
    expect(state.status).toBe("error");
    expect(state.message ?? "").not.toContain("connection reset");
  });
});

describe("the audit trail", () => {
  it("records the actor, the target and the outcome", async () => {
    await reviewCarrierPreRegistration(initialFormState, form());
    const entry = audits.find(
      (a) => a.action === "pre_registration_staff_review",
    );
    expect(entry).toBeDefined();
    expect(entry!.detail).toMatchObject({
      outcome: "clear",
      decision: "eligible_to_continue",
    });
  });

  it("records that a reason was given, not the reason text", async () => {
    await reviewCarrierPreRegistration(
      initialFormState,
      form({ note: "Spoke to the owner on 555-0142 and confirmed the MC." }),
    );
    const entry = audits.find(
      (a) => a.action === "pre_registration_staff_review",
    )!;
    const serialized = JSON.stringify(entry.detail);
    expect(serialized).not.toContain("555-0142");
    expect(entry.detail).toHaveProperty("note_length");
  });
});

/* ── Source-level guarantees ────────────────────────────────────────────── */

describe("the review surface cannot become an approval surface", () => {
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");

  const SURFACES = [
    "src/app/actions/carrier-review.ts",
    "src/app/actions/carrier-legacy.ts",
    "src/app/[locale]/portal/admin/carrier-verifications/page.tsx",
    "src/app/[locale]/portal/admin/carrier-verifications/[id]/page.tsx",
    "src/components/portal/CarrierReviewForm.tsx",
    "src/components/portal/LegacyCarrierAdoptForm.tsx",
  ];

  it("no staff surface writes carriers.active", () => {
    for (const f of SURFACES) {
      expect(code(f), f).not.toMatch(/active\s*:\s*true/);
      expect(code(f), f).not.toMatch(/\bactive\b\s*[:=]\s*true/);
    }
  });

  it("no staff surface calls or bypasses the activation gate", () => {
    for (const f of SURFACES) {
      expect(code(f), f).not.toContain("evaluateActivationEligibility");
      expect(code(f), f).not.toContain("activation-gate");
    }
  });

  /** The two route files. `/portal/` alone also matches the client
   *  components in `src/components/portal/`, which are not pages and have no
   *  business calling a page gate. */
  const PAGES = SURFACES.filter((f) => f.includes("/portal/admin/"));

  it("both pages are behind requireStaff", () => {
    expect(PAGES).toHaveLength(2);
    for (const f of PAGES) {
      expect(code(f), f).toContain("requireStaff(");
    }
  });

  it("neither page selects an EIN, an address or a raw payload", () => {
    for (const f of PAGES) {
      const src = code(f);
      for (const forbidden of [
        "ein",
        "phy_street",
        "address_line1",
        "raw_response,",
        "FMCSA_WEBKEY",
      ]) {
        expect(src.toLowerCase(), `${f} :: ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  });

  it("the detail page shows the digest, never a payload", () => {
    const src = code(
      "src/app/[locale]/portal/admin/carrier-verifications/[id]/page.tsx",
    );
    expect(src).toContain("raw_response_sha256");
    // Truncated: provenance, not data.
    expect(src).toMatch(/raw_response_sha256\.slice\(0, \d+\)/);
  });
});

describe("the staff labels stay on the staff side", () => {
  it("explains every reason code the engine can emit", () => {
    // A code with no label renders as a bare identifier to somebody deciding
    // whether a real company can work. Every one the engine can produce has a
    // sentence.
    const emitted = [
      "AUTHORITY_ACTIVE",
      "AUTHORITY_NOT_AUTHORIZED",
      "AUTHORITY_UNKNOWN",
      "OUT_OF_SERVICE",
      "USDOT_NOT_FOUND",
      "LEGAL_NAME_MATCH",
      "LEGAL_NAME_MISMATCH",
      "LEGAL_NAME_UNVERIFIED",
      "DOT_MATCH",
      "DOT_MISMATCH",
      "MC_MATCH",
      "MC_MISMATCH",
      "MC_NOT_PROVIDED",
      "MC_DOT_RELATIONSHIP_CONFIRMED",
      "MC_DOT_RELATIONSHIP_MISMATCH",
      "MC_DOT_RELATIONSHIP_UNVERIFIED",
      "CARRIER_AUTHORITY_ACTIVE",
      "CARRIER_AUTHORITY_INACTIVE",
      "CARRIER_AUTHORITY_UNKNOWN",
      "BROKER_AUTHORITY_ONLY",
      "INSURANCE_REVIEW_REQUIRED",
      "CREDIT_CHECK_NOT_CONFIGURED",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_NOT_CONFIGURED",
    ];
    for (const code of emitted) {
      expect(REASON_CODE_LABEL[code], code).toBeTypeOf("string");
    }
  });

  it("puts the findings first, so the reason it is here is at the top", () => {
    const sorted = sortReasonCodes([
      "INSURANCE_REVIEW_REQUIRED",
      "LEGAL_NAME_MISMATCH",
      "AUTHORITY_ACTIVE",
    ]);
    expect(sorted[0]).toBe("LEGAL_NAME_MISMATCH");
  });

  it("never renders an unknown as a 'no'", () => {
    expect(triStateLabel(null)).toBe("Not reported");
    expect(triStateLabel(false)).toBe("No");
    expect(matchLabel("unavailable")).toBe("Could not compare");
    expect(matchLabel("mismatch")).toBe("MISMATCH");
  });

  it("the applicant-safe set is still much smaller than the staff set", () => {
    // Guards the §6 boundary from the other direction: if somebody widened
    // APPLICANT_SAFE_REASON_CODES to "be more transparent", this fails.
    expect(APPLICANT_SAFE_REASON_CODES.size).toBeLessThan(
      Object.keys(REASON_CODE_LABEL).length / 3,
    );
    for (const code of ["LEGAL_NAME_MISMATCH", "MC_DOT_RELATIONSHIP_MISMATCH"]) {
      expect(APPLICANT_SAFE_REASON_CODES.has(code as never)).toBe(false);
    }
  });
});
