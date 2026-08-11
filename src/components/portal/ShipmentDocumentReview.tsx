"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { initialFormState, type FormState } from "@/lib/form-state";
import { STAFF_UPLOADABLE_DOC_TYPES } from "@/lib/shipments/documents";
import type {
  ShipmentDocumentType,
  ShipmentDocumentVisibility,
} from "@/lib/shipments/types";
import type { DocStatus } from "@/lib/supabase/database.types";

/**
 * M-77 — §16's DISPATCHER document surface: file anything, review everything.
 *
 * ── WHY THIS IS A SEPARATE FILE FROM `ShipmentDocuments.tsx` ─────────────
 *
 * The customer components call `useTranslations()` — `/track`, the shipper
 * portal, the carrier portal and the driver link are five-locale surfaces
 * (§24). Every M-75 staff component is plain English and calls no translation
 * hook, because the operator portal is one language. Keeping the two in one
 * file is how a `t()` ends up in a component rendered without a provider, and
 * a component that throws in a test harness is a component that throws in an
 * error boundary.
 *
 * So: same visual vocabulary (`.pcard`, `.ptable--cards`, `.pform-row`), same
 * a11y rules, different language policy — stated rather than discovered.
 *
 * ── WHAT A DISPATCHER CAN DO HERE THAT NOBODY ELSE CAN ──────────────────
 *
 *   * file ANY of the eleven §16 types (§14/§15). A carrier gets five, a
 *     driver two, a shipper and a broker none;
 *   * hold a document back to staff-only whatever its type licenses — the
 *     `visibility` column NARROWS and never widens (0024's trigger);
 *   * **approve or reject**, which is the §16 step everything else waits on.
 *     Approving a POD is precisely what makes §20's `pod_uploaded` reachable:
 *     0024 sets `approved_at`, `shipment_transition_facts()` reads it, M-72's
 *     engine refuses the transition without it. The blurb says so, because a
 *     dispatcher who does not know that will open a ticket about a transition
 *     the engine is correctly refusing.
 *
 * ── §22/§23 ─────────────────────────────────────────────────────────────
 *
 * A real `<table>` with a `<caption>` and `scope="col"` headers, `data-th` on
 * every body cell so `.ptable--cards` stacks correctly at 320px. Status is
 * TEXT, never colour. Every control has a `<label for>`. Results are
 * `role="alert"` / `role="status"`. Nothing is hover-only.
 */

const TYPE_LABEL: Record<ShipmentDocumentType, string> = {
  quote: "Quote",
  shipper_confirmation: "Shipper confirmation",
  rate_confirmation: "Carrier rate confirmation",
  bol: "Bill of Lading",
  lumper_receipt: "Lumper receipt",
  detention_documentation: "Detention documentation",
  delivery_receipt: "Delivery receipt",
  pod: "Proof of Delivery",
  invoice: "Invoice",
  claim: "Claim document",
  other: "Other document",
};

