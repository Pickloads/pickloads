/**
 * M-94 — shared client/server state for the carrier pre-check step (same
 * plain-module pattern as `src/lib/onboarding-state.ts`).
 *
 * ── WHAT IS NOT IN THIS SHAPE, AND WHY ───────────────────────────────────
 *
 * No pre-registration id. No reason codes. No FMCSA field. No boolean called
 * `verified`.
 *
 * The id lives in an httpOnly cookie the page script cannot read
 * (`precheck-session.ts`); the reason codes are staff-only (M-93 §6); the
 * provider record never crosses this boundary (§20); and a `verified` flag on
 * a client-side state object is the exact thing §17 forbids trusting, so it is
 * better that it not exist than that it exist and be ignored. What the browser
 * gets is which of three screens to render.
 */

export type PrecheckStatus =
  | "idle"
  /** Cleared to continue — to the M-95 fee, NOT to an account. */
  | "eligible"
  | "manual_review"
  | "not_eligible"
  /** Validation, rate limit or Turnstile refused the submission. */
  | "error";

export interface PrecheckState {
  status: PrecheckStatus;
  /** Present for `error` only. The three outcomes have fixed copy in the UI. */
  message?: string;
}

export const initialPrecheckState: PrecheckState = { status: "idle" };
