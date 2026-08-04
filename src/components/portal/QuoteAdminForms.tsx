"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "@/i18n/navigation";
import { updateFreightQuote } from "@/app/actions/quotes";
import { LEAD_STATUSES } from "@/lib/validation/quotes";
import { initialFormState } from "@/lib/form-state";
import type { LeadStatus } from "@/lib/supabase/database.types";

/** M-60 — staff quote status/rate editor (staff surface, English by scope). */

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New (Received)",
  call: "Call (In review)",
  qualified: "Qualified (In review)",
  appointment: "Appointment (In review)",
  agreement: "Agreement (Quoted)",
  waiting_documents: "Waiting docs (Quoted)",
  active: "Active (Booked)",
  inactive: "Inactive (Closed)",
  lost: "Lost (Closed)",
};

export function QuoteStatusForm({
  quoteId,
  status,
  quotedRate,
}: {
  quoteId: string;
  status: LeadStatus;
  quotedRate: number | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateFreightQuote,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

  return (
    <form
      action={formAction}
      style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
    >
      <input type="hidden" name="quote_id" value={quoteId} />
      <select
        id={`qs-${quoteId}`}
        name="status"
        defaultValue={status}
        aria-label="Quote status"
        className="langsel"
        style={{ padding: "8px 6px" }}
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <input
        name="quoted_rate"
        type="number"
        step="0.01"
        min="0"
        defaultValue={quotedRate ?? ""}
        placeholder="Rate $"
        aria-label="Quoted rate (USD)"
        className="langsel"
        style={{ width: 90, padding: "8px 6px" }}
      />
      <button
        className="btn btn-ghost btn-sm"
        type="submit"
        aria-busy={pending}
        disabled={pending}
      >
        Save
      </button>
      {state.status === "error" ? (
        <span role="alert" className="mono" style={{ fontSize: ".66rem", color: "#f2c9c9", flexBasis: "100%" }}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
