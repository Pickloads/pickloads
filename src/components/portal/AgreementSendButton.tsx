"use client";

import { useActionState } from "react";
import { useV4 } from "@/i18n/v4";
import { initialFormState } from "@/lib/form-state";
import { sendAgreementAction } from "@/app/actions/agreements";

/**
 * M-92 — request the dispatch agreement through SignWell.
 *
 * Rendered only when no signature request exists. There is no carrier id in
 * this form and there must never be one: `sendAgreementAction` resolves a
 * non-staff caller's carrier from their own membership rows, so the browser
 * has nothing to tamper with.
 *
 * Uses the existing `.btn` / `.form-ok` / `.form-err` vocabulary — no new
 * design.
 */
export function AgreementSendButton() {
  const tv = useV4();
  const [state, formAction, pending] = useActionState(
    sendAgreementAction,
    initialFormState,
  );

  return (
    <form action={formAction}>
      <button
        type="submit"
        className="btn btn-amber btn-sm"
        aria-busy={pending}
        disabled={pending || state.status === "success"}
      >
        {pending ? tv("Sending…") : tv("Send me the agreement")}
      </button>
      <div
        className={`form-ok${state.status === "success" ? " show" : ""}`}
        role="status"
      >
        {state.status === "success" && state.message ? tv(state.message) : null}
      </div>
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </form>
  );
}
