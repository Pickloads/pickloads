"use client";

import { useActionState } from "react";

import { reviewCarrierPreRegistration } from "@/app/actions/carrier-review";
import { initialFormState } from "@/lib/form-state";

/**
 * M-94 — the staff decision on a manual-review pre-registration.
 *
 * Two outcomes and a mandatory note. There is no "approve carrier" control
 * here and there cannot be one: this form resolves whether an applicant may
 * CONTINUE — to the fee and the documents — and every activation requirement
 * is evaluated separately, afterwards, by `evaluateActivationEligibility()`.
 *
 * The submit buttons carry the outcome as their `value`, so the decision is a
 * deliberate press rather than a radio that can be left where the last
 * reviewer put it.
 */
export function CarrierReviewForm({
  preRegistrationId,
}: {
  preRegistrationId: string;
}) {
  const [state, action, pending] = useActionState(
    reviewCarrierPreRegistration,
    initialFormState,
  );

  if (state.status === "success") {
    return (
      <div className="form-ok show" role="status">
        {state.message}
      </div>
    );
  }

  return (
    <form action={action} className="bigform" style={{ padding: 0 }}>
      <input
        type="hidden"
        name="pre_registration_id"
        value={preRegistrationId}
      />
      <div className="field">
        <label htmlFor="review-note">
          Reviewer note (required — this is the permanent record)
        </label>
        <textarea
          id="review-note"
          name="note"
          rows={4}
          required
          minLength={12}
          maxLength={1000}
          aria-describedby="review-note-hint"
          placeholder="What did you check, where, and what did you conclude?"
        />
        <p id="review-note-hint" className="field-hint">
          Name the source you checked — an FMCSA lookup by hand, a phone call,
          a document. &ldquo;Looks fine&rdquo; is not something anyone can act
          on six months from now.
        </p>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          className="btn btn-amber"
          type="submit"
          name="outcome"
          value="clear"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? "Saving…" : "Clear to continue"}
        </button>
        <button
          className="btn btn-dark"
          type="submit"
          name="outcome"
          value="refuse"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? "Saving…" : "Not eligible"}
        </button>
      </div>
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" ? state.message : null}
      </div>
    </form>
  );
}
