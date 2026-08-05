import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import {
  actorMayCorrect,
  evaluateTransition,
  NO_TRANSITION_FACTS,
  type PreconditionCode,
  type TransitionActor,
  type TransitionFacts,
  type TransitionRejectionCode,
} from "@/lib/shipments/transitions";
import { logShipmentSignal } from "@/lib/shipments/observability";
import type {
  EtaKind,
  ShipmentEventSource,
  ShipmentEventType,
  ShipmentEventVisibility,
  ShipmentStatus,
} from "@/lib/shipments/types";

/**
 * M-72 — the server-side application layer for the transition engine
 * (`docs/DIRECTIVE-tracking.md` §7, §14, §15, §19, §20, §26).
 *
 * `transitions.ts` decides. This file makes the decision durable, and it is
 * the ONLY thing in the codebase that may call migration 0019's write
 * functions. Its four jobs, in order:
 *
 *   1. resolve the §20 facts in one query (`shipment_transition_facts`);
 *   2. ask the engine, and stop at a typed failure without touching the DB;
 *   3. write the status change AND its `shipment_events` row in ONE atomic
 *      round trip, respecting the caller's idempotency key;
 *   4. journal staff-initiated changes through `src/lib/audit.ts` — the single
 *      writer M-69/P-4 made enforceable with an ESLint rule.
 *
 * ── WHY AN RPC AND NOT `.update()` + `.insert()` ──────────────────────────
 *
 * PostgREST has no multi-statement transaction, so two supabase-js calls are
 * two transactions. A crash between them leaves a shipment whose status has no
 * event explaining it — §6 ("create a separate event history instead of
 * overwriting the shipment record without history") and §7 both forbid exactly
 * that state, and no amount of client-side care prevents it. The RPC is also
 * the only place a COMPARE-AND-SWAP can live: it applies the change only if
 * the row is still in the status the engine judged, so two dispatchers acting
 * on the same shipment produce one winner and one typed `status_conflict`
 * rather than a lost update with a plausible-looking event.
 *
 * ── EVERY FAILURE IS TYPED ────────────────────────────────────────────────
 *
 * Nothing here throws for a domain outcome and nothing returns a bare boolean.
 * Callers get a discriminated union; the failure carries a machine code, an
 * operator sentence and, for precondition failures, exactly which
 * preconditions were unmet. Unexpected exceptions are caught and converted, so
 * a server action can render an honest message instead of a 500.
 *
 * ── SECRETLESS ENVIRONMENTS ───────────────────────────────────────────────
 *
 * `tryCreateAdminClient()` returns null without a service-role key (the M-14
 * graceful-degradation idiom the whole repo uses). Every entry point below
 * then returns `not_configured` rather than pretending to have written — the
 * same honesty rule M-52…M-56 apply to their form actions.
 */

/* ------------------------------------------------------------------ *
 * Result types
 * ------------------------------------------------------------------ */

export type ShipmentWriteFailureCode =
  | TransitionRejectionCode
  /** No service-role key — nothing was written and nothing is pretended. */
  | "not_configured"
  /** The shipment id does not resolve (`PL404`). */
  | "shipment_not_found"
  /** Compare-and-swap lost: another writer moved the row (`PL409`). */
  | "status_conflict"
  /** The database refused the arguments (`PL422`, or a CHECK). */
  | "invalid_input"
  /** Anything else — network, permission, unexpected SQLSTATE. */
  | "write_failed";

export interface ShipmentWriteFailure {
  ok: false;
  code: ShipmentWriteFailureCode;
  message: string;
  shipmentId: string;
  from?: ShipmentStatus;
  to?: ShipmentStatus;
  preconditions?: readonly PreconditionCode[];
}

export interface ShipmentWriteSuccess {
  ok: true;
  shipmentId: string;
  eventId: string;
  status: ShipmentStatus | null;
  /**
   * True when the idempotency key (or provider event id) matched an existing
   * event: NOTHING was written, and `eventId` is the original. §17's
   * notification dedupe and §9's Mode C replay both depend on this being
   * observable rather than silently absorbed.
   */
  replayed: boolean;
}

export type ShipmentWriteResult = ShipmentWriteSuccess | ShipmentWriteFailure;

