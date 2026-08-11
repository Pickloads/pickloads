"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit";
import { field } from "@/lib/forms/guard";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getShipperOwnerRecipient, notifyCustomer } from "@/lib/notify";
import type { FormState } from "@/lib/form-state";
import { firstIssueMessage } from "@/lib/validation/shared";
import {
  appointmentSchema,
  assignCarrierSchema,
  assignDispatcherSchema,
  convertQuoteSchema,
  correctionSchema,
  createShipmentSchema,
  etaUpdateSchema,
  logExceptionSchema,
  noteSchema,
  recordCallSchema,
  recordEmailSchema,
  releaseCarrierSchema,
  requestPodSchema,
  resendNotificationSchema,
  resolveExceptionSchema,
  statusUpdateSchema,
  triageExceptionSchema,
} from "@/lib/validation/dispatcher-shipments";
/* M-76 — §13's driver-link lifecycle reuses the carrier module's schemas
 * rather than declaring a second pair: the dispatcher and carrier issuance
 * forms take the same fields, and two copies would be two places for a bound
 * to drift. */
import {
  issueDriverTokenSchema,
  revokeDriverTokenSchema,
} from "@/lib/validation/carrier-shipments";
import {
  issueDriverToken,
  revokeDriverToken,
} from "@/lib/shipments/driver-access";
import {
  driverUpdatePath,
  isDriverTokenConfigured,
} from "@/lib/shipments/driver-token";
import {
  appendShipmentEvent,
  applyShipmentCorrection,
  applyShipmentTransition,
  setShipmentAppointment,
  type ShipmentWriteResult,
} from "@/lib/shipments/apply-transition";
import {
  assignShipmentCarrier,
  releaseShipmentAssignment,
} from "@/lib/shipments/assignments";
import {
  createShipment,
  mapQuoteToShipmentDraft,
  QUOTE_CONVERSION_COLUMNS,
  type ConvertibleQuote,
} from "@/lib/shipments/create";
import { setShipmentEta } from "@/lib/shipments/eta";
import {
  openShipmentException,
  resolveShipmentException,
  triageShipmentException,
} from "@/lib/shipments/exceptions";
import {
  resolveShipmentAccess,
  resolveStaffActor,
  type ShipmentAccessGrant,
} from "@/lib/shipments/staff-access";
import type { ShipmentStatus } from "@/lib/shipments/types";

/**
 * M-75 — the §14 dispatcher actions.
 *
 * ── THE FOUR RULES EVERY ACTION IN THIS FILE FOLLOWS ──────────────────────
 *
 *   1. **`resolveShipmentAccess` first, always.** A server action is a public
 *      HTTP endpoint; the page that rendered its form is not a control. The
 *      gate re-reads the session, re-reads the shipment through the
 *      COOKIE-BOUND client (so 0018's staff policy applies) and applies the
 *      §19 dispatcher scope. `tests/unit/dispatcher-shipment-actions.test.ts`
 *      enumerates the exports and asserts none of them skips it.
 *   2. **Zod before any write.** Every field arrives as a string from a
 *      FormData; the schemas in `validation/dispatcher-shipments.ts` are where
 *      it stops being one.
 *   3. **Never a raw UPDATE on a status.** Status changes go through M-72's
 *      `applyShipmentTransition` (graph → actor gate → preconditions →
 *      compare-and-swap → atomic event), corrections through
 *      `applyShipmentCorrection`, appointments through
 *      `setShipmentAppointment`, and every other §14 action through
 *      `appendShipmentEvent` with an M-70 event type. This file invents no
 *      event semantics and re-implements no engine.
 *   4. **Audit through the single writer.** `recordAuditEvent` only —
 *      the M-69/P-4 ESLint rule forbids anything else, and the write paths in
 *      `create.ts` / `assignments.ts` / `eta.ts` / `apply-transition.ts`
 *      journal their own operations, so an action that composes two of them
 *      does not double-journal.
 *
 * ── WHY EVERY RESULT IS A `FormState` AND NOT A THROW ─────────────────────
 *
 * M-72's failures are typed and explanatory on purpose ("somebody else moved
 * this shipment", "pickup has not been confirmed", "a cancellation reason is
 * required"). A `throw` would replace all of that with a 500. The one message
 * that gets special handling is `status_conflict` — M-72 recorded as residual
 * risk R-4 that a dispatcher board MUST surface it as "reload", or people
 * retry blindly into a race.
 */

const SHIPMENTS_PATH = "/portal/admin/shipments";

function refresh(shipmentId?: string): void {
  revalidatePath(SHIPMENTS_PATH);
  if (shipmentId) revalidatePath(`${SHIPMENTS_PATH}/${shipmentId}`);
}

function error(message: string): FormState {
  return { status: "error", message };
}

function ok(message?: string): FormState {
  return message ? { status: "success", message } : { status: "success" };
}

