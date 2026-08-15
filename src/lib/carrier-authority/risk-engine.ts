import type { IdentityComparison } from "./identity-match";
import type {
  AuthorityLookupResult,
  NormalizedAuthorityRecord,
} from "./provider";

/**
 * M-93 Phase 4 — the PickLoads risk engine.
 *
 * Deterministic and explainable. There is no score, no model and no weighting:
 * the same inputs always produce the same decision and the same reason codes,
 * and every reason code corresponds to a rule you can read below.
 *
 * Phase 4 says "Do NOT create a fake AI credit score", and the reason that
 * matters here is not aesthetic — a carrier refused by a number nobody can
 * explain is a carrier we cannot answer on the phone.
 *
 * ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────
 *
 * It never returns NOT_ELIGIBLE because a provider was unreachable. Phase 20:
 * our outage is not their fault. Provider failure routes to MANUAL_REVIEW,
 * where a human can look the carrier up by hand.
 */

export type RiskTier = "low" | "medium" | "high" | "manual_review";

export type PrequalDecision =
  "eligible_to_continue" | "manual_review" | "not_eligible";

/**
 * Machine-readable reason codes.
 *
 * Stored, logged, and shown to STAFF. Never shown in full to the applicant —
 * Phase 6 forbids displaying the fraud rules, because a rejected applicant
 * who learns exactly which check failed learns exactly what to change.
 */
export type ReasonCode =
  | "AUTHORITY_ACTIVE"
  | "AUTHORITY_NOT_AUTHORIZED"
  | "AUTHORITY_UNKNOWN"
  | "OUT_OF_SERVICE"
  | "USDOT_NOT_FOUND"
  | "LEGAL_NAME_MATCH"
  | "LEGAL_NAME_MISMATCH"
  | "LEGAL_NAME_UNVERIFIED"
  | "DOT_MATCH"
  | "DOT_MISMATCH"
  | "MC_MATCH"
  | "MC_MISMATCH"
  | "MC_NOT_PROVIDED"
  | "INSURANCE_REVIEW_REQUIRED"
  | "CREDIT_CHECK_NOT_CONFIGURED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_NOT_CONFIGURED";

export interface RiskAssessment {
  decision: PrequalDecision;
  tier: RiskTier;
  reasonCodes: ReasonCode[];
  manualReviewRequired: boolean;
}

/**
 * Reason codes an applicant may be shown.
 *
 * Everything else is staff-only. The customer-facing result is one of three
 * sentences (Phase 6); this set exists so a support agent can say something
 * concrete without reciting the rule book.
 */
export const APPLICANT_SAFE_REASON_CODES: ReadonlySet<ReasonCode> = new Set([
  "USDOT_NOT_FOUND",
  "MC_NOT_PROVIDED",
  "PROVIDER_UNAVAILABLE",
]);

