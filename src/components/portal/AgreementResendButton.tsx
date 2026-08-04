"use client";

import { useState, useTransition } from "react";
import { useV4 } from "@/i18n/v4";
import { requestAgreementResend } from "@/app/actions/carrier-portal";

/** M-55 — agreements page: ask for the signature request email again. */
export function AgreementResendButton() {
  const tv = useV4();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn btn-amber btn-sm"
        aria-busy={pending}
        disabled={pending || done}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await requestAgreementResend();
            if (result.status === "success") setDone(true);
            else setError(result.message ?? "Something went wrong. Retry.");
          })
        }
      >
        {pending ? tv("Sending…") : tv("Re-send signature request")}
      </button>
      <div className={`form-ok${done ? " show" : ""}`} role="status">
        {tv("✓ Sent — check your inbox for the signature request.")}
      </div>
      <div className={`form-err${error ? " show" : ""}`} role="alert">
        {error ? tv(error) : null}
      </div>
    </div>
  );
}
