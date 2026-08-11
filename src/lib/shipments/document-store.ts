import "server-only";

import { randomUUID } from "node:crypto";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { logShipmentSignal } from "@/lib/shipments/observability";
import {
  MAX_UPLOAD_BYTES,
  SIGNED_URL_TTL_SECONDS,
  sanitizeFileName,
  sniffMime,
} from "@/lib/uploads";
import {
  DOCUMENT_PAGE_SIZE,
  SHIPMENT_DOCS_BUCKET,
  canUpload,
  documentReachesAudience,
  resolveDocumentLimit,
  shipmentDocumentPath,
  toCustomerDocumentDtos,
  type CustomerDocumentDto,
  type DocumentAudience,
  type DocumentUploaderRole,
} from "@/lib/shipments/documents";
import type {
  ShipmentDocumentRow,
  ShipmentDocumentType,
  ShipmentDocumentVisibility,
  ShipmentEventSource,
} from "@/lib/shipments/types";
import type { DocStatus } from "@/lib/supabase/database.types";

/**
 * M-77 — the server half of §16: storing, listing, reviewing and serving
 * shipment documents.
 *
 * ── THE UPLOAD PIPELINE, IN ORDER, AND WHY THAT ORDER ─────────────────────
 *
 *   1. size cap        — cheapest rejection; refuse before reading bytes into
 *                        memory a second time
 *   2. MAGIC BYTES     — `sniffMime` (M-21 / audit S-03). The extension and
 *                        the client-declared `Content-Type` are attacker
 *                        input and are never consulted. A `.pdf` that starts
 *                        `<?php` is rejected here, not by the bucket.
 *   3. doc-type gate   — `canUpload(role, type)`: §13 gives a carrier BOL/POD
 *                        (plus the accessorial evidence only they can
 *                        produce) and a driver exactly BOL/POD. A carrier
 *                        cannot file an "invoice" the shipper then reads as
 *                        ours.
 *   4. randomized path — `{shipment}/{uuid}-{sanitized}`. The UUID is what
 *                        makes the object unguessable to anyone who has held
 *                        a signed URL for a different document.
 *   5. storage upload  — `upsert: false`, so a path collision fails rather
 *                        than silently overwriting a filed document
 *   6. 0024's function — row + `document_uploaded` event, ONE transaction
 *
 * Steps 5 and 6 are the one place this module can leave a mess: an object
 * uploaded and a row that failed to insert. It is handled explicitly — the
 * object is removed and the failure reported — and the reverse order is not
 * an option, because a row pointing at an object that does not exist yet is a
 * download error rather than an orphan (§26 names document-download errors as
 * a tracked signal precisely so this is visible if it ever happens).
 *
 * ── DOWNLOADS: TTL, AUDIT, AND WHAT IS NEVER WRITTEN ──────────────────────
 *
 * §15 requires *"view document-access history"*. Every signed URL minted here
 * goes through `recordAuditEvent` with `action: "document.download"` — the
 * same action string, the same writer and the same shape `actions/admin.ts`
 * and `actions/carrier.ts` have used since M-61/M-69 P-5, so the admin
 * security log renders shipment documents beside carrier documents with no
 * special case and §15's history is ONE query rather than two.
 *
 * The URL ITSELF is never logged, never stored and never put in a signal —
 * it is a live bearer credential for up to `SIGNED_URL_TTL_SECONDS`. §26's
 * never-log list says so and `redactDetail` would drop it anyway, which is
 * belt and braces rather than the plan.
 *
 * TTL is `SIGNED_URL_TTL_SECONDS` (300), imported from `@/lib/uploads`. Not a
 * literal: `tests/unit/security.test.ts` scans call sites and fails on a
 * numeric argument, and M-77 extends that scan to this file.
 *
 * ── AUTHORIZATION IS RLS, NOT THIS FILE ───────────────────────────────────
 *
 * `listShipmentDocuments` and `getShipmentDocumentUrl` take the CALLER's
 * cookie-bound client. 0024's four policies decide what comes back; the
 * matrix filter here is the second opinion, not the first. That ordering
 * matters: a bug in `documentReachesAudience` cannot widen what the database
 * returns, it can only narrow it further.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * Explicit projection, no `select("*")`. `review_note`, `reviewed_by`,
 * `uploaded_by` and `storage_path` are named NOWHERE in the customer read, so
 * a shipper request never has them in memory — the discipline M-74's
 * `SHIPMENT_DETAIL_COLUMNS` established.
 */
