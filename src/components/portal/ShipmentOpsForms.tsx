"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  addNoteAction,
  assignCarrierAction,
  assignDispatcherAction,
  convertQuoteAction,
  correctStatusAction,
  createShipmentAction,
  logExceptionAction,
  recordCallAction,
  recordEmailAction,
  releaseCarrierAction,
  requestPodAction,
  resendNotificationAction,
  setAppointmentAction,
  updateEtaAction,
  updateStatusAction,
} from "@/app/actions/dispatcher-shipments";
import { initialFormState, type FormState } from "@/lib/form-state";
import {
  PUBLIC_PHRASE_IDS,
  PUBLIC_PHRASES,
  phraseToken,
} from "@/lib/shipments/phrases";
import {
  DISPATCHER_ETA_SOURCES,
  SHIPMENT_EXCEPTION_SEVERITIES,
  SHIPMENT_EXCEPTION_TYPES,
  type ShipmentStatus,
} from "@/lib/shipments/types";
import {
  CALL_DIRECTIONS,
  CALL_PARTIES,
  CREATABLE_STATUSES,
  RESENDABLE_NOTIFICATIONS,
} from "@/lib/validation/dispatcher-shipments";

/**
 * M-75 — the §14 dispatcher forms.
 *
 * ── ONE WRAPPER, FOURTEEN FORMS ───────────────────────────────────────────
 *
 * `ActionCard` owns everything that is the same in all of them: `useActionState`,
 * the busy state, the `role="alert"` error, the `role="status"` success, and
 * the `router.refresh()` that pulls the new timeline back from the server. A
 * form that hand-rolled any of those is a form that can get one of them
 * wrong, and the one that gets the ALERT wrong is a refusal a dispatcher never
 * sees.
 *
 * ── §23: WHAT MAKES THESE ACCESSIBLE ──────────────────────────────────────
 *
 * Every control has a `<label for>`; every card is a `<section>` with a
 * heading; the result region is live (`role="alert"` for failure,
 * `role="status"` for success) so a refusal is ANNOUNCED rather than
 * discovered; buttons carry `aria-busy` while the action runs; nothing is
 * hover-only and nothing depends on colour.
 *
 * ── §24/D-6: THE PHRASE PICKER ────────────────────────────────────────────
 *
 * Anywhere a dispatcher writes something a CUSTOMER will read, the field is
 * paired with M-73's curated phrase library. Picking a phrase stores a TOKEN
 * (`phrase:delay.traffic`) which `/track` and the shipper portal render in the
 * reader's own language; typing prose stores prose, which those pages render
 * verbatim under the honest "written by dispatch, in English" label. That is
 * decision D-6, and this component is where a dispatcher meets it — the help
 * text says so in one sentence rather than leaving them to guess why one
 * option is a dropdown.
 */

/* ------------------------------------------------------------------ *
 * Shared shell
 * ------------------------------------------------------------------ */

function ActionCard({
  title,
  description,
  action,
  children,
  submitLabel,
  busyLabel,
  tone = "amber",
  onDone,
}: {
  title: string;
  description?: ReactNode;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  busyLabel: string;
  tone?: "amber" | "ghost";
  onDone?: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialFormState);

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onDone?.();
    }
    // `onDone` is a stable prop in every call site here; including it would
    // re-fire the refresh on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

  return (
    <section className="pcard">
      <h2>{title}</h2>
      {description ? (
        <p className="pempty" style={{ padding: "0 0 12px" }}>
          {description}
        </p>
      ) : null}
      <form action={formAction}>
        {children}
        {state.status === "error" && state.message ? (
          <p
            className="field invalid err-msg"
            role="alert"
            style={{ marginBottom: 12 }}
          >
            {state.message}
          </p>
        ) : null}
        {state.status === "success" ? (
          <p className="pempty" role="status" style={{ padding: "0 0 12px" }}>
            {state.message ?? "Saved."}
          </p>
        ) : null}
        <button
          className={`btn btn-${tone} btn-sm`}
          type="submit"
          aria-busy={pending}
        >
          {pending ? busyLabel : submitLabel}
        </button>
      </form>
    </section>
  );
}

