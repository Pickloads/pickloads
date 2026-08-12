"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { track, type AnalyticsEvent } from "@/lib/analytics";
import { initialFormState } from "@/lib/form-state";
import { submitContactMessage } from "@/app/actions/contact-message";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";

/*
 * Contact form (M-14 addition — audit F-08 required a functional contact
 * form; V4 sketched none, so this composes the existing .bigform vocabulary:
 * grid2 rows + .field + textarea, exactly the shipper-form pattern).
 */
/**
 * The ONE public contact form.
 *
 * Careers and Partners reuse it with a preset subject rather than shipping
 * their own. A second contact form would mean a second Zod schema, a second
 * rate limit, a second Turnstile call site and a second place for a lead to go
 * missing — for a field that differs by one string.
 */
export function ContactForm({
  defaultSubject,
  surface = "contact",
  startedEvent = "contact_started",
  submittedEvent = "contact_submitted",
  inquiryTypes,
  routeHints,
}: {
  /** Prefills the subject. The visitor can still edit it. */
  defaultSubject?: string;
  surface?: string;
  startedEvent?: AnalyticsEvent;
  submittedEvent?: AnalyticsEvent;
  /** When given, the subject becomes a constrained select of these types. */
  inquiryTypes?: readonly string[];
  /**
   * Inquiry type -> the funnel that actually handles it. Rendered as a hint,
   * NOT as a redirect: a visitor who wants to send a message may still send
   * one. It exists so a quote request is not captured as a contact message
   * that somebody then has to re-key into the quote flow — one submission,
   * one record, in the right system.
   */
  routeHints?: Readonly<Record<string, readonly [href: string, label: string]>>;
} = {}) {
  const tv = useV4();
  const locale = useLocale();
  const started = useRef(false);
  const [inquiry, setInquiry] = useState<string>(
    defaultSubject ?? inquiryTypes?.[0] ?? "",
  );
  const [state, formAction, pending] = useActionState(
    submitContactMessage,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") track(submittedEvent, { surface });
  }, [state, submittedEvent, surface]);

  const onFirstInput = () => {
    if (started.current) return;
    started.current = true;
    track(startedEvent, { surface });
  };

  return (
    <div className="bigform" id="message">
      <h2>{tv("Send us a message")}</h2>
      <p>
        {tv(
          "Prefer to write it out? We reply promptly — typically within the hour during business hours.",
        )}
      </p>
      <form action={formAction} onInput={onFirstInput}>
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
            {/* A SELECT rather than free text on the contact page, so an
                enquiry arrives already routed. Careers and Partners pass their
                own `defaultSubject` and keep a plain input: their subject is
                fixed, and a select of one option is a control that does
                nothing.

                The server schema is unchanged (optionalText(200)) — the select
                constrains the client, and constraining the server would reject
                the fixed subjects those two pages send. */}
            {inquiryTypes ? (
              <select
                id="ct-subject"
                name="subject"
                defaultValue={defaultSubject ?? inquiryTypes[0]}
                onChange={(e) => setInquiry(e.currentTarget.value)}
              >
                {inquiryTypes.map((type) => (
                  <option key={type} value={type}>
                    {tv(type)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="ct-subject"
                name="subject"
                type="text"
                defaultValue={defaultSubject}
                placeholder={tv("e.g. Dispatch for 2 dry vans")}
              />
            )}
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
        {routeHints?.[inquiry] ? (
          <p className="state state--empty" style={{ marginBottom: 14 }}>
            <Link href={routeHints[inquiry][0]}>
              {tv(routeHints[inquiry][1])}
            </Link>
          </p>
        ) : null}
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
          "✓ SENT — We'll reply at the email provided, typically within the hour during business hours. Urgent? Call (908) 404-5373.",
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
