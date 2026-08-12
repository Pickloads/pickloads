"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import { useV4 } from "@/i18n/v4";
import { initialFormState } from "@/lib/form-state";
import { submitCarrierLead } from "@/app/actions/carrier-lead";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";

/*
 * "Need a dispatcher?" quick lead form — V4 markup, U-02 label association,
 * V4 dictionary strings. M-14: wired to submitCarrierLead with U-03
 * loading (aria-busy) / success (.form-ok.show) / error (.form-err.show).
 * Select values stay canonical English; display text translates via tv().
 */
export function QuickQuote() {
  const tv = useV4();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    submitCarrierLead,
    initialFormState,
  );
  return (
    <div className="quote" id="quote">
      <div className="wrap">
        <div className="quote-card">
          <h2>{tv("Need a dispatcher?")}</h2>
          <p>
            {tv(
              "Tell us about your operation — we respond fast, typically within the hour during business hours.",
            )}
          </p>
          <form className="quote-form" action={formAction}>
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="q-truck">{tv("Truck Type")}</label>
              <select id="q-truck" name="truck_type" defaultValue="Semi / Tractor">
                <option value="Semi / Tractor">{tv("Semi / Tractor")}</option>
                <option value="Box Truck 26'">{tv("Box Truck 26'")}</option>
                <option value="Hot Shot">{tv("Hot Shot")}</option>
                <option value="Sprinter Van">{tv("Sprinter Van")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-trailer">{tv("Trailer Type")}</label>
              <select id="q-trailer" name="trailer_type" defaultValue="Dry Van">
                <option value="Dry Van">{tv("Dry Van")}</option>
                <option value="Reefer">{tv("Reefer")}</option>
                <option value="Flatbed">{tv("Flatbed")}</option>
                <option value="Step Deck">{tv("Step Deck")}</option>
                <option value="Power Only">{tv("Power Only")}</option>
                <option value="N/A">{tv("N/A")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-state">{tv("Home State")}</label>
              <select id="q-state" name="home_state" defaultValue="NJ">
                <option>NJ</option>
                <option>NY</option>
                <option>PA</option>
                <option>FL</option>
                <option>GA</option>
                <option>TX</option>
                <option>IL</option>
                <option>CA</option>
                <option value="Other">{tv("Other")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-trucks">{tv("# of Trucks")}</label>
              <select id="q-trucks" name="truck_count" defaultValue="1">
                <option>1</option>
                <option>2–5</option>
                <option>6–15</option>
                <option>16+</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-phone">{tv("Your Phone")}</label>
              <input
                id="q-phone"
                name="phone"
                type="tel"
                placeholder="(___) ___-____"
                inputMode="tel"
                autoComplete="tel"
                required
                aria-describedby="q-err"
              />
            </div>
            <TurnstileWidget theme="dark" />
            <button
              className="btn btn-amber"
              type="submit"
              aria-busy={pending}
              disabled={pending}
            >
              {pending ? tv("Sending…") : tv("Get Started →")}
            </button>
          </form>
          <div
            className={`form-ok${state.status === "success" ? " show" : ""}`}
            role="status"
          >
            {tv(
              "✓ RECEIVED — We respond fast, typically within the hour during business hours. Or call us now: (908) 404-5373",
            )}
          </div>
          <div
            id="q-err"
            className={`form-err${state.status === "error" ? " show" : ""}`}
            role="alert"
          >
            {state.status === "error" && state.message ? tv(state.message) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
