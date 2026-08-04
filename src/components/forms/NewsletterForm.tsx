"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useV4 } from "@/i18n/v4";
import { initialFormState } from "@/lib/form-state";
import { subscribeNewsletter } from "@/app/actions/newsletter";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";

/*
 * Newsletter signup (double opt-in per audit S-05). M-14: wired to
 * subscribeNewsletter; /api/newsletter/confirm redirects back here with
 * ?newsletter=confirmed|invalid, which this component surfaces.
 * NOTE: uses useSearchParams — render inside <Suspense> (blog page does).
 */
export function NewsletterForm() {
  const tv = useV4();
  const locale = useLocale();
  const confirmResult = useSearchParams().get("newsletter");
  const [state, formAction, pending] = useActionState(
    subscribeNewsletter,
    initialFormState,
  );

  const showOk = state.status === "success" || confirmResult === "confirmed";
  const showErr =
    state.status === "error" ||
    (confirmResult === "invalid" && state.status === "idle");
  const okMessage =
    confirmResult === "confirmed" && state.status !== "success"
      ? tv("✓ SUBSCRIBED — You're on the list. See you in your inbox.")
      : tv(
          "✓ CHECK YOUR INBOX — Confirm your email to finish subscribing. Market updates and dispatch tips, twice a month. No spam.",
        );
  const errMessage =
    state.status === "error" && state.message
      ? tv(state.message)
      : tv(
          "That confirmation link is invalid or expired. Enter your email below to get a fresh one.",
        );

  return (
    <form className="newsletter" action={formAction}>
      <input type="hidden" name="locale" value={locale} />
      <h3>{tv("Get Freight Insights in your inbox")}</h3>
      <div className="field">
        <label htmlFor="nl-email">{tv("Email address")}</label>
        <input
          id="nl-email"
          name="email"
          type="email"
          placeholder="you@yourcompany.com"
          autoComplete="email"
          required
          aria-describedby="nl-err"
        />
      </div>
      <TurnstileWidget theme="dark" />
      <button
        className="btn btn-amber"
        type="submit"
        aria-busy={pending}
        disabled={pending}
      >
        {pending ? tv("Sending…") : tv("Subscribe")}
      </button>
      <div
        className={`form-ok${showOk ? " show" : ""}`}
        style={{ flexBasis: "100%" }}
        role="status"
      >
        {okMessage}
      </div>
      <div
        id="nl-err"
        className={`form-err${showErr ? " show" : ""}`}
        style={{ flexBasis: "100%" }}
        role="alert"
      >
        {errMessage}
      </div>
    </form>
  );
}
