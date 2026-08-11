/**
 * M-77 — §16 shipment documents: **the visibility matrix**, as data.
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 records this as a RESTORED
 * requirement: *"§16 Document visibility MATRIX (which doc type → which
 * audience) + a broker value in `doc_visibility`"* — *"Enum defined, mapping
 * never stated; no broker value → §12 'BOL when authorized' unimplementable."*
 * M-70 shipped the vocabulary (`ShipmentDocumentType` ×11,
 * `ShipmentDocumentVisibility` ×5 including `broker`) and explicitly deferred
 * the mapping here. This file is the mapping.
 *
 * ── WHY A TABLE AND NOT CONDITIONALS ──────────────────────────────────────
 *
 * The plan asks for the matrix *"as data, not scattered conditionals"*. The
 * difference is not style. A conditional per surface means eleven document
 * types × five audiences × four surfaces = 220 independent chances to write
 * `>=` where `===` belonged, and no single place a reviewer can read to learn
 * who sees a rate confirmation. `DOCUMENT_AUDIENCES` below is a full
 * `Record<ShipmentDocumentType, …>`: adding a twelfth document type is a
 * **compile error** until somebody states its audience, and
 * `tests/unit/shipment-documents.test.ts` walks all 55 cells.
 *
 * The same matrix is seeded as ROWS in migration 0024
 * (`shipment_document_audiences`), because RLS cannot import TypeScript. The
 * two are pinned to each other by an integration test that reads the table
 * back and compares it cell for cell — a drift between the app's idea of who
 * may see a POD and the database's idea is the single most dangerous bug this
 * module could ship, so it is the one that has its own test.
 *
 * ── THE MATRIX ────────────────────────────────────────────────────────────
 *
 * §16 names three audiences and their documents verbatim:
 *
 *   Shipper-visible ... BOL · POD · shipper invoice · approved shipment paperwork
 *   Carrier-visible ... carrier rate confirmation · BOL · POD · approved operational documents
 *   Staff-only ....... internal notes · carrier compliance documents ·
 *                      internal pricing/margin data · private claim review
 *
 * §12 adds the fourth: a broker partner gets *"assigned shipments, status,
 * timeline, POD, BOL when authorized"* and must never see *"carrier's private
 * packet, carrier insurance records, shipper billing, PickLoads commission,
 * internal margin"*.
 *
 * §4 supplies the fifth by subtraction: the public tracking page must never
 * show *"carrier rate confirmations"*, *"insurance documents"*, *"shipper
 * billing details"* or *"internal notes"* — and §16 closes the question for
 * every other type with *"do not put shipment documents in public buckets."*
 * So **no document type is public**, and `public` appears in no cell below.
 * That is a decision, not an omission, and `NO_PUBLIC_DOCUMENTS` states it in
 * a form a test can read.
 *
 * ── THE JUDGMENT CALLS, ARGUED ────────────────────────────────────────────
 *
 * §16's lists are recommendations over eight named documents; the enum has
 * eleven. Three cells are therefore decisions rather than transcriptions:
 *
 *   * **`quote` and `shipper_confirmation` → shipper, not carrier.** They are
 *     the shipper's commercial correspondence and carry the price the shipper
 *     agreed. A carrier holding both the quote and their own rate
 *     confirmation has computed the margin, which §12 and §18 forbid
 *     disclosing. §16's carrier list names the *carrier* rate confirmation
 *     specifically, and this is why it is specific.
 *
 *   * **`invoice` → shipper only.** §16 says "shipper invoice"; §12 forbids
 *     brokers seeing "shipper billing"; a carrier invoice is a `carriers`
 *     concern under M-31's own tables, not a shipment document.
 *
 *   * **`claim` → staff only.** §16's staff list ends with "private claim
 *     review". A claim file mid-review contains the other party's account of
 *     events; releasing it before it is settled prejudices the settlement.
 *     Staff re-file the settled outcome as `other` when it is ready to share
 *     — which the matrix does license, so the workflow is possible without
 *     widening the claim band.
 *
 * `lumper_receipt`, `detention_documentation` and `delivery_receipt` are
 * §16's *"approved operational documents"* / *"approved shipment paperwork"*
 * and reach both commercial parties: they are the evidence behind an accessorial
 * charge, and a charge whose evidence one party cannot see is a dispute.
 *
 * ── `visibility` NARROWS, IT NEVER WIDENS ─────────────────────────────────
 *
 * A row's `visibility` column can restrict a document to `staff_only`
 * regardless of its type (a BOL held back pending a correction, say). It can
 * never grant an audience the matrix withholds — `LEGAL_ROW_VISIBILITIES`
 * below is what migration 0024's CHECK constraint is generated from, so
 * `rate_confirmation` with `visibility = 'shipper'` is refused by the
 * DATABASE and not merely by this module.
 *
 * ── UNAPPROVED DOCUMENTS ARE STAFF-ONLY ───────────────────────────────────
 *
 * §16's shipper and carrier lists both say "**approved**". A document sitting
 * at `pending` has not been checked; a `rejected` one has been checked and
 * failed. Neither reaches a customer. This is the same rule §20 relies on for
 * `pod_uploaded`, so there is exactly one definition of "approved" in the
 * module and both readers use it.
 *
 * Plain module by design (no `server-only`): the carrier and dispatcher
 * upload forms are client components and need the same doc-type lists the
 * server validates against. A second copy of them in client code is the drift
 * this file exists to prevent.
 */

