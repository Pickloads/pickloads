"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { getMyDocumentSignedUrl } from "@/app/actions/carrier";
import { DocUpload } from "@/components/onboarding/DocUpload";
import type { DocStatus, DocType } from "@/lib/supabase/database.types";

/** M-25 — carrier "my documents": statuses, ≤5-min downloads, replacements. */

export interface CarrierDocRow {
  id: string;
  type: DocType;
  file_name: string | null;
  status: DocStatus;
  review_note: string | null;
  created_at: string;
}

const TYPE_LABEL: Record<DocType, string> = {
  mc_authority: "MC Authority Letter",
  coi: "Certificate of Insurance",
  w9: "W-9 Form",
  voided_check: "Voided Check",
  noa: "Notice of Assignment",
  dispatch_agreement: "Dispatch Agreement",
  other: "Other document",
};

const STATUS_BADGE: Record<DocStatus, { cls: string; label: string }> = {
  pending: { cls: "amber", label: "In review" },
  approved: { cls: "green", label: "Approved" },
  rejected: { cls: "red", label: "Rejected" },
  expired: { cls: "red", label: "Expired" },
};

function DownloadButton({ documentId }: { documentId: string }) {
  const tv = useV4();
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
            const result = await getMyDocumentSignedUrl(documentId);
            if (result.ok)
              window.open(result.url, "_blank", "noopener,noreferrer");
            else setError(result.error);
          })
        }
      >
        {pending ? tv("…") : tv("Download")}
      </button>
      {error ? (
        <span
          className="mono"
          role="alert"
          style={{ color: "#f2c9c9", fontSize: ".66rem", display: "block", marginTop: 4 }}
        >
          {tv(error)}
        </span>
      ) : null}
    </>
  );
}

export function CarrierDocs({
  carrierId,
  documents,
}: {
  carrierId: string;
  documents: CarrierDocRow[];
}) {
  const tv = useV4();
  const router = useRouter();
  const [replaceType, setReplaceType] = useState<DocType>("coi");

  return (
    <div>
      <div className="ptable-wrap">
        {documents.length > 0 ? (
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th>{tv("Document")}</th>
                <th>{tv("File")}</th>
                <th>{tv("Status")}</th>
                <th>{tv("Uploaded")}</th>
                <th>{tv("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td data-th={tv("Document")}>{tv(TYPE_LABEL[d.type])}</td>
                  <td data-th={tv("File")}>{d.file_name ?? "—"}</td>
                  <td data-th={tv("Status")}>
                    <span className={`pbadge ${STATUS_BADGE[d.status].cls}`}>
                      {tv(STATUS_BADGE[d.status].label)}
                    </span>
                    {d.status === "rejected" && d.review_note ? (
                      <span
                        className="mono"
                        style={{ display: "block", fontSize: ".66rem", color: "#f2c9c9", marginTop: 4, maxWidth: 220 }}
                      >
                        {d.review_note}
                      </span>
                    ) : null}
                  </td>
                  <td data-th={tv("Uploaded")}>
                    {new Date(d.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td data-th={tv("Actions")}>
                    <DownloadButton documentId={d.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pempty">
            {tv("No documents on file yet — upload your first one below.")}
          </p>
        )}
      </div>

      <div className="pcard" style={{ marginTop: 18 }}>
        <h2>{tv("Upload a new or replacement document")}</h2>
        <div className="pform-row" style={{ alignItems: "end" }}>
          <div className="field">
            <label htmlFor="cd-type">{tv("Document type")}</label>
            <select
              id="cd-type"
              value={replaceType}
              onChange={(e) => {
                const v = e.target.value;
                if (
                  v === "mc_authority" || v === "coi" || v === "w9" ||
                  v === "voided_check" || v === "noa" || v === "other"
                ) {
                  setReplaceType(v);
                }
              }}
            >
              <option value="coi">{tv(TYPE_LABEL.coi)}</option>
              <option value="mc_authority">{tv(TYPE_LABEL.mc_authority)}</option>
              <option value="w9">{tv(TYPE_LABEL.w9)}</option>
              <option value="voided_check">{tv(TYPE_LABEL.voided_check)}</option>
              <option value="noa">{tv(TYPE_LABEL.noa)}</option>
              <option value="other">{tv(TYPE_LABEL.other)}</option>
            </select>
          </div>
        </div>
        <DocUpload
          key={replaceType}
          carrierId={carrierId}
          docType={replaceType}
          title={TYPE_LABEL[replaceType]}
          blurb="The previous file stays visible to our team until review completes."
          onDone={() => router.refresh()}
        />
      </div>
    </div>
  );
}
