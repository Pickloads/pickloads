"use client";

import { useActionState } from "react";

import { reviewCarrierPreRegistration } from "@/app/actions/carrier-review";
import { initialFormState } from "@/lib/form-state";

/**
 * M-94 — the staff decision on a manual-review pre-registration.
 * M-99 — laid out with the shared portal vocabulary.
 * M-100 — on the admin design system.
 *
 * Two outcomes and a mandatory note. There is no "approve carrier" control
 * here and there cannot be one: this form resolves whether an applicant may
 * CONTINUE — to the fee and the documents — and every activation requirement
 * is evaluated separately, afterwards, by `evaluateActivationEligibility()`.
 *
 * The submit buttons carry the outcome as their `value`, so the decision is a
 * deliberate press rather than a radio that can be left where the last
 * reviewer put it.
 *
 * ── LAYOUT (M-100 §13) ───────────────────────────────────────────────────
 *
 * The brief's objection was that the buttons looked like "random elements
 * placed after a textarea" — which they were: a flex row immediately below
 * the field, inside the same padding box, with nothing separating a
 * reversible edit from an irreversible decision.
 *
 * They are now an `ActionBar` — a footer with its own top border and raised
 * background, spanning the card. The field and its hint sit above it. Below
 * 520px the buttons go full width and stack, because a wrapped row of
 * half-width buttons reads as a broken grid.
 *
 * "Clear to continue" is the primary (amber); "Not eligible" is the dark
 * secondary — and both say what they do in words, so the distinction is never
 * carried by colour alone.
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
      <div className="a-card-body">
        <div className="form-ok show" role="status">
          {state.message}
        </div>
      </div>
    );
  }

  return (
    <form action={action}>
      <input
        type="hidden"
        name="pre_registration_id"
        value={preRegistrationId}
      />
      <div className="a-field">
        <label htmlFor="review-note">Reviewer note</label>
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
        <p id="review-note-hint" className="a-hint">
          <b>Required — this is the permanent record of the decision.</b> Name
          the source you checked: an FMCSA lookup by hand, a phone call, a
          document. &ldquo;Looks fine&rdquo; is not something anyone can act on
          six months from now.
        </p>
        <div
          className={`form-err${state.status === "error" ? " show" : ""}`}
          role="alert"
        >
          {state.status === "error" ? state.message : null}
        </div>
      </div>
      <div className="a-actions">
        <button
          className="btn btn-amber btn-sm"
          type="submit"
          name="outcome"
          value="clear"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? "Saving…" : "Clear to continue"}
        </button>
        <button
          className="btn btn-dark btn-sm"
          type="submit"
          name="outcome"
          value="refuse"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? "Saving…" : "Mark not eligible"}
        </button>
      </div>
    </form>
  );
}
