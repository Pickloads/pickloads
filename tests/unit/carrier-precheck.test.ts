import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  carrierPrecheckSchema,
} from "@/lib/validation/carrier-precheck";
import type { EnteredIdentity } from "@/lib/carrier-authority/identity-match";
import type {
  AuthorityLookupResult,
  CarrierAuthorityProvider,
  DocketLookupResult,
  NormalizedAuthorityRecord,
} from "@/lib/carrier-authority/provider";

/**
 * M-94 §26 — adversarial tests for the pre-registration gate.
 *
 * ── THE FIVE THINGS THIS FILE EXISTS TO MAKE IMPOSSIBLE ──────────────────
 *
 *   1. No failure state may become VERIFIED.
 *   2. No provider failure may become NOT_ELIGIBLE.
 *   3. No carrier may create an ACTIVE account through this gate.
 *   4. No FF or MX docket may satisfy a submitted MC.
 *   5. No client-supplied boolean may bypass server state.
 *
 * (5) is asserted in `onboarding-step1.test.ts`, where the browser's request
 * actually arrives; everything else is here.
 *
 * ── WHY THE DECISION MATRIX RUNS AGAINST `evaluatePrecheck` ──────────────
 *
 * It is pure: entered identity + carrier lookup + docket lookup in, decision
 * out. No clock, no network, no database. That is what lets one table below
 * cover every §12 row — timeout, 429, 5xx, malformed JSON, unrecognised
 * envelope, docket endpoint down, unknown authority token, name mismatch —
 * without eighteen fixtures and a fake HTTP server. The MAPPING from an HTTP
 * failure to `provider_unavailable` is the adapter's contract and is tested in
 * `fmcsa-envelope-outcomes.test.ts`; this file starts one layer above it.
 */

const auditActions: string[] = [];
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (event: { action: string }) => {
    auditActions.push(event.action);
    return Promise.resolve();
  },
}));

const { evaluatePrecheck, publicReasonCodes, runCarrierPrecheck } =
  await import("@/lib/carrier-authority/pre-registration");

/* ── Fixtures ───────────────────────────────────────────────────────────── */

/** A clean, active, fully-matching carrier. Every case below perturbs it. */
function record(
  over: Partial<NormalizedAuthorityRecord> = {},
): NormalizedAuthorityRecord {
  return {
    providerRecordId: "76830",
    legalName: "ACME TRUCKING LLC",
    dbaName: null,
    usdotNumber: "76830",
    mcNumber: "123456",
    // Set by the merge in `evaluatePrecheck`, never by the carrier endpoint.
    dockets: null,
    allowedToOperate: true,
    statusCode: "A",
    outOfService: false,
    outOfServiceDate: null,
    commonAuthority: "active",
    contractAuthority: null,
    brokerAuthority: null,
    insurance: null,
    safety: null,
    sourceRetrievedAt: "2026-08-18T06:00:03.368+0000",
    rawResponseSha256: "a".repeat(64),
    ...over,
  };
}

const ENTERED: EnteredIdentity = {
  legalName: "Acme Trucking LLC",
  usdotNumber: "76830",
  mcNumber: "123456",
};

function decide(input: {
  entered?: EnteredIdentity;
  lookup?: AuthorityLookupResult;
  dockets?: DocketLookupResult;
}) {
  return evaluatePrecheck({
    entered: input.entered ?? ENTERED,
    lookup: input.lookup ?? { status: "found", record: record() },
    dockets: input.dockets ?? {
      status: "found",
      dockets: [{ prefix: "MC", number: "123456" }],
    },
    creditConfigured: false,
  });
}

/* ── §26 · identity and docket ──────────────────────────────────────────── */