export interface AppointmentWriteSuccess extends ShipmentWriteSuccess {
  eventType: Extract<
    ShipmentEventType,
    "appointment_set" | "appointment_rescheduled"
  >;
  previousAt: string | null;
  newAt: string | null;
}

export type AppointmentWriteResult =
  | AppointmentWriteSuccess
  | ShipmentWriteFailure;

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

/** Actors whose writes belong in the §15 operator ledger. */
const STAFF_ACTORS: readonly TransitionActor[] = ["admin", "dispatcher"];

function isStaffActor(actor: TransitionActor): boolean {
  return STAFF_ACTORS.includes(actor);
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

/**
 * Map a PostgREST/PostgreSQL error onto a typed failure.
 *
 * The three custom SQLSTATEs are raised by migration 0019 and are the contract
 * between the two files; anything else is `write_failed`, deliberately
 * un-interpreted, because guessing at an unknown code is how a permission
 * error gets rendered to an operator as "shipment not found".
 */
function failureFromDbError(
  error: PostgrestLikeError,
  shipmentId: string,
  extra: Pick<ShipmentWriteFailure, "from" | "to"> = {},
): ShipmentWriteFailure {
  const code = error.code ?? "";
  const message = error.message ?? "database write failed";
  if (code === "PL404") {
    return { ok: false, code: "shipment_not_found", message, shipmentId, ...extra };
  }
  if (code === "PL409") {
    return { ok: false, code: "status_conflict", message, shipmentId, ...extra };
  }
  if (code === "PL422" || code === "23514") {
    return { ok: false, code: "invalid_input", message, shipmentId, ...extra };
  }
  return { ok: false, code: "write_failed", message, shipmentId, ...extra };
}

/** Emit the §26 `status-update error` signal for any failure. */
function reportFailure(
  failure: ShipmentWriteFailure,
  actor: TransitionActor,
  actorId: string | null,
): ShipmentWriteFailure {
  logShipmentSignal({
    signal: "status_update_error",
    code: failure.code,
    shipmentId: failure.shipmentId,
    from: failure.from ?? null,
    to: failure.to ?? null,
    actorRole: actor,
    actorId,
    detail: failure.message,
  });
  return failure;
}

/** Shape of every RPC return in 0019. `unknown` in, narrowed here. */
interface RpcEnvelope {
  event_id?: unknown;
  shipment_id?: unknown;
  status?: unknown;
  replayed?: unknown;
  event_type?: unknown;
  previous_at?: unknown;
  new_at?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/* ------------------------------------------------------------------ *
 * Facts (§20 preconditions, §25 one query)
 * ------------------------------------------------------------------ */

export interface ResolvedShipmentFacts {
  status: ShipmentStatus;
  trackingNumber: string;
  carrierId: string | null;
  facts: TransitionFacts;
}

export type ResolveFactsResult =
  | ({ ok: true } & ResolvedShipmentFacts)
  | ShipmentWriteFailure;

/**
 * One round trip for every §20 fact plus the current status.
 *
 * `assertions` is how the caller supplies the two facts the database cannot
 * answer yet — `approvedPodDocumentId` (M-77 owns documents) and
 * `closeoutCompletedAt` (a human assertion M-75's surface makes) — and the
 * delivery timestamp the CURRENT transition is asserting. Anything not
 * asserted stays null, which means the corresponding precondition fails. That
 * direction is deliberate: an unknown precondition must refuse, never pass.
 */
export async function resolveShipmentFacts(
  shipmentId: string,
  assertions: Partial<TransitionFacts> = {},
): Promise<ResolveFactsResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is unset — shipment facts cannot be read",
      shipmentId,
    };
  }

  const { data, error } = await admin.rpc("shipment_transition_facts", {
    p_shipment_id: shipmentId,
  });

  if (error) return failureFromDbError(error, shipmentId);
  if (!data || typeof data !== "object") {
    return {
      ok: false,
      code: "shipment_not_found",
      message: `shipment ${shipmentId} does not exist`,
      shipmentId,
    };
  }

  const row = data as Record<string, unknown>;
  const status = asString(row.status) as ShipmentStatus | null;
  if (status === null) {
    return {
      ok: false,
      code: "shipment_not_found",
      message: `shipment ${shipmentId} does not exist`,
      shipmentId,
    };
  }

  return {
    ok: true,
    status,
    trackingNumber: asString(row.tracking_number) ?? "",
    carrierId: asString(row.carrier_id),
    facts: {
      ...NO_TRANSITION_FACTS,
      activeAssignmentId: asString(row.active_assignment_id),
      pickupConfirmedAt: asString(row.pickup_confirmed_at),
      deliveredAt: asString(row.delivered_at),
      approvedPodDocumentId: asString(row.approved_pod_document_id),
      ...assertions,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 1 · Status transition
 * ------------------------------------------------------------------ */

export interface ApplyTransitionInput {
  shipmentId: string;
  /** The status the caller believes the shipment is in (compare-and-swap). */
  expectedStatus: ShipmentStatus;
  to: ShipmentStatus;
  actor: TransitionActor;
  actorId?: string | null;
  source: ShipmentEventSource;
  /** §7 band. Defaults to `staff_only` — privacy-first, as in 0019's DDL. */
  visibility?: ShipmentEventVisibility;
  /** When it happened in the world. Also the asserted delivery timestamp. */
  eventTime?: string;
  publicMessage?: string | null;
  internalMessage?: string | null;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown> | null;
  externalEventId?: string | null;
  idempotencyKey?: string | null;
  /** §20 — required when `to` is `cancelled`. */
  cancellationReason?: string | null;
  /**
   * Facts the database cannot derive: `approvedPodDocumentId` (M-77),
   * `closeoutCompletedAt` (M-75's closeout confirmation).
   */
  assertions?: Partial<TransitionFacts>;
  /** Pre-resolved facts, when the caller already fetched them. */
  facts?: ResolvedShipmentFacts;
}

/**
 * Validate a transition and, if it holds, apply it atomically.
 *
 * The engine runs BEFORE any write, so an illegal edge, a forbidden actor or
 * an unmet precondition costs one read and no mutation at all.
 */
export async function applyShipmentTransition(
  input: ApplyTransitionInput,
): Promise<ShipmentWriteResult> {
  const actorId = input.actorId ?? null;

  let state: ResolvedShipmentFacts;
  if (input.facts) {
    state = input.facts;
  } else {
    const resolved = await resolveShipmentFacts(
      input.shipmentId,
      input.assertions,
    );
    if (!resolved.ok) return reportFailure(resolved, input.actor, actorId);
    state = resolved;
  }

  // The transition the ENGINE judges is the one the DATABASE will apply: the
  // compare-and-swap uses `expectedStatus`, so judging anything else would
  // validate an edge that is not the edge being written.
  //
  // Two facts come from THIS request rather than from the row: the delivery
  // timestamp being asserted (§20's "`delivered` may require delivery
  // timestamp" is a property of the assertion, not of history) and the
  // cancellation reason.
  const facts: TransitionFacts = {
    ...state.facts,
    deliveryTimestamp: input.eventTime ?? new Date().toISOString(),
    cancellationReason: input.cancellationReason ?? null,
  };

  const decision = evaluateTransition({
    from: input.expectedStatus,
    to: input.to,
    actor: input.actor,
    facts,
  });

  if (!decision.ok) {
    const failure: ShipmentWriteFailure = {
      ok: false,
      code: decision.code,
      message: decision.message,
      shipmentId: input.shipmentId,
      from: decision.from,
      to: decision.to,
    };
    // `exactOptionalPropertyTypes` — an absent precondition list must be an
    // absent KEY, not an explicit `undefined`.
    if (decision.preconditions) failure.preconditions = decision.preconditions;
    return reportFailure(failure, input.actor, actorId);
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    return reportFailure(
      {
        ok: false,
        code: "not_configured",
        message:
          "SUPABASE_SERVICE_ROLE_KEY is unset — the status change was NOT written",
        shipmentId: input.shipmentId,
        from: input.expectedStatus,
        to: input.to,
      },
      input.actor,
      actorId,
    );
  }

  const { data, error } = await admin.rpc("apply_shipment_transition", {
    p_shipment_id: input.shipmentId,
    p_expected_status: input.expectedStatus,
    p_new_status: input.to,
    p_source: input.source,
    p_actor: actorId,
    p_visibility: input.visibility ?? "staff_only",
    p_event_time: input.eventTime ?? new Date().toISOString(),
    p_public_message: input.publicMessage ?? null,
    p_internal_message: input.internalMessage ?? null,
    p_city: input.city ?? null,
    p_state: input.state ?? null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_metadata: (input.metadata ?? {}) as never,
    p_external_event_id: input.externalEventId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_cancellation_reason: input.cancellationReason ?? null,
    p_event_type: input.to === "cancelled" ? "cancellation" : "status_change",
  });

  if (error) {
    return reportFailure(
      failureFromDbError(error, input.shipmentId, {
        from: input.expectedStatus,
        to: input.to,
      }),
      input.actor,
      actorId,
    );
  }

  const envelope = (data ?? {}) as RpcEnvelope;
  const success: ShipmentWriteSuccess = {
    ok: true,
    shipmentId: input.shipmentId,
    eventId: asString(envelope.event_id) ?? "",
    status: (asString(envelope.status) as ShipmentStatus | null) ?? input.to,
    replayed: envelope.replayed === true,
  };

  // §15: "audit who changed each status." A replay changed nothing, so it gets
  // no ledger entry — an audit trail that records writes that did not happen
  // is worse than one with a gap.
  if (isStaffActor(input.actor) && !success.replayed) {
    await recordAuditEvent({
      actorId,
      action: "shipment.status_change",
      targetTable: "shipments",
      targetId: input.shipmentId,
      detail: {
        from: input.expectedStatus,
        to: input.to,
        event_id: success.eventId,
        actor_role: input.actor,
        source: input.source,
      },
    });
  }

  return success;
}

/* ------------------------------------------------------------------ *
 * 2 · §14 dispatcher actions that are pure engine concerns
 * ------------------------------------------------------------------ */

/**
 * §14's non-status timeline writes: `record call`, `record email`, `add public
 * update`, `add internal note`, `request POD`, assignment created/released,
 * notification sent.
 *
 * §14's UI is M-75's. What belongs HERE is the vocabulary + the write path, so
 * M-75 renders forms rather than inventing event semantics — M-70 already gave
 * every one of these an `event_type`, and a dispatcher board that typed them
 * as free text would re-open exactly the hole §6 closes for statuses.
 *
 * The public/internal distinction §14 draws is a VISIBILITY, not a separate
 * table: `public_update` carries `visibility: "public"` and a `public_message`;
 * `internal_note` carries `staff_only` and an `internal_message`. The default
 * below is `staff_only`, so an operator who forgets to choose publishes
 * nothing.
 */
export interface AppendEventInput {
  shipmentId: string;
  eventType: Exclude<ShipmentEventType, "status_change" | "correction">;
  actor: TransitionActor;
  actorId?: string | null;
  source: ShipmentEventSource;
  visibility?: ShipmentEventVisibility;
  eventTime?: string;
  publicMessage?: string | null;
  internalMessage?: string | null;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown> | null;
  externalEventId?: string | null;
  idempotencyKey?: string | null;
  /** Some events reference a status without changing it (e.g. a note about it). */
  status?: ShipmentStatus | null;
}

export async function appendShipmentEvent(
  input: AppendEventInput,
): Promise<ShipmentWriteResult> {
  const actorId = input.actorId ?? null;
  const admin = tryCreateAdminClient();
  if (!admin) {
    return reportFailure(
      {
        ok: false,
        code: "not_configured",
        message:
          "SUPABASE_SERVICE_ROLE_KEY is unset — the event was NOT written",
        shipmentId: input.shipmentId,
      },
      input.actor,
      actorId,
    );
  }

  const { data, error } = await admin.rpc("append_shipment_event", {
    p_shipment_id: input.shipmentId,
    p_event_type: input.eventType,
    p_source: input.source,
    p_actor: actorId,
    p_visibility: input.visibility ?? "staff_only",
    p_event_time: input.eventTime ?? new Date().toISOString(),
    p_public_message: input.publicMessage ?? null,
    p_internal_message: input.internalMessage ?? null,
    p_city: input.city ?? null,
    p_state: input.state ?? null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_metadata: (input.metadata ?? {}) as never,
    p_external_event_id: input.externalEventId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_status: input.status ?? null,
  });

  if (error) {
    return reportFailure(
      failureFromDbError(error, input.shipmentId),
      input.actor,
      actorId,
    );
  }

  const envelope = (data ?? {}) as RpcEnvelope;
  return {
    ok: true,
    shipmentId: input.shipmentId,
    eventId: asString(envelope.event_id) ?? "",
    status: asString(envelope.status) as ShipmentStatus | null,
    replayed: envelope.replayed === true,
  };
}

/* ------------------------------------------------------------------ *
 * 3 · Event-sourced appointments (§6 "appointment rescheduled", plan §4)
 * ------------------------------------------------------------------ */

/**
 * Set or reschedule a pickup/delivery appointment.
 *
 * Plan §4 restores this to M-72 with the diagnosis attached: *"appointments
 * modelled as plain columns."* M-71 shipped the columns; an UPDATE on them
 * destroys the previous value, and "you told me Tuesday" then has no answer.
 *
 * The column write and the old→new event are one statement in 0019, so a
 * reschedule cannot half-happen. The first set emits `appointment_set`; every
 * change after emits `appointment_rescheduled` with `previous_at` and `new_at`
 * in `metadata`. Rescheduling to the same time is refused rather than recorded
 * — a customer timeline is not a place for events that assert nothing.
 */
export interface SetAppointmentInput {
  shipmentId: string;
  kind: EtaKind;
  /** `null` clears the appointment (and is recorded as such). */
  newAt: string | null;
  actor: TransitionActor;
  actorId?: string | null;
  source: ShipmentEventSource;
  /** Defaults to `shipper` — an appointment is the customer's own logistics. */
  visibility?: ShipmentEventVisibility;
  reason?: string | null;
  publicMessage?: string | null;
  internalMessage?: string | null;
  idempotencyKey?: string | null;
}

export async function setShipmentAppointment(
  input: SetAppointmentInput,
): Promise<AppointmentWriteResult> {
  const actorId = input.actorId ?? null;
  const admin = tryCreateAdminClient();
  if (!admin) {
    return reportFailure(
      {
        ok: false,
        code: "not_configured",
        message:
          "SUPABASE_SERVICE_ROLE_KEY is unset — the appointment was NOT written",
        shipmentId: input.shipmentId,
      },
      input.actor,
      actorId,
    );
  }

  const { data, error } = await admin.rpc("set_shipment_appointment", {
    p_shipment_id: input.shipmentId,
    p_kind: input.kind,
    p_new_at: input.newAt,
    p_source: input.source,
    p_actor: actorId,
    p_visibility: input.visibility ?? "shipper",
    p_reason: input.reason ?? null,
    p_public_message: input.publicMessage ?? null,
    p_internal_message: input.internalMessage ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) {
    return reportFailure(
      failureFromDbError(error, input.shipmentId),
      input.actor,
      actorId,
    );
  }

  const envelope = (data ?? {}) as RpcEnvelope;
  const eventType =
    asString(envelope.event_type) === "appointment_rescheduled"
      ? "appointment_rescheduled"
      : "appointment_set";
  const success: AppointmentWriteSuccess = {
    ok: true,
    shipmentId: input.shipmentId,
    eventId: asString(envelope.event_id) ?? "",
    status: null,
    replayed: envelope.replayed === true,
    eventType,
    previousAt: asString(envelope.previous_at),
    newAt: asString(envelope.new_at),
  };

  if (isStaffActor(input.actor) && !success.replayed) {
    await recordAuditEvent({
      actorId,
      action: `shipment.${eventType}`,
      targetTable: "shipments",
      targetId: input.shipmentId,
      detail: {
        appointment_kind: input.kind,
        previous_at: success.previousAt,
        new_at: success.newAt,
        reason: input.reason ?? null,
        event_id: success.eventId,
      },
    });
  }

  return success;
}

/* ------------------------------------------------------------------ *
 * 4 · §20 controlled admin correction
 * ------------------------------------------------------------------ */

/**
 * §20: *"Allow controlled admin correction with mandatory reason and audit
 * event."* §7: *"Do not delete event history silently. Corrections should be
 * recorded as additional audit events."*
 *
 * Three properties make this a correction rather than a back door:
 *
 *   * **Admin only.** `actorMayCorrect` refuses everyone else before any write.
 *   * **Mandatory reason.** Refused here on a blank string, refused again by
 *     `PL422` in the function, and refused a third time by the
 *     `shipment_events_correction_has_reason` CHECK. Three layers because a
 *     correction with no stated reason is indistinguishable from tampering.
 *   * **Additive.** The event that was wrong is untouched — 0019's append-only
 *     trigger makes editing or deleting it impossible for every role including
 *     the service role. The correction is a NEW `correction` event carrying
 *     `corrected_from`/`corrected_to` in `metadata`, PLUS an `audit_events`
 *     row through the M-69 single writer. Two ledgers, because §7's is about
 *     the shipment and §15's is about the operator.
 *
 * It bypasses the transition GRAPH by design: the graph describes freight
 * moving, and a mis-keyed status is not freight moving backwards. It does not
 * bypass the compare-and-swap, so a correction still cannot overwrite a
 * concurrent change.
 */
export interface CorrectionInput {
  shipmentId: string;
  expectedStatus: ShipmentStatus;
  correctedStatus: ShipmentStatus;
  /** MANDATORY. Blank is refused before any write. */
  reason: string;
  actor: TransitionActor;
  actorId?: string | null;
  visibility?: ShipmentEventVisibility;
  publicMessage?: string | null;
  eventTime?: string;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}

export async function applyShipmentCorrection(
  input: CorrectionInput,
): Promise<ShipmentWriteResult> {
  const actorId = input.actorId ?? null;

  if (!actorMayCorrect(input.actor)) {
    return reportFailure(
      {
        ok: false,
        code: "actor_not_permitted",
        message: `a ${input.actor} may not correct a shipment status; §20 reserves correction for admins`,
        shipmentId: input.shipmentId,
        from: input.expectedStatus,
        to: input.correctedStatus,
      },
      input.actor,
      actorId,
    );
  }

  if (input.reason.trim() === "") {
    return reportFailure(
      {
        ok: false,
        code: "invalid_input",
        message:
          "a correction requires a mandatory reason (DIRECTIVE-tracking §20)",
        shipmentId: input.shipmentId,
        from: input.expectedStatus,
        to: input.correctedStatus,
      },
      input.actor,
      actorId,
    );
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    return reportFailure(
      {
        ok: false,
        code: "not_configured",
        message:
          "SUPABASE_SERVICE_ROLE_KEY is unset — the correction was NOT written",
        shipmentId: input.shipmentId,
        from: input.expectedStatus,
        to: input.correctedStatus,
      },
      input.actor,
      actorId,
    );
  }

  const { data, error } = await admin.rpc("apply_shipment_correction", {
    p_shipment_id: input.shipmentId,
    p_expected_status: input.expectedStatus,
    p_corrected_status: input.correctedStatus,
    p_reason: input.reason.trim(),
    p_actor: actorId,
    p_visibility: input.visibility ?? "staff_only",
    p_public_message: input.publicMessage ?? null,
    p_event_time: input.eventTime ?? new Date().toISOString(),
    p_metadata: (input.metadata ?? {}) as never,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) {
    return reportFailure(
      failureFromDbError(error, input.shipmentId, {
        from: input.expectedStatus,
        to: input.correctedStatus,
      }),
      input.actor,
      actorId,
    );
  }

  const envelope = (data ?? {}) as RpcEnvelope;
  const success: ShipmentWriteSuccess = {
    ok: true,
    shipmentId: input.shipmentId,
    eventId: asString(envelope.event_id) ?? "",
    status:
      (asString(envelope.status) as ShipmentStatus | null) ??
      input.correctedStatus,
    replayed: envelope.replayed === true,
  };

  if (!success.replayed) {
    await recordAuditEvent({
      actorId,
      action: "shipment.status_correction",
      targetTable: "shipments",
      targetId: input.shipmentId,
      detail: {
        corrected_from: input.expectedStatus,
        corrected_to: input.correctedStatus,
        reason: input.reason.trim(),
        event_id: success.eventId,
      },
    });
  }

  return success;
}