export function assessCarrierRisk(input: {
  lookup: AuthorityLookupResult;
  identity: IdentityComparison | null;
  /** Result of the credit provider. Not configured today (Phase 5). */
  creditConfigured: boolean;
}): RiskAssessment {
  const codes: ReasonCode[] = [];

  /* ── Provider-level outcomes ─────────────────────────────────────────── */

  if (input.lookup.status === "not_configured") {
    // No credential. We have verified nothing, and saying otherwise would be
    // the single worst thing this module could do.
    codes.push("PROVIDER_NOT_CONFIGURED");
    return {
      decision: "manual_review",
      tier: "manual_review",
      reasonCodes: codes,
      manualReviewRequired: true,
    };
  }

  if (input.lookup.status === "provider_unavailable") {
    codes.push("PROVIDER_UNAVAILABLE");
    return {
      decision: "manual_review",
      tier: "manual_review",
      reasonCodes: codes,
      manualReviewRequired: true,
    };
  }

  if (input.lookup.status === "not_found") {
    // The authority has no such registration. This IS a verdict: a USDOT that
    // does not exist cannot be a clerical error on our side.
    codes.push("USDOT_NOT_FOUND");
    return {
      decision: "not_eligible",
      tier: "high",
      reasonCodes: codes,
      manualReviewRequired: false,
    };
  }

  const record: NormalizedAuthorityRecord = input.lookup.record;
  const identity = input.identity;

  /* ── Hard stops ──────────────────────────────────────────────────────── */

  let hardStop = false;

  if (record.outOfService === true) {
    codes.push("OUT_OF_SERVICE");
    hardStop = true;
  }

  if (record.allowedToOperate === false) {
    codes.push("AUTHORITY_NOT_AUTHORIZED");
    hardStop = true;
  } else if (record.allowedToOperate === true) {
    codes.push("AUTHORITY_ACTIVE");
  } else {
    // null = the authority did not tell us. Not the same as "no".
    codes.push("AUTHORITY_UNKNOWN");
  }

  if (hardStop) {
    return {
      decision: "not_eligible",
      tier: "high",
      reasonCodes: codes,
      manualReviewRequired: false,
    };
  }

  /* ── Identity ────────────────────────────────────────────────────────── */

  let needsReview = record.allowedToOperate === null;

  if (identity) {
    switch (identity.nameMatch) {
      case "exact":
      case "normalized":
        codes.push("LEGAL_NAME_MATCH");
        break;
      case "mismatch":
        codes.push("LEGAL_NAME_MISMATCH");
        needsReview = true;
        break;
      case "unavailable":
        codes.push("LEGAL_NAME_UNVERIFIED");
        needsReview = true;
        break;
    }

    if (identity.dotMatch === "mismatch") {
      // The record we fetched is not the one they claimed. Never automatic.
      codes.push("DOT_MISMATCH");
      needsReview = true;
    } else if (identity.dotMatch !== "unavailable") {
      codes.push("DOT_MATCH");
    }

    switch (identity.mcMatch) {
      case "mismatch":
        codes.push("MC_MISMATCH");
        needsReview = true;
        break;
      case "unavailable":
        // No MC entered, or none on file. Common and legitimate; it means the
        // MC could not be cross-checked, so a human confirms the authority
        // type rather than us assuming interstate for-hire.
        codes.push("MC_NOT_PROVIDED");
        needsReview = true;
        break;
      default:
        codes.push("MC_MATCH");
    }
  } else {
    codes.push("LEGAL_NAME_UNVERIFIED");
    needsReview = true;
  }

  /* ── Always-on requirements ──────────────────────────────────────────── */

  // FMCSA QCMobile does not expose insurance or filing status (M-93 §3), so
  // insurance is ALWAYS a document review against the COI. This code is not a
  // finding against the carrier — it is a statement that a human must look.
  codes.push("INSURANCE_REVIEW_REQUIRED");

  if (!input.creditConfigured) {
    // Phase 5: absence of a credit provider is never bad credit.
    codes.push("CREDIT_CHECK_NOT_CONFIGURED");
  }

  if (needsReview) {
    return {
      decision: "manual_review",
      tier: "manual_review",
      reasonCodes: codes,
      manualReviewRequired: true,
    };
  }

  // Clean: authority active, identity agrees on every field we could compare.
  // "eligible_to_continue" means eligible to PAY and upload documents — it is
  // not approval, and nothing downstream may read it as approval.
  return {
    decision: "eligible_to_continue",
    tier: "low",
    reasonCodes: codes,
    manualReviewRequired: false,
  };
}

/** The three sentences an applicant may see (Phase 6). */
export type ApplicantFacingResult =
  "verified_to_continue" | "additional_review_required" | "unable_to_verify";

export function applicantFacingResult(
  decision: PrequalDecision,
): ApplicantFacingResult {
  switch (decision) {
    case "eligible_to_continue":
      return "verified_to_continue";
    case "manual_review":
      return "additional_review_required";
    case "not_eligible":
      return "unable_to_verify";
  }
}
