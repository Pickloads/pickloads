import "server-only";

import { readFeePaymentState } from "./onboarding-fee";
import { readPrecheckCookie } from "./precheck-session";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

/**
 * M-95 — where an applicant actually stands, decided on the server.
 *
 * ── WHY THIS HAD TO EXIST BEFORE STRIPE COULD ────────────────────────────
 *
 * The wizard was a client-side step machine: reload the page and you were back
 * at step 1. That was survivable while every step was on one page. It stops
 * being survivable the moment the applicant LEAVES the site to pay — Stripe
 * redirects them back to a fresh page load, and a fresh page load restarted
 * the whole thing, which for a carrier who had just been charged $9.99 would
 * have looked exactly like losing their money.
 *
 * So the step is now a server-side conclusion drawn from the httpOnly cookie
 * plus the database, on every request. That is also what makes the payment
 * gate honest end to end: the browser is TOLD which step it is on, and the
 * server has already made up its mind independently. A client that lies to
 * itself about the step reaches a server action that disagrees.
 *
 * ── THE ONLY INPUT IS A COOKIE, AND IT IS NOT TRUSTED EITHER ─────────────
 *
 * The cookie names a row. Everything else — is it eligible, is it expired, is
 * it spent, is the fee paid — is read from that row and from the payments
 * ledger. Forging the cookie gets you somebody else's opaque id, which is
 * refused for exactly the same reasons it would be at any other gate.
 */

export type WizardResume =
  /** No pre-check, or nothing usable. Start at the beginning. */
  | { step: "precheck" }
  /** Verified, fee outstanding. */
  | { step: "fee" }
  /** Verified AND paid — the company-details step. */
  | { step: "company" }
  | { step: "manual_review" }
  | { step: "not_eligible" }
  /** The pre-registration has been spent on a carrier account already. */
  | { step: "already_onboarded" };

export async function resolveWizardResume(): Promise<WizardResume> {
  const id = await readPrecheckCookie();
  if (!id) return { step: "precheck" };

  const admin = tryCreateAdminClient();
  // Without the service role nothing can be verified, so nothing is resumed.
  // The applicant starts over rather than being shown a state we cannot back.
  if (!admin) return { step: "precheck" };

  const { data, error } = await admin
    .from("carrier_pre_registrations")
    .select("id, decision, expires_at, claimed_carrier_id")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { step: "precheck" };
  if (data.claimed_carrier_id !== null) return { step: "already_onboarded" };
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    return { step: "precheck" };
  }

  switch (data.decision) {
    case "not_eligible":
      return { step: "not_eligible" };
    case "eligible_to_continue": {
      const fee = await readFeePaymentState(admin, data.id);
      return fee.paid ? { step: "company" } : { step: "fee" };
    }
    case "manual_review":
    default:
      // `null` lands here too: a check that never completed is not a verdict,
      // and manual review is where M-94 puts everything it cannot decide.
      return { step: "manual_review" };
  }
}