import type {
  ShipmentDocumentType,
  ShipmentDocumentVisibility,
  DocStatus,
} from "@/lib/shipments/types";
import { SHIPMENT_DOCUMENT_TYPES } from "@/lib/shipments/types";

/* ------------------------------------------------------------------ *
 * Audiences
 * ------------------------------------------------------------------ */

/**
 * The four CUSTOMER-facing audiences. `staff_only` is not in this list
 * because it is not an audience the matrix decides about — staff read every
 * document on a shipment they operate, which is what "staff-only" means when
 * §16 uses it as a floor rather than a band.
 */
export type DocumentAudience = Exclude<ShipmentDocumentVisibility, "staff_only">;

export const DOCUMENT_AUDIENCES_ORDER = [
  "public",
  "shipper",
  "carrier",
  "broker",
] as const satisfies readonly DocumentAudience[];

/**
 * §4 + §16: no document type reaches the public tracking page, and no
 * document lives in a public bucket. Exported so the assertion can be tested
 * rather than trusted.
 */
export const NO_PUBLIC_DOCUMENTS = true as const;

/* ------------------------------------------------------------------ *
 * THE MATRIX
 * ------------------------------------------------------------------ */

/**
 * §16's document-type → audience mapping. Full `Record`: a new document type
 * does not compile until its audiences are stated.
 *
 * Read a row as: *"an APPROVED document of this type, whose row-level
 * `visibility` has not been narrowed, is readable by these audiences (plus
 * staff, always)."*
 */
export const DOCUMENT_AUDIENCES: Record<
  ShipmentDocumentType,
  readonly DocumentAudience[]
