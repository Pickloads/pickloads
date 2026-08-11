"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { initialFormState, type FormState } from "@/lib/form-state";
import {
  documentTypeKey,
  type CustomerDocumentDto,
} from "@/lib/shipments/documents";
import type { ShipmentDocumentType } from "@/lib/shipments/types";
import { formatTrackingDateTime } from "@/components/tracking/format";

/**
 * M-77 — the §16 document surfaces, shared by all four audiences.
 *
 * ── ONE COMPONENT SET, FOUR SURFACES ─────────────────────────────────────
 *
 * The shipper detail (M-74), the carrier detail (M-76), the driver link
 * (M-76) and the dispatcher detail (M-75) all render "a list of documents"
 * and up to one "upload" form. Four copies of that would be four places to
 * forget the `role="alert"`, and the axe suite would have to scan four
 * implementations of the same table. So: `<DocumentList>` for a customer
 * audience and `<DocumentUploadForm>` for everyone who may file one.
 *
 * The DISPATCHER review surface lives in `ShipmentDocumentReview.tsx` instead,
 * and the split is deliberate: every M-75 staff component is English and calls
 * no translation hook, because the operator portal is one language while
 * `/track`, the shipper portal, the carrier portal and the driver link are
 * five (§24). Mixing the two vocabularies in one file is how a `t()` ends up
 * in a component the admin layout renders without a provider.
 *
 * ── THE DOWNLOAD ACTION IS INJECTED, NOT CHOSEN HERE ─────────────────────
 *
 * Each surface passes the server action for ITS audience
 * (`getShipperDocumentUrlAction`, `getCarrierDocumentUrlAction`, …). The
 * component never decides which band it is rendering, because a component
 * that could would be a component a prop could get wrong. The action derives
 * the audience from the session; this file only knows how to call it.
 *
 * ── THE URL IS OPENED, NEVER STORED ──────────────────────────────────────
 *
 * A signed URL lives ≤300 seconds and is a bearer credential for that window.
 * It goes straight into `window.open` and is never written to state, never
 * put in an `href`, and never rendered — so it cannot survive in the DOM, in
 * a React devtools snapshot or in a screenshot.
 *
 * ── §23 / §22 ────────────────────────────────────────────────────────────
 *
 * A real `<table>` with a `<caption>` and `scope="col"` headers under the
 * portal's `.ptable--cards` responsive vocabulary (which becomes stacked
 * cards below the M-59 breakpoint, so 320px works because the shipped
 * mechanism works). Status is TEXT, never colour alone. Every control has a
 * label; results are `role="alert"` / `role="status"` so a refusal is
 * announced. Nothing is hover-only.
 *
 * ── §24 ──────────────────────────────────────────────────────────────────
 *
 * Document type labels are `documentTypeKey()` → `shipment.document.<type>`,
 * translated in five locales. No English document name is spelled here.
 */

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type DocumentUrlAction = (
  documentId: string,
) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;

/**
 * The download control. Mirrors `DocumentDownloadButton` (M-55) deliberately
 * — same `btn btn-ghost btn-sm`, same busy state, same inline `role="alert"`
 * — so a carrier meets one download button in this product, not two.
 */
