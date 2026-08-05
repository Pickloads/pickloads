"use client";

import { useActionState } from "react";
import { useV4 } from "@/i18n/v4";
import { initialFormState } from "@/lib/form-state";
import { unsubscribeNewsletter } from "@/app/actions/newsletter";

/**
 * M-69 / P-1 — the POST half of the unsubscribe flow.
 *
 * The page that renders this has already looked the token up READ-ONLY; the
 * removal happens only when a human presses this button, never on the GET
 * that mail scanners prefetch. Idempotent by construction: the action treats
 * "already unsubscribed" as success, so a second press shows the same
 * confirmation rather than an error.
 */
export function UnsubscribeForm({
  token,
  alreadyUnsubscribed,
}: {
  token: string;
  alreadyUnsubscribed: boolean;
}) {
  const tv = useV4();
  const [state, formAction, pending] = useActionState(
    unsubscribeNewsletter,
    initialFormState,
  );

  const done = state.status === "success" || alreadyUnsubscribed;

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      {done ? null : (
        <button className="btn btn-amber" type="submit" disabled={pending}>
          {pending
            ? tv("Removing you…")
            : tv("Yes, unsubscribe me")}
        </button>
      )}
      <div
        className={`form-ok ${done ? "show" : ""}`}
        role="status"
        aria-live="polite"
      >
        {tv(
          "✓ UNSUBSCRIBED — You're off the Freight Insights list. You may still receive account and load emails you asked for.",
        )}
      </div>
      <div
        className={`form-err ${state.status === "error" ? "show" : ""}`}
        role="alert"
      >
        {state.message ? tv(state.message) : null}
      </div>
    </form>
  );
}
