"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit";
import { getSessionProfile } from "@/lib/auth";
import { field } from "@/lib/forms/guard";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole } from "@/lib/auth";
import { carrierReviewSchema } from "@/lib/validation/carrier-review";
import { firstIssueMessage } from "@/lib/validation/shared";
import type { FormState } from "@/lib/form-state";

/**
 * M-94 — resolving a MANUAL_REVIEW pre-registration.
 *
 * ── WHY A HUMAN DECISION EXISTS AT ALL ───────────────────────────────────
 *
 * MANUAL_REVIEW is not a rejection queue. It is where the engine puts every
 * case it refuses to decide alone: an FMCSA timeout, a docket endpoint that
 * was down, an authority token nobody has mapped, a legal name that differs by
 * more than punctuation, an applicant with no MC docket. Most of those are
 * legitimate carriers, and without a way for a person to clear them the gate
 * M-94 built would be a wall.
 *
 * ── THE FIVE RULES ───────────────────────────────────────────────────────
 *
 *   1. **Staff gate re-read from the session, every call.** A server action is
 *      a public HTTP endpoint; the page that rendered the form is not a
 *      control. The role comes from the cookie-bound client, never from the
 *      request body.
 *   2. **The write runs cookie-bound, not as the service role.** RLS then
 *      re-checks `is_staff()` at the database, so a hole in this function is
 *      not a hole in the system. The service role appears exactly once, inside
 *      `recordAuditEvent`, because `audit_events` grants INSERT to nobody.
 *   3. **Only a pre-registration that is actually in manual review, and
 *      actually unspent, can be resolved.** Both conditions live in the
 *      UPDATE's WHERE clause, so a stale form cannot re-decide an applicant
 *      who has already onboarded.
 *   4. **The note is mandatory.** See `validation/carrier-review.ts`.
 *   5. **Nothing here activates anything.** No `carriers` row is touched, no
 *      `active` is set, no payment is marked, and `verification_status` — the
 *      provider's own statement — is left exactly as FMCSA left it.
 *      `evaluateActivationEligibility()` is neither called nor bypassed; it
 *      still has to pass in full, later, on its own inputs.
 */

const NOT_STAFF = "Only dispatch staff can resolve a carrier review.";
const NOT_FOUND =
  "This application is no longer awaiting review — someone may have resolved it already.";
const FAILED = "Something went wrong saving the review. Nothing was changed.";

export async function reviewCarrierPreRegistration(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSessionProfile();
  if (!session || session.status === "suspended" || !isStaffRole(session.role)) {
    return { status: "error", message: NOT_STAFF };
  }

  const parsed = carrierReviewSchema.safeParse({
    pre_registration_id: field(formData, "pre_registration_id"),
    outcome: field(formData, "outcome"),
    note: field(formData, "note"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const { pre_registration_id, outcome, note } = parsed.data;

  const decision =
    outcome === "clear" ? "eligible_to_continue" : "not_eligible";
  // Appended to the engine's own codes rather than replacing them: the record
  // should still show WHY it came to a human, next to what the human did.
  const staffCode =
    outcome === "clear" ? "STAFF_REVIEW_CLEARED" : "STAFF_REVIEW_REFUSED";

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("carrier_pre_registrations")
    .select("id, decision, reason_codes, claimed_carrier_id")
    .eq("id", pre_registration_id)
    .maybeSingle();
  if (readError) {
    console.error("[carrier-review] read failed", readError.message);
    return { status: "error", message: FAILED };
  }
  if (
    !current ||
    current.decision !== "manual_review" ||
    current.claimed_carrier_id !== null
  ) {
    return { status: "error", message: NOT_FOUND };
  }

  const reasonCodes = current.reason_codes.includes(staffCode)
    ? current.reason_codes
    : [...current.reason_codes, staffCode];

  const { data: updated, error: updateError } = await supabase
    .from("carrier_pre_registrations")
    .update({
      decision,
      manual_review_required: false,
      reason_codes: reasonCodes,
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
      // NOT written, deliberately: verification_status, risk_tier,
      // payment_status, expires_at, claimed_carrier_id.
    })
    .eq("id", pre_registration_id)
    // Re-asserted in the statement itself. The read above is advisory; this is
    // what makes two dispatchers pressing the button at once safe.
    .eq("decision", "manual_review")
    .is("claimed_carrier_id", null)
    .select("id");
  if (updateError) {
    console.error("[carrier-review] update failed", updateError.message);
    return { status: "error", message: FAILED };
  }
  if ((updated?.length ?? 0) !== 1) {
    return { status: "error", message: NOT_FOUND };
  }

  await recordAuditEvent({
    actorId: session.userId,
    action: "pre_registration_staff_review",
    targetTable: "carrier_pre_registrations",
    targetId: pre_registration_id,
    // The DECISION, not the prose. The note is operational text a reviewer
    // typed and it lives in its own column; the ledger records that a reason
    // was given and how long it was, which is what an auditor needs to know
    // without copying free text into a second place.
    detail: { outcome, decision, note_length: note.length },
  });

  revalidatePath("/portal/admin/carrier-verifications");
  revalidatePath(`/portal/admin/carrier-verifications/${pre_registration_id}`);

  return {
    status: "success",
    message:
      outcome === "clear"
        ? "Cleared to continue. The applicant may now proceed to the verification fee — this is not activation."
        : "Marked not eligible. No account can be created from this application.",
  };
}
