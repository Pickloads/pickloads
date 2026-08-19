"use client";

import { useActionState } from "react";

import { reviewCarrierPreRegistration } from "@/app/actions/carrier-review";
import { initialFormState } from "@/lib/form-state";

/**
 * M-94 — the staff decision on a manual-review pre-registration.
 * M-99 — laid out with the shared portal vocabulary.
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
 * ── LAYOUT NOTES (M-99) ──────────────────────────────────────────────────
 *
 * The permanent-record warning used to sit hard against the textarea's border
 * — a `<p>` with no margin under an unstyled control. It is now `.phelp`
 * below a portal-styled textarea, wired to the field with `aria-describedby`
 * so it is announced as the field's description rather than as loose text.
 *
 * The two buttons are a `.pactions` row: one gap rule, and below 480px they
 * go full width and stack, because a wrapped row of half-width buttons reads
 * as a broken grid. "Clear to continue" is the primary (amber); "Not eligible"
 * is the dark secondary — and the two say what they do in words, so the
 * distinction is never carried by colour alone.
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
    <form action={action} className="preview-form">
      <input
        type="hidden"
        name="pre_registration_id"
        value={preRegistrationId}
      />
      <div className="field">
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
      </div>
      <p id="review-note-hint" className="phelp">
        <b>Required — this is the permanent record of the decision.</b> Name the
        source you checked: an FMCSA lookup by hand, a phone call, a document.
        &ldquo;Looks fine&rdquo; is not something anyone can act on six months
        from now.
      </p>
      <div className="pactions">
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
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" ? state.message : null}
      </div>
    </form>
  );
}