describe("§26 · USDOT + MC", () => {
  it("valid USDOT with the correct MC is eligible to continue", () => {
    const out = decide({});
    expect(out.assessment.decision).toBe("eligible_to_continue");
    expect(out.verificationStatus).toBe("verified");
    expect(out.assessment.reasonCodes).toContain(
      "MC_DOT_RELATIONSHIP_CONFIRMED",
    );
  });

  it("valid USDOT with an MC that belongs to somebody else is NOT eligible to continue", () => {
    const out = decide({
      entered: { ...ENTERED, mcNumber: "777777" },
      dockets: { status: "found", dockets: [{ prefix: "MC", number: "123456" }] },
    });
    expect(out.assessment.decision).toBe("manual_review");
    expect(out.assessment.reasonCodes).toContain(
      "MC_DOT_RELATIONSHIP_MISMATCH",
    );
    expect(out.verificationStatus).not.toBe("verified");
  });

  it("an FF docket with the SAME DIGITS does not satisfy a submitted MC", () => {
    // The M-93 closure finding, re-asserted at the gate: a freight forwarder
    // holding FF-777777 must not verify as motor carrier MC-777777.
    const out = decide({
      entered: { ...ENTERED, mcNumber: "777777" },
      dockets: { status: "found", dockets: [{ prefix: "FF", number: "777777" }] },
    });
    expect(out.assessment.decision).not.toBe("eligible_to_continue");
    expect(out.assessment.reasonCodes).toContain(
      "MC_DOT_RELATIONSHIP_MISMATCH",
    );
  });

  it("an MX docket with the SAME DIGITS does not satisfy a submitted MC", () => {
    const out = decide({
      entered: { ...ENTERED, mcNumber: "777777" },
      dockets: { status: "found", dockets: [{ prefix: "MX", number: "777777" }] },
    });
    expect(out.assessment.decision).not.toBe("eligible_to_continue");
  });

  it("a multi-series carrier passes on the MC entry among the others", () => {
    const out = decide({
      dockets: {
        status: "found",
        dockets: [
          { prefix: "FF", number: "900001" },
          { prefix: "MX", number: "123456" },
          { prefix: "MC", number: "123456" },
        ],
      },
    });
    expect(out.assessment.decision).toBe("eligible_to_continue");
  });

  it("a docket endpoint that was never reached is UNVERIFIED, not a mismatch", () => {
    const out = decide({
      dockets: { status: "provider_unavailable", reason: "TimeoutError" },
    });
    expect(out.assessment.decision).toBe("manual_review");
    expect(out.assessment.reasonCodes).toContain(
      "MC_DOT_RELATIONSHIP_UNVERIFIED",
    );
    expect(out.assessment.reasonCodes).not.toContain(
      "MC_DOT_RELATIONSHIP_MISMATCH",
    );
  });

  it("no MC submitted goes to a human, never to an automatic approval", () => {
    const out = decide({
      entered: { ...ENTERED, mcNumber: null },
      dockets: { status: "found", dockets: [] },
    });
    expect(out.assessment.decision).toBe("manual_review");
  });
});

describe("§26 · legal name", () => {
  it("punctuation, case and the entity suffix do not cost a review", () => {
    const out = decide({
      entered: { ...ENTERED, legalName: "acme trucking, l.l.c." },
    });
    expect(out.assessment.decision).toBe("eligible_to_continue");
    expect(out.assessment.reasonCodes).toContain("LEGAL_NAME_MATCH");
  });

  it("a materially different name never auto-approves", () => {
    // "Trucking" and "Transport" are different companies, and approving the
    // wrong one hands an applicant somebody else's operating authority.
    const out = decide({
      entered: { ...ENTERED, legalName: "Acme Transport LLC" },
    });
    expect(out.assessment.decision).toBe("manual_review");
    expect(out.assessment.reasonCodes).toContain("LEGAL_NAME_MISMATCH");
    expect(out.assessment.decision).not.toBe("not_eligible");
  });
});

/* ── §26 · authority and service status ─────────────────────────────────── */

