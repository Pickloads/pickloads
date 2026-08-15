/**
 * M-93 Phase 16 — the carrier activation gate.
 *
 * ── THE FINDING THAT MADE THIS NECESSARY ─────────────────────────────────
 *
 * `carriers.active` is never set to `true` by any code path in this
 * repository. M-92 said it "preserved the activation gate" and that was true
 * narrowly — the agreement send never writes `active` — but the audit for this
 * phase found there is no gate to preserve. Activation today is a manual
 * database edit, so every requirement that says "must not activate unless X"
 * has been vacuously satisfied by nothing ever activating anything.
 *
 * This module is the gate. It is PURE: no database, no network, no clock
 * beyond what it is handed. That is what makes the rule testable and what
 * makes "why is this carrier not eligible?" answerable without reproducing a
 * session.
 *
 * ── ELIGIBLE IS NOT ACTIVE ───────────────────────────────────────────────
 *
 * This function returns eligibility. It does not activate, and nothing may
 * wire its `true` directly to an UPDATE. Phase 16's preference — and the owner
 * decision for initial production — is:
 *
 *     ELIGIBLE_FOR_ACTIVATION → authorized staff approval → ACTIVE
 *
 * A payment is not approval. A signature is not approval. An uploaded document
 * is not approval. Neither is the conjunction of all three.
 */

/** Every condition, named, so a UI can render the checklist verbatim. */
export type ActivationRequirement =
  | "FMCSA_VERIFIED"
  | "PAYMENT_CONFIRMED"
  | "REQUIRED_DOCUMENTS_RECEIVED"
  | "DOCUMENT_REVIEW_PASSED"
  | "INSURANCE_REQUIREMENTS_PASSED"
  | "RISK_REVIEW_PASSED"
  | "DISPATCH_AGREEMENT_COMPLETED"
  | "NO_ACTIVE_COMPLIANCE_HOLD";

export interface ActivationInputs {
  /** Pre-check reached a verified authority (not manual review, not unavailable). */
  fmcsaVerified: boolean;
  /** A `paid` onboarding payment row exists. Never read from the browser. */
  paymentConfirmed: boolean;
  /** Every currently-required document class has an uploaded file. */
  requiredDocumentsReceived: boolean;
  /** Every required document is `approved` — not merely present. */
  documentReviewPassed: boolean;
  /**
   * PickLoads insurance requirements, judged from the COI and
   * `carriers.insurance_expiry`.
   *
   * NOT an FMCSA filing status: QCMobile does not expose one (M-93 §3), and
   * Phase 14 requires the two never be presented as the same thing.
   */
  insuranceRequirementsPassed: boolean;
  /** Risk tier resolved to something other than manual_review, and not high. */
  riskReviewPassed: boolean;
  /** `signature_requests.status = 'completed'` for the dispatch agreement. */
  dispatchAgreementCompleted: boolean;
  /** No open compliance hold (expired insurance, out-of-service, staff hold). */
  activeComplianceHold: boolean;
}

export interface ActivationEvaluation {
  eligible: boolean;
  /** Requirements not yet satisfied, in checklist order. */
  blockedBy: ActivationRequirement[];
  /** Requirements satisfied, for the staff compliance view. */
  satisfied: ActivationRequirement[];
}

/**
 * Evaluate eligibility. Pure.
 *
 * Note there is no `force` parameter and no override flag. A staff override
 * belongs at the approval step, recorded with an actor and a reason, not
 * hidden inside the predicate that decides what the rules are.
 */
export function evaluateActivationEligibility(
  input: ActivationInputs,
): ActivationEvaluation {
  const checks: Array<[ActivationRequirement, boolean]> = [
    ["FMCSA_VERIFIED", input.fmcsaVerified],
    ["PAYMENT_CONFIRMED", input.paymentConfirmed],
    ["REQUIRED_DOCUMENTS_RECEIVED", input.requiredDocumentsReceived],
    ["DOCUMENT_REVIEW_PASSED", input.documentReviewPassed],
    ["INSURANCE_REQUIREMENTS_PASSED", input.insuranceRequirementsPassed],
    ["RISK_REVIEW_PASSED", input.riskReviewPassed],
    ["DISPATCH_AGREEMENT_COMPLETED", input.dispatchAgreementCompleted],
    // Inverted: the input is the presence of a hold, the requirement is its
    // absence. Kept explicit rather than folded into the caller, because a
    // caller that forgets to negate it would activate held carriers.
    ["NO_ACTIVE_COMPLIANCE_HOLD", !input.activeComplianceHold],
  ];

  const blockedBy = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const satisfied = checks.filter(([, ok]) => ok).map(([name]) => name);

  return { eligible: blockedBy.length === 0, blockedBy, satisfied };
}

/**
 * Human-readable labels for the staff compliance view (Phase 18).
 * English source; the portal wraps them through the V4 bridge.
 */
export const ACTIVATION_REQUIREMENT_LABEL: Readonly<
  Record<ActivationRequirement, string>
> = {
  FMCSA_VERIFIED: "FMCSA identity & authority",
  PAYMENT_CONFIRMED: "Onboarding fee",
  REQUIRED_DOCUMENTS_RECEIVED: "Required documents received",
  DOCUMENT_REVIEW_PASSED: "Document review",
  INSURANCE_REQUIREMENTS_PASSED: "PickLoads insurance requirements",
  RISK_REVIEW_PASSED: "Risk review",
  DISPATCH_AGREEMENT_COMPLETED: "Dispatch agreement",
  NO_ACTIVE_COMPLIANCE_HOLD: "No active compliance hold",
};
