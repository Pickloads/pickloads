"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { initialFormState } from "@/lib/form-state";
import { submitTrackingSupportMessage } from "@/app/actions/tracking-support";
import {
  TurnstileWidget,
  useTurnstileReset,
} from "@/components/forms/TurnstileWidget";

/**
 * M-73 — §8's "support-message button" on the public tracking page.
 *
 * ── THE ABUSE PLAN `FINAL-IMPLEMENTATION-PLAN` §4 ASKED FOR ───────────────
 *
 * This is an unauthenticated write reachable by anyone on the internet, so it
 * gets the same three defences every other public write in this repo has, and
 * it gets them by REUSING them rather than re-implementing them:
 *
 *   * Turnstile — the widget below injects `cf-turnstile-response`, and
 *     `submitContactMessage` verifies it server-side.
 *   * Rate limit — the shared `contact-message` bucket, 5 per IP per 10
 *     minutes. Sharing the bucket with the contact form is deliberate: a
 *     sender's budget for unsolicited messages should be per PERSON, not per
 *     form, or adding a form multiplies the budget.
 *   * Bounded write — `contactMessageSchema` caps the body at 5 000
 *     characters and the subject at 200, and the row lands in
 *     `contact_messages`, an insert-only table with no public read surface.
 *
 * ── WHY `contact_messages` AND NOT A SUPPORT THREAD ───────────────────────
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §5 regression risk **R-1**:
 * `support_threads.profile_id` is `NOT NULL references profiles(id)` in
 * shipped migration 0007, so a guest ticket cannot exist. Decision **D-5**
 * assigns guest tickets to M-89 with their own table; altering 0007 was ruled
 * out. Until then a guest message is a contact message with a shipment
 * reference in its subject, which is a real inbox a human answers — not a
 * parallel API and not a promise of a ticket history the product does not yet
 * have.
 *
 * ── DISCLOSURE, NOT MODAL ─────────────────────────────────────────────────
 *
 * `<details>`: keyboard-reachable with no JavaScript, no focus trap to get
 * wrong, and structurally incapable of violating §22's "no mobile modal
 * exceeding screen". The `role="status"` / `role="alert"` pair matches the
 * ContactForm exactly.
 */
export function TrackingSupportForm({
  trackingNumber,
}: {
  trackingNumber: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    submitTrackingSupportMessage,
    initialFormState,
  );
  // SEC-P1-01: a spent Turnstile token is re-sent on the next submit unless
  // the widget remounts. Counting settled submissions is what remounts it.
  const turnstileAttempt = useTurnstileReset(state);

  return (
    <details className="track-support">
      <summary>{t("shipment.support.button")}</summary>
      <div className="track-support-body">
        <p className="sub" style={{ maxWidth: "none" }}>
          {t("shipment.support.intro")}
        </p>
        <form action={formAction}>
          <input type="hidden" name="locale" value={locale} />
          {/*
            The reference the dispatcher needs. The SUBJECT is composed
            server-side from this value (see `tracking-support.ts`) so a
            submitter cannot forge a different shipment's reference onto a
            message.
          */}
          <input type="hidden" name="tracking_number" value={trackingNumber} />
          <div className="grid2">
            <div className="field">
              <label htmlFor="ts-name">{t("shipment.support.name")}</label>
              <input
                id="ts-name"
                name="full_name"
                type="text"
                autoComplete="name"
              />
            </div>
            <div className="field">
              <label htmlFor="ts-email">{t("shipment.support.email")}</label>
              <input
                id="ts-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                aria-describedby="ts-err"
              />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="ts-message">{t("shipment.support.message")}</label>
            <textarea
              id="ts-message"
              name="message"
              rows={5}
              placeholder={t("shipment.support.message_placeholder")}
              required
              aria-describedby="ts-err"
            />
          </div>
          <TurnstileWidget theme="light" resetKey={turnstileAttempt} />
          <button
            className="btn btn-amber"
            type="submit"
            aria-busy={pending}
            disabled={pending}
          >
            {pending
              ? t("shipment.support.sending")
              : t("shipment.support.send")}
          </button>
        </form>
        <div
          className={`form-ok${state.status === "success" ? " show" : ""}`}
          role="status"
        >
          {t("shipment.support.sent")}
        </div>
        <div
          id="ts-err"
          className={`form-err${state.status === "error" ? " show" : ""}`}
          role="alert"
        >
          {state.status === "error" && state.message ? state.message : null}
        </div>
      </div>
    </details>
  );
}