describe("§26 · operating authority", () => {
  it("broker authority alone does not satisfy carrier authority", () => {
    const out = decide({
      lookup: {
        status: "found",
        record: record({
          commonAuthority: "none",
          contractAuthority: "none",
          brokerAuthority: "active",
        }),
      },
    });
    expect(out.assessment.decision).toBe("manual_review");
    expect(out.assessment.reasonCodes).toContain("BROKER_AUTHORITY_ONLY");
  });

  it("an unknown authority token is an unknown, not a refusal", () => {
    const out = decide({
      lookup: {
        status: "found",
        record: record({
          commonAuthority: null,
          contractAuthority: null,
          allowedToOperate: null,
        }),
      },
    });
    expect(out.assessment.decision).toBe("manual_review");
    expect(out.assessment.decision).not.toBe("not_eligible");
  });

  it("a confirmed out-of-service carrier is NOT ELIGIBLE", () => {
    const out = decide({
      lookup: { status: "found", record: record({ outOfService: true }) },
    });
    expect(out.assessment.decision).toBe("not_eligible");
    expect(out.assessment.reasonCodes).toContain("OUT_OF_SERVICE");
    expect(out.verificationStatus).toBe("not_verified");
  });

  it("an UNKNOWN out-of-service flag is not treated as false", () => {
    const out = decide({
      lookup: { status: "found", record: record({ outOfService: null }) },
    });
    expect(out.assessment.reasonCodes).not.toContain("OUT_OF_SERVICE");
    expect(out.assessment.decision).toBe("eligible_to_continue");
  });
});

/* ── §26 · the decision matrix, including every failure mode ────────────── */

describe("§26/§12 · a failure is never a verdict", () => {
  const FAILURES: ReadonlyArray<[string, AuthorityLookupResult]> = [
    ["FMCSA timeout", { status: "provider_unavailable", reason: "TimeoutError" }],
    ["FMCSA 429", { status: "provider_unavailable", reason: "rate_limited" }],
    ["FMCSA 500", { status: "provider_unavailable", reason: "http_500" }],
    [
      "malformed JSON",
      { status: "provider_unavailable", reason: "malformed_json" },
    ],
    [
      "unrecognised envelope",
      { status: "provider_unavailable", reason: "unrecognized_envelope" },
    ],
    ["credential rejected", { status: "provider_unavailable", reason: "credential_rejected" }],
    ["provider not configured", { status: "not_configured" }],
  ];

  for (const [name, lookup] of FAILURES) {
    it(`${name} → MANUAL_REVIEW, never verified and never refused`, () => {
      const out = decide({ lookup });
      expect(out.assessment.decision).toBe("manual_review");
      expect(out.assessment.decision).not.toBe("not_eligible");
      expect(out.verificationStatus).toBe("provider_unavailable");
      expect(out.verificationStatus).not.toBe("verified");
      expect(out.assessment.manualReviewRequired).toBe(true);
    });
  }

  it("a docket endpoint failure alone is also MANUAL_REVIEW", () => {
    for (const dockets of [
      { status: "provider_unavailable", reason: "http_503" },
      { status: "not_configured" },
      { status: "not_found" },
    ] as DocketLookupResult[]) {
      expect(decide({ dockets }).assessment.decision).toBe("manual_review");
    }
  });

  it("an AFFIRMATIVE absence — and only that — is NOT_ELIGIBLE", () => {
    // The one path to a refusal on identity. It requires FMCSA to have said
    // so; "we could not read the answer" never reaches here.
    const out = decide({ lookup: { status: "not_found" } });
    expect(out.assessment.decision).toBe("not_eligible");
    expect(out.assessment.reasonCodes).toContain("USDOT_NOT_FOUND");
  });

  it("EXHAUSTIVE: no lookup status other than `found` can ever be verified", () => {
    const statuses: AuthorityLookupResult[] = [
      { status: "not_found" },
      { status: "not_configured" },
      { status: "provider_unavailable", reason: "anything" },
    ];
    for (const lookup of statuses) {
      expect(decide({ lookup }).verificationStatus).not.toBe("verified");
    }
  });
});

/* ── §26 · insurance and safety stay out of the decision ────────────────── */

