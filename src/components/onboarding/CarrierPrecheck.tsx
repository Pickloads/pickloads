"use client";

import { useActionState, useEffect, useRef } from "react";
import { useLocale } from "next-intl";

import { submitCarrierPrecheck } from "@/app/actions/carrier-precheck";
import { track } from "@/lib/analytics";
import {
  initialPrecheckState,
  type PrecheckState,
} from "@/lib/carrier-precheck-state";
import {
  TurnstileWidget,
  useTurnstileReset,
} from "@/components/forms/TurnstileWidget";
import { useV4 } from "@/i18n/v4";

/**
 * M-94 §2 — STEP 1: carrier verification.
 *
 * ── WHAT THIS COMPONENT KNOWS ────────────────────────────────────────────
 *
 * Which of four screens to render. That is all it is told, and it is all it
 * could usefully be told: the pre-registration id never reaches the browser
 * (it is set as an httpOnly cookie by the action), the reason codes are
 * staff-only, and the FMCSA record is not returned at all. §17's forged
 * booleans have no counterpart here to forge — there is no `verified` prop, no
 * `eligible` query parameter and no state field that would change what the
 * server does on the next step.
 *
 * ── WHY THE THREE OUTCOMES READ THE WAY THEY DO ──────────────────────────
 *
 * §6 forbids showing the rule that failed. A refused applicant who learns
 * which check they missed learns exactly what to change, so the copy names the
 * fact ("we could not verify this USDOT with FMCSA") and never the mechanism.
 * MANUAL_REVIEW is deliberately NOT phrased as a rejection: it is the outcome
 * an FMCSA timeout produces, and telling a carrier they failed because our
 * dependency was slow would be both false and insulting.
 */
