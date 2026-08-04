"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import { useV4 } from "@/i18n/v4";
import { initialFormState } from "@/lib/form-state";
import { submitFreightQuote } from "@/app/actions/freight-quote";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";

/*
 * Shipper freight-quote form — V4 markup with U-02 label association and
 * U-06 date floor. M-14: wired to submitFreightQuote (Zod + Turnstile +
 * rate limit + Resend) with U-03 loading/success/error states.
 */
export function FreightQuoteForm() {
  const tv = useV4();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    submitFreightQuote,
    initialFormState,
  );
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="bigform">
      <h2>{tv("Request a freight quote")}</h2>
      <p>
        {tv(
          "Tell us about your shipment — we respond within one business hour (Mon–Sat). Brokerage operations open with our MC activation; early requests get priority onboarding.",
        )}
      </p>
      <form action={formAction}>
        <input type="hidden" name="locale" value={locale} />
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-pickup-zip">{tv("Pickup ZIP")}</label>
            <input id="fq-pickup-zip" name="pickup_zip" type="text" placeholder="07111" inputMode="numeric" autoComplete="postal-code" />
          </div>
          <div className="field">
            <label htmlFor="fq-delivery-zip">{tv("Delivery ZIP")}</label>
            <input id="fq-delivery-zip" name="delivery_zip" type="text" placeholder="30303" inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="fq-date">{tv("Pickup Date")}</label>
            <input id="fq-date" name="pickup_date" type="date" min={today} />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-commodity">{tv("Commodity")}</label>
            <input id="fq-commodity" name="commodity" type="text" placeholder={tv("e.g. Palletized beverages")} />
          </div>
          <div className="field">
            <label htmlFor="fq-weight">{tv("Weight (lbs)")}</label>
            <input id="fq-weight" name="weight_lbs" type="text" placeholder="42,000" inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="fq-pallets">{tv("Pallets / Pieces")}</label>
            <input id="fq-pallets" name="pallets" type="text" placeholder={tv("26 pallets")} />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-equipment">{tv("Equipment")}</label>
            <select id="fq-equipment" name="equipment" defaultValue="Dry Van 53'">
              <option value="Dry Van 53'">{tv("Dry Van 53'")}</option>
              <option value="Reefer">{tv("Reefer")}</option>
              <option value="Flatbed">{tv("Flatbed")}</option>
              <option value="Step Deck">{tv("Step Deck")}</option>
              <option value="Box Truck">{tv("Box Truck")}</option>
              <option value="Sprinter Van">{tv("Sprinter Van")}</option>
              <option value="Not sure — advise me">{tv("Not sure — advise me")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fq-frequency">{tv("Frequency")}</label>
            <select id="fq-frequency" name="frequency" defaultValue="One-time shipment">
              <option value="One-time shipment">{tv("One-time shipment")}</option>
              <option value="Weekly">{tv("Weekly")}</option>
              <option value="Monthly">{tv("Monthly")}</option>
              <option value="Dedicated lane">{tv("Dedicated lane")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fq-company">{tv("Company Name")}</label>
            <input id="fq-company" name="company_name" type="text" placeholder={tv("Your company")} autoComplete="organization" />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="fq-email">{tv("Contact Email")}</label>
            <input id="fq-email" name="email" type="email" placeholder="you@company.com" autoComplete="email" required aria-describedby="fq-err" />
          </div>
          <div className="field">
            <label htmlFor="fq-phone">{tv("Contact Phone")}</label>
            <input id="fq-phone" name="phone" type="tel" placeholder="(___) ___-____" inputMode="tel" autoComplete="tel" />
          </div>
        </div>
        <TurnstileWidget theme="light" />
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
        {tv(
          "✓ RECEIVED — Our team will reply within one business hour at the email provided. Questions now? Call (908) 404-5373 or email support@pickloads.com",
        )}
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
