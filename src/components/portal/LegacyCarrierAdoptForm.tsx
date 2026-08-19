"use client";

import { useActionState } from "react";

import { adoptLegacyCarrier } from "@/app/actions/carrier-legacy";
import { initialFormState } from "@/lib/form-state";

/**
 * M-94 — run the FMCSA pre-check for a `carriers` row that predates the gate.
 *
 * The email is required because the old `carriers` table never had one; the
 * USDOT field appears only when the legacy row has none, which the old wizard
 * allowed. Nothing here decides anything: pressing the button runs the same
 * check a public applicant runs, and binds only what the engine — or a
 * recorded human review — cleared.
 */
export function LegacyCarrierAdoptForm({
  carrierId,
  needsUsdot,
}: {
  carrierId: string;
  /** True when the legacy row has no `dot_number` to check against. */
  needsUsdot: boolean;
}) {
  const [state, action, pending] = useActionState(
    adoptLegacyCarrier,
    initialFormState,
  );

  return (
    <form action={action}>
      <input type="hidden" name="carrier_id" value={carrierId} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 200, marginBottom: 0 }}>
          <label htmlFor={`adopt-email-${carrierId}`}>Applicant email</label>
          <input
            id={`adopt-email-${carrierId}`}
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="them@company.com"
          />
        </div>
        {needsUsdot ? (
          <div className="field" style={{ minWidth: 130, marginBottom: 0 }}>
            <label htmlFor={`adopt-usdot-${carrierId}`}>USDOT</label>
            <input
              id={`adopt-usdot-${carrierId}`}
              name="usdot_number"
              type="text"
              inputMode="numeric"
              maxLength={20}
              required
              placeholder="0000000"
            />
          </div>
        ) : null}
        <button
          className="btn btn-ghost btn-sm"
          type="submit"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? "Checking…" : "Verify with FMCSA"}
        </button>
      </div>
      {state.status !== "idle" && state.message ? (
        <p
          className={state.status === "success" ? "form-ok show" : "form-err show"}
          role={state.status === "success" ? "status" : "alert"}
          style={{ marginTop: 8 }}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