export const CUSTOMER_DOCUMENT_COLUMNS =
  "id, doc_type, visibility, status, file_name, size_bytes, uploaded_at, approved_at";

/** Staff see the review trail too — that IS their job (§15). */
export const STAFF_DOCUMENT_COLUMNS = `${CUSTOMER_DOCUMENT_COLUMNS}, review_note, uploaded_by, reviewed_by, reviewed_at, mime_type`;

export type StaffDocumentRow = Pick<
  ShipmentDocumentRow,
  | "id"
  | "doc_type"
  | "visibility"
  | "status"
  | "file_name"
  | "size_bytes"
  | "uploaded_at"
  | "approved_at"
  | "review_note"
  | "uploaded_by"
  | "reviewed_by"
  | "reviewed_at"
  | "mime_type"
>;

export interface DocumentPage<T> {
  documents: T[];
  hasMore: boolean;
  failed: boolean;
}

/**
 * One shipment's documents for one CUSTOMER audience.
 *
 * §25: newest-first, capped, and ONE query — the `+1` row answers "is there
 * more?" without a second `count: exact`, which is the expensive part of a
 * table that grows per shipment. There is no per-document follow-up read of
 * any kind, so a shipment with forty documents costs exactly what a shipment
 * with one costs, plus rows.
 */