/**
 * Turn an engine result into a `FormState`.
 *
 * M-72's R-4, made concrete: `status_conflict` is not a generic failure. Two
 * dispatchers read `in_transit`, both pressed a button, one won. The loser
 * must be told to RELOAD, because their page is now describing a shipment
 * that no longer exists in that state, and a retry from stale facts is how the
 * same mistake happens twice.
 */
function fromWrite(result: ShipmentWriteResult, success: string): FormState {
  if (result.ok) return ok(result.replayed ? `${success} (already recorded)` : success);
  if (result.code === "status_conflict") {
    return error(
      "Somebody else moved this shipment while you were working on it. Reload the page and check the timeline before trying again.",
    );
  }
  return error(result.message);
}

/** Every action's opening move. */
async function gate(
  formData: FormData,
): Promise<ShipmentAccessGrant | { ok: false; message: string }> {
  const access = await resolveShipmentAccess(field(formData, "shipment_id"));
  return access.ok ? access : { ok: false, message: access.message };
}

/* ================================================================== *
 * 1 · §14 create shipment
 * ================================================================== */

export async function createShipmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await resolveStaffActor();
  if (!actor.ok) return error(actor.message);

  const parsed = createShipmentSchema.safeParse({
    shipper_id: field(formData, "shipper_id"),
    quote_id: field(formData, "quote_id"),
    status: field(formData, "status"),
    origin_company: field(formData, "origin_company"),
    origin_address: field(formData, "origin_address"),
    origin_city: field(formData, "origin_city"),
    origin_state: field(formData, "origin_state"),
    origin_zip: field(formData, "origin_zip"),
    destination_company: field(formData, "destination_company"),
    destination_address: field(formData, "destination_address"),
    destination_city: field(formData, "destination_city"),
    destination_state: field(formData, "destination_state"),
    destination_zip: field(formData, "destination_zip"),
    equipment: field(formData, "equipment"),
    commodity_category: field(formData, "commodity_category"),
    weight_lbs: field(formData, "weight_lbs") || null,
    pallets: field(formData, "pallets") || null,
    shipper_reference: field(formData, "shipper_reference"),
    po_number: field(formData, "po_number"),
    pickup_appointment_at: field(formData, "pickup_appointment_at"),
    delivery_appointment_at: field(formData, "delivery_appointment_at"),
    gross_shipper_amount: field(formData, "gross_shipper_amount") || null,
    carrier_pay: field(formData, "carrier_pay") || null,
    internal_note: field(formData, "internal_note"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const result = await createShipment({
    draft: {
      shipper_id: d.shipper_id,
      quote_id: d.quote_id,
      // The creating dispatcher owns it. Without this a dispatcher creates a
      // shipment they immediately cannot see (§19 scope has two arms and this
      // is the one that covers carrier-less freight).
      dispatcher_id: actor.session.userId,
      status: d.status,
      origin_company: d.origin_company,
      origin_address: d.origin_address,
      origin_city: d.origin_city,
      origin_state: d.origin_state,
      origin_zip: d.origin_zip,
      destination_company: d.destination_company,
      destination_address: d.destination_address,
      destination_city: d.destination_city,
      destination_state: d.destination_state,
      destination_zip: d.destination_zip,
      equipment: d.equipment,
      commodity_category: d.commodity_category,
      weight_lbs: d.weight_lbs,
      pallets: d.pallets,
      shipper_reference: d.shipper_reference,
      po_number: d.po_number,
      pickup_appointment_at: d.pickup_appointment_at,
      delivery_appointment_at: d.delivery_appointment_at,
      gross_shipper_amount: d.gross_shipper_amount,
      carrier_pay: d.carrier_pay,
    },
    actorId: actor.session.userId,
    actorRole: actor.actorRole,
    internalMessage: d.internal_note,
  });

  if (!result.ok) return error(result.message);
  refresh(result.shipmentId);
  return ok(`Shipment ${result.trackingNumber} created.`);
}

/* ================================================================== *
 * 2 · §14 convert accepted quote → shipment
 * ================================================================== */

/**
 * Reads the quote through the CALLER'S client (0009's `"staff read quotes"`
 * policy), maps it with the pure `mapQuoteToShipmentDraft`, then creates.
 *
 * The double-conversion guard is a real query, not a flag: `idx_shipments_quote`
 * exists for exactly this question, and a quote converted twice produces two
 * shipments with one customer expectation behind them.
 */
export async function convertQuoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await resolveStaffActor();
  if (!actor.ok) return error(actor.message);

  const parsed = convertQuoteSchema.safeParse({
    quote_id: field(formData, "quote_id"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("freight_quotes")
    .select(QUOTE_CONVERSION_COLUMNS)
    .eq("id", parsed.data.quote_id)
    .maybeSingle();
  if (!quote) return error("That quote no longer exists.");

  const { data: existing } = await supabase
    .from("shipments")
    .select("id, tracking_number")
    .eq("quote_id", parsed.data.quote_id)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return error(
      `This quote was already converted — shipment ${existing.tracking_number}. Open that shipment instead of creating a second one.`,
    );
  }

  const mapped = mapQuoteToShipmentDraft(quote as unknown as ConvertibleQuote);
  if (!mapped.ok) return error(mapped.reason);

  const result = await createShipment({
    draft: { ...mapped.draft, dispatcher_id: actor.session.userId },
    actorId: actor.session.userId,
    actorRole: actor.actorRole,
    internalMessage: `Converted from quote ${parsed.data.quote_id}.`,
  });
  if (!result.ok) return error(result.message);

  refresh(result.shipmentId);
  const warning =
    mapped.warnings.length > 0 ? ` Check: ${mapped.warnings.join(" ")}` : "";
  return ok(`Shipment ${result.trackingNumber} created from the quote.${warning}`);
}

/* ================================================================== *
 * 3 · §14 assignments
 * ================================================================== */

export async function assignCarrierAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = assignCarrierSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    carrier_id: field(formData, "carrier_id"),
    driver_id: field(formData, "driver_id"),
    truck_id: field(formData, "truck_id"),
    dispatcher_id: field(formData, "dispatcher_id"),
    internal_note: field(formData, "internal_note"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  // §19: a dispatcher may only assign a carrier inside their own scope. The
  // dropdown is already scoped (`getAssignableCarriers`), and this is why
  // that is not enough — a hidden option is not a control.
  if (
    access.scope.carrierIds !== null &&
    !access.scope.carrierIds.includes(d.carrier_id)
  ) {
    return error(
      "That carrier is not assigned to you. Ask an admin to assign the carrier, or to make the assignment.",
    );
  }

  const result = await assignShipmentCarrier({
    shipmentId: access.shipmentId,
    carrierId: d.carrier_id,
    driverId: d.driver_id,
    truckId: d.truck_id,
    dispatcherId: d.dispatcher_id ?? access.session.userId,
    actorId: access.session.userId,
    actorRole: access.actorRole,
    internalMessage: d.internal_note,
  });
  if (!result.ok) return error(result.message);

  refresh(access.shipmentId);
  return ok(
    result.replayed
      ? "That assignment was already recorded."
      : "Carrier assigned. Move the status to Carrier Assigned when you are ready.",
  );
}

export async function releaseCarrierAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = releaseCarrierSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const result = await releaseShipmentAssignment({
    shipmentId: access.shipmentId,
    reason: parsed.data.reason,
    actorId: access.session.userId,
    actorRole: access.actorRole,
  });
  if (!result.ok) return error(result.message);

  refresh(access.shipmentId);
  return ok("Carrier released. The assignment stays in the history.");
}

/**
 * §14 "assign dispatcher" — the one §14 action that is a plain column write.
 *
 * It changes no status, creates no assignment and moves no freight; it changes
 * WHO OWNS the shipment operationally, which is a §19 scope fact rather than a
 * §7 timeline fact. So it is a scoped UPDATE plus an internal note plus an
 * audit row — and the note is what makes the change visible in "view update
 * history", which is where a dispatcher looks when a shipment leaves their
 * board.
 */
export async function assignDispatcherAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = assignDispatcherSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    dispatcher_id: field(formData, "dispatcher_id"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) {
    return error("SUPABASE_SERVICE_ROLE_KEY is unset — nothing was written.");
  }
  const { error: writeError } = await admin
    .from("shipments")
    .update({ dispatcher_id: parsed.data.dispatcher_id })
    .eq("id", access.shipmentId);
  if (writeError) {
    console.error("[dispatcher-shipments] reassign failed", writeError.message);
    return error("Couldn't reassign the shipment. Retry.");
  }

  await appendShipmentEvent({
    shipmentId: access.shipmentId,
    eventType: "internal_note",
    actor: access.actorRole,
    actorId: access.session.userId,
    source: access.actorRole,
    visibility: "staff_only",
    internalMessage:
      parsed.data.dispatcher_id === null
        ? "Dispatcher unassigned."
        : `Dispatcher changed to ${parsed.data.dispatcher_id}.`,
    metadata: {
      previous_dispatcher_id: access.dispatcherId,
      new_dispatcher_id: parsed.data.dispatcher_id,
    },
  });

  await recordAuditEvent({
    actorId: access.session.userId,
    action: "shipment.dispatcher_assigned",
    targetTable: "shipments",
    targetId: access.shipmentId,
    detail: {
      previous_dispatcher_id: access.dispatcherId,
      new_dispatcher_id: parsed.data.dispatcher_id,
    },
  });

  refresh(access.shipmentId);
  return ok("Dispatcher updated.");
}

/* ================================================================== *
 * 4 · §14 appointments — M-72 event-sources these; call that path
 * ================================================================== */

export async function setAppointmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = appointmentSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    kind: field(formData, "kind"),
    appointment_at: field(formData, "appointment_at"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const result = await setShipmentAppointment({
    shipmentId: access.shipmentId,
    kind: parsed.data.kind,
    newAt: parsed.data.appointment_at,
    actor: access.actorRole,
    actorId: access.session.userId,
    source: access.actorRole,
    reason: parsed.data.reason,
  });

  refresh(access.shipmentId);
  if (!result.ok) {
    // 0019 refuses a reschedule to the identical time (PL422). That is not an
    // operator error and is not reported as one.
    if (result.code === "invalid_input") return error(result.message);
    return fromWrite(result, "");
  }
  return ok(
    result.eventType === "appointment_rescheduled"
      ? "Appointment rescheduled. The previous time is on the timeline."
      : "Appointment set.",
  );
}

/* ================================================================== *
 * 5 · §14 status update — M-72's engine ONLY
 * ================================================================== */

export async function updateStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = statusUpdateSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    expected_status: field(formData, "expected_status"),
    to: field(formData, "to"),
    public_message: field(formData, "public_message"),
    internal_message: field(formData, "internal_message"),
    city: field(formData, "city"),
    state: field(formData, "state"),
    cancellation_reason: field(formData, "cancellation_reason"),
    closeout_confirmed: field(formData, "closeout_confirmed") === "on",
    publish: field(formData, "publish") === "on",
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const result = await applyShipmentTransition({
    shipmentId: access.shipmentId,
    // The compare-and-swap uses what the PAGE believed, not what we just read
    // in the gate — otherwise the gate's read would silently repair a stale
    // form and the conflict M-72 exists to surface would never surface.
    expectedStatus: d.expected_status as ShipmentStatus,
    to: d.to as ShipmentStatus,
    actor: access.actorRole,
    actorId: access.session.userId,
    source: access.actorRole,
    // §7/§14: public update vs internal note is a VISIBILITY, and the operator
    // chose it on the form. Defaulting to `staff_only` means a forgotten
    // checkbox publishes nothing.
    visibility: d.publish && d.public_message ? "public" : "staff_only",
    publicMessage: d.publish ? d.public_message : null,
    internalMessage: d.internal_message,
    city: d.city,
    state: d.state,
    cancellationReason: d.cancellation_reason,
    // §20's closeout is a human assertion (M-72: "deliberately not derivable").
    // It is supplied only when the operator ticked the box on THIS submission.
    assertions: d.closeout_confirmed
      ? { closeoutCompletedAt: new Date().toISOString() }
      : {},
  });

  refresh(access.shipmentId);
  return fromWrite(result, `Status updated to ${d.to.replace(/_/g, " ")}.`);
}

