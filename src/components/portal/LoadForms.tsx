"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { createLoad, updateLoadStatus } from "@/app/actions/loads";
import { initialFormState } from "@/lib/form-state";
import {
  LOAD_STATUS_LABELS,
  LOAD_TRANSITIONS,
} from "@/lib/loads";
import type { LoadStatus } from "@/lib/supabase/database.types";

/** M-30 — staff load creation + per-row status transitions. */

export interface CarrierOption {
  id: string;
  name: string;
  feePct: number;
}

const EQUIPMENT_OPTIONS = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Power Only",
  "Hot Shot",
  "Box Truck",
  "Sprinter Van",
] as const;

export function LoadCreateForm({ carriers }: { carriers: CarrierOption[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    createLoad,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.push("/portal/admin/loads");
  }, [state, router]);

  return (
    <form action={formAction} className="pcard" style={{ maxWidth: 760 }}>
      <h2>New load</h2>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ld-carrier">Carrier *</label>
          <select id="ld-carrier" name="carrier_id" required defaultValue="">
            <option value="" disabled>
              Select carrier…
            </option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.feePct}%)
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ld-equipment">Equipment</label>
          <select id="ld-equipment" name="equipment" defaultValue="">
            <option value="">—</option>
            {EQUIPMENT_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ld-broker">Broker</label>
          <input id="ld-broker" name="broker_name" maxLength={120} placeholder="TQL, CH Robinson…" />
        </div>
        <div className="field">
          <label htmlFor="ld-broker-mc">Broker MC#</label>
          <input id="ld-broker-mc" name="broker_mc" maxLength={20} placeholder="MC-123456" />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ld-ocity">Origin city</label>
          <input id="ld-ocity" name="origin_city" maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="ld-ostate">Origin state</label>
          <input id="ld-ostate" name="origin_state" maxLength={2} placeholder="NJ" style={{ textTransform: "uppercase" }} />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ld-dcity">Destination city</label>
          <input id="ld-dcity" name="dest_city" maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="ld-dstate">Destination state</label>
          <input id="ld-dstate" name="dest_state" maxLength={2} placeholder="GA" style={{ textTransform: "uppercase" }} />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ld-pickup">Pickup date</label>
          <input id="ld-pickup" name="pickup_date" type="date" />
        </div>
        <div className="field">
          <label htmlFor="ld-delivery">Delivery date</label>
          <input id="ld-delivery" name="delivery_date" type="date" />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ld-gross">Gross rate ($)</label>
          <input id="ld-gross" name="gross_rate" type="number" step="0.01" min="0" placeholder="2450.00" />
        </div>
        <div className="field">
          <label htmlFor="ld-miles">Miles</label>
          <input id="ld-miles" name="miles" type="number" step="1" min="1" placeholder="860" />
        </div>
      </div>
      <p className="pempty" style={{ padding: "0 0 14px" }}>
        {/* F-03 */}
        Dispatcher = you. Fee % is snapshotted from the carrier&apos;s current
        rate at booking; the dispatch fee is computed automatically.
      </p>
      {state.status === "error" && state.message ? (
        <p className="field invalid err-msg" role="alert" style={{ marginBottom: 12 }}>
          {state.message}
        </p>
      ) : null}
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending}>
        {pending ? "Booking…" : "Book load"}
      </button>
    </form>
  );
}

export function LoadStatusActions({
  loadId,
  status,
}: {
  loadId: string;
  status: LoadStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const nextStatuses = LOAD_TRANSITIONS[status];

  if (nextStatuses.length === 0) return null;

  function move(next: LoadStatus) {
    setError(null);
    startTransition(async () => {
      const result = await updateLoadStatus(loadId, next);
      if (!result.ok) setError(result.error ?? "Update failed.");
      else router.refresh();
    });
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {nextStatuses.map((next) => (
        <button
          key={next}
          type="button"
          className={`btn btn-sm ${next === "cancelled" ? "btn-ghost" : "btn-amber"}`}
          style={{ padding: "5px 10px", fontSize: ".68rem" }}
          disabled={pending}
          aria-busy={pending}
          onClick={() => move(next)}
        >
          {next === "cancelled" ? "Cancel" : `→ ${LOAD_STATUS_LABELS[next]}`}
        </button>
      ))}
      {error ? (
        <span className="err-msg" role="alert" style={{ color: "#f2c9c9", fontSize: ".66rem" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
