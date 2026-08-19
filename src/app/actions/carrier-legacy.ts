"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit";
import { getSessionProfile, isStaffRole } from "@/lib/auth";
import {
  claimPreRegistration,
  runCarrierPrecheck,
} from "@/lib/carrier-authority/pre-registration";
import { field } from "@/lib/forms/guard";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { legacyAdoptionSchema } from "@/lib/validation/carrier-review";
import { firstIssueMessage } from "@/lib/validation/shared";
import type { FormState } from "@/lib/form-state";

/**
 * M-94 — bringing a PRE-M-94 carrier application through the gate.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────
 *
 * `completeOnboarding` now requires the `carriers` row to have a
 * pre-registration bound to it. Rows created by the old flow have none, so
 * without this action a legitimate carrier who started onboarding the day
 * before M-94 shipped could never finish — locked out by a rule that did not
 * exist when they applied.
 *
 * The blast radius is exactly that set and no wider: a carrier who already has
 * an account (`profile_id` is not null) is refused by `completeOnboarding`
 * BEFORE the pre-registration check, with "sign in instead", and nothing else
 * in the product reads a pre-registration. Their portal, documents, loads and
 * agreements are untouched.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 *
 * It is not a grandfather clause, an exemption flag, or a bypass. There is no
 * parameter here that skips a check. A legacy applicant is put THROUGH the
 * same FMCSA pre-check as a new one, decided by the same risk engine, and
 * bound only if the engine — or a recorded human review of a MANUAL_REVIEW
 * outcome — cleared them. The one thing staff supply that an applicant would
 * have typed is the contact email, because the old `carriers` table has no
 * column for it.
 *
 * ── WHY IT IS SAFE TO PRESS TWICE ────────────────────────────────────────
 *
 * The common case is: run it, the engine says MANUAL_REVIEW (an FMCSA timeout,
 * a name that differs by more than punctuation), the application lands in the
 * review queue, a dispatcher clears it there — and then somebody presses this
 * button again. The second press must not create a second application. So it
 * looks for an existing adoption for this USDOT first and BINDS it if it is
 * now eligible, and refuses to create a duplicate while one is still awaiting
 * review.
 *
 * The lookup is keyed on the USDOT **and** the `LEGACY_ADOPTION` marker code,
 * so it can never bind a pre-registration a member of the public created for
 * themselves and is still waiting to use.
 */

const LEGACY_CODE = "LEGACY_ADOPTION";

const NOT_STAFF = "Only dispatch staff can run a legacy verification.";
const NO_ENV =
  "Service credentials aren't configured in this environment — nothing was changed.";
const NOT_ELIGIBLE_CARRIER =
  "This carrier already has an account or is already bound to a verification. Nothing was changed.";
const FAILED = "Something went wrong. Nothing was changed.";