export async function listShipmentDocuments(
  supabase: ServerSupabase,
  shipmentId: string,
  audience: DocumentAudience,
  limit: number = DOCUMENT_PAGE_SIZE,
): Promise<DocumentPage<CustomerDocumentDto>> {
  const take = resolveDocumentLimit(limit);
  const { data, error } = await supabase
    .from("shipment_documents")
    .select(CUSTOMER_DOCUMENT_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("uploaded_at", { ascending: false })
    .limit(take + 1);

  if (error) {
    logShipmentSignal({
      signal: "document_download_error",
      code: error.code ?? "list_failed",
      shipmentId,
      detail: error.message,
    });
    return { documents: [], hasMore: false, failed: true };
  }

  const rows = data ?? [];
  const hasMore = rows.length > take;
  return {
    documents: toCustomerDocumentDtos(rows.slice(0, take), audience),
    hasMore,
    failed: false,
  };
}

/** The staff list: every document on the shipment, review trail included. */
export async function listShipmentDocumentsForStaff(
  supabase: ServerSupabase,
  shipmentId: string,
  limit: number = DOCUMENT_PAGE_SIZE,
): Promise<DocumentPage<StaffDocumentRow>> {
  const take = resolveDocumentLimit(limit);
  const { data, error } = await supabase
    .from("shipment_documents")
    .select(STAFF_DOCUMENT_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("uploaded_at", { ascending: false })
    .limit(take + 1);

  if (error) {
    logShipmentSignal({
      signal: "document_download_error",
      code: error.code ?? "list_failed",
      shipmentId,
      detail: error.message,
    });
    return { documents: [], hasMore: false, failed: true };
  }
  const rows = (data ?? []) as StaffDocumentRow[];
  return {
    documents: rows.slice(0, take),
    hasMore: rows.length > take,
    failed: false,
  };
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

export type DocumentUploadFailureCode =
  | "not_configured"
  | "file_missing"
  | "too_large"
  | "bad_type"
  | "type_not_allowed"
  | "shipment_not_found"
  | "storage_failed"
  | "write_failed";

export interface DocumentUploadFailure {
  ok: false;
  code: DocumentUploadFailureCode;
  message: string;
}

export interface DocumentUploadSuccess {
  ok: true;
  documentId: string;
  fileName: string;
  eventId: string;
  visibility: ShipmentDocumentVisibility;
  replayed: boolean;
}

export type DocumentUploadResult = DocumentUploadSuccess | DocumentUploadFailure;

/** Operator-readable, i18n-free (server codes; the surfaces translate). */
export const DOCUMENT_UPLOAD_ERRORS: Record<DocumentUploadFailureCode, string> = {
  not_configured:
    "SUPABASE_SERVICE_ROLE_KEY is unset — the document was NOT stored.",
  file_missing: "Choose a file to upload.",
  too_large: "File is larger than 10 MB. Photograph it again at lower quality.",
  bad_type: "Unsupported file type — upload a PDF, JPG, PNG or HEIC.",
  type_not_allowed: "You can't file that kind of document on this shipment.",
  shipment_not_found: "That shipment no longer exists.",
  storage_failed: "Couldn't store the file. Retry and check the connection.",
  write_failed: "Couldn't record the document. Retry and check the connection.",
};

export interface UploadShipmentDocumentInput {
  shipmentId: string;
  docType: ShipmentDocumentType;
  file: File;
  /** Decides the doc-type allow-list. Never taken from the request body. */
  uploaderRole: DocumentUploaderRole;
  actorId: string | null;
  source: ShipmentEventSource;
  /** Staff may narrow at upload time; customers never choose. */
  visibility?: ShipmentDocumentVisibility | null;
}

export async function uploadShipmentDocument(
  input: UploadShipmentDocumentInput,
): Promise<DocumentUploadResult> {
  const { file } = input;
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, code: "file_missing", message: DOCUMENT_UPLOAD_ERRORS.file_missing };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, code: "too_large", message: DOCUMENT_UPLOAD_ERRORS.too_large };
  }
  // §13's allow-list, checked BEFORE the bytes are read: a carrier trying to
  // file an invoice should not get to spend our memory on it.
  if (!canUpload(input.uploaderRole, input.docType)) {
    return {
      ok: false,
      code: "type_not_allowed",
      message: DOCUMENT_UPLOAD_ERRORS.type_not_allowed,
    };
  }

  // Audit S-03: magic bytes. Extension and client MIME are never trusted.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) {
    return { ok: false, code: "bad_type", message: DOCUMENT_UPLOAD_ERRORS.bad_type };
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message: DOCUMENT_UPLOAD_ERRORS.not_configured,
    };
  }

  const fileName = sanitizeFileName(file.name);
  const storagePath = shipmentDocumentPath(input.shipmentId, fileName, randomUUID());

  const { error: uploadError } = await admin.storage
    .from(SHIPMENT_DOCS_BUCKET)
    .upload(storagePath, Buffer.from(bytes), {
      contentType: mime,
      upsert: false, // a collision must fail, never overwrite a filed document
    });
  if (uploadError) {
    logShipmentSignal({
      signal: "document_download_error",
      code: "storage_upload_failed",
      shipmentId: input.shipmentId,
      actorId: input.actorId,
      actorRole: input.uploaderRole,
      detail: uploadError.message,
    });
    return {
      ok: false,
      code: "storage_failed",
      message: DOCUMENT_UPLOAD_ERRORS.storage_failed,
    };
  }

  const { data, error } = await admin.rpc("add_shipment_document", {
    p_shipment_id: input.shipmentId,
    p_doc_type: input.docType,
    p_storage_path: storagePath,
    p_file_name: fileName,
    p_mime_type: mime,
    p_size_bytes: file.size,
    p_actor: input.actorId,
    p_source: input.source,
    p_visibility: input.visibility ?? null,
    // The path is already unique per object, so it is the natural replay key:
    // a retried submission of the SAME upload cannot produce two rows.
    p_idempotency_key: `doc:${storagePath}`,
  });

  if (error) {
    // The object is already in the bucket. Remove it rather than leave a file
    // no row explains — the one window in this pipeline where a partial state
    // is possible, closed explicitly.
    await admin.storage.from(SHIPMENT_DOCS_BUCKET).remove([storagePath]);
    logShipmentSignal({
      signal: "document_download_error",
      code: error.code ?? "add_document_failed",
      shipmentId: input.shipmentId,
      actorId: input.actorId,
      actorRole: input.uploaderRole,
      detail: error.message,
    });
    return error.code === "PL404"
      ? {
          ok: false,
          code: "shipment_not_found",
          message: DOCUMENT_UPLOAD_ERRORS.shipment_not_found,
        }
      : { ok: false, code: "write_failed", message: DOCUMENT_UPLOAD_ERRORS.write_failed };
  }

  const envelope = (data ?? {}) as Record<string, unknown>;
  const success: DocumentUploadSuccess = {
    ok: true,
    documentId: String(envelope.document_id ?? ""),
    fileName,
    eventId: String(envelope.event_id ?? ""),
    visibility: (envelope.visibility as ShipmentDocumentVisibility) ?? "staff_only",
    replayed: envelope.replayed === true,
  };

  if (!success.replayed) {
    // §15's history covers writes as well as reads. NEVER the storage path:
    // an audit row is read by staff surfaces and the path is the argument a
    // signed URL is minted from.
    await recordAuditEvent({
      actorId: input.actorId,
      action: "shipment_document.upload",
      targetTable: "shipment_documents",
      targetId: success.documentId,
      detail: {
        shipment_id: input.shipmentId,
        doc_type: input.docType,
        uploader_role: input.uploaderRole,
        mime_type: mime,
        size_bytes: file.size,
        visibility: success.visibility,
      },
    });
  }
  return success;
}