function DownloadButton({
  documentId,
  action,
  label,
}: {
  documentId: string;
  action: DocumentUrlAction;
  label: string;
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
            // ≤300s bearer credential: opened, never stored, never rendered.
            if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
            else setError(result.error);
          })
        }
      >
        {pending ? "…" : label}
      </button>
      {error ? (
        <span
          className="mono"
          role="alert"
          style={{
            color: "#f2c9c9",
            fontSize: ".66rem",
            display: "block",
            marginTop: 4,
          }}
        >
          {error}
        </span>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Customer list (shipper · carrier · broker)
 * ------------------------------------------------------------------ */

export interface DocumentListProps {
  documents: CustomerDocumentDto[];
  /** True when the read itself failed — an honest error, not an empty state. */
  failed?: boolean;
  /** §25: more exist beyond the bounded page. */
  hasMore?: boolean;
  downloadAction: DocumentUrlAction;
  headingId: string;
  /**
   * i18n KEYS, not strings. Two of the four callers are SERVER components
   * (the dispatcher detail, the shipper page's wrapper) and cannot call
   * `useTranslations`; passing keys means one component resolves them, in the
   * client, under the provider the root layout already mounts — and means no
   * caller can accidentally hand this an English literal (§24).
   */
  titleKey: string;
  /** What this audience should understand about the list (§16, §30). */
  blurbKey?: string;
}

export function DocumentList({
  documents,
  failed = false,
  hasMore = false,
  downloadAction,
  headingId,
  titleKey,
  blurbKey,
}: DocumentListProps) {
  const t = useTranslations();
  const locale = useLocale();
  const title = t(titleKey);

  return (
    <section className="track-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {blurbKey ? (
        <p className="pempty" style={{ padding: "0 0 10px" }}>
          {t(blurbKey)}
        </p>
      ) : null}
      {failed ? (
        <p className="pempty" role="alert" style={{ padding: 0 }}>
          {t("shipment.document.failed")}
        </p>
      ) : documents.length === 0 ? (
        <p className="pempty" style={{ padding: 0 }}>
          {t("shipment.document.empty")}
        </p>
      ) : (
        <>
          <table className="ptable ptable--cards">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t("shipment.document.col_type")}</th>
                <th scope="col">{t("shipment.document.col_file")}</th>
                <th scope="col">{t("shipment.document.col_size")}</th>
                <th scope="col">{t("shipment.document.col_approved")}</th>
                <th scope="col">
                  <span className="sr-only">{t("shipment.document.col_action")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td data-th={t("shipment.document.col_type")}>
                    {t(doc.doc_type_key)}
                  </td>
                  <td data-th={t("shipment.document.col_file")} className="mono">
                    {doc.file_name}
                  </td>
                  <td data-th={t("shipment.document.col_size")}>
                    {formatBytes(doc.size_bytes)}
                  </td>
                  <td data-th={t("shipment.document.col_approved")}>
                    {doc.approved_at === null ? (
                      "—"
                    ) : (
                      <time dateTime={doc.approved_at}>
                        {formatTrackingDateTime(doc.approved_at, locale)}
                      </time>
                    )}
                  </td>
                  <td data-th={t("shipment.document.col_action")}>
                    <DownloadButton
                      documentId={doc.id}
                      action={downloadAction}
                      label={t("shipment.document.download")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore ? (
            <p className="pempty" style={{ padding: "8px 0 0" }}>
              {t("shipment.document.more")}
            </p>
          ) : null}
          <p className="pempty" style={{ padding: "8px 0 0" }}>
            {t("shipment.document.link_note")}
          </p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

export interface DocumentUploadFormProps {
  shipmentId?: string;
  /** The driver surface passes its token instead of a shipment id. */
  token?: string;
  /** The types THIS role may file — server-side allow-list, mirrored. */
  docTypes: readonly ShipmentDocumentType[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  headingId: string;
  /** i18n keys — see `DocumentListProps`. */
  titleKey: string;
  blurbKey: string;
  /** Staff-only: offer the "hold this back" checkbox. */
  allowStaffOnly?: boolean;
  /** Driver page uses its own card vocabulary. */
  variant?: "portal" | "driver";
  /** Messages come back as i18n KEYS on the driver surface. */
  translateResult?: boolean;
  onDone?: () => void;
}

export function DocumentUploadForm({
  shipmentId,
  token,
  docTypes,
  action,
  headingId,
  titleKey,
  blurbKey,
  allowStaffOnly = false,
  variant = "portal",
  translateResult = false,
  onDone,
}: DocumentUploadFormProps) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onDone?.();
    }
  }, [state.status, state.message, onDone]);

  const render = (message: string) => (translateResult ? t(message) : message);
  const cardClass = variant === "driver" ? "driver-card" : "pcard";
  const fieldClass = variant === "driver" ? "driver-field" : "pform-row";

  return (
    <section className={cardClass} aria-labelledby={headingId}>
      <h2 id={headingId} className={variant === "driver" ? "driver-h2" : undefined}>
        {t(titleKey)}
      </h2>
      <p
        className={variant === "driver" ? "driver-body" : "pempty"}
        style={variant === "driver" ? undefined : { padding: "0 0 12px" }}
      >
        {t(blurbKey)}
      </p>
      <form ref={formRef} action={formAction} className="pform">
        {shipmentId ? (
          <input type="hidden" name="shipment_id" value={shipmentId} />
        ) : null}
        {token ? <input type="hidden" name="token" value={token} /> : null}
        <div className={fieldClass}>
          <label htmlFor={`${headingId}-type`}>
            {t("shipment.document.field_type")}
          </label>
          <select
            id={`${headingId}-type`}
            name="doc_type"
            required
            defaultValue={docTypes[0]}
          >
            {docTypes.map((type) => (
              <option key={type} value={type}>
                {t(documentTypeKey(type))}
              </option>
            ))}
          </select>
        </div>
        <div className={fieldClass}>
          <label htmlFor={`${headingId}-file`}>
            {t("shipment.document.field_file")}
          </label>
          <input
            id={`${headingId}-file`}
            name="file"
            type="file"
            required
            // A HINT, not a control: the server sniffs magic bytes and the
            // bucket enforces its own list. An `accept` attribute is client
            // convenience and is never the check.
            accept="application/pdf,image/jpeg,image/png,image/heic"
            aria-describedby={`${headingId}-hint`}
          />
          <span id={`${headingId}-hint`} className="mono">
            {t("shipment.document.field_hint")}
          </span>
        </div>
        {allowStaffOnly ? (
          <div className={fieldClass}>
            <label htmlFor={`${headingId}-staff`}>
              {t("shipment.document.field_staff_only")}
            </label>
            <input
              id={`${headingId}-staff`}
              name="staff_only"
              type="checkbox"
              value="on"
            />
          </div>
        ) : null}
        <button
          className="btn btn-amber btn-sm"
          type="submit"
          aria-busy={pending}
          disabled={pending}
        >
          {pending
            ? t("shipment.document.uploading")
            : t("shipment.document.upload")}
        </button>
      </form>
      {state.status === "error" && state.message ? (
        <p className="pempty" role="alert" style={{ padding: "10px 0 0" }}>
          {render(state.message)}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p className="pempty" role="status" style={{ padding: "10px 0 0" }}>
          {render(state.message)}
        </p>
      ) : null}
    </section>
  );
}