/* ================================================================== *
 * 6 · §14 ETA update
 * ================================================================== */

export async function updateEtaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = etaUpdateSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    kind: field(formData, "kind"),
    eta_at: field(formData, "eta_at"),
    eta_source: field(formData, "eta_source"),
    eta_confidence: field(formData, "eta_confidence"),
    delay_minutes: field(formData, "delay_minutes") || null,
    reason_public: field(formData, "reason_public"),
    reason_internal: field(formData, "reason_internal"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const result = await setShipmentEta({
    shipmentId: access.shipmentId,
    kind: d.kind,
    newAt: d.eta_at,
    etaSource: d.eta_source,
    etaConfidence: d.eta_confidence,
    delayMinutes: d.delay_minutes,
    reasonPublic: d.reason_public,
    reasonInternal: d.reason_internal,
    actorId: access.session.userId,
    actorRole: access.actorRole,
    publicMessage: d.reason_public,
  });

  refresh(access.shipmentId);
  if (!result.ok) return error(result.message);
  return ok(
    result.previousAt === null
      ? "ETA set."
      : "ETA updated. The previous time is on the timeline.",
  );
}

/* ================================================================== *
 * 7 · §14 public update vs internal note
 * ================================================================== */

/**
 * ONE form, one switch, two event types — because §7 made the distinction a
 * VISIBILITY rather than a table and M-72 shipped both event types for it.
 *
 * `public` writes `public_update` with `visibility: "public"` and the text in
 * `public_message`; `internal` writes `internal_note` with `staff_only` and
 * the text in `internal_message`. A public update never lands in
 * `internal_message` and vice versa, which is what keeps M-74's shipper
 * projection (which selects one and not the other) correct by construction.
 */
