"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { field, guardPublicForm } from "@/lib/forms/guard";
import type { FormState } from "@/lib/form-state";
import { firstIssueMessage } from "@/lib/validation/shared";
import { createClient } from "@/lib/supabase/server";
import { getMyShipperId } from "@/lib/memberships";
import {
  getShipmentDocumentUrl,
  reviewShipmentDocument,
  uploadShipmentDocument,
} from "@/lib/shipments/document-store";
import { resolveCarrierShipmentAccess } from "@/lib/shipments/carrier-access";
import {
  resolveShipmentAccess,
  resolveStaffActor,
} from "@/lib/shipments/staff-access";
import {
  DRIVER_UPDATE_RATE_LIMIT,
  DRIVER_UPDATE_RATE_LIMIT_FORM,
  redeemDriverToken,
} from "@/lib/shipments/driver-access";
import {
  DRIVER_LINK_EXPIRED_KEY,
  DRIVER_RATE_LIMITED_KEY,
  DRIVER_UNAVAILABLE_KEY,
} from "@/lib/shipments/carrier-updates";
import { logShipmentSignal } from "@/lib/shipments/observability";
import type { DocumentAudience } from "@/lib/shipments/documents";
import {
  carrierDocumentUploadSchema,
  documentDownloadSchema,
  documentReviewSchema,
  driverDocumentUploadSchema,
  staffDocumentUploadSchema,
} from "@/lib/validation/shipment-documents";

/**
 * M-77 — the §16 document server actions.
 *
 * ── FOUR UPLOAD DOORS, FOUR DIFFERENT GATES, ONE PIPELINE ────────────────
 *
 * §13 lets a carrier and a driver file a BOL/POD; §14/§15 let staff file
 * anything. Those are four exported actions, not one action with a role
 * parameter, because the role is what decides the doc-type allow-list and a
 * role that arrives in the request body is not a role — it is a field.
 *
 * Each action resolves its own actor through the gate its module already
 * shipped (`resolveCarrierShipmentAccess`, `resolveShipmentAccess`,
 * `redeemDriverToken`, `getMyShipperId`), then hands a FIXED `uploaderRole`
 * to `uploadShipmentDocument`. There is no code path on which a caller
 * chooses their own allow-list.
 *
 * ── DOWNLOADS: ONE ACTION PER AUDIENCE, FOR THE SAME REASON ──────────────
 *
 * `getShipmentDocumentUrl` takes the audience as an argument, and the
 * audience is derived from the SESSION in each wrapper below — never from the
 * form. A single `download(documentId, audience)` exported to the browser
 * would let a shipper session ask for the `carrier` band, which the matrix
 * would then happily satisfy for a rate confirmation.
 *
 * ── §15 AND §26 ──────────────────────────────────────────────────────────
 *
 * Every mint is journalled by `document-store.ts` through the M-69 single
 * writer as `document.download` — the same action string the carrier-document
 * paths use, so §15's "document-access history" is one query over
 * `audit_events`. The signed URL itself is never logged, stored or returned to
 * anything but the caller. Failures raise §26's `document_download_error`.
 *
 * ── §31/§30 HONEST NOTE ──────────────────────────────────────────────────
 *
 * There is deliberately NO shipper or broker upload action. §16 does not give
 * either party an upload right, and inventing one would put documents on a
 * shipment that our own review queue never asked for.
 */

const SHIPPER_PATH = "/portal/shipper/shipments";
const CARRIER_PATH = "/portal/carrier/shipments";
const STAFF_PATH = "/portal/dispatcher/shipments";

function error(message: string): FormState {
  return { status: "error", message };
}

function ok(message: string): FormState {
  return { status: "success", message };
}

function refresh(base: string, shipmentId?: string): void {
  revalidatePath(base);
  if (shipmentId) revalidatePath(`${base}/${shipmentId}`);
}

/** The file input, read once and never trusted for its type or its name. */
function fileOf(formData: FormData): File | null {
  const value = formData.get("file");
  return value instanceof File && value.size > 0 ? value : null;
}

/* ================================================================== *
 * 1 · §13 — the carrier uploads a BOL or a POD
 * ================================================================== */

