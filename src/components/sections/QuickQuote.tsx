"use client";

import { useV4 } from "@/i18n/v4";

/*
 * "Need a dispatcher?" quick lead form — V4 markup, U-02 label association,
 * V4 dictionary strings. Server-action wiring lands in M-14 (Phase 1 gate).
 */
export function QuickQuote() {
  const tv = useV4();
  return (
    <div className="quote" id="quote">
      <div className="wrap">
        <div className="quote-card">
          <h2>{tv("Need a dispatcher?")}</h2>
          <p>
            {tv(
              "Tell us about your operation — a dispatcher calls you back within 15 minutes during business hours.",
            )}
          </p>
          <form
            className="quote-form"
            onSubmit={(e) => {
              e.preventDefault();
              /* M-14: useActionState(submitCarrierLead) */
            }}
          >
            <div className="field">
              <label htmlFor="q-truck">{tv("Truck Type")}</label>
              <select id="q-truck" name="truck_type" defaultValue="Semi / Tractor">
                <option>Semi / Tractor</option>
                <option>Box Truck 26&apos;</option>
                <option>Hot Shot</option>
                <option>Sprinter Van</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-trailer">{tv("Trailer Type")}</label>
              <select id="q-trailer" name="trailer_type" defaultValue="Dry Van">
                <option>Dry Van</option>
                <option>Reefer</option>
                <option>Flatbed</option>
                <option>Step Deck</option>
                <option>Power Only</option>
                <option>N/A</option>
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
                <option>Other</option>
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
              />
            </div>
            <button className="btn btn-amber" type="submit">
              {tv("Get Started →")}
            </button>
          </form>
          <div className="form-ok" role="status">
            {tv(
              "✓ RECEIVED — A dispatcher will call you within 15 minutes (Mon–Sat, 7am–9pm ET). Or call us now: (908) 404-5373",
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
