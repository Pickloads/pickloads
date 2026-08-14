"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { createShipperAccount } from "@/app/actions/account";
import { initialSignupState } from "@/lib/account-state";
import {
  TurnstileWidget,
  useTurnstileReset,
} from "@/components/forms/TurnstileWidget";

/**
 * M-53 — shipper registration form (V4 .bigform vocabulary). Directive
 * fields: industry, shipping frequency, regions. Copy stays quote-request
 * only (decision D1): no brokerage claims before authority activation.
 */

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

export function CreateShipperForm() {
  const tv = useV4();
  const locale = useLocale();
  const [regions, setRegions] = useState<ReadonlyArray<string>>([]);
  const [state, action, pending] = useActionState(
    createShipperAccount,
    initialSignupState,
  );
  // SEC-P1-01: a spent Turnstile token is re-sent on the next submit unless
  // the widget remounts. Counting settled submissions is what remounts it.
  const turnstileAttempt = useTurnstileReset(state);

  const toggleRegion = (region: string) => {
    setRegions((prev) =>
      prev.includes(region)
        ? prev.filter((r) => r !== region)
        : [...prev, region],
    );
  };

  if (state.status === "success") {
    return (
      <div className="bigform" style={{ maxWidth: 640, margin: "44px auto 0" }}>
        <h2>{tv("Your shipper account")}</h2>
        {state.verification === "unconfigured" ? (
          <div className="form-err show" role="alert">
            {tv(
              "This preview environment isn't connected to the account service — no account was created. Call (908) 404-5373 and we'll set you up directly.",
            )}
          </div>
        ) : (
          <>
            <div className="form-ok show" role="status">
              {state.verification === "sent"
                ? tv(
                    "✓ ACCOUNT CREATED — Check your inbox and click the verification link, then sign in.",
                  )
                : tv("✓ ACCOUNT CREATED — You're signed in.")}{" "}
              {tv(
                "Your shipper portal tracks every quote request and rate — and any quotes you already requested under this email get linked automatically.",
              )}
            </div>
            <div
              style={{
                marginTop: 22,
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <Link className="btn btn-amber" href="/login">
                {tv("Sign in to your portal →")}
              </Link>
              <a className="btn btn-dark" href="tel:+19084045373">
                {tv("Questions? (908) 404-5373")}
              </a>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="bigform" style={{ maxWidth: 640, margin: "44px auto 0" }}>
      <h2>{tv("Your shipper account")}</h2>
      <p>
        {tv(
          "About 2 minutes. Request quotes and coordinate freight with vetted carriers — a dispatcher reviews every request personally.",
        )}
      </p>
      <form action={action}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="regions" value={regions.join(", ")} />
        <div className="grid2">
          <div className="field">
            <label htmlFor="sa-company">{tv("Company Name")}</label>
            <input
              id="sa-company"
              name="company_name"
              type="text"
              required
              autoComplete="organization"
              placeholder={tv("Your company LLC")}
            />
          </div>
          <div className="field">
            <label htmlFor="sa-name">{tv("Your Full Name")}</label>
            <input
              id="sa-name"
              name="full_name"
              type="text"
              required
              autoComplete="name"
              placeholder="Jane Miller"
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sa-email">{tv("Email")}</label>
            <input
              id="sa-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
          </div>
          <div className="field">
            <label htmlFor="sa-phone">{tv("Phone")}</label>
            <input
              id="sa-phone"
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              inputMode="tel"
              placeholder="(___) ___-____"
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sa-industry">{tv("Industry")}</label>
            <select id="sa-industry" name="industry" defaultValue="">
              <option value="">{tv("Select…")}</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {tv(i)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sa-frequency">{tv("Shipping Frequency")}</label>
            <select id="sa-frequency" name="shipping_frequency" defaultValue="">
              <option value="">{tv("Select…")}</option>
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {tv(f.label)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 16px" }}>
          <legend className="field" style={{ padding: 0, marginBottom: 7 }}>
            <span
              style={{
                display: "block",
                fontFamily: "var(--font-mono)",
                fontSize: ".66rem",
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "#6a747b",
              }}
            >
              {tv("Shipping Regions (check all that apply)")}
            </span>
          </legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
            {REGIONS.map((r) => (
              <label
                key={r}
                className="consent-row"
                style={{ padding: "4px 0", gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={regions.includes(r)}
                  onChange={() => toggleRegion(r)}
                />
                <span>{tv(r)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="sa-pass">{tv("Password (8+ characters)")}</label>
          <input
            id="sa-pass"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>
        <TurnstileWidget theme="light" resetKey={turnstileAttempt} />
        <button
          className="btn btn-green"
          type="submit"
          aria-busy={pending}
          disabled={pending}
          style={{ marginTop: 4 }}
        >
          {pending ? tv("Creating account…") : tv("Create Account →")}
        </button>
      </form>
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
      <p className="mono" style={{ fontSize: ".72rem", marginTop: 22 }}>
        {"// "}
        {tv("Already have an account?")}{" "}
        <Link
          href="/login"
          style={{
            color: "var(--color-amber-aa)",
            textDecoration: "underline",
          }}
        >
          {tv("Sign In →")}
        </Link>
      </p>
    </div>
  );
}
