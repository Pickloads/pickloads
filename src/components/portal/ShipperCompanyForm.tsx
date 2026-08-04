"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useV4 } from "@/i18n/v4";
import { updateShipperCompany } from "@/app/actions/shipper-portal";
import { initialFormState } from "@/lib/form-state";

/** M-56 — self-serve shipper company settings (M-53 vocabulary reused). */

const INDUSTRIES = [
  "Retail & E-commerce",
  "Food & Beverage",
  "Manufacturing",
  "Construction & building materials",
  "Agriculture",
  "Automotive",
  "Other",
] as const;

const FREQUENCIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "one_time", label: "One-time shipment" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "seasonal", label: "Seasonal" },
];

const REGIONS = [
  "Northeast",
  "Southeast",
  "Midwest",
  "Southwest",
  "West",
  "Nationwide",
] as const;

export function ShipperCompanyForm({
  companyName,
  industry,
  shippingFrequency,
  regions,
  phone,
  billingEmail,
}: {
  companyName: string;
  industry: string | null;
  shippingFrequency: string | null;
  regions: string[] | null;
  phone: string | null;
  billingEmail: string | null;
}) {
  const tv = useV4();
  const [selectedRegions, setSelectedRegions] = useState<ReadonlyArray<string>>(
    regions ?? [],
  );
  const [state, formAction, pending] = useActionState(
    updateShipperCompany,
    initialFormState,
  );

  const toggleRegion = (region: string) => {
    setSelectedRegions((prev) =>
      prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region],
    );
  };

  return (
    <form action={formAction}>
      <input type="hidden" name="regions" value={selectedRegions.join(", ")} />
      <div className="pform-row">
        <div className="field">
          <label htmlFor="sc-company">{tv("Company Name")}</label>
          <input id="sc-company" name="company_name" type="text" required defaultValue={companyName} />
        </div>
        <div className="field">
          <label htmlFor="sc-industry">{tv("Industry")}</label>
          <select id="sc-industry" name="industry" defaultValue={industry ?? ""}>
            <option value="">{tv("Select…")}</option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>
                {tv(i)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="sc-frequency">{tv("Shipping Frequency")}</label>
          <select id="sc-frequency" name="shipping_frequency" defaultValue={shippingFrequency ?? ""}>
            <option value="">{tv("Select…")}</option>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {tv(f.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sc-phone">{tv("Phone")}</label>
          <input id="sc-phone" name="phone" type="tel" inputMode="tel" defaultValue={phone ?? ""} placeholder="(___) ___-____" />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="sc-billing">{tv("Billing email")}</label>
        <input id="sc-billing" name="billing_email" type="email" defaultValue={billingEmail ?? ""} placeholder="billing@company.com" />
      </div>
      <span className="psec" style={{ margin: "0 0 8px" }}>
        {tv("Shipping Regions (check all that apply)")}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginBottom: 14 }}>
        {REGIONS.map((r) => (
          <label key={r} className="consent-row" style={{ padding: "4px 0", gap: 8 }}>
            <input
              type="checkbox"
              checked={selectedRegions.includes(r)}
              onChange={() => toggleRegion(r)}
            />
            <span>{tv(r)}</span>
          </label>
        ))}
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? tv("Saving…") : tv("Save company info")}
      </button>
      <div className={`form-ok${state.status === "success" ? " show" : ""}`} role="status">
        {state.status === "success" ? tv("✓ Saved.") : null}
      </div>
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </form>
  );
}
