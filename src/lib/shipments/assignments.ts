import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { logShipmentSignal } from "@/lib/shipments/observability";
import type {
  ShipmentEventVisibility,
  ShipmentEventSource,
} from "@/lib/shipments/types";

/**
 * M-75 — §14 assignments: carrier, dispatcher, driver/truck.
 *
 * ── WHY THESE GO THROUGH 0022 AND NOT `.insert()` + `.update()` ───────────
 *
 * Assigning a carrier is three writes: the `shipment_assignments` row (M-70:
 * *"reassignment is a new row, never an edit"*), the denormalised
 * `shipments.carrier_id` that 0018's `"carrier member read shipments"` policy
 * keys on, and the `assignment_created` event. Split across supabase-js calls
 * they are three transactions, and the failure between the first two produces
 * a state the policy cannot express: an assignment exists but the carrier
 * cannot see the shipment they were just assigned. That is a permission bug
 * manufactured by a network blip, so it belongs in one statement.
 *
 * ── THIS FILE NEVER CHANGES A STATUS ──────────────────────────────────────
 *
 * §20 makes `carrier_assigned` require a carrier assignment as a
 * PRECONDITION. The assignment is the fact; the transition is M-72's engine,
 * with its graph, its actor gate and its compare-and-swap. A server action
 * that wants both calls `assignShipmentCarrier` and then
 * `applyShipmentTransition`, in that order, and the second one is allowed to
 * fail without un-assigning the first — a carrier IS assigned at that point,
 * and rolling that back would be a lie about the world.
 *
 * ── DRIVER / TRUCK (M-50) ─────────────────────────────────────────────────
 *
 * `trucks` and `drivers` are the M-50 fleet tables, both keyed on
 * `carrier_id`. 0022 refuses a driver or truck belonging to a DIFFERENT
 * carrier with `PL422`, which is what stops §20's *"driver marking another
 * carrier's shipment delivered"* being reachable through mis-keyed data
 * rather than through a permission mistake. Both are optional: a carrier that
 * has not onboarded its fleet still gets assigned the load.
 */

export type AssignmentFailureCode =
  | "not_configured"
  | "shipment_not_found"
  | "already_assigned"
  | "no_open_assignment"
  | "invalid_input"
  | "write_failed";

export interface AssignmentFailure {
  ok: false;
  code: AssignmentFailureCode;
  message: string;
  shipmentId: string;
}

export interface AssignmentSuccess {
  ok: true;
  shipmentId: string;
  assignmentId: string | null;
  eventId: string;
  replayed: boolean;
}

export type AssignmentResult = AssignmentSuccess | AssignmentFailure;

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

function isOneActiveAssignmentViolation(error: PostgrestLikeError): boolean {
  return (
    error.code === "23505" &&
    `${error.message ?? ""} ${error.details ?? ""}`.includes(
      "shipment_assignments_one_active",
    )
  );
}

function fail(
  error: PostgrestLikeError,
  shipmentId: string,
  actorId: string | null,
): AssignmentFailure {
  let code: AssignmentFailureCode = "write_failed";
  let message =
    error.message ?? "Couldn't save the assignment. Retry and check the connection.";

  if (isOneActiveAssignmentViolation(error)) {
    code = "already_assigned";
    message =
      "This shipment already has an open carrier assignment. Release the current carrier first — reassignment is a new record, never an edit, so the history keeps both.";
  } else if (error.code === "PL404") {
    code = "shipment_not_found";
    message = "That shipment no longer exists.";
  } else if (error.code === "PL422") {
    // 0022 raises PL422 for both "no open assignment" and "driver/truck
    // belongs to another carrier". They are told apart by the message
    // because they are told apart by the OPERATOR's next action.
    code = /no open carrier assignment/.test(error.message ?? "")
      ? "no_open_assignment"
      : "invalid_input";
    message = error.message ?? message;
  } else if (error.code === "23503") {
    code = "invalid_input";
    message = "That carrier, driver or truck no longer exists.";
  }

  logShipmentSignal({
    signal: "status_update_error",
    code,
    shipmentId,
    actorId,
    detail: message,
  });
  return { ok: false, code, message, shipmentId };
}

