"use client";

/*
 * "Need a dispatcher?" quick lead form — V4 markup with proper label/input
 * association (audit U-02) and the U-03 state vocabulary in place.
 * Submission wiring (server action + Zod + Turnstile + rate limit + Resend)
 * lands in M-14; until then the button is inert by design — the site is not
 * launched before M-14 completes (Phase 1 gate).
 */
export function QuickQuote() {
  return (
    <div className="quote" id="quote">
      <div className="wrap">
        <div className="quote-card">
          <h2>Need a dispatcher?</h2>
          <p>
            Tell us about your operation — a dispatcher calls you back within 15
            minutes during business hours.
          </p>
          <form
            className="quote-form"
            onSubmit={(e) => {
              e.preventDefault();
              /* M-14: replace with useActionState(submitCarrierLead) */
            }}
          >
            <div className="field">
              <label htmlFor="q-truck">Truck Type</label>
              <select id="q-truck" name="truck_type" defaultValue="Semi / Tractor">
                <option>Semi / Tractor</option>
                <option>Box Truck 26&apos;</option>
                <option>Hot Shot</option>
                <option>Sprinter Van</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-trailer">Trailer Type</label>
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
              <label htmlFor="q-state">Home State</label>
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
              <label htmlFor="q-trucks"># of Trucks</label>
              <select id="q-trucks" name="truck_count" defaultValue="1">
                <option>1</option>
                <option>2–5</option>
                <option>6–15</option>
                <option>16+</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-phone">Your Phone</label>
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
              Get Started →
            </button>
          </form>
          <div className="form-ok" role="status">
            ✓ RECEIVED — A dispatcher will call you within 15 minutes (Mon–Sat,
            7am–9pm ET). Or call us now: (908) 404-5373
          </div>
        </div>
      </div>
    </div>
  );
}