export function CarrierPrecheck({
  onVerified,
  resumeOutcome,
}: {
  /** Called when the applicant chooses to continue past a verified check. */
  onVerified: () => void;
  /**
   * M-95. A server-resolved outcome for an applicant returning to a check
   * they already ran — the same two panels the live action renders, so the
   * copy has one home and cannot drift into two versions.
   */
  resumeOutcome?: "manual_review" | "not_eligible";
}) {
  const tv = useV4();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<PrecheckState, FormData>(
    submitCarrierPrecheck,
    initialPrecheckState,
  );
  const turnstileAttempt = useTurnstileReset(state);
  const started = useRef(false);

  useEffect(() => {
    // §22: outcome only. No MC, no USDOT, no legal name, no email — the
    // taxonomy has no parameter that could carry one.
    switch (state.status) {
      case "eligible":
        track("carrier_precheck_completed", { surface: "become-a-carrier" });
        break;
      case "manual_review":
        track("carrier_precheck_manual_review", {
          surface: "become-a-carrier",
        });
        break;
      case "not_eligible":
        track("carrier_precheck_not_eligible", { surface: "become-a-carrier" });
        break;
      default:
        break;
    }
  }, [state.status]);

  // WCAG 2.4.3 — an outcome that replaces the form must take focus, or a
  // screen-reader user is left on a submit button that no longer exists.
  const outcomeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (state.status === "idle" || state.status === "error") return;
    const heading = outcomeRef.current?.querySelector<HTMLElement>("h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: false });
  }, [state.status]);

  const onFirstInput = () => {
    if (started.current) return;
    started.current = true;
    track("carrier_precheck_started", { surface: "become-a-carrier" });
  };

  /* ---------------- Verified — continue to the M-95 fee ---------------- */
  if (state.status === "eligible") {
    return (
      <div className="bigform" ref={outcomeRef}>
        <h2>{tv("Carrier information verified.")}</h2>
        <div className="form-ok show" role="status">
          {tv(
            "Your USDOT and MC match an active carrier record at FMCSA. No account has been created yet.",
          )}
        </div>
        <button
          className="btn btn-amber"
          type="button"
          style={{ marginTop: 22 }}
          onClick={() => {
            track("carrier_precheck_continue", { surface: "become-a-carrier" });
            onVerified();
          }}
        >
          {tv("Continue to verification fee →")}
        </button>
      </div>
    );
  }

  /* ---------------- Manual review — not a rejection ---------------- */
  if (state.status === "manual_review" || resumeOutcome === "manual_review") {
    return (
      <div className="bigform" ref={outcomeRef}>
        <h2>
          {tv(
            "We need to review some of your carrier information before continuing.",
          )}
        </h2>
        <p>
          {tv(
            "This is not a decision about your application. A compliance specialist checks the record by hand and comes back to you — usually the same business day.",
          )}
        </p>
        <div style={{ marginTop: 22, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a className="btn btn-amber" href="tel:+19084045373">
            {tv("Call (908) 404-5373")}
          </a>
          <a className="btn btn-dark" href="mailto:support@pickloads.com">
            {tv("Email support@pickloads.com")}
          </a>
        </div>
      </div>
    );
  }

  /* ---------------- Not eligible — neutral, no internals ---------------- */
  if (state.status === "not_eligible" || resumeOutcome === "not_eligible") {
    return (
      <div className="bigform" ref={outcomeRef}>
        <h2>{tv("We couldn't verify this carrier with FMCSA.")}</h2>
        <p>
          {tv(
            "We couldn't verify this USDOT number with FMCSA. Please review the number or contact PickLoads for assistance.",
          )}
        </p>
        <div style={{ marginTop: 22, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a className="btn btn-amber" href="tel:+19084045373">
            {tv("Call (908) 404-5373")}
          </a>
        </div>
      </div>
    );
  }

  /* ---------------- The form ---------------- */
  return (
    <div className="bigform">
      <h2>{tv("Verify your carrier authority")}</h2>
      {/* "begins", not "starts": `slugifyV4` truncates at 56 characters, and
          the page metadata on /become-a-carrier already owns the slug that
          "Onboarding starts with an FMCSA check of your USDOT and…" produces.
          A collision there is silent — the second string would render the
          FIRST one's translation in every locale, forever, with no warning.

          The comment lives outside the `tv(` call on purpose: the coverage
          collector matches a quote immediately after `tv(`, so a comment
          inside the parentheses hides the string from the audit that exists
          to catch exactly this class of mistake. */}
      <p>
        {tv(
          "Onboarding begins with an FMCSA check of your USDOT and MC. It takes a few seconds, creates no account and costs nothing.",
        )}
      </p>
      <form action={formAction} onInput={onFirstInput}>
        <input type="hidden" name="locale" value={locale} />
        <div className="field">
          <label htmlFor="pc-legal-name">{tv("Legal Company Name")}</label>
          <input
            id="pc-legal-name"
            name="legal_name"
            type="text"
            required
            maxLength={120}
            autoComplete="organization"
            aria-describedby="pc-legal-name-hint"
            placeholder={tv("Your company LLC")}
          />
          <p id="pc-legal-name-hint" className="field-hint">
            {tv("As registered with FMCSA — punctuation and LLC/Inc are fine.")}
          </p>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="pc-usdot">{tv("USDOT Number")}</label>
            <input
              id="pc-usdot"
              name="usdot_number"
              type="text"
              required
              maxLength={20}
              // §24: a numeric keypad on a phone, without `type="number"` —
              // which brings spinners, silent locale parsing and a scroll
              // wheel that edits the value.
              inputMode="numeric"
              autoComplete="off"
              placeholder="0000000"
            />
          </div>
          <div className="field">
            <label htmlFor="pc-mc">{tv("MC Number (optional)")}</label>
            <input
              id="pc-mc"
              name="mc_number"
              type="text"
              maxLength={20}
              inputMode="numeric"
              autoComplete="off"
              aria-describedby="pc-mc-hint"
              placeholder="MC-000000"
            />
            <p id="pc-mc-hint" className="field-hint">
              {tv(
                "Leave blank if your operation has no MC docket — we'll review it by hand instead.",
              )}
            </p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pc-email">{tv("Email")}</label>
          <input
            id="pc-email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            aria-describedby="pc-email-hint"
            placeholder="you@company.com"
          />
          <p id="pc-email-hint" className="field-hint">
            {tv("Where we reach you if the record needs a human look.")}
          </p>
        </div>
        <TurnstileWidget theme="light" resetKey={turnstileAttempt} />
        <button
          className="btn btn-amber"
          type="submit"
          aria-busy={pending}
          disabled={pending}
          style={{ marginTop: 4 }}
        >
          {pending ? tv("Checking with FMCSA…") : tv("Verify with FMCSA →")}
        </button>
      </form>
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </div>
  );
}