/* ------------------------------------------------------------------ *
 * Review (§16 approval, §20 precondition)
 * ------------------------------------------------------------------ */

export type DocumentReviewFailureCode =
  | "not_configured"
  | "not_found"
  | "invalid_decision"
  | "write_failed";

export interface DocumentReviewResult {
  ok: boolean;
  code?: DocumentReviewFailureCode;
  message?: string;
  documentId?: string;
  shipmentId?: string;
  status?: DocStatus;
}

export interface ReviewShipmentDocumentInput {
  documentId: string;
  decision: Extract<DocStatus, "approved" | "rejected" | "expired">;
  actorId: string | null;
  actorRole: "admin" | "dispatcher";
  note?: string | null;
  publicMessage?: string | null;
}

/**
 * The staff approval step. Approving is what sets `approved_at`, which is
 * exactly what `shipment_transition_facts()` reads for `pod_uploaded` — so
 * this function IS §20's POD precondition, viewed from the operator's side.
 */
export async function reviewShipmentDocument(
  input: ReviewShipmentDocumentInput,
): Promise<DocumentReviewResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message: "SUPABASE_SERVICE_ROLE_KEY is unset — the review was NOT saved.",
    };
  }

  const { data, error } = await admin.rpc("review_shipment_document", {
    p_document_id: input.documentId,
    p_decision: input.decision,
    p_actor: input.actorId,
    p_note: input.note ?? null,
    p_source: input.actorRole === "admin" ? "admin" : "dispatcher",
    p_public_message: input.publicMessage ?? null,
  });

  if (error) {
    logShipmentSignal({
      signal: "document_download_error",
      code: error.code ?? "review_failed",
      actorId: input.actorId,
      actorRole: input.actorRole,
      detail: error.message,
    });
    if (error.code === "PL404") {
      return { ok: false, code: "not_found", message: "That document no longer exists." };
    }
    if (error.code === "PL422") {
      return {
        ok: false,
        code: "invalid_decision",
        message: error.message ?? "That review decision isn't valid.",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: "Couldn't save the review. Retry and check the connection.",
    };
  }

  const envelope = (data ?? {}) as Record<string, unknown>;
  const shipmentId =
    typeof envelope.shipment_id === "string" ? envelope.shipment_id : undefined;

  await recordAuditEvent({
    actorId: input.actorId,
    action: "shipment_document.review",
    targetTable: "shipment_documents",
    targetId: input.documentId,
    detail: {
      decision: input.decision,
      shipment_id: shipmentId ?? null,
      actor_role: input.actorRole,
      has_note: (input.note ?? "").trim() !== "",
    },
  });

  return {
    ok: true,
    documentId: input.documentId,
    ...(shipmentId ? { shipmentId } : {}),
    status: envelope.status as DocStatus,
  };
}