describe("§10/§11 · what the engine refuses to conclude", () => {
  it("an FMCSA insurance filing never satisfies the COI requirement", () => {
    const out = decide({
      lookup: {
        status: "found",
        record: record({
          insurance: {
            bipdOnFile: "Y",
            bipdRequired: "Y",
            bipdRequiredAmount: "750",
            cargoOnFile: "Y",
            cargoRequired: "Y",
            bondOnFile: "N",
            bondRequired: "N",
          },
        }),
      },
    });
    // Everything on file federally, and the code still says a human reads the
    // certificate. That is the §10 separation, asserted rather than assumed.
    expect(out.assessment.reasonCodes).toContain("INSURANCE_REVIEW_REQUIRED");
  });

  it("crash counts and OOS rates do not change the decision", () => {
    const clean = decide({});
    const alarming = decide({
      lookup: {
        status: "found",
        record: record({
          safety: {
            rating: "C",
            ratingDate: "2025-01-01",
            crashTotal: 91,
            vehicleOosRate: 88.5,
            driverOosRate: 61.2,
          },
        }),
      },
    });
    // §11: no invented PickLoads safety score, no hidden ranking.
    expect(alarming.assessment.decision).toBe(clean.assessment.decision);
  });
});

/* ── §20 · what the applicant is allowed to learn ───────────────────────── */

describe("§20 · reason codes are staff-only", () => {
  it("the applicant-safe subset never leaks a fraud rule", () => {
    const out = decide({
      entered: { ...ENTERED, legalName: "Acme Transport LLC" },
    });
    expect(out.assessment.reasonCodes).toContain("LEGAL_NAME_MISMATCH");
    expect(publicReasonCodes(out.assessment.reasonCodes)).not.toContain(
      "LEGAL_NAME_MISMATCH",
    );
  });

  it("only USDOT_NOT_FOUND, MC_NOT_PROVIDED and PROVIDER_UNAVAILABLE survive", () => {
    const out = decide({ lookup: { status: "not_found" } });
    expect(publicReasonCodes(out.assessment.reasonCodes)).toEqual([
      "USDOT_NOT_FOUND",
    ]);
  });
});

/* ── §2 · input normalisation ───────────────────────────────────────────── */

describe("§2 · what the public form accepts", () => {
  const base = {
    legal_name: "Acme Trucking LLC",
    usdot_number: "76830",
    mc_number: "MC-123456",
    email: "ops@acme.example",
    locale: "en",
  };

  it("accepts MC123456, MC-123456, mc 123456 and 123456 as one number", () => {
    for (const raw of ["MC123456", "MC-123456", "mc 123456", "123456"]) {
      const parsed = carrierPrecheckSchema.safeParse({ ...base, mc_number: raw });
      expect(parsed.success, raw).toBe(true);
      expect(parsed.success && parsed.data.mc_number).toBe("123456");
    }
  });

  it("strips leading zeros so 0076830 and 76830 are the same registration", () => {
    const parsed = carrierPrecheckSchema.safeParse({
      ...base,
      usdot_number: "0076830",
    });
    expect(parsed.success && parsed.data.usdot_number).toBe("76830");
  });

  it("refuses a malformed USDOT", () => {
    for (const raw of ["", "abc", "   ", "123456789012"]) {
      expect(
        carrierPrecheckSchema.safeParse({ ...base, usdot_number: raw }).success,
        raw,
      ).toBe(false);
    }
  });

  it("refuses a malformed MC rather than silently dropping its digits", () => {
    for (const raw of ["MC-12-34-56", "abc123", "MC#123456", "12 34 56"]) {
      expect(
        carrierPrecheckSchema.safeParse({ ...base, mc_number: raw }).success,
        raw,
      ).toBe(false);
    }
  });

  it("accepts a BLANK MC — an intrastate carrier is not a malformed one", () => {
    const parsed = carrierPrecheckSchema.safeParse({ ...base, mc_number: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.mc_number).toBeNull();
  });

  it("collects nothing sensitive", () => {
    const parsed = carrierPrecheckSchema.safeParse({
      ...base,
      ein: "12-3456789",
      password: "hunter2",
      verified: "true",
    });
    expect(parsed.success).toBe(true);
    // §2/§17: the fields are not ignored at runtime, they are unrepresentable.
    expect(Object.keys(parsed.success ? parsed.data : {})).toEqual([
      "legal_name",
      "usdot_number",
      "mc_number",
      "email",
      "locale",
    ]);
  });
});

/* ── §3/§21 · what the orchestrator actually writes ─────────────────────── */

interface Written {
  table: string;
  row: Record<string, unknown>;
}

function fakeAdmin(written: Written[], updated: Written[]) {
  const chain = (result: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "is", "gt", "select"]) b[m] = () => b;
    b.single = () => Promise.resolve(result);
    b.maybeSingle = () => Promise.resolve(result);
    b.then = (f?: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(f, r);
    return b;
  };
  return {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        written.push({ table, row });
        return chain({ data: { id: "pre-reg-1" }, error: null });
      },
      update: (row: Record<string, unknown>) => {
        updated.push({ table, row });
        return chain({ data: [{ id: "pre-reg-1" }], error: null });
      },
      select: () => chain({ data: null, error: null }),
    }),
  };
}

