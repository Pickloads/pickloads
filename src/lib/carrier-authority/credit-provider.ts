/**
 * M-93 Phase 5 — commercial credit provider abstraction.
 *
 * ── NOT IMPLEMENTED, AND THAT IS THE DELIVERABLE ─────────────────────────
 *
 * No provider is selected and no credentials exist, so this returns
 * `not_configured` and nothing else. Phase 5 is explicit: "Do not fabricate
 * scores." A stub that invented a number would be worse than no check at all,
 * because a fabricated score would flow into the risk engine and start
 * refusing real carriers on the strength of a random number.
 *
 * ── WHAT THIS MUST NEVER BECOME ──────────────────────────────────────────
 *
 * Consumer or personal credit. PickLoads is assessing a BUSINESS. Pulling a
 * personal credit file — even the owner-operator's, even with consent — makes
 * this an FCRA-regulated activity with adverse-action notice obligations,
 * permissible-purpose requirements and dispute handling that none of this
 * system implements. The interface below has no place to put an SSN or a date
 * of birth, deliberately.
 *
 * ── BEFORE INTEGRATING A PROVIDER ────────────────────────────────────────
 *
 * Phase 5 requires documenting, in docs/modules/M-93-*.md: provider, API
 * availability, pricing, permitted purpose, contractual restrictions, data
 * retention restrictions, and what the score actually means. A number whose
 * meaning is undocumented cannot be used in a decision that refuses someone.
 */

export type CreditCheckStatus =
  "not_configured" | "provider_unavailable" | "completed";

export interface CreditAssessment {
  status: CreditCheckStatus;
  /** Provider identifier once one exists. Null while unconfigured. */
  provider: string | null;
  /**
   * Provider-native score. Meaningless without the provider's own scale, so it
   * is never rendered bare and never compared across providers.
   */
  score: number | null;
  checkedAt: string | null;
}

export interface CarrierCreditProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Business identity only — never a person. */
  assess(input: {
    legalName: string;
    usdotNumber: string;
    mcNumber: string | null;
  }): Promise<CreditAssessment>;
}

/**
 * The active provider today: none.
 *
 * `isConfigured()` returns false, so the risk engine records
 * CREDIT_CHECK_NOT_CONFIGURED and treats the absence as unknown — never as
 * bad credit (Phase 20).
 */
export const unconfiguredCreditProvider: CarrierCreditProvider = {
  name: "none",
  isConfigured: () => false,
  async assess(): Promise<CreditAssessment> {
    return {
      status: "not_configured",
      provider: null,
      score: null,
      checkedAt: null,
    };
  },
};
