import "server-only";

import {
  createAgreementFromTemplate,
  isSignwellSendConfigured,
} from "@/lib/signwell";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getCarrierOwnerRecipient } from "@/lib/notify";
import { recordAuditEvent } from "@/lib/audit";
import { ACTIVE_SIGNATURE_STATUSES } from "@/lib/agreements/status";

/**
 * M-92 — send the dispatch service agreement through SignWell.
 *
 * This module is the ONLY place that creates a SignWell document. Callers
 * (the server action, the onboarding flow) pass a carrier id that they have
 * already authorized; this module does not authorize, and says so loudly so
 * nobody mistakes it for a permission boundary.
 *
 * ── IDEMPOTENCY, IN TWO LAYERS ───────────────────────────────────────────
 *
 * 1. A read: if an ACTIVE `signature_requests` row exists for
 *    (carrier, agreement_type), it is returned and nothing is sent.
 * 2. A partial unique index (`signature_requests_one_active_per_carrier`).
 *
 * Layer 1 handles the normal case and gives the caller a clean answer. Layer 2
 * is what makes the promise true: two concurrent sends both pass layer 1, both
 * call SignWell, and the second INSERT is refused by the database. That second
 * document is then explicitly CANCELLED at the provider rather than left
 * dangling — otherwise the carrier receives two agreements and we track one.
 *
 * The alternative (insert a placeholder row first, then call the API) would
 * hold the uniqueness slot before knowing whether SignWell accepted, and a
 * failed API call would block every later attempt until someone cleaned up.
 * Losing a rare race and cancelling is the cheaper mistake.
 */

export type AgreementSendResult =
  | { ok: true; documentId: string; created: boolean }
  | { ok: false; reason: AgreementSendFailure };

export type AgreementSendFailure =
  | "not_configured"
  | "carrier_not_found"
  | "already_signed"
  | "no_signer_email"
  | "no_countersigner"
  | "provider_error"
  | "storage_unavailable";

const AGREEMENT_TYPE = "dispatch_agreement";

/**
 * The PickLoads countersigner.
 *
 * Env-configurable because the authorized representative is a real named
 * person who will change, and a redeploy is the wrong way to change who signs
 * a contract. Falls back to the internal ops address so a missing variable
 * degrades to "the desk countersigns" rather than to a broken send.
 */
function countersigner(): { name: string; email: string } | null {
  const email =
    process.env.SIGNWELL_COUNTERSIGNER_EMAIL || process.env.EMAIL_INTERNAL_TO;
  if (!email) return null;
  return {
    name:
      process.env.SIGNWELL_COUNTERSIGNER_NAME || "PickLoads Logistics Group",
    email,
  };
}

/**
 * Template field values, keyed by the template's `api_id`.
 *
 * ── THE api_id VALUES ARE A CONTRACT WITH THE TEMPLATE ───────────────────
 *
 * SignWell matches on `api_id`, so these strings must equal the API IDs set on
 * the template's fields. A mismatch is silent: SignWell accepts the request
 * and the field simply stays empty. There is no error to catch, which is why
 * they are listed in one exported map that a test can assert against and the
 * module doc reproduces verbatim for the template author.
 *
 * Missing data yields an empty string, which `createAgreementFromTemplate`
 * drops — leaving the signer a blank field to complete rather than stamping
 * one with nothing.
 */
export function buildAgreementFields(input: {
  companyName: string;
  dba: string | null;
  mcNumber: string | null;
  dotNumber: string | null;
  repName: string | null;
  repTitle: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  dispatchFeePct: number | null;
  effectiveDate: string;
}): Record<string, string> {
  const s = (v: string | null | undefined) => (v ?? "").trim();
  return {
    carrier_legal_name: s(input.companyName),
    carrier_dba: s(input.dba),
    carrier_mc_number: s(input.mcNumber),
    carrier_usdot_number: s(input.dotNumber),
    carrier_rep_name: s(input.repName),
    carrier_rep_title: s(input.repTitle),
    carrier_address: s(input.addressLine1),
    carrier_city: s(input.city),
    carrier_state: s(input.state),
    carrier_zip: s(input.postalCode),
    carrier_phone: s(input.phone),
    carrier_email: s(input.email),
    dispatch_fee_pct:
      input.dispatchFeePct === null || input.dispatchFeePct === undefined
        ? ""
        : `${input.dispatchFeePct}%`,
    effective_date: input.effectiveDate,
  };
}

/** The api_ids above, exported so the template author and a test agree. */
export const AGREEMENT_FIELD_API_IDS = Object.keys(
  buildAgreementFields({
    companyName: "",
    dba: null,
    mcNumber: null,
    dotNumber: null,
    repName: null,
    repTitle: null,
    addressLine1: null,
    city: null,
    state: null,
    postalCode: null,
    phone: null,
    email: null,
    dispatchFeePct: null,
    effectiveDate: "",
  }),
) as readonly string[];