function stubProvider(
  lookup: AuthorityLookupResult,
  dockets: DocketLookupResult,
): CarrierAuthorityProvider {
  return {
    name: "fmcsa_qcmobile",
    isConfigured: () => lookup.status !== "not_configured",
    lookupByUsdot: () => Promise.resolve(lookup),
    lookupByDocket: () => Promise.resolve(lookup),
    lookupDocketNumbers: () => Promise.resolve(dockets),
  };
}

const SUBMISSION = {
  legalName: "Acme Trucking LLC",
  usdotNumber: "76830",
  mcNumber: "123456",
  email: "ops@acme.example",
  locale: "en" as const,
};

async function run(
  lookup: AuthorityLookupResult,
  dockets: DocketLookupResult = {
    status: "found",
    dockets: [{ prefix: "MC", number: "123456" }],
  },
) {
  const written: Written[] = [];
  const updated: Written[] = [];
  const outcome = await runCarrierPrecheck(SUBMISSION, {
    provider: stubProvider(lookup, dockets),
    creditConfigured: false,
    admin: fakeAdmin(written, updated) as never,
  });
  return { outcome, written, updated };
}

beforeEach(() => {
  auditActions.length = 0;
});

describe("§3 · the pre-check creates a pre-registration and NOTHING else", () => {
  it("writes no carriers row, no profile, no membership, no payment", async () => {
    const { written } = await run({ status: "found", record: record() });
    const tables = new Set(written.map((w) => w.table));
    expect(tables).toEqual(
      new Set(["carrier_pre_registrations", "carrier_verifications"]),
    );
    for (const forbidden of [
      "carriers",
      "profiles",
      "carrier_memberships",
      "carrier_onboarding_payments",
      "signature_requests",
      "documents",
    ]) {
      expect(tables.has(forbidden), forbidden).toBe(false);
    }
  });

  it("never sets an activation or payment flag on anything it writes", async () => {
    const { written, updated } = await run({ status: "found", record: record() });
    for (const { row } of [...written, ...updated]) {
      expect(row).not.toHaveProperty("active");
      expect(row).not.toHaveProperty("profile_id");
      expect(row).not.toHaveProperty("claimed_carrier_id");
      expect(row.payment_status).toBeUndefined();
    }
  });

  it("stores the DIGEST of the FMCSA response, never the response", async () => {
    const { written } = await run({ status: "found", record: record() });
    const verification = written.find(
      (w) => w.table === "carrier_verifications",
    )!.row;
    expect(verification.raw_response_sha256).toBe("a".repeat(64));
    // §20/§21: nowhere to put an address, an EIN or a raw body.
    for (const forbidden of ["raw_response", "ein", "address", "phy_street"]) {
      expect(verification).not.toHaveProperty(forbidden);
    }
  });

  it("preserves what the applicant TYPED, unmodified", async () => {
    const { written } = await run({ status: "found", record: record() });
    const pre = written.find(
      (w) => w.table === "carrier_pre_registrations",
    )!.row;
    expect(pre.legal_name_entered).toBe("Acme Trucking LLC");
    expect(pre.usdot_number_entered).toBe("76830");
    expect(pre.mc_number_entered).toBe("123456");
    // NOT overwritten with the provider's "ACME TRUCKING LLC" — the
    // entered-vs-returned comparison is the evidence.
    expect(pre.legal_name_entered).not.toBe("ACME TRUCKING LLC");
  });
});

