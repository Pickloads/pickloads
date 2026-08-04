"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { getDocumentSignedUrl, reviewDocument } from "@/app/actions/admin";
import { initialFormState } from "@/lib/form-state";

/** M-24 Operations — pending-document review row (view / approve / reject). */
export function DocumentReviewRow({
  documentId,
  companyName,
  docType,
  fileName,
  uploadedAt,
}: {
  documentId: string;
  companyName: string;
  docType: string;
  fileName: string | null;
  uploadedAt: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    reviewDocument,
    initialFormState,
  );
  const [viewError, setViewError] = useState<string | null>(null);
  const [viewPending, startView] = useTransition();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

  function view() {
    setViewError(null);
    startView(async () => {
      const result = await getDocumentSignedUrl(documentId);
      if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
      else setViewError(result.error);
    });
  }

  return (
    <tr>
      <td>{companyName}</td>
      <td>
        <span className="pbadge amber">{docType.replace(/_/g, " ")}</span>
      </td>
      <td>{fileName ?? "—"}</td>
      <td>
        {new Date(uploadedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </td>
      <td style={{ minWidth: 340 }}>
        <form
          action={formAction}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <input type="hidden" name="document_id" value={documentId} />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={view}
            aria-busy={viewPending}
            disabled={viewPending}
          >
            View
          </button>
          <input
            type="text"
            name="note"
            placeholder="review note"
            aria-label="Review note"
            style={{
              background: "#0B0E11",
              border: "1px solid var(--line)",
              borderRadius: 6,
              color: "var(--paper)",
              padding: "8px 10px",
              fontSize: ".82rem",
              width: 150,
            }}
          />
          <button
            className="btn btn-green btn-sm"
            type="submit"
            name="decision"
            value="approve"
            aria-busy={pending}
            disabled={pending}
          >
            Approve
          </button>
          <button
            className="btn btn-dark btn-sm"
            type="submit"
            name="decision"
            value="reject"
            aria-busy={pending}
            disabled={pending}
            style={{ border: "1px solid var(--line)" }}
          >
            Reject
          </button>
        </form>
        {state.status === "error" || viewError ? (
          <span
            className="mono"
            role="alert"
            style={{ color: "#f2c9c9", fontSize: ".68rem", display: "block", marginTop: 6 }}
          >
            {viewError ?? state.message}
          </span>
        ) : null}
      </td>
    </tr>
  );
}
