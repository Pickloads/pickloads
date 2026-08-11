"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { submitPortalQuote } from "@/app/actions/shipper-portal";
import { initialFormState } from "@/lib/form-state";
import { RESPONSE_PROMISE_RECEIVED } from "@/lib/copy/response-promise";
import {
  QUOTE_EQUIPMENT,
  QUOTE_FREQUENCIES,
} from "@/lib/validation/portal-quote";

/**
 * M-56 — the professional in-portal quote form (all directive fields).
 * Server-validated (Zod) and inserted with the membership-verified
 * shipper_id; this component is layout + progressive disclosure only.
 */
export function PortalQuoteForm({
  contactName,
  phone,
}: {
  contactName: string | null;
  phone: string | null;
}) {
  const tv = useV4();
  const [tempControlled, setTempControlled] = useState(false);
  const [state, formAction, pending] = useActionState(
    submitPortalQuote,
    initialFormState,
  );

  if (state.status === "success") {
    return (
      <div className="pcard">
        <div className="form-ok show" role="status">
          {/* The SAME constant the public form uses. These two had already
              drifted — "within one business hour (Mon–Sat)" on the public page
              versus "usually within one business hour (8am–6pm ET)" here — and
              a shared convention is what let them. */}
          {tv(RESPONSE_PROMISE_RECEIVED)}
        </div>
        <p style={{ marginTop: 16 }}>
          <Link className="btn btn-amber btn-sm" href="/portal/shipper/quotes">
            {tv("Track it in My Quotes")} →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <div className="pgrid2">
        <div className="pcard">
          <h2>{tv("Pickup")}</h2>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="pq-pu-company">{tv("Pickup company / facility")}</label>
            <input id="pq-pu-company" name="pickup_company" type="text" placeholder={tv("Acme Warehouse")} />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="pq-pu-address">{tv("Street address")}</label>
            <input id="pq-pu-address" name="pickup_address" type="text" placeholder="123 Dock St" />
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="pq-pu-city">{tv("City")}</label>
              <input id="pq-pu-city" name="pickup_city" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="pq-pu-state">{tv("State")}</label>
              <input id="pq-pu-state" name="pickup_state" type="text" required placeholder="NJ" />
            </div>
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="pq-pu-zip">{tv("ZIP")}</label>
              <input id="pq-pu-zip" name="pickup_zip" type="text" required inputMode="numeric" placeholder="07111" />
            </div>
            <div className="field">
              <label htmlFor="pq-pu-date">{tv("Pickup date")}</label>
              <input id="pq-pu-date" name="pickup_date" type="date" />
            </div>
          </div>
        </div>

        <div className="pcard">
          <h2>{tv("Delivery")}</h2>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="pq-de-company">{tv("Delivery company / facility")}</label>
            <input id="pq-de-company" name="delivery_company" type="text" />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="pq-de-address">{tv("Street address")}</label>
            <input id="pq-de-address" name="delivery_address" type="text" />
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="pq-de-city">{tv("City")}</label>
              <input id="pq-de-city" name="delivery_city" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="pq-de-state">{tv("State")}</label>
              <input id="pq-de-state" name="delivery_state" type="text" required placeholder="TX" />
            </div>
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="pq-de-zip">{tv("ZIP")}</label>
              <input id="pq-de-zip" name="delivery_zip" type="text" required inputMode="numeric" />
            </div>
            <div className="field">
              <label htmlFor="pq-de-deadline">{tv("Delivery deadline")}</label>
              <input id="pq-de-deadline" name="delivery_deadline" type="date" />
            </div>
          </div>
        </div>
      </div>

      <div className="pcard">
        <h2>{tv("Freight details")}</h2>
        <div className="pform-row">
          <div className="field">
            <label htmlFor="pq-commodity">{tv("Commodity")}</label>
            <input id="pq-commodity" name="commodity" type="text" required placeholder={tv("e.g. Packaged food, palletized")} />
          </div>
          <div className="field">
            <label htmlFor="pq-weight">{tv("Weight (lbs)")}</label>
            <input id="pq-weight" name="weight_lbs" type="text" inputMode="numeric" placeholder="42,000" />
          </div>
        </div>
        <div className="pform-row">
          <div className="field">
            <label htmlFor="pq-pallets">{tv("Pallets / pieces")}</label>
            <input id="pq-pallets" name="pallets" type="text" placeholder="26 pallets" />
          </div>
          <div className="field">
            <label htmlFor="pq-equipment">{tv("Equipment")}</label>
            <select id="pq-equipment" name="equipment" required defaultValue="">
              <option value="" disabled>
                {tv("Select…")}
              </option>
              {QUOTE_EQUIPMENT.map((e) => (
                <option key={e} value={e}>
                  {tv(e)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <span className="psec" style={{ margin: "6px 0 8px" }}>
          {tv("Dimensions (if oversized or partial)")}
        </span>
        <div className="pform-row">
          <div className="field">
            <label htmlFor="pq-dl">{tv("Length (in)")}</label>
            <input id="pq-dl" name="dims_l_in" type="text" inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="pq-dw">{tv("Width (in)")}</label>
            <input id="pq-dw" name="dims_w_in" type="text" inputMode="numeric" />
          </div>
        </div>
        <div className="pform-row">
          <div className="field">
            <label htmlFor="pq-dh">{tv("Height (in)")}</label>
            <input id="pq-dh" name="dims_h_in" type="text" inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="pq-frequency">{tv("Shipping Frequency")}</label>
            <select id="pq-frequency" name="frequency" required defaultValue="">
              <option value="" disabled>
                {tv("Select…")}
              </option>
              {QUOTE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {tv(f)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 22px", margin: "6px 0 12px" }}>
          <label className="consent-row" style={{ padding: "4px 0", gap: 8 }}>
            <input
              type="checkbox"
              name="temp_controlled"
              checked={tempControlled}
              onChange={(e) => setTempControlled(e.target.checked)}
            />
            <span>{tv("Temperature controlled")}</span>
          </label>
          <label className="consent-row" style={{ padding: "4px 0", gap: 8 }}>
            <input type="checkbox" name="hazmat" />
            <span>{tv("Hazmat (placarded)")}</span>
          </label>
        </div>
        {tempControlled ? (
          <div className="pform-row">
            <div className="field">
              <label htmlFor="pq-tmin">{tv("Min temp (°F)")}</label>
              <input id="pq-tmin" name="temp_min_f" type="text" inputMode="numeric" placeholder="34" />
            </div>
            <div className="field">
              <label htmlFor="pq-tmax">{tv("Max temp (°F)")}</label>
              <input id="pq-tmax" name="temp_max_f" type="text" inputMode="numeric" placeholder="38" />
            </div>
          </div>
        ) : null}
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="pq-instructions">{tv("Special instructions")}</label>
          <textarea
            id="pq-instructions"
            name="special_instructions"
            rows={3}
            maxLength={1000}
            placeholder={tv("Appointments, liftgate, driver assist, references…")}
          />
        </div>
        <div className="pform-row">
          <div className="field">
            <label htmlFor="pq-contact">{tv("Contact name")}</label>
            <input id="pq-contact" name="contact_name" type="text" required defaultValue={contactName ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="pq-phone">{tv("Phone")}</label>
            <input id="pq-phone" name="phone" type="tel" inputMode="tel" required defaultValue={phone ?? ""} placeholder="(___) ___-____" />
          </div>
        </div>
        <button className="btn btn-amber" type="submit" aria-busy={pending} disabled={pending}>
          {pending ? tv("Sending…") : tv("Request Quote →")}
        </button>
        <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
          {state.status === "error" && state.message ? tv(state.message) : null}
        </div>
      </div>
    </form>
  );
}