> = {
  // §16 "shipper-visible: approved shipment paperwork" — the shipper's own
  // commercial correspondence. Not the carrier's: quote + rate confirmation
  // together disclose the margin (§12, §18).
  quote: ["shipper"],
  shipper_confirmation: ["shipper"],
  // §16 "carrier-visible: carrier rate confirmation". §4 forbids it reaching
  // the public; §12 does not list it among a broker's permissions.
  rate_confirmation: ["carrier"],
  // §16 names BOL under BOTH lists; §12 grants it to a broker "when
  // authorized" — the authorization being the shipment↔broker_partner link
  // that RLS already requires. This cell is the reason `broker` exists in the
  // enum at all (plan §4).
  bol: ["shipper", "carrier", "broker"],
  // §16 "approved operational documents" / "approved shipment paperwork":
  // accessorial evidence both commercial parties are billed against.
  lumper_receipt: ["shipper", "carrier"],
  detention_documentation: ["shipper", "carrier"],
  delivery_receipt: ["shipper", "carrier"],
  // §16 names POD under both lists; §12 names it as a broker permission
  // outright, with no "when authorized" qualifier.
  pod: ["shipper", "carrier", "broker"],
  // §16 "shipper invoice". §12 forbids brokers seeing "shipper billing".
  invoice: ["shipper"],
  // §16 staff list: "private claim review".
  claim: [],
  // The escape hatch, and it is deliberately NOT a wildcard: staff choose the
  // audience per row within what this cell licenses. Internal notes, carrier
  // compliance documents and internal pricing all arrive as `other`, so the
  // DEFAULT for this type is `staff_only` (see `DEFAULT_DOCUMENT_VISIBILITY`)
  // and widening it is an explicit act.
  other: ["shipper", "carrier", "broker"],
};

/**
 * The `visibility` values migration 0024's CHECK accepts for each type: the
 * matrix row, plus `staff_only`, which is always legal because narrowing
 * always is.
 */
export function legalRowVisibilities(
  docType: ShipmentDocumentType,
): readonly ShipmentDocumentVisibility[] {
  return [...DOCUMENT_AUDIENCES[docType], "staff_only"];
}

/**
 * The default `visibility` a new upload is filed under: `staff_only` for
 * types with no customer audience AND for `other`, whose contents are unknown
 * until a human looks; otherwise the type's widest band, which is a label for
 * "the matrix decides", not a widening of it.
 *
 * `bol` and `pod` default to `shipper` rather than `broker` for the same
 * reason: the value is a floor, and the matrix — not this column — is what
 * grants the carrier and broker bands.
 */
export const DEFAULT_DOCUMENT_VISIBILITY: Record<
  ShipmentDocumentType,
  ShipmentDocumentVisibility
> = {
  quote: "shipper",
  shipper_confirmation: "shipper",
  rate_confirmation: "carrier",
  bol: "shipper",
  lumper_receipt: "shipper",
  detention_documentation: "shipper",
  delivery_receipt: "shipper",
  pod: "shipper",
  invoice: "shipper",
  claim: "staff_only",
  other: "staff_only",
};

/* ------------------------------------------------------------------ *
 * The one predicate every reader uses
 * ------------------------------------------------------------------ */

/**
 * Does a document row reach an audience?
 *
 * The SAME three-clause decision migration 0024's
 * `shipment_document_reaches_audience()` makes, in the same order, so the
 * app's answer and RLS's answer cannot disagree:
 *
 *   1. unapproved (`pending` / `rejected` / `expired`) → nobody but staff;
 *   2. `visibility = 'staff_only'` → nobody but staff;
 *   3. otherwise → the matrix row for the type.
 *
 * Note what is NOT here: no role hierarchy, no "shipper implies broker", no
 * fallthrough. The bands do not nest, exactly as M-70's event bands do not.
 */
export function documentReachesAudience(
  doc: {
    doc_type: ShipmentDocumentType;
    visibility: ShipmentDocumentVisibility;
    status: DocStatus;
  },
  audience: DocumentAudience,
): boolean {
  if (doc.status !== "approved") return false;
  if (doc.visibility === "staff_only") return false;
  return DOCUMENT_AUDIENCES[doc.doc_type].includes(audience);
}

/** Which document types an audience can ever see, approved and unnarrowed. */
export function documentTypesForAudience(
  audience: DocumentAudience,
): readonly ShipmentDocumentType[] {
  return SHIPMENT_DOCUMENT_TYPES.filter((t) =>
    DOCUMENT_AUDIENCES[t].includes(audience),
  );
}

/* ------------------------------------------------------------------ *
 * Who may UPLOAD what (§13, §14)
 * ------------------------------------------------------------------ */

