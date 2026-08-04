"use client";

import { useRef, useState } from "react";
import { useV4 } from "@/i18n/v4";
import { uploadCarrierDocument } from "@/app/actions/onboarding";
import type { DocType } from "@/lib/supabase/database.types";

/**
 * M-21 secure-upload dropzone (V4 `.upload` vocabulary) — shared by the
 * become-a-carrier wizard (step 2) and the carrier portal (M-25
 * replacements). Per-file uploading/done/error states with retry.
 */

type UploadStatus =
  | { s: "idle" }
  | { s: "uploading" }
  | { s: "done"; fileName: string }
  | { s: "error"; message: string };

export function DocUpload({
  carrierId,
  docType,
  title,
  blurb,
  onDone,
}: {
  carrierId: string;
  docType: DocType;
  title: string;
  blurb: string;
  onDone: () => void;
}) {
  const tv = useV4();
  const [status, setStatus] = useState<UploadStatus>({ s: "idle" });
  const lastFile = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    lastFile.current = file;
    setStatus({ s: "uploading" });
    try {
      const fd = new FormData();
      fd.set("carrier_id", carrierId);
      fd.set("doc_type", docType);
      fd.set("file", file);
      const result = await uploadCarrierDocument(fd);
      if (result.ok) {
        setStatus({ s: "done", fileName: result.fileName });
        onDone();
      } else {
        setStatus({ s: "error", message: result.error });
      }
    } catch {
      setStatus({
        s: "error",
        message: "Upload failed — check your connection and retry.",
      });
    }
  }

  const stateClass =
    status.s === "done" ? " picked" : status.s === "error" ? " err" : "";

  return (
    <div
      className={`upload${stateClass}`}
      role="button"
      tabIndex={0}
      aria-label={`${tv(title)} — ${tv("upload")}`}
      style={{ position: "relative", padding: "30px 22px" }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void send(file);
      }}
    >
      <span className="big" aria-hidden="true">
        {status.s === "done" ? "✓" : "⇪"}
      </span>
      <b>{tv(title)}</b>
      <span>{tv(blurb)}</span>
      {status.s === "idle" ? (
        <span className="mono">
          {"// "}
          {tv("PDF, JPG, PNG or HEIC · max 10 MB")}
        </span>
      ) : null}
      {status.s === "uploading" ? (
        <span className="st" role="status">
          {tv("Uploading…")}
        </span>
      ) : null}
      {status.s === "done" ? (
        <span className="st ok" role="status">
          ✓ {status.fileName}
        </span>
      ) : null}
      {status.s === "error" ? (
        <>
          <span className="st bad" role="alert">
            ✕ {tv(status.message)}
          </span>
          <button
            type="button"
            className="btn btn-dark"
            style={{ padding: "8px 16px", fontSize: ".78rem", marginTop: 8 }}
            onClick={(e) => {
              e.stopPropagation();
              if (lastFile.current) void send(lastFile.current);
              else inputRef.current?.click();
            }}
          >
            {tv("Retry upload")}
          </button>
        </>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void send(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
