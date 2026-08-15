import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeRegistrationNumber,
  toIsoDate,
  yesNoToBoolean,
  type AuthorityLookupResult,
  type NormalizedAuthorityRecord,
} from "@/lib/carrier-authority/provider";
import {
  compareIdentity,
  matchBusinessName,
  matchRegistrationNumber,
  normalizeBusinessName,
} from "@/lib/carrier-authority/identity-match";
import {
  APPLICANT_SAFE_REASON_CODES,
  applicantFacingResult,
  assessCarrierRisk,
} from "@/lib/carrier-authority/risk-engine";
import { evaluateActivationEligibility } from "@/lib/carrier-authority/activation-gate";
import { unconfiguredCreditProvider } from "@/lib/carrier-authority/credit-provider";

/**
 * M-93 Phase 28 — adversarial tests for the pre-qualification foundation.
 *
 * The rule every case here defends: a provider failure is never a verdict, and
 * a near-match is never an approval.
 */

/** Source with comments removed — these files DOCUMENT the mistakes they
 *  prevent, so a scanner that reads prose flags the fix as the defect. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/^[ \t]*--.*$/gm, " ");
}

const RECORD: NormalizedAuthorityRecord = {
  providerRecordId: "76830",
  legalName: "ACME TRUCKING LLC",
  dbaName: null,
  usdotNumber: "76830",
  mcNumber: "123456",
  allowedToOperate: true,
  outOfService: false,
  outOfServiceDate: null,
  sourceRetrievedAt: "2026-08-15T06:00:03.368+0000",
  rawResponseSha256: "a".repeat(64),
};

const found = (over: Partial<typeof RECORD> = {}): AuthorityLookupResult => ({
  status: "found",
  record: { ...RECORD, ...over },
});

const IDENTITY = {
  legalName: "Acme Trucking, L.L.C.",
  usdotNumber: "76830",
  mcNumber: "MC-123456",
};

describe("M-93 · normalisation", () => {
  it("treats MC-123456, mc 123456 and 0123456 as one number", () => {
    expect(normalizeRegistrationNumber("MC-123456")).toBe("123456");
    expect(normalizeRegistrationNumber("mc 123456")).toBe("123456");
    expect(normalizeRegistrationNumber("0123456")).toBe("123456");
    // Leading zeros matter: FMCSA returns the integer form, so a raw string
    // compare would report a mismatch on two identical registrations.
    expect(normalizeRegistrationNumber("00076830")).toBe("76830");
  });

  it("returns null for a malformed USDOT rather than an empty string", () => {
    expect(normalizeRegistrationNumber("abc")).toBeNull();
    expect(normalizeRegistrationNumber("")).toBeNull();
    expect(normalizeRegistrationNumber(null)).toBeNull();
    // "0" normalises away entirely — it is not a registration number.
    expect(normalizeRegistrationNumber("0")).toBeNull();
  });

  it("maps FMCSA Y/N, and maps anything else to null", () => {
    expect(yesNoToBoolean("Y")).toBe(true);
    expect(yesNoToBoolean("n")).toBe(false);
    // null means "the authority did not tell us" — never "no".
    expect(yesNoToBoolean("")).toBeNull();
    expect(yesNoToBoolean(undefined)).toBeNull();
    expect(yesNoToBoolean("MAYBE")).toBeNull();
  });

  it("converts FMCSA MM/DD/YYYY to ISO and rejects junk", () => {
    expect(toIsoDate("03/07/2024")).toBe("2024-03-07");
    expect(toIsoDate("3/7/2024")).toBe("2024-03-07");
    expect(toIsoDate("2024-03-07")).toBe("2024-03-07");
    expect(toIsoDate("not a date")).toBeNull();
    expect(toIsoDate(12345)).toBeNull();
  });
});

describe("M-93 · identity matching", () => {
  it("normalises entity suffixes and punctuation", () => {
    expect(normalizeBusinessName("Acme Trucking, L.L.C.")).toBe(
      "acme trucking",
    );
    expect(normalizeBusinessName("ACME TRUCKING LLC")).toBe("acme trucking");
    expect(normalizeBusinessName("Acme Trucking Inc.")).toBe("acme trucking");
    expect(
      matchBusinessName("Acme Trucking, L.L.C.", "ACME TRUCKING LLC"),
    ).toBe("normalized");
    expect(matchBusinessName("Acme Trucking", "Acme Trucking")).toBe("exact");
  });

  it("REFUSES to equate materially different businesses", () => {
    // The whole point. Fuzzy matching here would let an applicant inherit
    // another company's operating authority.
    expect(matchBusinessName("Acme Trucking LLC", "Acme Transport LLC")).toBe(
      "mismatch",
    );
    expect(matchBusinessName("Acme Trucking", "Acme Trucking of Texas")).toBe(
      "mismatch",
    );
    expect(matchBusinessName("Smith Hauling", "Smith Haulage")).toBe(
      "mismatch",
    );
  });

  it("never reduces a name to nothing", () => {
    // A carrier legitimately named "LLC" must not normalise to "".
    expect(normalizeBusinessName("LLC")).toBe("llc");
    expect(matchBusinessName("LLC", "Acme")).toBe("mismatch");
  });

  it("distinguishes 'not told' from 'disagrees'", () => {
    expect(matchRegistrationNumber(null, "123456")).toBe("unavailable");
    expect(matchRegistrationNumber("123456", null)).toBe("unavailable");
    expect(matchRegistrationNumber("123457", "123456")).toBe("mismatch");
  });

  it("a transposed digit is a mismatch, not a near-miss", () => {
    expect(matchRegistrationNumber("MC-123465", "123456")).toBe("mismatch");
  });
});

describe("M-93 · risk engine — provider failure is never a verdict", () => {
  it("FMCSA unavailable → MANUAL_REVIEW, never NOT_ELIGIBLE", () => {
    const r = assessCarrierRisk({
      lookup: { status: "provider_unavailable", reason: "TimeoutError" },
      identity: null,
      creditConfigured: false,
    });
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("PROVIDER_UNAVAILABLE");
    expect(r.decision).not.toBe("not_eligible");
  });

  it("no webKey → MANUAL_REVIEW and never 'verified'", () => {
    const r = assessCarrierRisk({
      lookup: { status: "not_configured" },
      identity: null,
      creditConfigured: false,
    });
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("PROVIDER_NOT_CONFIGURED");
    expect(r.reasonCodes).not.toContain("AUTHORITY_ACTIVE");
  });

  it("credit provider unconfigured is NOT bad credit", () => {
    const r = assessCarrierRisk({
      lookup: found(),
      identity: compareIdentity(IDENTITY, RECORD),
      creditConfigured: false,
    });
    expect(r.reasonCodes).toContain("CREDIT_CHECK_NOT_CONFIGURED");
    expect(r.decision).toBe("eligible_to_continue");
  });

  it("the credit stub fabricates nothing", async () => {
    const a = await unconfiguredCreditProvider.assess({
      legalName: "Acme",
      usdotNumber: "76830",
      mcNumber: null,
    });
    expect(a.status).toBe("not_configured");
    expect(a.score).toBeNull();
    expect(unconfiguredCreditProvider.isConfigured()).toBe(false);
  });
});

describe("M-93 · risk engine — verdicts", () => {
  it("a clean carrier is eligible to continue", () => {
    const r = assessCarrierRisk({
      lookup: found(),
      identity: compareIdentity(IDENTITY, RECORD),
      creditConfigured: false,
    });
    expect(r.decision).toBe("eligible_to_continue");
    expect(r.tier).toBe("low");
    expect(r.manualReviewRequired).toBe(false);
    expect(r.reasonCodes).toContain("AUTHORITY_ACTIVE");
    expect(r.reasonCodes).toContain("LEGAL_NAME_MATCH");
    // Insurance is ALWAYS a document review — FMCSA does not expose filings.
    expect(r.reasonCodes).toContain("INSURANCE_REVIEW_REQUIRED");
  });

  it("out of service is a hard stop", () => {
    const r = assessCarrierRisk({
      lookup: found({ outOfService: true }),
      identity: compareIdentity(IDENTITY, RECORD),
      creditConfigured: false,
    });
    expect(r.decision).toBe("not_eligible");
    expect(r.reasonCodes).toContain("OUT_OF_SERVICE");
  });

  it("not authorized to operate is a hard stop", () => {
    const r = assessCarrierRisk({
      lookup: found({ allowedToOperate: false }),
      identity: compareIdentity(IDENTITY, RECORD),
      creditConfigured: false,
    });
    expect(r.decision).toBe("not_eligible");
    expect(r.reasonCodes).toContain("AUTHORITY_NOT_AUTHORIZED");
  });

  it("a fake USDOT is not eligible", () => {
    const r = assessCarrierRisk({
      lookup: { status: "not_found" },
      identity: null,
      creditConfigured: false,
    });
    expect(r.decision).toBe("not_eligible");
    expect(r.reasonCodes).toContain("USDOT_NOT_FOUND");
  });

  it("a legal-name mismatch NEVER auto-approves", () => {
    const r = assessCarrierRisk({
      lookup: found(),
      identity: compareIdentity(
        { ...IDENTITY, legalName: "Totally Different Freight LLC" },
        RECORD,
      ),
      creditConfigured: false,
    });
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("LEGAL_NAME_MISMATCH");
  });

  it("an MC/USDOT mismatch NEVER auto-approves", () => {
    const r = assessCarrierRisk({
      lookup: found(),
      identity: compareIdentity({ ...IDENTITY, mcNumber: "MC-999999" }, RECORD),
      creditConfigured: false,
    });
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("MC_MISMATCH");
  });

  it("unknown authority status routes to review, not approval", () => {
    const r = assessCarrierRisk({
      lookup: found({ allowedToOperate: null }),
      identity: compareIdentity(IDENTITY, RECORD),
      creditConfigured: false,
    });
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("AUTHORITY_UNKNOWN");
  });

  it("is deterministic — same input, same output", () => {
    const args = {
      lookup: found(),
      identity: compareIdentity(IDENTITY, RECORD),
      creditConfigured: false,
    };
    expect(assessCarrierRisk(args)).toEqual(assessCarrierRisk(args));
  });

  it("does not leak the rule set to the applicant", () => {
    // Only three sentences reach a customer, and most reason codes are
    // staff-only — a rejected applicant who learns which check failed learns
    // what to change.
    expect(applicantFacingResult("eligible_to_continue")).toBe(
      "verified_to_continue",
    );
    expect(applicantFacingResult("manual_review")).toBe(
      "additional_review_required",
    );
    expect(applicantFacingResult("not_eligible")).toBe("unable_to_verify");
    expect(APPLICANT_SAFE_REASON_CODES.has("LEGAL_NAME_MISMATCH")).toBe(false);
    expect(APPLICANT_SAFE_REASON_CODES.has("OUT_OF_SERVICE")).toBe(false);
  });
});

describe("M-93 · activation gate", () => {
  const ALL_TRUE = {
    fmcsaVerified: true,
    paymentConfirmed: true,
    requiredDocumentsReceived: true,
    documentReviewPassed: true,
    insuranceRequirementsPassed: true,
    riskReviewPassed: true,
    dispatchAgreementCompleted: true,
    activeComplianceHold: false,
  };

  it("every condition satisfied → eligible", () => {
    const r = evaluateActivationEligibility(ALL_TRUE);
    expect(r.eligible).toBe(true);
    expect(r.blockedBy).toEqual([]);
    expect(r.satisfied).toHaveLength(8);
  });

  it("payment alone is NOT approval", () => {
    const r = evaluateActivationEligibility({
      ...ALL_TRUE,
      documentReviewPassed: false,
      dispatchAgreementCompleted: false,
    });
    expect(r.eligible).toBe(false);
    expect(r.blockedBy).toContain("DOCUMENT_REVIEW_PASSED");
    expect(r.blockedBy).toContain("DISPATCH_AGREEMENT_COMPLETED");
  });

  it("a completed agreement without approved documents is NOT eligible", () => {
    const r = evaluateActivationEligibility({
      ...ALL_TRUE,
      documentReviewPassed: false,
    });
    expect(r.eligible).toBe(false);
  });

  it("documents received is not the same as documents approved", () => {
    const r = evaluateActivationEligibility({
      ...ALL_TRUE,
      documentReviewPassed: false,
    });
    expect(r.satisfied).toContain("REQUIRED_DOCUMENTS_RECEIVED");
    expect(r.blockedBy).toContain("DOCUMENT_REVIEW_PASSED");
  });

  it("an active compliance hold blocks even when all else passes", () => {
    const r = evaluateActivationEligibility({
      ...ALL_TRUE,
      activeComplianceHold: true,
    });
    expect(r.eligible).toBe(false);
    expect(r.blockedBy).toEqual(["NO_ACTIVE_COMPLIANCE_HOLD"]);
  });

  it("every single requirement can block on its own", () => {
    const keys = [
      "fmcsaVerified",
      "paymentConfirmed",
      "requiredDocumentsReceived",
      "documentReviewPassed",
      "insuranceRequirementsPassed",
      "riskReviewPassed",
      "dispatchAgreementCompleted",
    ] as const;
    for (const k of keys) {
      expect(
        evaluateActivationEligibility({ ...ALL_TRUE, [k]: false }).eligible,
        `${k} must be able to block activation`,
      ).toBe(false);
    }
  });

  it("has no override parameter", () => {
    // A staff override belongs at the approval step with an actor and a
    // reason, not hidden inside the predicate that defines the rules.
    expect(evaluateActivationEligibility.length).toBe(1);
    const src = readFileSync(
      "src/lib/carrier-authority/activation-gate.ts",
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(src).not.toMatch(/\bforce\b/);
    expect(src).not.toMatch(/\boverride\b/);
  });
});

describe("M-93 · data minimisation & secrets", () => {
  const ADAPTER = "src/lib/carrier-authority/fmcsa-qcmobile.ts";

  it("stores a digest of the provider response, never the payload", () => {
    const src = readFileSync(ADAPTER, "utf8");
    expect(src).toContain("rawResponseSha256");
    expect(src).toContain('createHash("sha256")');
    const migration = readFileSync(
      "supabase/migrations/0032_carrier_prequalification.sql",
      "utf8",
    );
    expect(migration).toContain("raw_response_sha256");
    expect(migration).not.toMatch(/raw_response\s+jsonb/);
  });

  it("never logs the webKey", () => {
    const src = code(ADAPTER);
    // Logging the variable NAME when the credential is rejected is deliberate
    // and useful — it is how an operator learns the key expired. What must
    // never appear is the VALUE, or the URL that carries it as a query
    // parameter.
    expect(src).not.toMatch(/console\.[a-z]+\([^)]*\$\{webKey\}/);
    expect(src).not.toMatch(/console\.[a-z]+\([^)]*process\.env/);
    expect(src).not.toMatch(/console\.[a-z]+\([^)]*\burl\b/);
  });

  it("the adapter is server-only", () => {
    expect(
      readFileSync(ADAPTER, "utf8").startsWith('import "server-only";'),
    ).toBe(true);
  });

  it("bounds the upstream call so their outage is not ours", () => {
    const src = readFileSync(ADAPTER, "utf8");
    expect(src).toContain("AbortSignal.timeout(TIMEOUT_MS)");
  });

  it("models no FMCSA insurance field", () => {
    // QCMobile does not expose filings. A nullable column would invite the
    // exact conflation Phase 14 forbids.
    expect(
      code("supabase/migrations/0032_carrier_prequalification.sql"),
    ).not.toMatch(/fmcsa_insurance/);
    expect(code("src/lib/carrier-authority/provider.ts")).not.toMatch(
      /insurance/i,
    );
  });
});

describe("M-93 · RLS posture of the new tables", () => {
  const migration = readFileSync(
    "supabase/migrations/0032_carrier_prequalification.sql",
    "utf8",
  );

  it("enables RLS on all three new tables", () => {
    for (const t of [
      "carrier_pre_registrations",
      "carrier_verifications",
      "carrier_onboarding_payments",
    ]) {
      expect(migration, `${t} must have RLS enabled`).toMatch(
        new RegExp(`alter table ${t}\\s+enable row level security`),
      );
    }
  });

  it("grants no policy to anon or authenticated", () => {
    // Staff-only by construction: with RLS on and no matching policy, Postgres
    // denies. No client can write a verification decision, a payment
    // confirmation or a risk tier.
    expect(migration).not.toMatch(/to anon/);
    expect(migration).not.toMatch(/for all using \(true\)/);
    const policies = migration.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(3);
    for (const p of policies) expect(p).toContain("is_staff()");
  });

  it("protects against duplicate payment at the database", () => {
    expect(migration).toContain(
      "create unique index onboarding_payments_one_paid_per_pre_registration",
    );
    expect(migration).toMatch(/where status = 'paid'/);
  });

  it("prevents one carrier being claimed by two pre-registrations", () => {
    expect(migration).toContain(
      "create unique index pre_registrations_one_claim_per_carrier",
    );
  });

  it("expires pre-registrations", () => {
    expect(migration).toMatch(/expires_at timestamptz not null/);
  });
});
