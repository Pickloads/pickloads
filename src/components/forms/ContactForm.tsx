"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import { useV4 } from "@/i18n/v4";
import { initialFormState } from "@/lib/form-state";
import { submitContactMessage } from "@/app/actions/contact-message";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";

/*
 * Contact form (M-14 addition — audit F-08 required a functional contact
 * form; V4 sketched none, so this composes the existing .bigform vocabulary:
 * grid2 rows + .field + textarea, exactly the shipper-form pattern).
 */
export function ContactForm() {
  const tv = useV4();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    submitContactMessage,
    initialFormState,
  );
  return (
    <div className="bigform" id="message">
      <h2>{tv("Send us a message")}</h2>
      <p>
        {tv(
          "Prefer to write it out? We reply within one business day — usually much faster.",
        )}
      </p>
      <form action={formAction}>
        <input type="hidden" name="locale" value={locale} />
        <div className="grid2">
          <div className="field">
            <label htmlFor="ct-name">{tv("Your Name")}</label>
            <input
              id="ct-name"
              name="full_name"
              type="text"
              placeholder={tv("First and last name")}
              autoComplete="name"
            />
          </div>
          <div className="field">
            <label htmlFor="ct-email">{tv("Email")}</label>
            <input
              id="ct-email"
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              required
              aria-describedby="ct-err"
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="ct-phone">{tv("Phone (optional)")}</label>
            <input
              id="ct-phone"
              name="phone"
              type="tel"
              placeholder="(___) ___-____"
              inputMode="tel"
              autoComplete="tel"
            />
          </div>
          <div className="field">
            <label htmlFor="ct-subject">{tv("Subject")}</label>
            <input
              id="ct-subject"
              name="subject"
              type="text"
              placeholder={tv("e.g. Dispatch for 2 dry vans")}
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="ct-message">{tv("Message")}</label>
          <textarea
            id="ct-message"
            name="message"
            rows={6}
            placeholder={tv("How can we help?")}
            required
            aria-describedby="ct-err"
          />
        </div>
        <TurnstileWidget theme="light" />
        <button
          className="btn btn-amber"
          type="submit"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? tv("Sending…") : tv("Send Message →")}
        </button>
      </form>
      <div
        className={`form-ok${state.status === "success" ? " show" : ""}`}
        role="status"
      >
        {tv(
          "✓ SENT — We'll reply within one business day at the email provided. Urgent? Call (908) 404-5373.",
        )}
      </div>
      <div
        id="ct-err"
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </div>
  );
}