export async function addNoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = noteSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    band: field(formData, "band"),
    body: field(formData, "body"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const isPublic = parsed.data.band === "public";

  const result = await appendShipmentEvent({
    shipmentId: access.shipmentId,
    eventType: isPublic ? "public_update" : "internal_note",
    actor: access.actorRole,
    actorId: access.session.userId,
    source: access.actorRole,
    visibility: isPublic ? "public" : "staff_only",
    publicMessage: isPublic ? parsed.data.body : null,
    internalMessage: isPublic ? null : parsed.data.body,
  });

  if (result.ok) {
    await recordAuditEvent({
      actorId: access.session.userId,
      action: isPublic ? "shipment.public_update" : "shipment.internal_note",
      targetTable: "shipment_events",
      targetId: result.eventId,
      detail: { shipment_id: access.shipmentId, visibility: isPublic ? "public" : "staff_only" },
    });
  }

  refresh(access.shipmentId);
  return fromWrite(
    result,
    isPublic
      ? "Published to the customer timeline."
      : "Internal note saved. Customers never see it.",
  );
}

/* ================================================================== *
 * 8 · §14 record call / record email
 * ================================================================== */

/**
 * §14 names both, and `FINAL-IMPLEMENTATION-PLAN` §4 restores them explicitly
 * (*"Dispatcher 'record call / record email' — absent from M-75"*). M-72 gave
 * each an event type (`call_logged`, `email_logged`) with the instruction not
 * to invent new ones, so this is the write path and the form is the surface.
 *
 * The structured facts — direction, counterparty, when it happened — go in
 * `metadata`, not into the prose. A dispatcher searching "who called the
 * receiver on Tuesday?" is asking a structured question, and burying the
 * answer in free text makes it unanswerable the moment the shipment has
 * twenty notes on it.
 *
 * `event_time` is when the CALL happened; `recorded_at` is when it was typed
 * up. §7 keeps both on purpose and this is the action that makes the
 * distinction real — a 06:40 arrival written up at 09:15 is the example M-72's
 * migration gives.
 *
 * **Never the contents.** A call summary is operational; a recording, a
 * password read out over the phone or a card number is not, and there is no
 * field here for any of them.
 */
