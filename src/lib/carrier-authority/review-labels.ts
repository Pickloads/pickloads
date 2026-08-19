/**
 * M-94 — staff-facing labels for the carrier review queue.
 *
 * Plain module (no `server-only`): the queue page renders these on the server
 * and the review form is a client component, so both sides import them.
 *
 * ── WHY THESE STRINGS ARE STAFF-ONLY ─────────────────────────────────────
 *
 * M-93 §6: an applicant who learns exactly which check they failed learns
 * exactly what to change. The three sentences an APPLICANT sees are in
 * `CarrierPrecheck.tsx`; these are the operational explanations, and they only
 * ever render behind `requireStaff`. The distinction is enforced by where the
 * component tree puts them, and asserted by
 * `tests/unit/carrier-review-queue.test.ts`.
 *
 * ── AND WHY THEY ARE PLAIN ENGLISH, NOT `tv()` ───────────────────────────
 *
 * Same reason every other `/portal/admin` surface is: the dispatch desk is an
 * internal tool with an English-speaking staff, and the V4 dictionary is the
 * public site's. Putting compliance vocabulary through a translation ratchet
 * nobody reads in five languages would cost the translators real work for no
 * reader.
 */

import type { ReasonCode } from "./risk-engine";

/** What each reason code MEANS, for somebody deciding what to do about it. */
export const REASON_CODE_LABEL: Readonly<Record<string, string>> = {
  AUTHORITY_ACTIVE: "FMCSA says allowed to operate",
  AUTHORITY_NOT_AUTHORIZED: "FMCSA says NOT allowed to operate",
  AUTHORITY_UNKNOWN: "FMCSA did not report an operating status",
  OUT_OF_SERVICE: "Carrier is out of service",
  USDOT_NOT_FOUND: "FMCSA has no record of this USDOT",
  LEGAL_NAME_MATCH: "Legal name matches the FMCSA record",
  LEGAL_NAME_MISMATCH: "Legal name differs materially from FMCSA",
  LEGAL_NAME_UNVERIFIED: "Legal name could not be compared",
  DOT_MATCH: "USDOT matches the record we fetched",
  DOT_MISMATCH: "USDOT does not match the record we fetched",
  MC_MATCH: "MC matches the carrier record's MC field",
  MC_MISMATCH: "MC differs from the carrier record's MC field",
  MC_NOT_PROVIDED: "No MC to compare (none submitted, or none on record)",
  MC_DOT_RELATIONSHIP_CONFIRMED: "Submitted MC is a real MC docket for this USDOT",
  MC_DOT_RELATIONSHIP_MISMATCH: "Submitted MC is NOT an MC docket for this USDOT",
  MC_DOT_RELATIONSHIP_UNVERIFIED: "MC↔USDOT relationship could not be checked",
  CARRIER_AUTHORITY_ACTIVE: "Common or contract authority is active",
  CARRIER_AUTHORITY_INACTIVE: "No active common or contract authority",
  CARRIER_AUTHORITY_UNKNOWN: "FMCSA did not report the authority grants",
  BROKER_AUTHORITY_ONLY: "Broker authority only — cannot legally haul",
  INSURANCE_REVIEW_REQUIRED: "COI still requires PickLoads review (always)",
  CREDIT_CHECK_NOT_CONFIGURED: "No credit provider configured (not a finding)",
  PROVIDER_UNAVAILABLE: "FMCSA was unreachable — our outage, not theirs",
  PROVIDER_NOT_CONFIGURED: "FMCSA credential not configured in this environment",
  STAFF_REVIEW_CLEARED: "Cleared by staff review",
  STAFF_REVIEW_REFUSED: "Refused by staff review",
};

export function reasonCodeLabel(code: string): string {
  return REASON_CODE_LABEL[code] ?? code;
}

/**
 * Codes that describe a FINDING rather than a normal observation.
 *
 * Used only to order the list so the reason a file came to a human is at the
 * top. It changes no decision — the risk engine already made that, and a
 * second, differently-shaped judgement rendered in a template is how two
 * definitions of "serious" start to disagree.
 */
const NOTABLE = new Set<string>([
  "AUTHORITY_NOT_AUTHORIZED",
  "OUT_OF_SERVICE",
  "USDOT_NOT_FOUND",
  "LEGAL_NAME_MISMATCH",
  "DOT_MISMATCH",
  "MC_MISMATCH",
  "MC_DOT_RELATIONSHIP_MISMATCH",
  "CARRIER_AUTHORITY_INACTIVE",
  "BROKER_AUTHORITY_ONLY",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_NOT_CONFIGURED",
  "LEGAL_NAME_UNVERIFIED",
  "MC_DOT_RELATIONSHIP_UNVERIFIED",
  "MC_NOT_PROVIDED",
  "AUTHORITY_UNKNOWN",
  "CARRIER_AUTHORITY_UNKNOWN",
]);