export async function adoptLegacyCarrier(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSessionProfile();
  if (!session || session.status === "suspended" || !isStaffRole(session.role)) {
    return { status: "error", message: NOT_STAFF };
  }

  const parsed = legacyAdoptionSchema.safeParse({
    carrier_id: field(formData, "carrier_id"),
    email: field(formData, "email"),
    usdot_number: field(formData, "usdot_number"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const { carrier_id, email, usdot_number } = parsed.data;

  const admin = tryCreateAdminClient();
  if (!admin) return { status: "error", message: NO_ENV };

  // Cookie-bound read: RLS re-checks `is_staff()` at the database.
  const supabase = await createClient();
  const { data: carrier, error: carrierError } = await supabase
    .from("carriers")
    .select("id, company_name, mc_number, dot_number, profile_id")
    .eq("id", carrier_id)
    .maybeSingle();
  if (carrierError) {
    console.error("[legacy-adopt] carrier read failed", carrierError.message);
    return { status: "error", message: FAILED };
  }
  // An account already exists → nothing to adopt. `completeOnboarding` refuses
  // that row for a different, older reason and always did.
  if (!carrier || carrier.profile_id !== null) {
    return { status: "error", message: NOT_ELIGIBLE_CARRIER };
  }

  const { data: alreadyBound } = await supabase
    .from("carrier_pre_registrations")
    .select("id")
    .eq("claimed_carrier_id", carrier_id)
    .maybeSingle();
  if (alreadyBound) {
    return { status: "error", message: NOT_ELIGIBLE_CARRIER };
  }

  // The USDOT staff typed wins over the one on the legacy row: the old wizard
  // made USDOT optional, so a great many of these rows simply do not have one.
  const usdot = usdot_number ?? carrier.dot_number;
  if (!usdot) {
    return {
      status: "error",
      message:
        "This application has no USDOT on file. Ask the carrier for it and enter it above — it cannot be verified without one.",
    };
  }

  /* ── Second press: bind an adoption that has since been cleared ───────── */

  const { data: existing } = await supabase
    .from("carrier_pre_registrations")
    .select("id, decision, expires_at, reason_codes")
    .eq("usdot_number_entered", usdot)
    .is("claimed_carrier_id", null)
    .contains("reason_codes", [LEGACY_CODE])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    if (existing.decision === "eligible_to_continue") {
      return finishBind(admin, {
        preRegistrationId: existing.id,
        carrierId: carrier_id,
        actorId: session.userId,
        usdot,
        created: false,
      });
    }
    if (existing.decision === "manual_review") {
      return {
        status: "error",
        message:
          "A verification for this USDOT is already awaiting review. Resolve it in the queue, then run this again to bind it.",
      };
    }
    return {
      status: "error",
      message:
        "This USDOT was already checked and found not eligible. It cannot be bound to a carrier account.",
    };
  }

  /* ── First press: run the REAL pre-check ──────────────────────────────── */

  const outcome = await runCarrierPrecheck({
    // The legacy row's own identity, not something staff retyped — except the
    // USDOT above, which the old schema may never have collected.
    legalName: carrier.company_name,
    usdotNumber: usdot,
    mcNumber: carrier.mc_number,
    email,
    locale: "en",
  });

  // Mark it, so a later press can find THIS application and never a member of
  // the public's. Done after the run because the orchestrator owns the codes.
  const { data: marked } = await admin
    .from("carrier_pre_registrations")
    .select("id, reason_codes")
    .eq("usdot_number_entered", usdot)
    .is("claimed_carrier_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (marked && !marked.reason_codes.includes(LEGACY_CODE)) {
    await admin
      .from("carrier_pre_registrations")
      .update({ reason_codes: [...marked.reason_codes, LEGACY_CODE] })
      .eq("id", marked.id);
  }

  await recordAuditEvent({
    actorId: session.userId,
    action: "legacy_carrier_verification_run",
    targetTable: "carriers",
    targetId: carrier_id,
    detail: { decision: outcome.decision, bound: false },
  });

  if (outcome.decision !== "eligible_to_continue" || !outcome.preRegistrationId) {
    revalidatePath("/portal/admin/carrier-verifications");
    return {
      status: "error",
      message:
        outcome.decision === "not_eligible"
          ? "FMCSA could not verify this carrier. Nothing was bound — the application is recorded in the queue."
          : "The check could not be completed automatically. It is now in the review queue; resolve it there, then run this again to bind it.",
    };
  }

  return finishBind(admin, {
    preRegistrationId: outcome.preRegistrationId,
    carrierId: carrier_id,
    actorId: session.userId,
    usdot,
    created: true,
  });
}

/**
 * Bind, then align the carrier row's identity with what was verified.
 *
 * The second half matters as much as the first. If a legacy row said "Acme
 * Trucking" with no USDOT and the verified application says "ACME TRUCKING
 * LLC" against USDOT 76830, leaving the old values in place would keep an
 * unverified identity on the record the rest of the product reads — the same
 * reason `startOnboarding` takes its identity from the pre-registration
 * rather than from the form.
 */
async function finishBind(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  input: {
    preRegistrationId: string;
    carrierId: string;
    actorId: string;
    usdot: string;
    created: boolean;
  },
): Promise<FormState> {
  const claimed = await claimPreRegistration(
    admin,
    input.preRegistrationId,
    input.carrierId,
  );
  if (!claimed) {
    return {
      status: "error",
      message:
        "That verification was spent or expired before it could be bound. Run the check again.",
    };
  }

  const { data: pre } = await admin
    .from("carrier_pre_registrations")
    .select("legal_name_entered, usdot_number_entered, mc_number_entered")
    .eq("id", input.preRegistrationId)
    .maybeSingle();
  if (pre) {
    await admin
      .from("carriers")
      .update({
        company_name: pre.legal_name_entered,
        dot_number: pre.usdot_number_entered,
        mc_number: pre.mc_number_entered,
        // NOT written, and there is no code path in M-94 that writes it:
        // `active`. Binding a verification is not activation.
      })
      .eq("id", input.carrierId);
  }

  await recordAuditEvent({
    actorId: input.actorId,
    action: "legacy_carrier_verification_bound",
    targetTable: "carriers",
    targetId: input.carrierId,
    detail: {
      pre_registration_id: input.preRegistrationId,
      created_in_this_call: input.created,
    },
  });

  revalidatePath("/portal/admin/carrier-verifications");
  return {
    status: "success",
    message:
      "Verified and bound. This application can now create its portal account — it is not activated, and every activation requirement still applies.",
  };
}