/* ------------------------------------------------------------------ *
 * Signed URLs (§15, §16, §26)
 * ------------------------------------------------------------------ */

export type DocumentUrlFailureCode =
  | "not_configured"
  | "not_found"
  | "not_visible"
  | "url_failed";

export type DocumentUrlResult =
  | { ok: true; url: string; fileName: string }
  | { ok: false; code: DocumentUrlFailureCode; message: string };

/**
 * Mint a ≤300s signed URL for one document, for one audience, and journal the
 * access.
 *
 * THREE gates, in this order:
 *   1. RLS — the row is read on the CALLER's client. A document they may not
 *      see comes back as `null`, indistinguishable from one that does not
 *      exist, so this is also the enumeration answer.
 *   2. the matrix, again — `documentReachesAudience` re-checks in TypeScript.
 *      It cannot widen gate 1; it can only catch a policy that was written
 *      too loosely. `audience === null` means staff, who skip it.
 *   3. the audit write — before the URL is returned, so a mint that is not
 *      recorded is a mint the caller never receives.
 *
 * The signed URL is minted with the SERVICE client because 0024 grants no
 * customer policy on `storage.objects` for this bucket at all (see the
 * migration's section 1): the row decides, and the object is served by us.
 */
export async function getShipmentDocumentUrl(
  supabase: ServerSupabase,
  documentId: string,
  audience: DocumentAudience | null,
  actorId: string | null,
): Promise<DocumentUrlResult> {
  const { data: doc, error } = await supabase
    .from("shipment_documents")
    .select("id, shipment_id, doc_type, visibility, status, storage_path, file_name")
    .eq("id", documentId)
    .maybeSingle();

  if (error || !doc) {
    logShipmentSignal({
      signal: "document_download_error",
      code: error?.code ?? "not_found",
      actorId,
      actorRole: audience ?? "staff",
      detail: error?.message ?? "document not readable by this caller",
    });
    return { ok: false, code: "not_found", message: "Document not found." };
  }

  if (audience !== null && !documentReachesAudience(doc, audience)) {
    logShipmentSignal({
      signal: "unauthorized_access_attempt",
      code: "document_audience_denied",
      shipmentId: doc.shipment_id,
      actorId,
      actorRole: audience,
      detail: `doc_type=${doc.doc_type} status=${doc.status}`,
    });
    return { ok: false, code: "not_found", message: "Document not found." };
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message: "Downloads are unavailable right now — call (908) 404-5373.",
    };
  }

  const { data: signed, error: urlError } = await admin.storage
    .from(SHIPMENT_DOCS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

  if (urlError || !signed) {
    // §26 names "document-download errors" as a tracked signal. This is it.
    logShipmentSignal({
      signal: "document_download_error",
      code: "sign_failed",
      shipmentId: doc.shipment_id,
      actorId,
      actorRole: audience ?? "staff",
      detail: urlError?.message ?? "signed url not returned",
    });
    return {
      ok: false,
      code: "url_failed",
      message: "Couldn't generate a download link.",
    };
  }

  // §15 document-access history. Same action string, writer and shape as the
  // carrier-document paths (M-61 / M-69 P-5), so the security log is ONE
  // query. NEVER `signed.signedUrl` — a live credential for up to 300s.
  await recordAuditEvent({
    actorId,
    action: "document.download",
    targetTable: "shipment_documents",
    targetId: doc.id,
    detail: {
      shipment_id: doc.shipment_id,
      doc_type: doc.doc_type,
      audience: audience ?? "staff",
      ttl_seconds: SIGNED_URL_TTL_SECONDS,
    },
  });

  return { ok: true, url: signed.signedUrl, fileName: doc.file_name };
}