/**
 * §13 gives a carrier and a driver exactly two upload actions — *"upload
 * BOL"* and *"upload POD"* — plus the accessorial evidence they are the only
 * party physically able to produce. A carrier cannot file a quote, an
 * invoice, a rate confirmation or a claim: those are ours to issue, and an
 * upload endpoint that accepted them would let a carrier plant a document the
 * shipper then reads as ours.
 */
export const CARRIER_UPLOADABLE_DOC_TYPES = [
  "bol",
  "pod",
  "lumper_receipt",
  "detention_documentation",
  "delivery_receipt",
] as const satisfies readonly ShipmentDocumentType[];

/**
 * §13's driver link is one shipment, one driver, a phone camera and no
 * account. It gets the two documents the directive names and nothing else —
 * the narrowest surface in the product should not also be the widest upload.
 */
export const DRIVER_UPLOADABLE_DOC_TYPES = [
  "bol",
  "pod",
] as const satisfies readonly ShipmentDocumentType[];

/** §14/§15: dispatchers and admins file any of the eleven types. */
export const STAFF_UPLOADABLE_DOC_TYPES = SHIPMENT_DOCUMENT_TYPES;

export type DocumentUploaderRole = "carrier" | "driver" | "staff";

export const UPLOADABLE_DOC_TYPES: Record<
  DocumentUploaderRole,
  readonly ShipmentDocumentType[]
> = {
  carrier: CARRIER_UPLOADABLE_DOC_TYPES,
  driver: DRIVER_UPLOADABLE_DOC_TYPES,
  staff: STAFF_UPLOADABLE_DOC_TYPES,
};

