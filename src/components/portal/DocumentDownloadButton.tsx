"use client";

import { useState, useTransition } from "react";
import { useV4 } from "@/i18n/v4";
import { getMyDocumentSignedUrl } from "@/app/actions/carrier";

/**
 * M-55 — shared ≤5-min signed-URL download button (extracted from the M-25
 * documents table so the agreements page can offer the executed-copy
 * download with identical behavior).
 */
export function DocumentDownloadButton({
  documentId,
  label,
}: {
  documentId: string;
  label?: string;
}) {
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
        {pending ? "…" : tv(label ?? "Download")}
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
          {tv(error)}
        </span>
      ) : null}
    </>
  );
}