export function isNotableReason(code: string): boolean {
  return NOTABLE.has(code);
}

export function sortReasonCodes(codes: readonly string[]): string[] {
  return [...codes].sort((a, b) => {
    const an = isNotableReason(a) ? 0 : 1;
    const bn = isNotableReason(b) ? 0 : 1;
    return an === bn ? a.localeCompare(b) : an - bn;
  });
}

export const DECISION_BADGE: Readonly<
  Record<string, { label: string; badge: string }>
> = {
  eligible_to_continue: { label: "Cleared to continue", badge: "green" },
  manual_review: { label: "Needs review", badge: "amber" },
  not_eligible: { label: "Not eligible", badge: "red" },
};

export const VERIFICATION_BADGE: Readonly<
  Record<string, { label: string; badge: string }>
> = {
  pending: { label: "Pending", badge: "" },
  verified: { label: "FMCSA verified", badge: "green" },
  manual_review: { label: "FMCSA inconclusive", badge: "amber" },
  not_verified: { label: "FMCSA not verified", badge: "red" },
  provider_unavailable: { label: "FMCSA unavailable", badge: "amber" },
};

/** `null` is "the authority did not tell us" and must not read as "no". */
export function triStateLabel(value: boolean | null): string {
  if (value === null) return "Not reported";
  return value ? "Yes" : "No";
}

export function matchLabel(value: string | null): string {
  switch (value) {
    case "exact":
      return "Exact";
    case "normalized":
      return "Match (normalized)";
    case "mismatch":
      return "MISMATCH";
    case "unavailable":
      return "Could not compare";
    default:
      return "—";
  }
}

/** Reason codes an APPLICANT may be shown. Re-exported for the assertion. */
export type { ReasonCode };

/* ==========================================================================
   M-100 — presentational tone for the values above.

   These map a value the engine ALREADY decided onto a badge colour. They
   decide nothing: `allowedToOperate === false` was false before this file
   existed and is false after it. They exist so the detail screen can show
   "NOT ALLOWED TO OPERATE" as a danger badge instead of as the word "No" in
   body text, which is what made a compliance blocker read like a data point.

   Every label is still a full word, so no state is carried by colour alone.
   ========================================================================== */

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * A tri-state where TRUE is the good outcome (`allowed to operate`).
 * `null` stays neutral: the authority not answering is not a finding.
 */
export function affirmativeTone(value: boolean | null): BadgeTone {
  if (value === null) return "neutral";
  return value ? "success" : "danger";
}

/** A tri-state where TRUE is the bad outcome (`out of service`). */
export function negativeTone(value: boolean | null): BadgeTone {
  if (value === null) return "neutral";
  return value ? "danger" : "success";
}

/** `unavailable` is neutral, not a failure — not knowing is not disagreeing. */
export function matchTone(value: string | null): BadgeTone {
  switch (value) {
    case "exact":
    case "normalized":
      return "success";
    case "mismatch":
      return "danger";
    default:
      return "neutral";
  }
}

/** `carrier_risk_tier` — 'low' | 'medium' | 'high' | 'manual_review'. */
export const RISK_TIER_BADGE: Readonly<
  Record<string, { label: string; tone: BadgeTone }>
> = {
  low: { label: "Low risk", tone: "success" },
  medium: { label: "Medium risk", tone: "warning" },
  high: { label: "High risk", tone: "danger" },
  manual_review: { label: "Manual review", tone: "warning" },
};

/** `onboarding_payment_status` — the five states in migration 0032. */
export const PAYMENT_BADGE: Readonly<
  Record<string, { label: string; tone: BadgeTone }>
> = {
  unpaid: { label: "Unpaid", tone: "neutral" },
  session_created: { label: "Checkout started", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  failed: { label: "Payment failed", tone: "danger" },
  refunded: { label: "Refunded", tone: "warning" },
};

/**
 * An unrecognised enum value must still render, and must not silently read as
 * a normal state — it shows the raw value on a neutral badge so staff can see
 * that the code and the database have diverged.
 */
export function badgeFor(
  map: Readonly<Record<string, { label: string; tone: BadgeTone }>>,
  value: string | null,
): { label: string; tone: BadgeTone } {
  if (value === null) return { label: "—", tone: "neutral" };
  return map[value] ?? { label: value, tone: "neutral" };
}