export function canUpload(
  role: DocumentUploaderRole,
  docType: ShipmentDocumentType,
): boolean {
  return UPLOADABLE_DOC_TYPES[role].includes(docType);
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

/**
 * A SECOND private bucket, not a namespace inside `carrier-docs`. Argued,
 * because the plan asked for the argument:
 *
 * `carrier-docs` is keyed by CARRIER: migration 0004's two customer policies
 * both read `(storage.foldername(name))[1]` and compare it to the caller's
 * `carriers.id`. Every object in that bucket therefore belongs to exactly one
 * carrier, and that is the whole authorization model.
 *
 * A shipment document has up to four legitimate readers — the shipper, the
 * carrier, a broker partner and staff — none of whom is "the folder owner",
 * and its readability depends on `doc_type`, `status` and `visibility`, which
 * are columns in a table the storage policy would have to join. Putting
 * shipment documents under `carrier-docs/shipments/…` would mean either
 * loosening 0004's carrier-prefix policies (which today are the only thing
 * standing between carrier A and carrier B's W-9) or leaving objects in a
 * bucket whose policies cannot express who may read them.
 *
 * A separate bucket keeps 0004 frozen and lets 0024 write policies in the
 * matrix's own terms. It also keeps the retention story separable: a carrier's
 * compliance packet and a shipment's paperwork have different lifetimes.
 *
 * The bucket is PRIVATE (§16: *"do not put shipment documents in public
 * buckets"*). Nothing in this repo may set `public: true` on it, and
 * `tests/unit/shipment-documents.test.ts` reads the migration to prove it.
 */
export const SHIPMENT_DOCS_BUCKET = "shipment-docs";

/**
 * Same 10 MB cap as `carrier-docs` (M-21/0004) and the same four types. A POD
 * is a phone photo or a scan; the cap is what the bucket enforces
 * independently, so raising it here alone would produce a confusing
 * server-side success followed by a storage rejection.
 *
 * DECLARED, not re-exported from `@/lib/uploads` — that module carries
 * `import "server-only"`, and this one is imported by the client components
 * that render the upload forms. Re-exporting a single number through it would
 * pull the whole server module into the browser bundle and fail the build,
 * which is exactly what it did the first time.
 *
 * `tests/unit/shipment-documents.test.ts` asserts this equals
 * `MAX_UPLOAD_BYTES`, so the two cannot drift.
 */
export const MAX_SHIPMENT_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Randomized object path: `{shipment_id}/{uuid}-{sanitized name}`.
 *
 * The shipment id prefixes it so an operator reading the bucket can tell what
 * a file belongs to, and the UUID is what makes the path unguessable — a
 * signed URL is minted against a path, and a path derived from
 * `{shipment}/pod.pdf` would be enumerable by anyone who has ever held a
 * signed URL for one shipment.
 *
 * `randomUUID` is passed in rather than imported so this module stays free of
 * `node:crypto` and can be imported by the client components that render the
 * upload forms.
 */
export function shipmentDocumentPath(
  shipmentId: string,
  sanitizedFileName: string,
  uuid: string,
): string {
  return `${shipmentId}/${uuid}-${sanitizedFileName}`;
}

/* ------------------------------------------------------------------ *
 * The audience-safe document DTO
 * ------------------------------------------------------------------ */

/**
 * What a CUSTOMER surface may render about a document. An allow-list built by
 * naming every field, the same construction M-70's shipment DTOs use and for
 * the same reason: a column added to `shipment_documents` later is invisible
 * until somebody decides otherwise.
 *
 * `storage_path` is absent at every customer audience. It is the argument a
 * signed URL is minted from; a page that had it in its payload would let a
 * reader ask for a URL to a path they were never shown. Customers name a
 * document by `id`, and the server resolves the path under RLS.
 *
 * `review_note` is absent too: a rejection reason is written by staff for
 * staff, and unapproved documents do not reach customers at all, so a
 * customer-visible note would have nothing to describe.
 */
export interface CustomerDocumentDto {
  id: string;
  doc_type: ShipmentDocumentType;
  /** i18n key — no English document label exists in this module (§24). */
  doc_type_key: string;
  file_name: string;
  size_bytes: number | null;
  uploaded_at: string;
  approved_at: string | null;
}

/** `shipment.document.<type>` — the §24 key builder for document labels. */
export function documentTypeKey(docType: ShipmentDocumentType): string {
  return `shipment.document.${docType}`;
}

/**
 * Serialize the documents an audience may see, dropping the rest. The filter
 * and the serializer are one function so a caller cannot do the second
 * without the first.
 */
export function toCustomerDocumentDtos(
  rows: readonly {
    id: string;
    doc_type: ShipmentDocumentType;
    visibility: ShipmentDocumentVisibility;
    status: DocStatus;
    file_name: string;
    size_bytes: number | null;
    uploaded_at: string;
    approved_at: string | null;
  }[],
  audience: DocumentAudience,
): CustomerDocumentDto[] {
  return rows
    .filter((row) => documentReachesAudience(row, audience))
    .map((row) => ({
      id: row.id,
      doc_type: row.doc_type,
      doc_type_key: documentTypeKey(row.doc_type),
      file_name: row.file_name,
      size_bytes: row.size_bytes,
      uploaded_at: row.uploaded_at,
      approved_at: row.approved_at,
    }));
}

/* ------------------------------------------------------------------ *
 * §25 — bounded reads
 * ------------------------------------------------------------------ */

/**
 * §25: *"do not load all events or documents by default when a shipment has a
 * large history."* Document lists are read newest-first with this cap and one
 * extra row to answer "is there more?" without a second count query — the
 * trick M-73 and M-74 already use on event timelines.
 */
export const DOCUMENT_PAGE_SIZE = 25;

/** Hard ceiling a caller-supplied limit is clamped to. */
export const DOCUMENT_MAX_PAGE_SIZE = 50;

export function resolveDocumentLimit(raw?: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return DOCUMENT_PAGE_SIZE;
  const n = Math.floor(raw);
  if (n < 1) return DOCUMENT_PAGE_SIZE;
  return Math.min(n, DOCUMENT_MAX_PAGE_SIZE);
}
