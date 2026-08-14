"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { createCarrierAccount } from "@/app/actions/account";
import { initialSignupState } from "@/lib/account-state";
import {
  TurnstileWidget,
  useTurnstileReset,
} from "@/components/forms/TurnstileWidget";
import type { AuthorityStatus } from "@/lib/validation/account";

/**
 * M-52 — carrier registration form (V4 .bigform vocabulary). Authority
 * status drives both the visible fields and the server-side routing:
 * active → onboarding wizard · pending → pending state · none →
 * new-authority funnel · leased-on → manual review flag.
 */

const AUTHORITY_OPTIONS: ReadonlyArray<{
  value: AuthorityStatus;
  label: string;
}> = [
  { value: "active", label: "My MC authority is active" },
  { value: "pending", label: "I filed with FMCSA — authority pending" },
  { value: "none", label: "No authority yet — help me start" },
  { value: "leased_on", label: "I'm leased on to another authority" },
];

export function CreateCarrierForm() {
  const tv = useV4();
  const locale = useLocale();
  const [authority, setAuthority] = useState<AuthorityStatus>("active");
  const [state, action, pending] = useActionState(
    createCarrierAccount,
    initialSignupState,
  );
  // SEC-P1-01: a spent Turnstile token is re-sent on the next submit unless
  // the widget remounts. Counting settled submissions is what remounts it.
  const turnstileAttempt = useTurnstileReset(state);

  if (state.status === "success") {
    return (
      <div className="bigform" style={{ maxWidth: 640, margin: "44px auto 0" }}>
        <h2>{tv("Your carrier account")}</h2>
        {state.verification === "unconfigured" ? (
          /* Honest no-env state: nothing was created, say so (audit §6.4). */
          <div className="form-err show" role="alert">
            {tv(
              "This preview environment isn't connected to the account service — no account was created. Call (908) 404-5373 and we'll set you up directly.",
            )}
          </div>
        ) : (
          <div className="form-ok show" role="status">
            {state.verification === "sent"
              ? tv(
                  "✓ ACCOUNT CREATED — Check your inbox and click the verification link, then sign in.",
                )
              : tv("✓ ACCOUNT CREATED — You're signed in.")}{" "}
            {state.next === "onboarding"
              ? tv(
                  "Next: finish onboarding — your documents and dispatch agreement take about 10 minutes.",
                )
              : state.next === "pending"
                ? tv(
                    "Your MC application is pending — our team verifies it and activates dispatch. Sign in any time to track your documents.",
                  )
                : state.next === "new_authority"
                  ? tv(
                      "We'll help you launch: your checklist is ready, and a dispatcher typically calls you the same day.",
                    )
                  : tv(
                      "Because you run leased-on, a dispatcher reviews your setup personally and calls you — usually the same day.",
                    )}
          </div>
        )}
        {state.verification !== "unconfigured" ? (
          <div
            style={{
              marginTop: 22,
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            {state.next === "onboarding" ? (
              <Link className="btn btn-amber" href="/become-a-carrier">
                {tv("Continue to onboarding →")}
              </Link>
            ) : state.next === "new_authority" ? (
              <Link
                className="btn btn-amber"
                href="/start-your-trucking-company"
              >
                {tv("See your launch checklist →")}
              </Link>
            ) : (
              <Link className="btn btn-amber" href="/login">
                {tv("Sign in to your portal →")}
              </Link>
            )}
            <a className="btn btn-dark" href="tel:+19084045373">
              {tv("Questions? (908) 404-5373")}
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="bigform" style={{ maxWidth: 640, margin: "44px auto 0" }}>
      <h2>{tv("Your carrier account")}</h2>
      <p>
        {tv(
          "About 2 minutes. Onboarding — documents and the dispatch agreement — continues after your email is verified.",
        )}
      </p>
      <form action={action}>
        <input type="hidden" name="locale" value={locale} />
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="ca-authority">
            {tv("Where does your authority stand?")}
          </label>
          <select
            id="ca-authority"
            name="authority_status"
            value={authority}
            onChange={(e) => {
              const v = e.target.value;
              if (
                v === "active" ||
                v === "pending" ||
                v === "none" ||
                v === "leased_on"
              ) {
                setAuthority(v);
              }
            }}
          >
            {AUTHORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {tv(o.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="ca-company">{tv("Company Name")}</label>
            <input
              id="ca-company"
              name="company_name"
              type="text"
              required
              autoComplete="organization"
              placeholder={tv("Your company LLC")}
            />
          </div>
          <div className="field">
            <label htmlFor="ca-name">{tv("Your Full Name")}</label>
            <input
              id="ca-name"
              name="full_name"
              type="text"
              required
              autoComplete="name"
              placeholder="John Carter"
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="ca-email">{tv("Email")}</label>
            <input
              id="ca-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
          </div>
          <div className="field">
            <label htmlFor="ca-phone">{tv("Phone")}</label>
            <input
              id="ca-phone"
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              inputMode="tel"
              placeholder="(___) ___-____"
            />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label htmlFor="ca-mc">
              {authority === "active" ? tv("MC #") : tv("MC # (optional)")}
            </label>
            <input
              id="ca-mc"
              name="mc_number"
              type="text"
              required={authority === "active"}
              placeholder="MC-000000"
            />
          </div>
          <div className="field">
            <label htmlFor="ca-dot">{tv("USDOT # (optional)")}</label>
            <input
              id="ca-dot"
              name="dot_number"
              type="text"
              placeholder="0000000"
            />
          </div>
          <div className="field">
            <label htmlFor="ca-state">{tv("Home State")}</label>
            <input
              id="ca-state"
              name="home_state"
              type="text"
              placeholder="NJ"
              autoComplete="address-level1"
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="ca-pass">{tv("Password (8+ characters)")}</label>
          <input
            id="ca-pass"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>
        {authority === "none" ? (
          <p
            className="mono"
            style={{
              fontSize: ".72rem",
              color: "var(--color-amber-aa)",
              margin: "0 0 16px",
            }}
          >
            {"// "}
            {tv(
              "No authority yet? You still get a full account — plus the launch checklist and a call from a dispatcher, typically the same day.",
            )}
          </p>
        ) : authority === "leased_on" ? (
          <p
            className="mono"
            style={{
              fontSize: ".72rem",
              color: "var(--color-amber-aa)",
              margin: "0 0 16px",
            }}
          >
            {"// "}
            {tv(
              "Leased-on setups are reviewed personally — a dispatcher confirms how your lease works before dispatch starts.",
            )}
          </p>
        ) : null}
        <TurnstileWidget theme="light" resetKey={turnstileAttempt} />
        <button
          className="btn btn-amber"
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