function Hidden({ id }: { id: string }) {
  return <input type="hidden" name="shipment_id" value={id} />;
}

/**
 * The D-6 picker: a `<select>` of library phrases beside a free-text box.
 *
 * The select writes a token into the same field the textarea uses, so the
 * server never has to know which one the dispatcher used — a token IS a value
 * the column already accepts (M-73's argument for tokens over an enum column).
 */
function PhrasePicker({
  name,
  label,
  group,
  help,
}: {
  name: string;
  label: string;
  group: "update" | "delay" | "exception";
  help?: string;
}) {
  const [value, setValue] = useState("");
  const ids = PUBLIC_PHRASE_IDS.filter((id) => id.startsWith(`${group}.`));
  return (
    <div className="field">
      <label htmlFor={`${name}-pick`}>{label} — pick a translated phrase</label>
      <select
        id={`${name}-pick`}
        value=""
        onChange={(e) => {
          if (e.target.value !== "") setValue(phraseToken(e.target.value as never));
        }}
      >
        <option value="">Choose a standard phrase…</option>
        {ids.map((id) => (
          <option key={id} value={id}>
            {PUBLIC_PHRASES[id]}
          </option>
        ))}
      </select>
      <label htmlFor={name} style={{ marginTop: 10 }}>
        {label} — customer-visible text
      </label>
      <textarea
        id={name}
        name={name}
        rows={2}
        maxLength={600}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-describedby={`${name}-help`}
      />
      <p id={`${name}-help`} className="pempty" style={{ padding: "4px 0 0" }}>
        {help ??
          "A standard phrase is translated into the customer's language. Anything you type yourself is shown to them in English, labelled as written by dispatch."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * §14 — create shipment
 * ------------------------------------------------------------------ */

export interface ShipperOption {
  id: string;
  name: string;
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

export function ShipmentCreateForm({
  shippers,
  brokerageOpen,
  brokerageMessage,
}: {
  shippers: ShipperOption[];
  brokerageOpen: boolean;
  brokerageMessage: string;
}) {
  if (!brokerageOpen) {
    // §2 rendered honestly BEFORE the form, not as an error after submitting
    // it. The server refuses regardless (`create.ts`), and the 0017 trigger
    // refuses under that — this is the layer that saves a dispatcher from
    // typing a shipment nobody can accept.
    return (
      <section className="pcard">
        <h2>New shipment</h2>
        <p className="pempty" role="status" style={{ padding: 0 }}>
          {brokerageMessage}
        </p>
      </section>
    );
  }

  return (
    <ActionCard
      title="New shipment"
      description="The tracking number is generated when you save — it cannot be chosen or changed afterwards."
      action={createShipmentAction}
      submitLabel="Create shipment"
      busyLabel="Creating…"
    >
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-shipper">Shipper *</label>
          <select id="cs-shipper" name="shipper_id" required defaultValue="">
            <option value="" disabled>
              Select shipper…
            </option>
            {shippers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cs-status">Starting status</label>
          <select id="cs-status" name="status" defaultValue="carrier_search">
            {CREATABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-ocity">Pickup city *</label>
          <input id="cs-ocity" name="origin_city" maxLength={80} required />
        </div>
        <div className="field">
          <label htmlFor="cs-ostate">Pickup state *</label>
          <input
            id="cs-ostate"
            name="origin_state"
            maxLength={2}
            required
            placeholder="NJ"
            style={{ textTransform: "uppercase" }}
          />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-ocompany">Pickup facility</label>
          <input id="cs-ocompany" name="origin_company" maxLength={160} />
        </div>
        <div className="field">
          <label htmlFor="cs-ozip">Pickup ZIP</label>
          <input id="cs-ozip" name="origin_zip" maxLength={12} />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-dcity">Delivery city *</label>
          <input id="cs-dcity" name="destination_city" maxLength={80} required />
        </div>
        <div className="field">
          <label htmlFor="cs-dstate">Delivery state *</label>
          <input
            id="cs-dstate"
            name="destination_state"
            maxLength={2}
            required
            placeholder="GA"
            style={{ textTransform: "uppercase" }}
          />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-dcompany">Delivery facility</label>
          <input id="cs-dcompany" name="destination_company" maxLength={160} />
        </div>
        <div className="field">
          <label htmlFor="cs-dzip">Delivery ZIP</label>
          <input id="cs-dzip" name="destination_zip" maxLength={12} />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-equipment">Equipment *</label>
          <select id="cs-equipment" name="equipment" required defaultValue="Dry Van">
            {EQUIPMENT_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cs-commodity">Commodity</label>
          <input id="cs-commodity" name="commodity_category" maxLength={120} />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-weight">Weight (lbs)</label>
          <input id="cs-weight" name="weight_lbs" type="number" min="0" step="1" />
        </div>
        <div className="field">
          <label htmlFor="cs-pallets">Pallets</label>
          <input id="cs-pallets" name="pallets" type="number" min="0" step="1" />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-pickup">Pickup appointment</label>
          <input
            id="cs-pickup"
            name="pickup_appointment_at"
            type="datetime-local"
          />
        </div>
        <div className="field">
          <label htmlFor="cs-delivery">Delivery appointment</label>
          <input
            id="cs-delivery"
            name="delivery_appointment_at"
            type="datetime-local"
          />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-ref">Shipper reference</label>
          <input id="cs-ref" name="shipper_reference" maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="cs-po">PO number</label>
          <input id="cs-po" name="po_number" maxLength={80} />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="cs-gross">Shipper gross ($)</label>
          <input id="cs-gross" name="gross_shipper_amount" type="number" min="0" step="0.01" />
        </div>
        <div className="field">
          <label htmlFor="cs-pay">Carrier pay ($)</label>
          <input id="cs-pay" name="carrier_pay" type="number" min="0" step="0.01" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cs-note">Internal note</label>
        <textarea id="cs-note" name="internal_note" rows={2} maxLength={2000} />
      </div>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        Gross and carrier pay are staff-only — they never appear on a customer
        page. Margin is derived by staff reporting, not typed here.
      </p>
    </ActionCard>
  );
}

export function QuoteConvertForm({
  quoteId,
  label,
}: {
  quoteId: string;
  label: string;
}) {
  return (
    <ActionCard
      title="Convert this quote"
      description={`Creates a shipment for ${label}, carrying the lane, freight details and quoted rate. The quote keeps its own record.`}
      action={convertQuoteAction}
      submitLabel="Convert to shipment"
      busyLabel="Converting…"
    >
      <input type="hidden" name="quote_id" value={quoteId} />
    </ActionCard>
  );
}

/* ------------------------------------------------------------------ *
 * §14 — assignments
 * ------------------------------------------------------------------ */

export interface AssignOption {
  id: string;
  label: string;
}

export function AssignCarrierForm({
  shipmentId,
  carriers,
  staff,
  drivers,
  trucks,
  hasOpenAssignment,
}: {
  shipmentId: string;
  carriers: AssignOption[];
  staff: AssignOption[];
  drivers: AssignOption[];
  trucks: AssignOption[];
  hasOpenAssignment: boolean;
}) {
  if (hasOpenAssignment) {
    return (
      <ActionCard
        title="Release the carrier"
        description="Reassignment is a new record, never an edit — the released assignment stays in the history with its reason."
        action={releaseCarrierAction}
        submitLabel="Release carrier"
        busyLabel="Releasing…"
        tone="ghost"
      >
        <Hidden id={shipmentId} />
        <div className="field">
          <label htmlFor="rc-reason">Why is the carrier coming off? *</label>
          <textarea id="rc-reason" name="reason" rows={2} maxLength={300} required />
        </div>
      </ActionCard>
    );
  }

  return (
    <ActionCard
      title="Assign a carrier"
      description="Assigning does not change the status. Move it to Carrier Assigned afterwards — that is the step the customer sees."
      action={assignCarrierAction}
      submitLabel="Assign carrier"
      busyLabel="Assigning…"
    >
      <Hidden id={shipmentId} />
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ac-carrier">Carrier *</label>
          <select id="ac-carrier" name="carrier_id" required defaultValue="">
            <option value="" disabled>
              Select carrier…
            </option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ac-dispatcher">Dispatcher</label>
          <select id="ac-dispatcher" name="dispatcher_id" defaultValue="">
            <option value="">Me</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ac-driver">Driver (optional)</label>
          <select id="ac-driver" name="driver_id" defaultValue="">
            <option value="">Not yet assigned</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ac-truck">Truck (optional)</label>
          <select id="ac-truck" name="truck_id" defaultValue="">
            <option value="">Not yet assigned</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        The driver and truck lists show the currently selected carrier&apos;s
        fleet. A driver or truck belonging to another carrier is refused.
      </p>
      <div className="field">
        <label htmlFor="ac-note">Internal note</label>
        <textarea id="ac-note" name="internal_note" rows={2} maxLength={2000} />
      </div>
    </ActionCard>
  );
}

export function AssignDispatcherForm({
  shipmentId,
  staff,
  current,
}: {
  shipmentId: string;
  staff: AssignOption[];
  current: string | null;
}) {
  return (
    <ActionCard
      title="Move to another dispatcher"
      description="Changes who owns this shipment operationally. It leaves your board when you hand it over."
      action={assignDispatcherAction}
      submitLabel="Save owner"
      busyLabel="Saving…"
      tone="ghost"
    >
      <Hidden id={shipmentId} />
      <div className="field">
        <label htmlFor="ad-dispatcher">Dispatcher</label>
        <select id="ad-dispatcher" name="dispatcher_id" defaultValue={current ?? ""}>
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </ActionCard>
  );
}

/* ------------------------------------------------------------------ *
 * §14 — appointments, status, ETA
 * ------------------------------------------------------------------ */

export function AppointmentForm({
  shipmentId,
  pickupAt,
  deliveryAt,
}: {
  shipmentId: string;
  pickupAt: string | null;
  deliveryAt: string | null;
}) {
  return (
    <ActionCard
      title="Set or reschedule an appointment"
      description="Every change is recorded with the previous time, so 'you told me Tuesday' has an answer."
      action={setAppointmentAction}
      submitLabel="Save appointment"
      busyLabel="Saving…"
    >
      <Hidden id={shipmentId} />
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ap-kind">Appointment</label>
          <select id="ap-kind" name="kind" defaultValue="pickup">
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ap-at">New time (blank clears it)</label>
          <input id="ap-at" name="appointment_at" type="datetime-local" />
        </div>
      </div>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        Currently — pickup: {pickupAt ?? "not set"} · delivery:{" "}
        {deliveryAt ?? "not set"}
      </p>
      <div className="field">
        <label htmlFor="ap-reason">Reason for the change</label>
        <input id="ap-reason" name="reason" maxLength={300} />
      </div>
    </ActionCard>
  );
}

export function StatusUpdateForm({
  shipmentId,
  status,
  available,
  needsCloseout,
}: {
  shipmentId: string;
  status: ShipmentStatus;
  available: readonly ShipmentStatus[];
  needsCloseout: boolean;
}) {
  const [target, setTarget] = useState<string>(available[0] ?? "");
  return (
    <ActionCard
      title="Update status"
      description="Only the transitions the rules allow from the current status are offered. The server checks again before writing."
      action={updateStatusAction}
      submitLabel="Update status"
      busyLabel="Updating…"
    >
      <Hidden id={shipmentId} />
      <input type="hidden" name="expected_status" value={status} />
      {available.length === 0 ? (
        <p className="pempty" role="status" style={{ padding: "0 0 12px" }}>
          No status change is possible from{" "}
          <b>{status.replace(/_/g, " ")}</b> right now. A terminal status can
          only be changed by an admin correction, with a reason.
        </p>
      ) : (
        <>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="su-to">Move to</label>
              <select
                id="su-to"
                name="to"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {available.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="su-city">City (optional)</label>
              <input id="su-city" name="city" maxLength={80} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="su-state">State (optional)</label>
            <input
              id="su-state"
              name="state"
              maxLength={2}
              style={{ textTransform: "uppercase" }}
            />
          </div>
          {target === "cancelled" ? (
            <div className="field">
              <label htmlFor="su-cancel">Cancellation reason *</label>
              <textarea
                id="su-cancel"
                name="cancellation_reason"
                rows={2}
                maxLength={300}
                required
              />
            </div>
          ) : null}
          {target === "completed" || needsCloseout ? (
            <div className="field psh-toggle">
              <label htmlFor="su-closeout">
                <input
                  id="su-closeout"
                  type="checkbox"
                  name="closeout_confirmed"
                />
                Operational closeout is done — paperwork in, detention settled,
                invoice raised
              </label>
            </div>
          ) : null}
          <PhrasePicker
            name="public_message"
            label="Customer update"
            group="update"
          />
          <div className="field psh-toggle">
            <label htmlFor="su-publish">
              <input id="su-publish" type="checkbox" name="publish" />
              Publish the customer update to the tracking timeline
            </label>
          </div>
          <div className="field">
            <label htmlFor="su-internal">Internal note</label>
            <textarea
              id="su-internal"
              name="internal_message"
              rows={2}
              maxLength={2000}
            />
          </div>
          <p className="pempty" style={{ padding: "0 0 12px" }}>
            Leave the publish box unticked and nothing reaches the customer —
            the note stays staff-only.
          </p>
        </>
      )}
    </ActionCard>
  );
}

export function EtaUpdateForm({
  shipmentId,
  pickupEta,
  deliveryEta,
}: {
  shipmentId: string;
  pickupEta: string | null;
  deliveryEta: string | null;
}) {
  return (
    <ActionCard
      title="Update ETA"
      description="Dispatcher-entered ETAs only. The customer page labels them as entered by dispatch — PickLoads does not predict ETAs."
      action={updateEtaAction}
      submitLabel="Save ETA"
      busyLabel="Saving…"
    >
      <Hidden id={shipmentId} />
      <div className="pform-row">
        <div className="field">
          <label htmlFor="eta-kind">ETA for</label>
          <select id="eta-kind" name="kind" defaultValue="delivery">
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="eta-at">New ETA (blank clears it)</label>
          <input id="eta-at" name="eta_at" type="datetime-local" />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="eta-source">Source</label>
          <select id="eta-source" name="eta_source" defaultValue="manual">
            {DISPATCHER_ETA_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="eta-confidence">Confidence</label>
          <select id="eta-confidence" name="eta_confidence" defaultValue="">
            <option value="">Not stated</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="eta-delay">Delay (minutes)</label>
        <input id="eta-delay" name="delay_minutes" type="number" min="0" step="5" />
      </div>
      <PhrasePicker name="reason_public" label="Delay reason" group="delay" />
      <div className="field">
        <label htmlFor="eta-internal">Internal reason</label>
        <textarea id="eta-internal" name="reason_internal" rows={2} maxLength={300} />
      </div>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        Currently — pickup ETA: {pickupEta ?? "not set"} · delivery ETA:{" "}
        {deliveryEta ?? "not set"}
      </p>
    </ActionCard>
  );
}

/* ------------------------------------------------------------------ *
 * §14 — timeline actions
 * ------------------------------------------------------------------ */

export function NoteForm({ shipmentId }: { shipmentId: string }) {
  const [band, setBand] = useState<"public" | "internal">("internal");
  return (
    <ActionCard
      title="Add an update"
      description="A public update appears on the customer's tracking timeline. An internal note never does."
      action={addNoteAction}
      submitLabel={band === "public" ? "Publish update" : "Save internal note"}
      busyLabel="Saving…"
    >
      <Hidden id={shipmentId} />
      <div className="field">
        <label htmlFor="nf-band">Who sees this</label>
        <select
          id="nf-band"
          name="band"
          value={band}
          onChange={(e) => setBand(e.target.value as "public" | "internal")}
        >
          <option value="internal">Internal note — staff only</option>
          <option value="public">Public update — the customer sees it</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="nf-body">Update *</label>
        <textarea id="nf-body" name="body" rows={3} maxLength={2000} required />
      </div>
      {band === "public" ? (
        <p className="pempty" style={{ padding: "0 0 12px" }}>
          Written in English and shown to the customer in English, labelled as
          written by dispatch. For a translated sentence, use the standard
          phrase list on the status or ETA form.
        </p>
      ) : null}
    </ActionCard>
  );
}

function directionAndParty(prefix: string) {
  return (
    <div className="pform-row">
      <div className="field">
        <label htmlFor={`${prefix}-direction`}>Direction</label>
        <select id={`${prefix}-direction`} name="direction" defaultValue="outbound">
          {CALL_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-party`}>Who</label>
        <select id={`${prefix}-party`} name="party" defaultValue="carrier">
          {CALL_PARTIES.map((p) => (
            <option key={p} value={p}>
              {p.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function RecordCallForm({ shipmentId }: { shipmentId: string }) {
  return (
    <ActionCard
      title="Record a call"
      description="Goes on the timeline with who, which way and when it happened — not when you typed it up."
      action={recordCallAction}
      submitLabel="Record call"
      busyLabel="Recording…"
      tone="ghost"
    >
      <Hidden id={shipmentId} />
      {directionAndParty("rc")}
      <div className="pform-row">
        <div className="field">
          <label htmlFor="rc-contact">Contact name</label>
          <input id="rc-contact" name="contact_name" maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="rc-when">When the call happened</label>
          <input id="rc-when" name="occurred_at" type="datetime-local" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="rc-summary">What was said *</label>
        <textarea id="rc-summary" name="summary" rows={3} maxLength={2000} required />
      </div>
      <div className="field">
        <label htmlFor="rc-public">Customer-visible line (optional)</label>
        <input id="rc-public" name="public_message" maxLength={600} />
      </div>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        Never record card numbers, passwords or anything a caller read out that
        is not operational.
      </p>
    </ActionCard>
  );
}

export function RecordEmailForm({ shipmentId }: { shipmentId: string }) {
  return (
    <ActionCard
      title="Record an email"
      description="The subject and counterparty are stored as structured fields, so 'what did we send the receiver?' stays answerable."
      action={recordEmailAction}
      submitLabel="Record email"
      busyLabel="Recording…"
      tone="ghost"
    >
      <Hidden id={shipmentId} />
      {directionAndParty("re")}
      <div className="pform-row">
        <div className="field">
          <label htmlFor="re-counterparty">Their address</label>
          <input id="re-counterparty" name="counterparty" type="email" maxLength={254} />
        </div>
        <div className="field">
          <label htmlFor="re-when">When it was sent/received</label>
          <input id="re-when" name="occurred_at" type="datetime-local" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="re-subject">Subject *</label>
        <input id="re-subject" name="subject" maxLength={200} required />
      </div>
      <div className="field">
        <label htmlFor="re-summary">Summary</label>
        <textarea id="re-summary" name="summary" rows={2} maxLength={2000} />
      </div>
      <div className="field">
        <label htmlFor="re-public">Customer-visible line (optional)</label>
        <input id="re-public" name="public_message" maxLength={600} />
      </div>
    </ActionCard>
  );
}

export function LogExceptionForm({ shipmentId }: { shipmentId: string }) {
  return (
    <ActionCard
      title="Log an exception"
      description="Recorded on the timeline with its type and severity. Resolving exceptions, assignment and customer-notified tracking arrive with the exceptions module."
      action={logExceptionAction}
      submitLabel="Log exception"
      busyLabel="Logging…"
      tone="ghost"
    >
      <Hidden id={shipmentId} />
      <div className="pform-row">
        <div className="field">
          <label htmlFor="ex-type">Type</label>
          <select id="ex-type" name="exception_type" defaultValue="pickup_delay">
            {SHIPMENT_EXCEPTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ex-severity">Severity</label>
          <select id="ex-severity" name="severity" defaultValue="medium">
            {SHIPMENT_EXCEPTION_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <PhrasePicker
        name="public_description"
        label="What the customer is told"
        group="exception"
        help="Leave it blank if there is nothing honest to say yet — a blank alarm is worse than silence. Standard phrases are translated; your own words are shown in English, labelled."
      />
      <div className="field">
        <label htmlFor="ex-internal">What actually happened *</label>
        <textarea
          id="ex-internal"
          name="internal_description"
          rows={3}
          maxLength={2000}
          required
        />
      </div>
    </ActionCard>
  );
}

export function RequestPodForm({ shipmentId }: { shipmentId: string }) {
  return (
    <ActionCard
      title="Request proof of delivery"
      description="Puts a dated, attributed request on the carrier's timeline. Uploading and approving the document itself is the documents module."
      action={requestPodAction}
      submitLabel="Request POD"
      busyLabel="Requesting…"
      tone="ghost"
    >
      <Hidden id={shipmentId} />
      <div className="field">
        <label htmlFor="pod-note">Note to the carrier</label>
        <textarea id="pod-note" name="note" rows={2} maxLength={600} />
      </div>
    </ActionCard>
  );
}

export function ResendNotificationForm({ shipmentId }: { shipmentId: string }) {
  return (
    <ActionCard
      title="Re-send the customer notification"
      description="Sends an in-portal notification to the shipper's account now. Localized emails, delivery retry and customer preferences are the notifications module — call them if it is urgent."
      action={resendNotificationAction}
      submitLabel="Send notification"
      busyLabel="Sending…"
      tone="ghost"
    >
      <Hidden id={shipmentId} />
      <div className="field">
        <label htmlFor="rn-kind">Notification</label>
        <select id="rn-kind" name="kind" defaultValue="shipment_status">
          {RESENDABLE_NOTIFICATIONS.map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rn-reason">Why re-send it? *</label>
        <input id="rn-reason" name="reason" maxLength={300} required />
      </div>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        One notification of each kind per shipment per day — a repeat is
        absorbed rather than duplicated.
      </p>
    </ActionCard>
  );
}

/* ------------------------------------------------------------------ *
 * §20 — admin correction
 * ------------------------------------------------------------------ */

/**
 * Rendered ONLY for admins. The server refuses a dispatcher independently
 * (both in the action and inside `applyShipmentCorrection`), so hiding it is
 * the courtesy, not the control.
 */
export function CorrectionForm({
  shipmentId,
  status,
  statuses,
}: {
  shipmentId: string;
  status: ShipmentStatus;
  statuses: readonly ShipmentStatus[];
}) {
  return (
    <ActionCard
      title="Correct the status (admin)"
      description="For a status entered in error. It bypasses the normal transition rules on purpose — and records a correction entry beside the original, which is never deleted or edited."
      action={correctStatusAction}
      submitLabel="Record correction"
      busyLabel="Correcting…"
      tone="ghost"
    >
      <Hidden id={shipmentId} />
      <input type="hidden" name="expected_status" value={status} />
      <div className="field">
        <label htmlFor="cor-to">Correct it to</label>
        <select id="cor-to" name="corrected_status" defaultValue={status}>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cor-reason">Reason * (required, and recorded)</label>
        <textarea id="cor-reason" name="reason" rows={2} maxLength={600} required />
      </div>
      <div className="field">
        <label htmlFor="cor-public">Customer-visible explanation (optional)</label>
        <input id="cor-public" name="public_message" maxLength={600} />
      </div>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        A correction cannot change the tracking number — that is fixed at
        creation and cannot be altered by anybody, including this form.
      </p>
    </ActionCard>
  );
}
