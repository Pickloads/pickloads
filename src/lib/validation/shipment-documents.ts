import { z } from "zod";
import { optionalText } from "./shared";
import { SHIPMENT_DOCUMENT_TYPES } from "@/lib/shipments/types";
import {
  CARRIER_UPLOADABLE_DOC_TYPES,
  DRIVER_UPLOADABLE_DOC_TYPES,
} from "@/lib/shipments/documents";

/**
 * M-77 — Zod schemas for the §16 document actions.
 *
 * Same discipline as M-75/M-76: every enum is `z.enum(SOME_CONST)` over an
 * array declared in `types.ts` or `documents.ts`, never a string literal typed
 * here. A second copy of a value list is a thing the first `alter type` leaves
 * silently wrong.
 *
 * ── THE DOC-TYPE ALLOW-LIST IS PER ROLE, AND IT IS IN THE SCHEMA ─────────
 *
 * §13 gives a carrier "upload BOL" and "upload POD"; §14 gives a dispatcher
 * every type. Those are DIFFERENT schemas rather than one schema plus a check,
 * because a shared schema means a carrier's request is parsed as valid before
 * anything rejects it, and "valid but refused" is one refactor away from
 * "valid". `document-store.ts` re-checks with `canUpload()` — two independent
 * constructions of the same rule, which is the pattern M-70's DTO tests
 * established.
 *
 * ── WHAT IS NOT A FIELD HERE ────────────────────────────────────────────
 *
 * `storage_path` — the server derives it (randomized, namespaced). A caller
 * that could name it could overwrite another shipment's document or point a
 * row at an object it does not own.
 * `status` / `approved_at` / `approved_by` — the review function sets them.
 * A carrier that could POST `status=approved` would satisfy §20's POD
 * precondition without a human ever looking at the file, which is the single
 * thing this module exists to prevent.
 * `visibility` — absent from the CARRIER and DRIVER schemas entirely; only
 * staff may narrow a band, and nobody may widen one (0024's trigger).
 */

const shipmentId = z.uuid("That shipment is not on your board.");
const documentId = z.uuid("That document no longer exists.");

/** 43 base64url characters — `randomBytes(32).toString("base64url")` (M-76). */
const driverToken = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, "This link is no longer valid.");

/** §13's carrier upload: BOL, POD and the accessorial evidence only they hold. */
export const carrierDocumentUploadSchema = z.object({
  shipment_id: shipmentId,
  doc_type: z.enum(CARRIER_UPLOADABLE_DOC_TYPES, {
    message: "You can't file that kind of document on this shipment.",
  }),
});

/** §13's driver link: exactly the two documents the directive names. */
export const driverDocumentUploadSchema = z.object({
  token: driverToken,
  doc_type: z.enum(DRIVER_UPLOADABLE_DOC_TYPES, {
    message: "You can only send a BOL or a POD from this link.",
  }),
});

/** §14/§15: staff file any of the eleven types. */
export const staffDocumentUploadSchema = z.object({
  shipment_id: shipmentId,
  doc_type: z.enum(SHIPMENT_DOCUMENT_TYPES, {
    message: "Choose a document type.",
  }),
  /**
   * Staff may hold a document back to `staff_only` at upload time. It is a
   * checkbox, not a band picker: widening is the matrix's decision and 0024's
   * trigger refuses any other value for the type anyway.
   */
  staff_only: z
    .union([z.literal("on"), z.literal("true"), z.literal("")])
    .nullish()
    .transform((v) => v === "on" || v === "true"),
});

/** §16's approval step. `expired` is in the enum but not offered on the form. */
export const documentReviewSchema = z.object({
  document_id: documentId,
  decision: z.enum(["approved", "rejected"], {
    message: "Choose approve or reject.",
  }),
  /** Staff-to-staff, and staff-to-uploader. Never rendered to a customer. */
  note: optionalText(500),
});

/** A download request. One id, nothing else — the server resolves the rest. */
export const documentDownloadSchema = z.object({
  document_id: documentId,
});