export async function carrierUploadDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // The M-76 gate: live session, carrier role, M-57 membership, and the
  // shipment re-read through the COOKIE-BOUND client so 0018's policy applies.
  const access = await resolveCarrierShipmentAccess(field(formData, "shipment_id"));
  if (!access.ok) return error(access.message);

  const parsed = carrierDocumentUploadSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    doc_type: field(formData, "doc_type"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const file = fileOf(formData);
  if (file === null) return error("Choose a file to upload.");

  const result = await uploadShipmentDocument({
    shipmentId: access.shipmentId,
    docType: parsed.data.doc_type,
    file,
    uploaderRole: "carrier",
    actorId: access.session.userId,
    source: "carrier",
  });
  if (!result.ok) return error(result.message);

  refresh(CARRIER_PATH, access.shipmentId);
  return ok(
    // §16: a filed document is not a visible document. Saying so here is what
    // stops a carrier chasing dispatch about a POD the shipper cannot see yet.
    "Uploaded. Dispatch reviews it before the customer can see it.",
  );
}

/* ================================================================== *
 * 2 · §13 — the driver link uploads a BOL or a POD
 * ================================================================== */

/**
 * Same order of operations as `driver-updates.ts`: public-form guard, token
 * shape, `redeemDriverToken` (0023's atomic ledger + expiry + revocation +
 * carrier check), then the body. Nothing about the shipment is known before
 * the redeem returns, so nothing about the shipment can leak to a guess.
 *
 * Returns message KEYS, not English — the driver page is a five-locale
 * surface (§24) and an English refusal there would be English in every locale.
 */
export async function driverUploadDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const guard = await guardPublicForm(
    DRIVER_UPDATE_RATE_LIMIT_FORM,
    formData,
    DRIVER_UPDATE_RATE_LIMIT,
  );
  if (!guard.ok) return error(DRIVER_RATE_LIMITED_KEY);

  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const userAgent = h.get("user-agent");

  const redeemed = await redeemDriverToken({
    token: field(formData, "token"),
    ip,
    userAgent,
  });
  if (!redeemed.ok) {
    return error(
      redeemed.code === "rate_limited"
        ? DRIVER_RATE_LIMITED_KEY
        : redeemed.code === "unavailable"
          ? DRIVER_UNAVAILABLE_KEY
          : DRIVER_LINK_EXPIRED_KEY,
    );
  }

  const parsed = driverDocumentUploadSchema.safeParse({
    token: field(formData, "token"),
    doc_type: field(formData, "doc_type"),
  });
  if (!parsed.success) return error("shipment.driver.doc_invalid");

  const file = fileOf(formData);
  if (file === null) return error("shipment.driver.doc_missing");

  const result = await uploadShipmentDocument({
    shipmentId: redeemed.shipment.shipment_id,
    docType: parsed.data.doc_type,
    file,
    uploaderRole: "driver",
    // A driver link has no account. `driverId` is the fleet record when the
    // link was issued against one, and null otherwise — never a profile id,
    // because there is no profile.
    actorId: null,
    source: "driver",
  });
  if (!result.ok) {
    logShipmentSignal({
      signal: "document_download_error",
      code: result.code,
      shipmentId: redeemed.shipment.shipment_id,
      actorRole: "driver",
      detail: result.message,
    });
    return error(
      result.code === "too_large" || result.code === "bad_type"
        ? `shipment.driver.doc_${result.code}`
        : "shipment.driver.doc_failed",
    );
  }
  return ok("shipment.driver.doc_sent");
}

/* ================================================================== *
 * 3 · §14/§15 — staff file any document type
 * ================================================================== */

export async function staffUploadDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await resolveShipmentAccess(field(formData, "shipment_id"));
  if (!access.ok) return error(access.message);

  const parsed = staffDocumentUploadSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    doc_type: field(formData, "doc_type"),
    staff_only: field(formData, "staff_only"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const file = fileOf(formData);
  if (file === null) return error("Choose a file to upload.");

  const result = await uploadShipmentDocument({
    shipmentId: access.shipmentId,
    docType: parsed.data.doc_type,
    file,
    uploaderRole: "staff",
    actorId: access.session.userId,
    source: access.actorRole === "admin" ? "admin" : "dispatcher",
    // Narrowing only. `null` means "let 0024 apply the matrix default".
    visibility: parsed.data.staff_only ? "staff_only" : null,
  });
  if (!result.ok) return error(result.message);

  refresh(STAFF_PATH, access.shipmentId);
  return ok("Filed. It stays staff-only until you approve it.");
}