const STATUS_LABEL: Record<DocStatus, string> = {
  pending: "In review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

/** The §16 band a row is filed under — the FLOOR, not the audience list. */
const BAND_LABEL: Record<ShipmentDocumentVisibility, string> = {
  public: "Public",
  shipper: "Shipper",
  carrier: "Carrier",
  broker: "Broker partner",
  staff_only: "Staff only",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function when(value: string | null): string {
  if (value === null) return "—";
  return value.replace("T", " ").replace(/\.\d+Z$/, "Z").slice(0, 16);
}

export type DocumentUrlAction = (
  documentId: string,
) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;

export interface StaffDocumentView {
  id: string;
  doc_type: ShipmentDocumentType;
  visibility: ShipmentDocumentVisibility;
  status: DocStatus;
  file_name: string;
  size_bytes: number | null;
  uploaded_at: string;
  approved_at: string | null;
  review_note: string | null;
}

/**
 * The download control. A signed URL lives ≤300 seconds and is a bearer
 * credential for that window: it goes straight into `window.open` and is never
 * written to state, never put in an `href` and never rendered — so it cannot
 * survive in the DOM, in a devtools snapshot or in a screen share.
 */
function DownloadButton({
  documentId,
  action,
}: {
  documentId: string;
  action: DocumentUrlAction;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-busy={pending}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await action(documentId);
            if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
            else setError(result.error);
          })
        }
      >
        {pending ? "…" : "Download"}
      </button>
      {error ? (
        <span className="mono" role="alert" style={{ display: "block" }}>
          {error}
        </span>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Upload (§14/§15 — any of the eleven types)
 * ------------------------------------------------------------------ */

function StaffUploadForm({
  shipmentId,
  action,
}: {
  shipmentId: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status, state.message]);

  return (
    <section className="pcard" aria-labelledby="sd-doc-upload">
      <h2 id="sd-doc-upload">File a document</h2>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        Any of the eleven §16 document types. It lands as <b>pending</b> and
        stays staff-only until you approve it — customers see approved documents
        only.
      </p>
      <form ref={formRef} action={formAction} className="pform">
        <input type="hidden" name="shipment_id" value={shipmentId} />
        <div className="pform-row">
          <label htmlFor="sd-doc-type">Document type</label>
          <select id="sd-doc-type" name="doc_type" required defaultValue="bol">
            {STAFF_UPLOADABLE_DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="pform-row">
          <label htmlFor="sd-doc-file">File</label>
          <input
            id="sd-doc-file"
            name="file"
            type="file"
            required
            /* A HINT. The server sniffs magic bytes and the bucket enforces
               its own allow-list; `accept` is never the check. */
            accept="application/pdf,image/jpeg,image/png,image/heic"
            aria-describedby="sd-doc-hint"
          />
          <span id="sd-doc-hint" className="mono">
            PDF, JPG, PNG or HEIC · max 10 MB
          </span>
        </div>
        <div className="pform-row">
          <label htmlFor="sd-doc-staff">
            Keep this staff-only, whatever its type allows
          </label>
          <input id="sd-doc-staff" name="staff_only" type="checkbox" value="on" />
        </div>
        <button
          className="btn btn-amber btn-sm"
          type="submit"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
      </form>
      {state.status === "error" && state.message ? (
        <p className="pempty" role="alert" style={{ padding: "10px 0 0" }}>
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p className="pempty" role="status" style={{ padding: "10px 0 0" }}>
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The review queue
 * ------------------------------------------------------------------ */

function ReviewTable({
  shipmentId,
  documents,
  failed,
  hasMore,
  downloadAction,
  reviewAction,
}: {
  shipmentId: string;
  documents: StaffDocumentView[];
  failed: boolean;
  hasMore: boolean;
  downloadAction: DocumentUrlAction;
  reviewAction: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(
    reviewAction,
    initialFormState,
  );

  return (
    <section className="pcard" aria-labelledby="sd-docs">
      <h2 id="sd-docs">Documents and review</h2>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        Approving a proof of delivery is what makes the <b>POD uploaded</b>{" "}
        status available — the engine refuses that transition until an approved
        POD exists on this shipment (§20). Rejecting one asks the uploader for a
        replacement and changes nothing a customer can see.
      </p>
      {failed ? (
        <p className="pempty" role="alert" style={{ padding: 0 }}>
          We couldn&apos;t read this shipment&apos;s documents just now. Reload
          the page.
        </p>
      ) : documents.length === 0 ? (
        <p className="pempty" style={{ padding: 0 }}>
          Nothing has been filed on this shipment yet.
        </p>
      ) : (
        <table className="ptable ptable--cards">
          <caption className="sr-only">Documents on this shipment</caption>
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">File</th>
              <th scope="col">Status</th>
              <th scope="col">Filed under</th>
              <th scope="col">Uploaded</th>
              <th scope="col">Review</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td data-th="Document">{TYPE_LABEL[doc.doc_type]}</td>
                <td data-th="File" className="mono">
                  {doc.file_name} · {formatBytes(doc.size_bytes)}
                </td>
                {/* Status is TEXT. Colour alone would fail §23. */}
                <td data-th="Status">
                  {STATUS_LABEL[doc.status]}
                  {doc.review_note ? (
                    <span className="mono" style={{ display: "block" }}>
                      {doc.review_note}
                    </span>
                  ) : null}
                </td>
                <td data-th="Filed under">{BAND_LABEL[doc.visibility]}</td>
                <td data-th="Uploaded">
                  <time dateTime={doc.uploaded_at}>{when(doc.uploaded_at)}</time>
                </td>
                <td data-th="Review">
                  <DownloadButton documentId={doc.id} action={downloadAction} />
                  {doc.status === "pending" ? (
                    <form action={formAction} className="pform">
                      <input type="hidden" name="shipment_id" value={shipmentId} />
                      <input type="hidden" name="document_id" value={doc.id} />
                      <div className="pform-row">
                        <label htmlFor={`sd-rev-note-${doc.id}`}>
                          Reviewer note (optional)
                        </label>
                        <input
                          id={`sd-rev-note-${doc.id}`}
                          name="note"
                          type="text"
                          maxLength={500}
                          autoComplete="off"
                        />
                      </div>
                      <button
                        className="btn btn-amber btn-sm"
                        type="submit"
                        name="decision"
                        value="approved"
                        aria-busy={pending}
                        disabled={pending}
                      >
                        Approve
                      </button>{" "}
                      <button
                        className="btn btn-ghost btn-sm"
                        type="submit"
                        name="decision"
                        value="rejected"
                        aria-busy={pending}
                        disabled={pending}
                      >
                        Reject
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore ? (
        <p className="pempty" style={{ padding: "8px 0 0" }}>
          Older documents exist beyond this page (§25 bounds the read at 25).
        </p>
      ) : null}
      {state.status === "error" && state.message ? (
        <p className="pempty" role="alert" style={{ padding: "10px 0 0" }}>
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p className="pempty" role="status" style={{ padding: "10px 0 0" }}>
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The block the staff detail page renders
 * ------------------------------------------------------------------ */

export function StaffShipmentDocuments({
  shipmentId,
  documents,
  failed,
  hasMore,
  uploadAction,
  reviewAction,
  downloadAction,
}: {
  shipmentId: string;
  documents: StaffDocumentView[];
  failed: boolean;
  hasMore: boolean;
  uploadAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  reviewAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  downloadAction: DocumentUrlAction;
}) {
  return (
    <>
      <StaffUploadForm shipmentId={shipmentId} action={uploadAction} />
      <ReviewTable
        shipmentId={shipmentId}
        documents={documents}
        failed={failed}
        hasMore={hasMore}
        downloadAction={downloadAction}
        reviewAction={reviewAction}
      />
      {/*
        §12/§16 — the BROKER band is live, and since M-81 so is the surface
        that reads it: 0024's "broker member read shipment documents" and
        0029's "broker shared read shipment documents" grant an approved BOL
        and POD to any partner organization this shipment is linked to,
        granted to, or covered for by an account agreement — and those
        partners read them at `/portal/broker`.

        M-77 shipped this note saying the permission existed and the surface
        did not. That caveat is removed rather than softened: it is no longer
        true, and a stale hedge on an operator screen is the same failure as a
        stale status on a customer one.

        Naming the band here is what stops a dispatcher assuming an approved
        BOL is invisible to a partner org — the assumption that leads to
        filing something under the wrong type.
      */}
      <p className="pempty" style={{ padding: "0 0 12px" }} role="note">
        Any broker partner this shipment is shared with sees its BOL and POD
        once you approve them (§12), in the partner portal. Nothing else on
        this list reaches them — rate confirmations, quotes and invoices are
        outside a partner&apos;s permissions. Manage sharing under &ldquo;Broker
        partner access&rdquo; below.
      </p>
    </>
  );
}