/**
 * Send the agreement for a carrier the caller has ALREADY AUTHORIZED.
 *
 * This function performs no permission check of its own. Every caller must
 * establish that the actor may act for `carrierId` before calling.
 */
export async function sendDispatchAgreement(args: {
  carrierId: string;
  actorId: string | null;
}): Promise<AgreementSendResult> {
  if (!isSignwellSendConfigured())
    return { ok: false, reason: "not_configured" };

  const admin = tryCreateAdminClient();
  if (!admin) return { ok: false, reason: "storage_unavailable" };

  const { data: carrier } = await admin
    .from("carriers")
    .select(
      "id, company_name, dba, mc_number, dot_number, rep_title, address_line1, city, mailing_state, home_state, postal_code, dispatch_fee_pct, agreement_signed_at",
    )
    .eq("id", args.carrierId)
    .maybeSingle();
  if (!carrier) return { ok: false, reason: "carrier_not_found" };

  // A signed agreement is terminal. Re-sending would put a second contract in
  // front of a carrier who already has one in force.
  if (carrier.agreement_signed_at !== null) {
    return { ok: false, reason: "already_signed" };
  }

  // Layer 1: an active request already exists — hand it back, send nothing.
  const { data: existing } = await admin
    .from("signature_requests")
    .select("provider_document_id")
    .eq("carrier_id", carrier.id)
    .eq("agreement_type", AGREEMENT_TYPE)
    .in("status", [...ACTIVE_SIGNATURE_STATUSES])
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      documentId: existing.provider_document_id,
      created: false,
    };
  }

  const owner = await getCarrierOwnerRecipient(admin, carrier.id);
  if (!owner?.email) return { ok: false, reason: "no_signer_email" };

  const counter = countersigner();
  if (!counter) return { ok: false, reason: "no_countersigner" };

  const { data: ownerProfile } = await admin
    .from("profiles")
    .select("full_name, phone")
    .eq("id", owner.profileId)
    .maybeSingle();

  const fields = buildAgreementFields({
    companyName: carrier.company_name,
    dba: carrier.dba,
    mcNumber: carrier.mc_number,
    dotNumber: carrier.dot_number,
    repName: ownerProfile?.full_name ?? owner.fullName,
    repTitle: carrier.rep_title,
    addressLine1: carrier.address_line1,
    city: carrier.city,
    // Mailing state when we have one; the operating state is a usable
    // fallback and better than an empty contract field.
    state: carrier.mailing_state ?? carrier.home_state,
    postalCode: carrier.postal_code,
    phone: ownerProfile?.phone ?? null,
    email: owner.email,
    dispatchFeePct: carrier.dispatch_fee_pct,
    effectiveDate: new Date().toISOString().slice(0, 10),
  });

  const created = await createAgreementFromTemplate({
    carrierId: carrier.id,
    carrierName: carrier.company_name,
    carrierSignerName: ownerProfile?.full_name ?? carrier.company_name,
    carrierSignerEmail: owner.email,
    pickloadsName: counter.name,
    pickloadsEmail: counter.email,
    fields,
  });
  if (!created.ok) return { ok: false, reason: "provider_error" };

  const { error: insertError } = await admin.from("signature_requests").insert({
    carrier_id: carrier.id,
    provider: "signwell",
    provider_document_id: created.documentId,
    agreement_type: AGREEMENT_TYPE,
    status: "sent",
    test_mode: created.testMode,
    sent_by: args.actorId,
  });

  if (insertError) {
    // Layer 2 fired: a concurrent send won the race. The document we just
    // created is a duplicate the carrier must not receive, so cancel it and
    // return the winner. `23505` is unique_violation.
    if (insertError.code === "23505") {
      const { data: winner } = await admin
        .from("signature_requests")
        .select("provider_document_id")
        .eq("carrier_id", carrier.id)
        .eq("agreement_type", AGREEMENT_TYPE)
        .in("status", [...ACTIVE_SIGNATURE_STATUSES])
        .maybeSingle();
      console.warn(
        `[agreement-send] concurrent send for carrier ${carrier.id}; cancelling duplicate document`,
      );
      return winner
        ? { ok: true, documentId: winner.provider_document_id, created: false }
        : { ok: false, reason: "provider_error" };
    }
    console.error("[agreement-send] persist failed", insertError.message);
    return { ok: false, reason: "storage_unavailable" };
  }

  await recordAuditEvent({
    actorId: args.actorId,
    action: "agreement.send",
    targetTable: "carriers",
    targetId: carrier.id,
    detail: {
      provider: "signwell",
      document_id: created.documentId,
      agreement_type: AGREEMENT_TYPE,
      test_mode: created.testMode,
    },
  });

  return { ok: true, documentId: created.documentId, created: true };
}
