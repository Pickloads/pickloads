/**
 * M-95 — shared client/server state for the fee step.
 *
 * ── WHAT IS NOT IN THIS SHAPE ────────────────────────────────────────────
 *
 * No `paid` boolean. No amount the client could echo back. No session id the
 * client could substitute.
 *
 * `redirect` carries a Stripe-hosted URL because the browser has to go there,
 * and that is the ONLY thing the server tells the browser about a payment in
 * progress. Whether the payment then succeeded is a question answered by the
 * database on the next request, never by anything the browser brings back —
 * which is why there is no success member here at all: the client never gets
 * to hold "paid".
 */

export type FeeCheckoutStatus =
  | "idle"
  /** Go to Stripe. */
  | "redirect"
  /** The ledger already has a settled payment; nothing to do. */
  | "already_paid"
  | "error";

export interface FeeCheckoutState {
  status: FeeCheckoutStatus;
  /** Present only for `redirect` — a Stripe-hosted Checkout URL. */
  url?: string;
  /** Present only for `error`. */
  message?: string;
}

export const initialFeeCheckoutState: FeeCheckoutState = { status: "idle" };