export async function recordCallAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = recordCallSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    direction: field(formData, "direction"),
    party: field(formData, "party"),
    contact_name: field(formData, "contact_name"),
    occurred_at: field(formData, "occurred_at"),
    summary: field(formData, "summary"),
    public_message: field(formData, "public_message"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const result = await appendShipmentEvent({
    shipmentId: access.shipmentId,
    eventType: "call_logged",
    actor: access.actorRole,
    actorId: access.session.userId,
    source: access.actorRole,
    // A logged call is internal unless the dispatcher wrote a customer line.
    visibility: d.public_message ? "public" : "staff_only",
    eventTime: d.occurred_at ?? new Date().toISOString(),
    internalMessage: d.summary,
    publicMessage: d.public_message,
    metadata: {
      direction: d.direction,
      party: d.party,
      contact_name: d.contact_name,
    },
  });

  if (result.ok) {
    await recordAuditEvent({
      actorId: access.session.userId,
      action: "shipment.call_logged",
      targetTable: "shipment_events",
      targetId: result.eventId,
      detail: {
        shipment_id: access.shipmentId,
        direction: d.direction,
        party: d.party,
      },
    });
  }

  refresh(access.shipmentId);
  return fromWrite(result, "Call recorded on the timeline.");
}

export async function recordEmailAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = recordEmailSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    direction: field(formData, "direction"),
    party: field(formData, "party"),
    counterparty: field(formData, "counterparty"),
    subject: field(formData, "subject"),
    occurred_at: field(formData, "occurred_at"),
    summary: field(formData, "summary"),
    public_message: field(formData, "public_message"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const result = await appendShipmentEvent({
    shipmentId: access.shipmentId,
    eventType: "email_logged",
    actor: access.actorRole,
    actorId: access.session.userId,
    source: access.actorRole,
    visibility: d.public_message ? "public" : "staff_only",
    eventTime: d.occurred_at ?? new Date().toISOString(),
    internalMessage: d.summary ?? d.subject,
    publicMessage: d.public_message,
    metadata: {
      direction: d.direction,
      party: d.party,
      counterparty: d.counterparty,
      subject: d.subject,
    },
  });

  if (result.ok) {
    await recordAuditEvent({
      actorId: access.session.userId,
      action: "shipment.email_logged",
      targetTable: "shipment_events",
      targetId: result.eventId,
      detail: {
        shipment_id: access.shipmentId,
        direction: d.direction,
        party: d.party,
      },
    });
  }

  refresh(access.shipmentId);
  return fromWrite(result, "Email recorded on the timeline.");
}

/* ================================================================== *
 * 9 · §21 exceptions — open, triage, resolve (M-78)
 * ================================================================== */

