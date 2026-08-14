"use client";

import { useActionState, useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { useV4 } from "@/i18n/v4";
import { initialFormState } from "@/lib/form-state";
import { submitFreightQuote } from "@/app/actions/freight-quote";
import {
  TurnstileWidget,
  useTurnstileReset,
} from "@/components/forms/TurnstileWidget";
import { track } from "@/lib/analytics";
import {
  CONTACT_NOW,
  RESPONSE_PROMISE,
  RESPONSE_PROMISE_RECEIVED,
} from "@/lib/copy/response-promise";

/*
 * Shipper freight-quote form — V4 markup with U-02 label association and
 * U-06 date floor. M-14: wired to submitFreightQuote (Zod + Turnstile +
 * rate limit + Resend) with U-03 loading/success/error states.
 */
export function FreightQuoteForm({
  surface = "shippers",
  brokerageActive = false,
}: {
  /** Which page this instance is on — the funnel's only dimension. */
  surface?: string;
  /** Reported with each event so "is this a pre-launch funnel?" is answerable. */
  brokerageActive?: boolean;
} = {}) {
  const tv = useV4();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    submitFreightQuote,
    initialFormState,
  );
  // SEC-P1-01: a spent Turnstile token is re-sent on the next submit unless
  // the widget remounts. Counting settled submissions is what remounts it.
  const turnstileAttempt = useTurnstileReset(state);
  const today = new Date().toISOString().slice(0, 10);

  /* ── §52 funnel events ──────────────────────────────────────────────────
   * Four events, fired HERE rather than on each page, so the two surfaces
   * that render this form cannot measure the funnel differently. `track()`
   * is a no-op until GA4 has both a measurement id and consent, so nothing
   * here needs a guard and nothing here can leak: the taxonomy has no field
   * that could carry shipment content.
   */
  const started = useRef(false);

  useEffect(() => {
    track("quote_view", { surface, brokerage_active: brokerageActive });
    // Once per mount. A re-render is not a new view.
  }, [surface, brokerageActive]);

  const onFirstInput = () => {
    if (started.current) return;
    started.current = true;
    track("quote_started", { surface, brokerage_active: brokerageActive });
  };

  useEffect(() => {
    if (state.status === "success") {
      track("quote_submitted", { surface, brokerage_active: brokerageActive });
    } else if (state.status === "error") {
      // A COARSE reason only. The server's own message can quote user input,
      // and §52 keeps user input out of analytics entirely.
      const raw = (state.message ?? "").toLowerCase();
      const reason = raw.includes("too many")
        ? ("rate_limited" as const)
        : raw.includes("verification") || raw.includes("turnstile")
          ? ("turnstile" as const)
          : raw.includes("try again") || raw.includes("went wrong")
            ? ("server" as const)
            : ("validation" as const);
      track("quote_failed", {
        surface,
        reason,
        brokerage_active: brokerageActive,
      });
    }
  }, [state, surface, brokerageActive]);
  return (
    <div className="bigform">
      <h2>{tv("Request a freight quote")}</h2>
      <p>
        {tv("Tell us about your shipment.")} {tv(RESPONSE_PROMISE)}{" "}
        {tv(
          "Brokerage operations open with our MC activation; early requests get priority onboarding.",
        )}
      </p>
      <form action={formAction} onInput={onFirstInput}>
        <input type="hidden" name="locale" value={locale} />
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-pickup-zip">{tv("Pickup ZIP")}</label>
            <input
              id="fq-pickup-zip"
              name="pickup_zip"
              type="text"
              placeholder="07111"
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </div>
          <div className="field">
            <label htmlFor="fq-delivery-zip">{tv("Delivery ZIP")}</label>
            <input
              id="fq-delivery-zip"
              name="delivery_zip"
              type="text"
              placeholder="30303"
              inputMode="numeric"
            />
          </div>
          <div className="field">
            <label htmlFor="fq-date">{tv("Pickup Date")}</label>
            <input id="fq-date" name="pickup_date" type="date" min={today} />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-commodity">{tv("Commodity")}</label>
            <input
              id="fq-commodity"
              name="commodity"
              type="text"
              placeholder={tv("e.g. Palletized beverages")}
            />
          </div>
          <div className="field">
            <label htmlFor="fq-weight">{tv("Weight (lbs)")}</label>
            <input
              id="fq-weight"
              name="weight_lbs"
              type="text"
              placeholder="42,000"
              inputMode="numeric"
            />
          </div>
          <div className="field">
            <label htmlFor="fq-pallets">{tv("Pallets / Pieces")}</label>
            <input
              id="fq-pallets"
              name="pallets"
              type="text"
              placeholder={tv("26 pallets")}
            />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-equipment">{tv("Equipment")}</label>
            <select
              id="fq-equipment"
              name="equipment"
              defaultValue="Dry Van 53'"
            >
              <option value="Dry Van 53'">{tv("Dry Van 53'")}</option>
              <option value="Reefer">{tv("Reefer")}</option>
              <option value="Flatbed">{tv("Flatbed")}</option>
              <option value="Step Deck">{tv("Step Deck")}</option>
              <option value="Box Truck">{tv("Box Truck")}</option>
              <option value="Sprinter Van">{tv("Sprinter Van")}</option>
              <option value="Not sure — advise me">
                {tv("Not sure — advise me")}
              </option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fq-frequency">{tv("Frequency")}</label>
            <select
              id="fq-frequency"
              name="frequency"
              defaultValue="One-time shipment"
            >
              <option value="One-time shipment">
                {tv("One-time shipment")}
              </option>
              <option value="Weekly">{tv("Weekly")}</option>
              <option value="Monthly">{tv("Monthly")}</option>
              <option value="Dedicated lane">{tv("Dedicated lane")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fq-company">{tv("Company Name")}</label>
            <input
              id="fq-company"
              name="company_name"
              type="text"
              placeholder={tv("Your company")}
              autoComplete="organization"
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="fq-email">{tv("Contact Email")}</label>
            <input
              id="fq-email"
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              required
              aria-describedby="fq-err"
            />
          </div>
          <div className="field">
            <label htmlFor="fq-phone">{tv("Contact Phone")}</label>
            <input
              id="fq-phone"
              name="phone"
              type="tel"
              placeholder="(___) ___-____"
              inputMode="tel"
              autoComplete="tel"
            />
          </div>
        </div>
        <TurnstileWidget theme="light" resetKey={turnstileAttempt} />
        <button
          className="btn btn-amber"
          type="submit"
          aria-busy={pending}
          disabled={pending}
          style={{ marginTop: 4 }}
        >
          {pending ? tv("Sending…") : tv("Request Freight Quote →")}
        </button>
      </form>
      <div
        className={`form-ok${state.status === "success" ? " show" : ""}`}
        role="status"
      >
        {tv(RESPONSE_PROMISE_RECEIVED)} {tv(CONTACT_NOW)}
      </div>
      <div
        id="fq-err"
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </div>
  );
}