describe("§13/§14/§15 · what the applicant is handed back", () => {
  it("an eligible applicant gets an id to continue with", async () => {
    const { outcome } = await run({ status: "found", record: record() });
    expect(outcome.decision).toBe("eligible_to_continue");
    expect(outcome.preRegistrationId).toBe("pre-reg-1");
  });

  it("a manual-review applicant is handed NOTHING to continue with", async () => {
    const { outcome } = await run({
      status: "provider_unavailable",
      reason: "TimeoutError",
    });
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.preRegistrationId).toBeNull();
  });

  it("a refused applicant is handed NOTHING to continue with", async () => {
    const { outcome } = await run({ status: "not_found" });
    expect(outcome.decision).toBe("not_eligible");
    expect(outcome.preRegistrationId).toBeNull();
  });

  it("with no service credentials it fails CLOSED to manual review", async () => {
    const outcome = await runCarrierPrecheck(SUBMISSION, {
      provider: stubProvider({ status: "found", record: record() }, {
        status: "found",
        dockets: [{ prefix: "MC", number: "123456" }],
      }),
      creditConfigured: false,
      admin: null,
    });
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.preRegistrationId).toBeNull();
  });
});

describe("§21 · the audit trail", () => {
  it("journals creation, the check and the decision", async () => {
    await run({ status: "found", record: record() });
    expect(auditActions).toEqual([
      "pre_registration_created",
      "fmcsa_check_started",
      "fmcsa_check_completed",
      "pre_registration_eligible",
    ]);
  });

  it("names manual review and refusal as their own events", async () => {
    auditActions.length = 0;
    await run({ status: "provider_unavailable", reason: "http_500" });
    expect(auditActions).toContain("manual_review_required");

    auditActions.length = 0;
    await run({ status: "not_found" });
    expect(auditActions).toContain("pre_registration_not_eligible");
  });
});

/* ── Source-level guarantees ────────────────────────────────────────────── */

describe("the credential and the payload never leave the server", () => {
  /** Comments removed — these files DOCUMENT what they prevent. */
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");

  it("the FMCSA adapter is server-only", () => {
    expect(code("src/lib/carrier-authority/fmcsa-qcmobile.ts")).toContain(
      'import "server-only"',
    );
  });

  it("the orchestrator and the cookie helper are server-only", () => {
    for (const f of [
      "src/lib/carrier-authority/pre-registration.ts",
      "src/lib/carrier-authority/precheck-session.ts",
    ]) {
      expect(code(f), f).toContain('import "server-only"');
    }
  });

  it("no client component reads FMCSA_WEBKEY or the provider", () => {
    for (const f of [
      "src/components/onboarding/CarrierPrecheck.tsx",
      "src/components/onboarding/CarrierWizard.tsx",
    ]) {
      const src = code(f);
      expect(src, f).not.toContain("FMCSA_WEBKEY");
      expect(src, f).not.toContain("mobile.fmcsa.dot.gov");
      expect(src, f).not.toContain("carrier-authority");
    }
  });

  it("the public state shape carries no decision the browser could forge", () => {
    const state = code("src/lib/carrier-precheck-state.ts");
    for (const forbidden of [
      "preRegistrationId",
      "reasonCodes",
      "verified:",
      "eligible:",
      "paid",
    ]) {
      expect(state, forbidden).not.toContain(forbidden);
    }
  });

  it("the pre-check cookie is httpOnly", () => {
    const session = code("src/lib/carrier-authority/precheck-session.ts");
    expect(session).toMatch(/httpOnly:\s*true/);
    expect(session).toMatch(/sameSite:\s*"lax"/);
  });
});
