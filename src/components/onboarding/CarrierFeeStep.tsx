"use client";

import { useActionState, useEffect } from "react";

import { startCarrierFeeCheckout } from "@/app/actions/carrier-fee";
import {
  initialFeeCheckoutState,
  type FeeCheckoutState,
} from "@/lib/carrier-fee-state";
import { useV4 } from "@/i18n/v4";

/**
 * M-95 — STEP 2: the $9.99 verification fee.
 *
 * ── WHAT THIS COMPONENT CANNOT DO ────────────────────────────────────────
 *
 * Decide that the fee is paid. It has no `paid` prop, no success branch and
 * nothing to set: the only outcomes it can render are "go to Stripe", "the
 * ledger already says paid", and an error. Whether a payment succeeded is
 * answered by the server on the NEXT page load, from the database, after
 * Stripe's signed webhook wrote it.
 *
 * That is why the button leads OUT of the app rather than into a success
 * state. The applicant leaves for Stripe's hosted page — PickLoads never sees
 * a card number, a CVC or a payment method — and comes back to a server route
 * that re-reads the ledger.
 */
export function CarrierFeeStep({
  onAlreadyPaid,
}: {
  /** Called when the ledger says this applicant has already settled. */
  onAlreadyPaid: () => void;
}) {
  const tv = useV4();
  const [state, action, pending] = useActionState<FeeCheckoutState, FormData>(
    startCarrierFeeCheckout,
    initialFeeCheckoutState,
  );

  // The redirect is performed by the browser, to a Stripe-hosted URL the
  // SERVER produced. Nothing about the destination comes from this component.
  useEffect(() => {
    if (state.status === "redirect" && state.url) {
      window.location.assign(state.url);
    }
    if (state.status === "already_paid") onAlreadyPaid();
  }, [state, onAlreadyPaid]);

  const leaving = pending || state.status === "redirect";

  return (
    <div className="bigform">
      <h2>{tv("Verification fee")}</h2>
      <p>
        {tv(
          "PickLoads charges a $9.99 one-time carrier verification and onboarding fee.",
        )}
      </p>
      <div className="esign-panel">
        <b>{tv("Secure card payment by Stripe")}</b>
        <p>
          {tv(
            "You'll finish on Stripe's secure payment page and come straight back. PickLoads never sees or stores your card details. Paying does not activate your account — documents, the agreement and our compliance review still apply.",
          )}
        </p>
      </div>
      <form action={action}>
        <button
          className="btn btn-amber"
          type="submit"
          aria-busy={leaving}
          disabled={leaving}
        >
          {leaving
            ? tv("Taking you to Stripe…")
            : tv("Pay $9.99 and continue →")}
        </button>
      </form>
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
      <p className="field-hint" style={{ marginTop: 14 }}>
        {tv(
          "Card payments are processed by Stripe. Your payment is confirmed with Stripe directly — not from your browser — so give it a moment if you've just returned.",
        )}
      </p>
    </div>
  );
}
