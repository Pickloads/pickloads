"use client";

/*
 * Shipper freight-quote form — V4 markup with U-02 label association and
 * U-06 date floor. Server-action wiring (Zod + Turnstile + rate limit +
 * Resend) lands in M-14 with the rest of the form pipeline.
 */
export function FreightQuoteForm() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="bigform">
      <h2>Request a freight quote</h2>
      <p>
        Tell us about your shipment — we respond within one business hour
        (Mon–Sat). Brokerage operations open with our MC activation; early
        requests get priority onboarding.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          /* M-14: useActionState(submitFreightQuote) */
        }}
      >
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-pickup-zip">Pickup ZIP</label>
            <input id="fq-pickup-zip" name="pickup_zip" type="text" placeholder="07111" inputMode="numeric" autoComplete="postal-code" />
          </div>
          <div className="field">
            <label htmlFor="fq-delivery-zip">Delivery ZIP</label>
            <input id="fq-delivery-zip" name="delivery_zip" type="text" placeholder="30303" inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="fq-date">Pickup Date</label>
            <input id="fq-date" name="pickup_date" type="date" min={today} />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-commodity">Commodity</label>
            <input id="fq-commodity" name="commodity" type="text" placeholder="e.g. Palletized beverages" />
          </div>
          <div className="field">
            <label htmlFor="fq-weight">Weight (lbs)</label>
            <input id="fq-weight" name="weight_lbs" type="text" placeholder="42,000" inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="fq-pallets">Pallets / Pieces</label>
            <input id="fq-pallets" name="pallets" type="text" placeholder="26 pallets" />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="fq-equipment">Equipment</label>
            <select id="fq-equipment" name="equipment" defaultValue="Dry Van 53'">
              <option>Dry Van 53&apos;</option>
              <option>Reefer</option>
              <option>Flatbed</option>
              <option>Step Deck</option>
              <option>Box Truck</option>
              <option>Sprinter Van</option>
              <option>Not sure — advise me</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fq-frequency">Frequency</label>
            <select id="fq-frequency" name="frequency" defaultValue="One-time shipment">
              <option>One-time shipment</option>
              <option>Weekly</option>
              <option>Monthly</option>
              <option>Dedicated lane</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fq-company">Company Name</label>
            <input id="fq-company" name="company_name" type="text" placeholder="Your company" autoComplete="organization" />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="fq-email">Contact Email</label>
            <input id="fq-email" name="email" type="email" placeholder="you@company.com" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="fq-phone">Contact Phone</label>
            <input id="fq-phone" name="phone" type="tel" placeholder="(___) ___-____" inputMode="tel" autoComplete="tel" />
          </div>
        </div>
        <button className="btn btn-amber" type="submit">
          Request Freight Quote →
        </button>
      </form>
      <div className="form-ok" role="status">
        ✓ RECEIVED — Our team will reply within one business hour at the email
        provided. Questions now? Call (908) 404-5373 or email
        support@pickloads.com
      </div>
    </div>
  );
}
