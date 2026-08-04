import "server-only";

import Stripe from "stripe";

/**
 * M-31 — Stripe client (dispatch-fee billing only).
 *
 * COMPLIANCE RULE (arch §5): PickLoads invoices ONLY its dispatch fee
 * (loads.dispatch_fee, snapshotted per F-03). Freight money moves
 * broker → carrier/factoring directly and NEVER transits a PickLoads
 * account — we are a dispatch service, not a party to the freight charge.
 * Nothing in this module may create a charge for a load's gross rate.
 *
 * Graceful degradation (same pattern as esign.ts / admin.ts): without
 * STRIPE_SECRET_KEY nothing is sent; callers show an honest "connect
 * Stripe" state and the build/runtime never throws.
 */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function tryCreateStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.warn("[stripe] STRIPE_SECRET_KEY unset — billing disabled");
    return null;
  }
  // Account default API version — pinning happens at upgrade time with a test
  // run, not ad hoc in code.
  return new Stripe(key);
}

export type { Stripe };