/**
 * §14 "log exception" — now writing a REAL ROW.
 *
 * M-75 shipped this as an `exception_opened` EVENT carrying the §21 type and
 * severity in `metadata`, marked `exception_source = "m75_event_only"`, and
 * said in its own doc that M-78 would *"backfill from"* those events. Both
 * halves of that contract are honoured:
 *
 *   * this action now calls `open_shipment_exception()`, which writes the
 *     `shipment_exceptions` row AND the same `exception_opened` event in one
 *     transaction — so the timeline a customer reads is unchanged and the
 *     lifecycle §21 asks for now exists behind it;
 *   * every event M-75 and M-76 already wrote has been migrated into a row by
 *     0025's backfill, and NOT ONE of them was deleted or edited (§7 is
 *     append-only, and 0019's trigger refuses an UPDATE even from the service
 *     role).
 *
 * VISIBILITY IS NOT PASSED FROM HERE. M-75 computed it in this file
 * (`d.public_description ? "public" : "staff_only"`); 0025 computes it in the
 * function, from the same rule, so a second writer cannot file a public
 * description as a staff-only event. §21 decides it, not the caller.
 */
export async function logExceptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = logExceptionSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    exception_type: field(formData, "exception_type"),
    severity: field(formData, "severity"),
    public_description: field(formData, "public_description"),
    internal_description: field(formData, "internal_description"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const result = await openShipmentException({
    shipmentId: access.shipmentId,
    exceptionType: d.exception_type,
    severity: d.severity,
    publicDescription: d.public_description,
    internalDescription: d.internal_description,
    openedBy: access.session.userId,
    source: access.actorRole,
    reportedBy: access.actorRole,
  });

  if (!result.ok) return error(result.message);
  refresh(access.shipmentId);
  return ok(
    d.public_description
      ? "Exception logged. The customer now sees the explanation you published."
      : "Exception logged. Nothing has been published to the customer — add wording when there is something honest to say.",
  );
}

/**
 * §14's OTHER half, which M-75 named as M-78's and deliberately did not build:
 * *"`resolve exception` … NOT implemented here, because resolving needs a row
 * to resolve and a lifecycle to close."* The row exists now.
 *
 * TWO server-side checks, not one. `gate()` establishes that this staff member
 * may act on this SHIPMENT (§19's dispatcher scope, re-read from the session
 * and not from the form). The second check is that the chosen EXCEPTION
 * belongs to that shipment — without it, a dispatcher scoped to shipment A
 * could resolve an exception on shipment B by editing one hidden field.
 */
