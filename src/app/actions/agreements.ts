"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isStaffRole } from "@/lib/auth";
import { getMyCarrierId } from "@/lib/memberships";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendDispatchAgreement } from "@/lib/agreements/send";
import type { FormState } from "@/lib/form-state";

/**
 * M-92 — the send action for the dispatch service agreement.
 *
 * ── AUTHORIZATION: THE CARRIER ID IS NEVER TAKEN FROM THE CLIENT ─────────
 *
 * A carrier member cannot name a carrier at all. Their id is resolved from
 * their own membership rows server-side, so "Carrier A sends for Carrier B"
 * is not a request this action can express — there is no parameter to put
 * B in.
 *
 * Staff MAY name a carrier, because a dispatcher legitimately sends an
 * agreement on a carrier's behalf. That path is gated on a server-read role
 * from `profiles`, never on anything the caller supplied.
 *
 * This is deliberately stricter than filtering a supplied id: an id you never
 * accept cannot be forged, mistyped, or missed by a later refactor of the
 * filter.
 *
 * ── SAFE ERRORS ──────────────────────────────────────────────────────────
 *
 * Every failure maps to a fixed sentence. The provider's reason string is
 * logged, never returned: "create_http_422" tells a carrier nothing and tells
 * an attacker something.
 */

const MESSAGES = {
  signed_out: "Your session expired — sign in again.",
  not_linked:
    "Your account isn't linked to a carrier record yet — call (908) 404-5373.",
  rate_limited:
    "We already have that in hand — give it a few minutes, then check your inbox.",
  already_signed: "Your agreement is already signed — nothing to send.",
  unavailable:
    "E-signing isn't available right now. Call (908) 404-5373 and the dispatch desk will help.",
  sent: "Sent — check your email for the signature request.",
  existing: "Already sent — check your inbox (and spam) for the request.",
} as const;

/** Staff may name a carrier. Nobody else may. */
const staffTargetSchema = z.object({ carrierId: z.uuid() });

export async function sendAgreementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const profile = await getSessionProfile();
  if (!profile) return { status: "error", message: MESSAGES.signed_out };

  const staff = isStaffRole(profile.role);

  let carrierId: string | null;
  if (staff) {
    // The ONLY branch that reads a carrier id from input, and it is reachable
    // only after a server-side role read.
    const parsed = staffTargetSchema.safeParse({
      carrierId: formData.get("carrier_id"),
    });
    if (!parsed.success) {
      return { status: "error", message: MESSAGES.not_linked };
    }
    carrierId = parsed.data.carrierId;
  } else {
    // Note the absence of a formData read here. That absence is the control.
    carrierId = await getMyCarrierId(supabase);
  }
  if (!carrierId) return { status: "error", message: MESSAGES.not_linked };

  // Per-actor, not per-IP: this is an authenticated action and an office of
  // dispatchers behind one NAT should not throttle each other.
  if (!(await checkRateLimit("agreement-send", profile.userId, 3))) {
    return { status: "error", message: MESSAGES.rate_limited };
  }

  const result = await sendDispatchAgreement({
    carrierId,
    actorId: profile.userId,
  });

  if (!result.ok) {
    if (result.reason === "already_signed") {
      return { status: "error", message: MESSAGES.already_signed };
    }
    console.error(`[agreement-send] refused: ${result.reason}`);
    return { status: "error", message: MESSAGES.unavailable };
  }

  return {
    status: "success",
    message: result.created ? MESSAGES.sent : MESSAGES.existing,
  };
}