/* ================================================================== *
 * 4 · §16 — the staff approval step (and §20's POD precondition)
 * ================================================================== */

/**
 * Approving a POD is what makes `pod_uploaded` reachable — 0024 sets
 * `approved_at`, `shipment_transition_facts()` reads it, and M-72's engine
 * refuses the transition without it. The chain is deliberately this long: a
 * status that asserts a delivery is proved should require a human to have
 * looked at the proof.
 */
export async function reviewDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // The document is scoped through its SHIPMENT: same staff gate, same
  // dispatcher-scope rule as every other §14 action.
  const access = await resolveShipmentAccess(field(formData, "shipment_id"));
  if (!access.ok) return error(access.message);

  const parsed = documentReviewSchema.safeParse({
    document_id: field(formData, "document_id"),
    decision: field(formData, "decision"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const result = await reviewShipmentDocument({
    documentId: parsed.data.document_id,
    decision: parsed.data.decision,
    actorId: access.session.userId,
    actorRole: access.actorRole,
    note: parsed.data.note,
  });
  if (!result.ok) return error(result.message ?? "Couldn't save the review.");

  // The shipper's copy of this shipment changes too — an approved BOL becomes
  // visible to them in the same write.
  refresh(STAFF_PATH, access.shipmentId);
  refresh(SHIPPER_PATH, access.shipmentId);
  refresh(CARRIER_PATH, access.shipmentId);
  return ok(
    parsed.data.decision === "approved"
      ? "Approved. The parties the §16 matrix allows can see it now."
      : "Rejected. The uploader is asked for a replacement; nothing customer-facing changed.",
  );
}

/* ================================================================== *
 * 5 · Downloads — one wrapper per audience (§15, §16)
 * ================================================================== */

type UrlResult = { ok: true; url: string } | { ok: false; error: string };

const NOT_FOUND = "Document not found.";

/**
 * The shared tail. `audience` is supplied by the wrapper from the SESSION,
 * never from the form, and `null` means staff.
 */
async function mint(
  documentId: unknown,
  audience: DocumentAudience | null,
  actorId: string | null,
): Promise<UrlResult> {
  const parsed = documentDownloadSchema.safeParse({ document_id: documentId });
  if (!parsed.success) return { ok: false, error: NOT_FOUND };

  const supabase = await createClient();
  const result = await getShipmentDocumentUrl(
    supabase,
    parsed.data.document_id,
    audience,
    actorId,
  );
  return result.ok
    ? { ok: true, url: result.url }
    : { ok: false, error: result.message };
}

export async function getShipperDocumentUrlAction(
  documentId: string,
): Promise<UrlResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expired — sign in again." };
  // Membership, not ownership (M-57). A shipper with no organization has no
  // documents to read, and says so as a 404 rather than as a 403.
  const shipperId = await getMyShipperId(supabase);
  if (shipperId === null) return { ok: false, error: NOT_FOUND };
  return mint(documentId, "shipper", user.id);
}

export async function getCarrierDocumentUrlAction(
  documentId: string,
): Promise<UrlResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expired — sign in again." };
  return mint(documentId, "carrier", user.id);
}

/**
 * §12's broker band, live. M-81 owns the broker SURFACE; this action exists
 * now because the matrix M-77 was scoped to deliver is only real if something
 * can exercise the band, and because RLS (0024's "broker member read shipment
 * documents") already decides it. When M-81 lands it calls this rather than
 * writing a fifth copy of the same three lines.
 */
export async function getBrokerDocumentUrlAction(
  documentId: string,
): Promise<UrlResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expired — sign in again." };
  return mint(documentId, "broker", user.id);
}

export async function getStaffDocumentUrlAction(
  documentId: string,
): Promise<UrlResult> {
  // `resolveStaffActor` rather than `requireStaff`: this is an action, not a
  // page, so a refusal must be a value the button can render, never a redirect.
  const actor = await resolveStaffActor();
  if (!actor.ok) return { ok: false, error: NOT_FOUND };
  // `null` audience = staff: 0024's `"staff manage shipment documents"` policy
  // is the whole gate, and the matrix does not apply to the people who run the
  // shipment.
  return mint(documentId, null, actor.session.userId);
}