export async function resolveExceptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = resolveExceptionSchema.safeParse({
    exception_id: field(formData, "exception_id"),
    resolution: field(formData, "resolution"),
    public_message: field(formData, "public_message"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const owned = await exceptionBelongsToShipment(
    d.exception_id,
    access.shipmentId,
  );
  if (!owned) {
    return error(
      "That exception is not on this shipment. Reload the page and try again.",
    );
  }

  const result = await resolveShipmentException({
    exceptionId: d.exception_id,
    resolution: d.resolution,
    actorId: access.session.userId,
    source: access.actorRole,
    publicMessage: d.public_message,
  });

  if (!result.ok) return error(result.message);
  refresh(access.shipmentId);
  return ok(
    "Exception resolved. It is closed for good — re-opening means logging a new one.",
  );
}

/** §21's triage fields: assign, re-severity, publish wording, mark notified. */
export async function triageExceptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = triageExceptionSchema.safeParse({
    exception_id: field(formData, "exception_id"),
    assigned_to: field(formData, "assigned_to"),
    severity: field(formData, "severity"),
    public_description: field(formData, "public_description"),
    mark_customer_notified: field(formData, "mark_customer_notified"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const owned = await exceptionBelongsToShipment(
    d.exception_id,
    access.shipmentId,
  );
  if (!owned) {
    return error(
      "That exception is not on this shipment. Reload the page and try again.",
    );
  }

  const result = await triageShipmentException({
    exceptionId: d.exception_id,
    assignedTo: d.assigned_to,
    severity: d.severity,
    publicDescription: d.public_description,
    markCustomerNotified: d.mark_customer_notified,
    actorId: access.session.userId,
  });

  if (!result.ok) return error(result.message);
  refresh(access.shipmentId);
  return ok("Exception updated.");
}

/**
 * Does this exception belong to this shipment?
 *
 * Read through the COOKIE-BOUND client, so 0025's `"staff manage shipment
 * exceptions"` policy answers as well — a non-staff session reaching this
 * point (it cannot, `gate()` refuses first) would read no row and be refused
 * a second time. Two independent conditions for one authorization, which is
 * the pattern every shipment surface in this codebase uses.
 */
async function exceptionBelongsToShipment(
  exceptionId: string,
  shipmentId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipment_exceptions")
    .select("id")
    .eq("id", exceptionId)
    .eq("shipment_id", shipmentId)
    .maybeSingle();
  return data !== null;
}

/* ================================================================== *
 * 10 · §14 request POD
 * ================================================================== */

/**
 * `pod_requested` is an M-70 event type and M-72 named it among the actions
 * belonging to the append path. The DOCUMENT itself is M-77's — nothing here
 * uploads, approves or stores anything — so what this action does is put a
 * dated, attributed request on the record that the carrier surface (M-76) and
 * the documents module (M-77) can both answer.
 *
 * Visibility is `carrier`, not `public`: the request is addressed to the
 * carrier, and a customer reading "we have asked for your POD" on their
 * timeline learns nothing except that paperwork is late.
 */
export async function requestPodAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = requestPodSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const result = await appendShipmentEvent({
    shipmentId: access.shipmentId,
    eventType: "pod_requested",
    actor: access.actorRole,
    actorId: access.session.userId,
    source: access.actorRole,
    visibility: "carrier",
    internalMessage: parsed.data.note ?? "Proof of delivery requested.",
    metadata: { requested_at: new Date().toISOString() },
  });

  if (result.ok) {
    await recordAuditEvent({
      actorId: access.session.userId,
      action: "shipment.pod_requested",
      targetTable: "shipment_events",
      targetId: result.eventId,
      detail: { shipment_id: access.shipmentId },
    });
  }

  refresh(access.shipmentId);
  return fromWrite(result, "POD requested. The carrier sees it on their timeline.");
}

/* ================================================================== *
 * 11 · §14 resend customer notification
 * ================================================================== */

/**
 * HONEST SCOPE, because §30 applies to internal surfaces too.
 *
 * **M-79 owns notifications** — the 11 customer events, idempotency keys,
 * dedupe, retry with backoff, preference respect, ×5 localisation and the
 * background worker. None of that exists yet, and there is no shipment email
 * template in `src/emails/` to resend.
 *
 * So what this action does, exactly: it writes the shipper's IN-PORTAL
 * notification row pointing at their shipment, and records a
 * `notification_sent` event with an idempotency key derived from the shipment,
 * the kind and the day. The UI says so in those words. It does NOT send an
 * email, and it does not claim to.
 *
 * The idempotency key is the useful part for M-79: a resend of the same kind
 * on the same day is absorbed by 0019's global unique index rather than
 * producing a second notification, which is the dedupe behaviour M-79 will
 * generalise. The mandatory reason is on the record because a duplicate
 * customer notification is a thing somebody will ask about.
 */
export async function resendNotificationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = resendNotificationSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    kind: field(formData, "kind"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const admin = tryCreateAdminClient();
  if (!admin) {
    return error("SUPABASE_SERVICE_ROLE_KEY is unset — nothing was sent.");
  }

  const recipient = await getShipperOwnerRecipient(admin, access.shipperId);
  if (!recipient) {
    return error(
      "This shipper has no portal owner account yet, so there is nobody to notify. Invite them from the Users page.",
    );
  }

  const day = new Date().toISOString().slice(0, 10);
  const result = await appendShipmentEvent({
    shipmentId: access.shipmentId,
    eventType: "notification_sent",
    actor: access.actorRole,
    actorId: access.session.userId,
    source: access.actorRole,
    visibility: "staff_only",
    internalMessage: `Re-sent ${d.kind} notification. Reason: ${d.reason}`,
    idempotencyKey: `m75:notify:${access.shipmentId}:${d.kind}:${day}`,
    metadata: { kind: d.kind, reason: d.reason, channel: "portal_feed" },
  });

  if (!result.ok) return fromWrite(result, "");
  if (result.replayed) {
    return error(
      "That notification was already sent to this customer today. Wait until tomorrow, or call them.",
    );
  }

  await notifyCustomer({
    recipient,
    kind: d.kind,
    title: `Update on shipment ${access.trackingNumber}`,
    body: "Open the shipment for the latest status and timeline.",
    href: `/portal/shipper/shipments/${access.shipmentId}`,
  });

  await recordAuditEvent({
    actorId: access.session.userId,
    action: "shipment.notification_resent",
    targetTable: "shipments",
    targetId: access.shipmentId,
    detail: { kind: d.kind, reason: d.reason, recipient_profile: recipient.profileId },
  });

  refresh(access.shipmentId);
  return ok("In-portal notification sent. (Emails are M-79 — call them if it is urgent.)");
}

/* ================================================================== *
 * 12 · §20 controlled admin correction
 * ================================================================== */

/**
 * §20: *"Allow controlled admin correction with mandatory reason and audit
 * event."*
 *
 * M-72 OWNS this flow — `applyShipmentCorrection` refuses a non-admin, refuses
 * a blank reason, writes an additive `correction` event with
 * `corrected_from`/`corrected_to`, journals to `audit_events` through the
 * single writer, and keeps the compare-and-swap. **It is called here, not
 * reimplemented.**
 *
 * What this action adds is the two things a server action has to add: the
 * ADMIN-ONLY gate at the surface (so a dispatcher never sees the form and
 * never reaches the endpoint), and a reason bound a human can read. The engine
 * refuses a dispatcher independently — this check is the message, not the
 * control.
 *
 * It corrects a STATUS. It does not, and cannot, rewrite a tracking number:
 * §5 makes that immutable, 0017's trigger enforces it against every role
 * including the service role, and M-71 recorded that changing it would take a
 * visible migration dropping and recreating the trigger. Nothing here does.
 */
export async function correctStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);
  if (access.actorRole !== "admin") {
    return error(
      "Only an admin can correct a shipment status. §20 reserves corrections for admins — ask one, with the reason.",
    );
  }

  const parsed = correctionSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    expected_status: field(formData, "expected_status"),
    corrected_status: field(formData, "corrected_status"),
    reason: field(formData, "reason"),
    public_message: field(formData, "public_message"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  if (d.expected_status === d.corrected_status) {
    return error("That is the status it is already in. Nothing to correct.");
  }

  const result = await applyShipmentCorrection({
    shipmentId: access.shipmentId,
    expectedStatus: d.expected_status as ShipmentStatus,
    correctedStatus: d.corrected_status as ShipmentStatus,
    reason: d.reason,
    actor: "admin",
    actorId: access.session.userId,
    visibility: d.public_message ? "public" : "staff_only",
    publicMessage: d.public_message,
  });

  refresh(access.shipmentId);
  return fromWrite(
    result,
    `Corrected to ${d.corrected_status.replace(/_/g, " ")}. The original entry stays on the timeline.`,
  );
}

/* ================================================================== *
 * 16 · M-76 — §13 driver-link lifecycle (dispatcher half)
 * ================================================================== */

/**
 * Issue a `/driver/update/[token]` link for this shipment.
 *
 * §13 permits both origins — *"a dispatcher issuing from the operations
 * surface, a carrier issuing from their own portal"* — and this is the
 * dispatcher one. `src/app/actions/carrier-shipments.ts` holds the carrier
 * twin; both call `issueDriverToken`, which is the only minting path.
 *
 * THE PLAINTEXT TOKEN IS IN THE RETURN VALUE AND NOWHERE ELSE. The row holds
 * an HMAC and `token_hash` is column-revoked from every browser-reachable
 * role, so the link is rendered once, copied into a text message, and never
 * retrievable. Re-issuing is one click; a portal that could re-read a live
 * credential is a portal that can leak one.
 */
export async function issueDriverTokenAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = issueDriverTokenSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    driver_id: field(formData, "driver_id"),
    driver_name: field(formData, "driver_name"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  // §13 "only assigned shipment" / "no access to other carrier records": a
  // link cannot exist before a carrier does. 0023's function refuses this
  // independently (PL422) — this is the message, not the control.
  if (access.carrierId === null) {
    return error(
      "Assign a carrier before issuing a driver link — the link is scoped to the carrier hauling this freight.",
    );
  }
  if (!isDriverTokenConfigured()) {
    return error(
      "DRIVER_TOKEN_SECRET is unset in this environment, so no driver link can be minted or verified. Nothing was issued.",
    );
  }

  const result = await issueDriverToken({
    shipmentId: access.shipmentId,
    carrierId: access.carrierId,
    driverId: parsed.data.driver_id,
    driverName: parsed.data.driver_name,
    issuedBy: access.session.userId,
    issuedByRole: access.actorRole,
  });
  if (!result.ok) return error(result.message);

  refresh(access.shipmentId);
  return ok(
    `Driver link created — copy it now, it is not shown again: ${driverUpdatePath(result.token)}`,
  );
}

/**
 * §13 "revocable", from the dispatcher side.
 *
 * The gate proved this staff member may act on this SHIPMENT; it has not
 * proved the posted token belongs to it. `revoke_shipment_driver_token` takes
 * an id, so without the scoping read below a dispatcher could revoke any link
 * in the system by posting somebody else's id — including one on a shipment
 * outside their §19 scope. The read runs through the COOKIE-BOUND client, so
 * 0023's `"staff manage driver tokens"` policy applies on top of the
 * `shipment_id` predicate.
 */
export async function revokeDriverTokenAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = revokeDriverTokenSchema.safeParse({
    token_id: field(formData, "token_id"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { data: token } = await supabase
    .from("shipment_driver_tokens")
    .select("id, shipment_id")
    .eq("id", parsed.data.token_id)
    .eq("shipment_id", access.shipmentId)
    .maybeSingle();
  if (!token) return error("That driver link is not on this shipment.");

  const result = await revokeDriverToken({
    tokenId: parsed.data.token_id,
    reason: parsed.data.reason,
    actorId: access.session.userId,
    actorRole: access.actorRole,
  });
  if (!result.ok) return error(result.message);

  refresh(access.shipmentId);
  return ok(
    result.alreadyRevoked
      ? "That link was already revoked."
      : "Driver link revoked. It stops working immediately.",
  );
}