export interface AssignCarrierInput {
  shipmentId: string;
  carrierId: string;
  driverId?: string | null;
  truckId?: string | null;
  /** Who owns the shipment operationally. Defaults to the current holder. */
  dispatcherId?: string | null;
  actorId: string | null;
  actorRole: "admin" | "dispatcher";
  source?: ShipmentEventSource;
  /** Defaults to `shipper`: §17 lists carrier assignment among the events a
   *  customer is notified about, and "a carrier is on it" is good news. */
  visibility?: ShipmentEventVisibility;
  publicMessage?: string | null;
  internalMessage?: string | null;
  idempotencyKey?: string | null;
}

export async function assignShipmentCarrier(
  input: AssignCarrierInput,
): Promise<AssignmentResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is unset — the assignment was NOT written.",
      shipmentId: input.shipmentId,
    };
  }

  const { data, error } = await admin.rpc("assign_shipment_carrier", {
    p_shipment_id: input.shipmentId,
    p_carrier_id: input.carrierId,
    p_driver_id: input.driverId ?? null,
    p_truck_id: input.truckId ?? null,
    p_dispatcher_id: input.dispatcherId ?? null,
    p_actor: input.actorId,
    p_source: input.source ?? (input.actorRole === "admin" ? "admin" : "dispatcher"),
    p_visibility: input.visibility ?? "shipper",
    p_public_message: input.publicMessage ?? null,
    p_internal_message: input.internalMessage ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) return fail(error, input.shipmentId, input.actorId);

  const envelope = (data ?? {}) as Record<string, unknown>;
  const success: AssignmentSuccess = {
    ok: true,
    shipmentId: input.shipmentId,
    assignmentId:
      typeof envelope.assignment_id === "string" ? envelope.assignment_id : null,
    eventId: String(envelope.event_id ?? ""),
    replayed: envelope.replayed === true,
  };

  // A replay wrote nothing, so it gets no ledger row — the same rule
  // `apply-transition.ts` applies, for the same reason.
  if (!success.replayed) {
    await recordAuditEvent({
      actorId: input.actorId,
      action: "shipment.carrier_assigned",
      targetTable: "shipments",
      targetId: input.shipmentId,
      detail: {
        carrier_id: input.carrierId,
        driver_id: input.driverId ?? null,
        truck_id: input.truckId ?? null,
        dispatcher_id: input.dispatcherId ?? null,
        assignment_id: success.assignmentId,
        event_id: success.eventId,
        actor_role: input.actorRole,
      },
    });
  }

  return success;
}

export interface ReleaseAssignmentInput {
  shipmentId: string;
  reason: string | null;
  actorId: string | null;
  actorRole: "admin" | "dispatcher";
  source?: ShipmentEventSource;
  /** Defaults to `staff_only` — a carrier falling through is internal news
   *  until dispatch decides what to tell the customer (§21: no blame). */
  visibility?: ShipmentEventVisibility;
  publicMessage?: string | null;
  internalMessage?: string | null;
  /** False when swapping a truck inside the same carrier. */
  clearCarrier?: boolean;
  idempotencyKey?: string | null;
}

export async function releaseShipmentAssignment(
  input: ReleaseAssignmentInput,
): Promise<AssignmentResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is unset — the release was NOT written.",
      shipmentId: input.shipmentId,
    };
  }

  const { data, error } = await admin.rpc("release_shipment_assignment", {
    p_shipment_id: input.shipmentId,
    p_reason: input.reason,
    p_actor: input.actorId,
    p_source: input.source ?? (input.actorRole === "admin" ? "admin" : "dispatcher"),
    p_visibility: input.visibility ?? "staff_only",
    p_public_message: input.publicMessage ?? null,
    p_internal_message: input.internalMessage ?? null,
    p_clear_carrier: input.clearCarrier ?? true,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) return fail(error, input.shipmentId, input.actorId);

  const envelope = (data ?? {}) as Record<string, unknown>;
  const success: AssignmentSuccess = {
    ok: true,
    shipmentId: input.shipmentId,
    assignmentId:
      typeof envelope.assignment_id === "string" ? envelope.assignment_id : null,
    eventId: String(envelope.event_id ?? ""),
    replayed: envelope.replayed === true,
  };

  if (!success.replayed) {
    await recordAuditEvent({
      actorId: input.actorId,
      action: "shipment.carrier_released",
      targetTable: "shipments",
      targetId: input.shipmentId,
      detail: {
        assignment_id: success.assignmentId,
        reason: input.reason,
        carrier_cleared: input.clearCarrier ?? true,
        event_id: success.eventId,
        actor_role: input.actorRole,
      },
    });
  }

  return success;
}
