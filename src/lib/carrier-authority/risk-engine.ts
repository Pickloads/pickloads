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
  | "MC_DOT_RELATIONSHIP_CONFIRMED"
  | "MC_DOT_RELATIONSHIP_MISMATCH"
  | "MC_DOT_RELATIONSHIP_UNVERIFIED"
  | "CARRIER_AUTHORITY_ACTIVE"
  | "CARRIER_AUTHORITY_INACTIVE"
  | "CARRIER_AUTHORITY_UNKNOWN"
  | "BROKER_AUTHORITY_ONLY"
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

  /* ── Operating authority, by TYPE ─────────────────────────────────────── */
  //
  // Broker authority is not carrier authority. A broker-only entity holds
  // `brokerAuthority: "active"` with no common or contract grant, and reading
  // that as permission to haul would onboard a company that cannot legally
  // carry a load. The grants are therefore evaluated separately and only the
  // carrier-side ones can satisfy the check.

  const carrierAuthorityActive =
    record.commonAuthority === "active" ||
    record.contractAuthority === "active";
  const carrierAuthorityKnown =
    record.commonAuthority !== null || record.contractAuthority !== null;

  let needsReview = record.allowedToOperate === null;

  if (carrierAuthorityActive) {
    codes.push("CARRIER_AUTHORITY_ACTIVE");
  } else if (carrierAuthorityKnown) {
    // FMCSA told us about the carrier grants and none is active.
    codes.push("CARRIER_AUTHORITY_INACTIVE");
    needsReview = true;
    if (record.brokerAuthority === "active") {
      // Worth its own code: this applicant is a broker asking to be onboarded
      // as a carrier, which is a different conversation, not a data problem.
      codes.push("BROKER_AUTHORITY_ONLY");
    }
  } else {
    // The authority fields were absent. Not a finding — an unknown.
    codes.push("CARRIER_AUTHORITY_UNKNOWN");
    needsReview = true;
  }

  /* ── Identity ────────────────────────────────────────────────────────── */

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
        // No MC entered, or none on the carrier record. Common and legitimate;
        // it means the MC could not be cross-checked against that field.
        codes.push("MC_NOT_PROVIDED");
        needsReview = true;
        break;
      default:
        codes.push("MC_MATCH");
    }

    // ── THE MC↔USDOT RELATIONSHIP ──────────────────────────────────────────
    //
    // "A valid USDOT with the wrong MC must NOT pass." This is the check that
    // enforces it: the submitted MC is compared against the docket SET FMCSA
    // associates with the submitted USDOT, not against a single field.
    switch (identity.docketMatch) {
      case "exact":
      case "normalized":
        codes.push("MC_DOT_RELATIONSHIP_CONFIRMED");
        break;
      case "mismatch":
        // Either FMCSA holds dockets for this USDOT and the submitted MC is
        // not among them, or it holds none at all. Either way the applicant
        // claimed a docket this registration does not have. Never automatic.
        codes.push("MC_DOT_RELATIONSHIP_MISMATCH");
        needsReview = true;
        break;
      case "unavailable":
        // No MC submitted, or the docket endpoint was never reached. We do not
        // know the relationship, so we do not assert one.
        codes.push("MC_DOT_RELATIONSHIP_UNVERIFIED");
        needsReview = true;
        break;
    }
  } else {
    codes.push("LEGAL_NAME_UNVERIFIED");
    needsReview = true;
  }

  /* ── Always-on requirements ──────────────────────────────────────────── */

  // ── INSURANCE IS ALWAYS A DOCUMENT REVIEW ──────────────────────────────
  //
  // FMCSA DOES return filing indicators (bipd/cargo/bond on-file and
  // required) — an earlier note in this file wrongly said it did not. They are
  // normalized and shown to staff, and they are deliberately NOT read here.
  //
  // A federal filing says a policy was filed with the government. It does not
  // say the policy is current, that it meets PickLoads' limits, or that the
  // certificate we hold matches it. Letting `bipdOnFile` satisfy this code
  // would turn "on file with FMCSA" into "approved by PickLoads", which is the
  // exact conflation Phase 14 forbids.
  //
  // This code is not a finding against the carrier. It states that a human
  // must look at the COI.
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
