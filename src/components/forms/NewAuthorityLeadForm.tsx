"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import { useV4 } from "@/i18n/v4";
import { initialFormState } from "@/lib/form-state";
import { submitCarrierLead } from "@/app/actions/carrier-lead";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";

/**
 * M-26 — New Authority lead form (V4 .bigform vocabulary). Posts through the
 * same guarded pipeline as the quick form with lead_type='new_authority'
 * (auto-tagged + separate source in the action). Select values stay
 * canonical English (locale-independent DB rows).
 */
export function NewAuthorityLeadForm() {
  const tv = useV4();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    submitCarrierLead,
    initialFormState,
  );
  return (
    <div className="bigform" id="start">
      <h2>{tv("Start your trucking company")}</h2>
      <p>
        {tv(
          "Tell us where you are in the process — a launch specialist calls you back within 15 minutes during business hours.",
        )}
      </p>
      <form action={formAction}>
        <input type="hidden" name="lead_type" value="new_authority" />
        <input type="hidden" name="locale" value={locale} />
        <div className="grid2">
          <div className="field">
            <label htmlFor="na-name">{tv("Your Full Name")}</label>
            <input
              id="na-name"
              name="full_name"
              type="text"
              autoComplete="name"
              placeholder="John Carter"
            />
          </div>
          <div className="field">
            <label htmlFor="na-phone">{tv("Phone")}</label>
            <input
              id="na-phone"
              name="phone"
              type="tel"
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="(___) ___-____"
              aria-describedby="na-err"
            />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="na-email">{tv("Email (optional)")}</label>
            <input
              id="na-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
            />
          </div>
          <div className="field">
            <label htmlFor="na-state">{tv("Home State")}</label>
            <input
              id="na-state"
              name="home_state"
              type="text"
              placeholder="NJ"
              autoComplete="address-level1"
            />
          </div>
          <div className="field">
            <label htmlFor="na-truck">{tv("Planned Equipment")}</label>
            <select id="na-truck" name="truck_type" defaultValue="">
              <option value="">{tv("Not sure yet")}</option>
              <option value="Semi Truck">{tv("Semi Truck")}</option>
              <option value="Box Truck">{tv("Box Truck")}</option>
              <option value="Hot Shot">{tv("Hot Shot")}</option>
              <option value="Sprinter Van">{tv("Sprinter Van")}</option>
            </select>
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="na-stage">{tv("Where are you today?")}</label>
            <select id="na-stage" name="stage" defaultValue="Still planning">
              <option value="Still planning">{tv("Still planning")}</option>
              <option value="Have a truck, no authority">
                {tv("Have a truck, no authority")}
              </option>
              <option value="LLC filed, need MC/USDOT">
                {tv("LLC filed, need MC/USDOT")}
              </option>
              <option value="MC filed, waiting on FMCSA">
                {tv("MC filed, waiting on FMCSA")}
              </option>
            </select>
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
          {pending ? tv("Sending…") : tv("Start My Trucking Company →")}
        </button>
      </form>
      <div
        className={`form-ok${state.status === "success" ? " show" : ""}`}
        role="status"
      >
        {tv(
          "✓ RECEIVED — A launch specialist will call you back within 15 minutes during business hours. Questions now? Call (908) 404-5373.",
        )}
      </div>
      <div
        id="na-err"
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
      <p
        className="mono"
        style={{ fontSize: ".7rem", color: "var(--color-slate-aa)", marginTop: 16 }}
      >
        {"// "}
        {tv(
          "Document filing assistance only — we are not a law firm and do not provide legal advice.",
        )}
      </p>
    </div>
  );
}
