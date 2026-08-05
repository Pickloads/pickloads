"use server";

import type { FormState } from "@/lib/form-state";
import { field } from "@/lib/forms/guard";
import { submitContactMessage } from "@/app/actions/contact-message";
import { normalizeTrackingNumber } from "@/lib/shipments/tracking-number";

/**
 * M-73 — §8's public "support-message button" on the tracking page.
 *
 * ── NO PARALLEL WRITE PATH ────────────────────────────────────────────────
 *
 * The executive directive forbids duplicate APIs, and
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §5 (regression risk **R-1**) records
 * why the obvious destination is unavailable: `support_threads.profile_id` is
 * `NOT NULL references profiles(id)` in shipped migration 0007, so a GUEST
 * ticket cannot exist, and the plan's decision **D-5** assigns the guest-ticket
 * table to M-89 — explicitly NOT to this module. Altering 0007 here was
 * ruled out by the task and would be wrong anyway: 0007's RLS assumes a
 * profile on every row.
 *
 * So this action writes NOTHING itself. It delegates to
 * `submitContactMessage` — the shipped `contact_messages` path — which already
 * carries the entire guard stack this button needs: rate limit, Turnstile,
 * Zod bounds (5 000-character body, 200-character subject), the service-role
 * insert and the internal notification email. One code path, one set of
 * guarantees, one place to fix a bug.
 *
 * ── WHY THE SUBJECT IS BUILT SERVER-SIDE ──────────────────────────────────
 *
 * The shipment reference is what makes the message answerable, and it is
 * composed HERE from the normalised tracking number rather than accepted from
 * a hidden field. A client-supplied subject would let a submitter forge
 * "Shipment PL-2026-000101" on a message about a different shipment, which is
 * a small social-engineering lever pointed at a dispatcher's inbox.
 *
 * The value is normalised, capped and prefixed; it is a LABEL on a support
 * message, not an authorization — nothing in this path reads a shipment, and
 * an unknown or wrong number produces a support message about an unknown
 * number, which a human resolves in one reply.
 *
 * ── WHAT IS DELIBERATELY NOT SENT ─────────────────────────────────────────
 *
 * No DTO, no status, no timeline, no addresses. A support message carries the
 * customer's own words and the reference they are asking about. Echoing
 * shipment data back into an email that leaves the platform would widen §4's
 * exposure surface for no operational gain — the dispatcher opens the
 * shipment.
 */

/** Bound on the reference embedded in the subject line. */
const MAX_REFERENCE = 32;

export async function submitTrackingSupportMessage(
  prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // `normalizeTrackingNumber` returns null for anything that is not a
  // well-formed PickLoads number, so a forged or garbled value degrades to the
  // generic subject rather than being echoed into a dispatcher's inbox.
  const reference = (
    normalizeTrackingNumber(field(formData, "tracking_number")) ?? ""
  ).slice(0, MAX_REFERENCE);

  formData.set(
    "subject",
    reference === ""
      ? "Tracking support request"
      : `Tracking support — ${reference}`,
  );

  return submitContactMessage(prev, formData);
}
