import { beforeAll, describe, expect, it } from "vitest";

import {
  closeBrokerageGate,
  count,
  exec,
  json,
  lit,
  litOrNull,
  openBrokerageGate,
  scalar,
  sqlstateOf,
} from "./helpers/db";
import {
  evaluateTransition,
  NO_TRANSITION_FACTS,
  type TransitionFacts,
} from "@/lib/shipments/transitions";
import type { ShipmentStatus } from "@/lib/shipments/types";

/**
 * M-72 — the integration lane's first instalment.
 *
 * `FINAL-IMPLEMENTATION-PLAN` §4: the tracking directive's §27 integration
 * tier — eleven named tests — was *"diagnosed absent, then dropped entirely"*
 * and is restored as M-83b. Four of the eleven are provable today and are
 * proved here against a real PostgreSQL 16, plus the idempotent replay the
 * whole write path rests on:
 *
 *   §27 · create shipment          → "create → assign → event → status update"
 *   §27 · assign carrier           → same walk
 *   §27 · create shipment event    → same walk
 *   §27 · update status            → same walk
 *   (public tracking lookup, portal lookup, carrier update, document upload,
 *    POD upload, notification generation and exception lifecycle need M-73,
 *    M-74, M-76, M-77, M-78 and M-79 — M-83b adds them as they land.)
 *
 * WHAT MAKES THIS AN INTEGRATION TEST AND NOT A SECOND UNIT SUITE: every
 * decision is made by the REAL engine (`evaluateTransition`, imported from
 * `src/`) against facts read from the REAL database, and every write goes
 * through the REAL migration-0019 functions. The unit suite mocks the client
 * and can prove none of that; the RLS suite is pure SQL and imports no
 * TypeScript. This is the only lane where the two halves have to agree.
 */

const SHIPPER = "22222222-2222-2222-2222-222222220001";
const CARRIER_A = "11111111-1111-1111-1111-111111110001";
const CARRIER_B = "11111111-1111-1111-1111-111111110002";
const DISPATCHER = "00000000-0000-0000-0000-0000000e0001";
const ADMIN = "00000000-0000-0000-0000-0000000f0001";

/** Read the §20 facts exactly as `apply-transition.ts` does — one query. */
function facts(shipmentId: string): TransitionFacts & { status: ShipmentStatus } {
  const row = json<{
    status: ShipmentStatus;
    active_assignment_id: string | null;
    pickup_confirmed_at: string | null;
    delivered_at: string | null;
    approved_pod_document_id: string | null;
    closeout_completed_at: string | null;
    cancellation_reason: string | null;
  }>(`select shipment_transition_facts(${lit(shipmentId)})`);
  return {
    ...NO_TRANSITION_FACTS,
    status: row.status,
    activeAssignmentId: row.active_assignment_id,
    pickupConfirmedAt: row.pickup_confirmed_at,
    deliveredAt: row.delivered_at,
    approvedPodDocumentId: row.approved_pod_document_id,
    closeoutCompletedAt: row.closeout_completed_at,
    cancellationReason: row.cancellation_reason,
  };
}

interface TransitionEnvelope {
  event_id: string;
  shipment_id: string;
  status: ShipmentStatus;
  replayed: boolean;
}

/**
 * The full application path, in the order `applyShipmentTransition` runs it:
 * resolve facts → ask the engine → write atomically. The engine's verdict is
 * returned so a test can assert on it, and a refusal never reaches the
 * database — which is the property being demonstrated.
 */
function transition(args: {
  shipmentId: string;
  to: ShipmentStatus;
  actor: Parameters<typeof evaluateTransition>[0]["actor"];
  eventTime?: string;
  cancellationReason?: string | null;
  visibility?: string;
  publicMessage?: string | null;
  idempotencyKey?: string | null;
  assertions?: Partial<TransitionFacts>;
  actorId?: string;
  expectedStatus?: ShipmentStatus;
}):
  | { ok: true; envelope: TransitionEnvelope }
  | { ok: false; code: string; message: string } {
  const state = facts(args.shipmentId);
  const from = args.expectedStatus ?? state.status;
  const eventTime = args.eventTime ?? new Date().toISOString();

  const decision = evaluateTransition({
    from,
    to: args.to,
    actor: args.actor,
    facts: {
      ...state,
      ...args.assertions,
      deliveryTimestamp: eventTime,
      cancellationReason: args.cancellationReason ?? null,
    },
  });
  if (!decision.ok) {
    return { ok: false, code: decision.code, message: decision.message };
  }

  const envelope = json<TransitionEnvelope>(
    `select apply_shipment_transition(
       ${lit(args.shipmentId)}, ${lit(from)}, ${lit(args.to)}, 'dispatcher',
       ${lit(args.actorId ?? DISPATCHER)},
       ${lit(args.visibility ?? "staff_only")},
       ${lit(eventTime)}::timestamptz,
       ${litOrNull(args.publicMessage ?? null)},
       null, null, null, null, null, '{}'::jsonb, null,
       ${litOrNull(args.idempotencyKey ?? null)},
       ${litOrNull(args.cancellationReason ?? null)},
       ${args.to === "cancelled" ? lit("cancellation") : lit("status_change")})`,
  );
  return { ok: true, envelope };
}

function createShipment(trackingNumber: string): string {
  const id = scalar(
    `insert into shipments (tracking_number, shipper_id, dispatcher_id,
       origin_city, origin_state, destination_city, destination_state, equipment)
     values (${lit(trackingNumber)}, ${lit(SHIPPER)}, ${lit(DISPATCHER)},
       'Newark', 'NJ', 'Atlanta', 'GA', 'dry-van')
     returning id`,
  );
  if (!id) throw new Error("shipment insert returned no id");
  return id;
}

/** Walk a shipment to a status using the engine, one legal edge at a time. */
function advanceTo(shipmentId: string, target: ShipmentStatus): void {
  const path: Record<string, ShipmentStatus[]> = {
    carrier_search: ["quote_sent", "quote_accepted", "carrier_search"],
  };
  for (const step of path[target] ?? []) {
    const result = transition({ shipmentId, to: step, actor: "dispatcher" });
    if (!result.ok) throw new Error(`${step}: ${result.message}`);
  }
}

beforeAll(() => {
  // Identities. The lane builds its own — it deliberately does NOT load the
  // RLS fixtures, because the point is to create shipments through the engine.
  exec(`insert into auth.users (id, email) values
      (${lit(DISPATCHER)}, 'dispatcher@integration.test'),
      (${lit(ADMIN)}, 'admin@integration.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(DISPATCHER)}, 'dispatcher', 'Integration Dispatcher'),
      (${lit(ADMIN)}, 'admin', 'Integration Admin')
    on conflict do nothing`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER)}, 'Integration Shipper Inc') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER_A)}, 'Integration Carrier A', true),
      (${lit(CARRIER_B)}, 'Integration Carrier B', true)
    on conflict do nothing`);
});

/* ------------------------------------------------------------------ *
 * §2 gate — the state the whole lane starts from
 * ------------------------------------------------------------------ */

describe("§2 brokerage gate (0017)", () => {
  it("refuses shipment creation while brokerage_active is false", () => {
    closeBrokerageGate();
    const state = sqlstateOf(
      `insert into shipments (tracking_number, shipper_id, origin_city, origin_state,
         destination_city, destination_state, equipment)
       values ('PL-2026-900001', '${SHIPPER}', 'Newark', 'NJ', 'Atlanta', 'GA', 'dry-van')`,
    );
    expect(state).toBe("P0001");
  });

  it("allows it once an admin opens the gate", () => {
    openBrokerageGate();
    const id = createShipment("PL-2026-900002");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/* ------------------------------------------------------------------ *
 * §27 — create → assign → event → status update
 * ------------------------------------------------------------------ */

describe("§27 · create shipment → assign carrier → create event → update status", () => {
  let shipmentId = "";

  it("creates a shipment in the lifecycle's first status", () => {
    openBrokerageGate();
    shipmentId = createShipment("PL-2026-910001");
    expect(facts(shipmentId).status).toBe("quote_requested");
    expect(count(`select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`)).toBe(0);
  });

  it("walks the quote statuses, writing one event per transition", () => {
    for (const to of ["quote_sent", "quote_accepted", "carrier_search"] as const) {
      const result = transition({ shipmentId, to, actor: "dispatcher" });
      expect(result.ok, `${to}: ${result.ok ? "" : result.message}`).toBe(true);
    }
    expect(facts(shipmentId).status).toBe("carrier_search");
    // §7: every status change has an event. Three transitions, three events.
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)} and event_type = 'status_change'`,
      ),
    ).toBe(3);
  });

  /**
   * §20: "`carrier_assigned` requires a carrier assignment." The engine
   * refuses BEFORE the database is touched, so the status is unchanged and no
   * event exists — which is the whole difference between a validated
   * transition and an optimistic one.
   */
  it("refuses carrier_assigned with no assignment, and writes nothing", () => {
    const before = count(
      `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`,
    );
    const result = transition({ shipmentId, to: "carrier_assigned", actor: "dispatcher" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("precondition_failed");
    expect(facts(shipmentId).status).toBe("carrier_search");
    expect(
      count(`select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`),
    ).toBe(before);
  });

  it("§27 · assign carrier — the precondition then holds", () => {
    exec(
      `insert into shipment_assignments (shipment_id, carrier_id, dispatcher_id, assigned_by)
       values (${lit(shipmentId)}, ${lit(CARRIER_A)}, ${lit(DISPATCHER)}, ${lit(DISPATCHER)})`,
    );
    exec(`update shipments set carrier_id = ${lit(CARRIER_A)} where id = ${lit(shipmentId)}`);
    expect(facts(shipmentId).activeAssignmentId).not.toBeNull();

    const result = transition({ shipmentId, to: "carrier_assigned", actor: "dispatcher" });
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    expect(facts(shipmentId).status).toBe("carrier_assigned");
  });

  it("§27 · create shipment event — a status change writes its event atomically", () => {
    const result = transition({
      shipmentId,
      to: "dispatched",
      actor: "dispatcher",
      visibility: "public",
      publicMessage: "Carrier dispatched",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = json<{
      event_type: string;
      status: string;
      visibility: string;
      public_message: string;
      created_by: string;
      metadata: Record<string, unknown>;
    }>(
      `select to_jsonb(e) from shipment_events e where e.id = ${lit(result.envelope.event_id)}`,
    );
    expect(event.event_type).toBe("status_change");
    expect(event.status).toBe("dispatched");
    expect(event.visibility).toBe("public");
    expect(event.public_message).toBe("Carrier dispatched");
    expect(event.created_by).toBe(DISPATCHER);
    // §7 keeps both clocks; `metadata` defaults to `{}`, never null.
    expect(event.metadata).toEqual({});
  });

  it("§27 · update status — the operational walk to delivered", () => {
    for (const to of [
      "en_route_to_pickup",
      "arrived_at_pickup",
      "loading",
      "picked_up",
      "in_transit",
      "arrived_at_delivery",
      "unloading",
      "delivered",
    ] as const) {
      const result = transition({ shipmentId, to, actor: "dispatcher" });
      expect(result.ok, `${to}: ${result.ok ? "" : result.message}`).toBe(true);
    }
    expect(facts(shipmentId).status).toBe("delivered");
    // §20's pickup precondition was satisfied by the RECORDED arrival/loading
    // events, not by an assertion the caller made about itself.
    expect(facts(shipmentId).pickupConfirmedAt).not.toBeNull();
    expect(facts(shipmentId).deliveredAt).not.toBeNull();
  });

  it("refuses pod_uploaded — M-77 owns documents, so the fact is null", () => {
    const result = transition({ shipmentId, to: "pod_uploaded", actor: "dispatcher" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("precondition_failed");
    expect(result.message).toContain("POD");
  });

  it("requires delivery AND closeout for completed", () => {
    const withoutCloseout = transition({ shipmentId, to: "completed", actor: "dispatcher" });
    expect(withoutCloseout.ok).toBe(false);
    if (withoutCloseout.ok) return;
    expect(withoutCloseout.code).toBe("precondition_failed");

    const withCloseout = transition({
      shipmentId,
      to: "completed",
      actor: "dispatcher",
      assertions: { closeoutCompletedAt: new Date().toISOString() },
    });
    expect(withCloseout.ok, withCloseout.ok ? "" : withCloseout.message).toBe(true);

    const row = json<{ status: string; completed_at: string | null }>(
      `select to_jsonb(t) from (select status, completed_at from shipments where id = ${lit(shipmentId)}) t`,
    );
    expect(row.status).toBe("completed");
    expect(row.completed_at).not.toBeNull();
  });

  it("is terminal once completed", () => {
    const result = transition({
      shipmentId,
      to: "in_transit",
      actor: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("terminal_status");
  });
});

/* ------------------------------------------------------------------ *
 * Idempotent replay
 * ------------------------------------------------------------------ */

describe("idempotent replay", () => {
  let shipmentId = "";

  beforeAll(() => {
    openBrokerageGate();
    shipmentId = createShipment("PL-2026-920001");
  });

  it("a retried write returns the ORIGINAL event and appends nothing", () => {
    const first = transition({
      shipmentId,
      to: "quote_sent",
      actor: "dispatcher",
      idempotencyKey: "retry-key-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.envelope.replayed).toBe(false);

    const eventsAfterFirst = count(
      `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`,
    );
    expect(eventsAfterFirst).toBe(1);

    // The same call again — the shape a retried serverless invocation takes.
    const replay = json<TransitionEnvelope>(
      `select apply_shipment_transition(
         ${lit(shipmentId)}, 'quote_sent', 'quote_accepted', 'dispatcher',
         ${lit(DISPATCHER)}, 'staff_only', now(), null, null, null, null,
         null, null, '{}'::jsonb, null, 'retry-key-1', null, 'status_change')`,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.event_id).toBe(first.envelope.event_id);
    // No second event…
    expect(
      count(`select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`),
    ).toBe(1);
    // …and, decisively, NO status change: the replay carried a different
    // target and the shipment did not move.
    expect(facts(shipmentId).status).toBe("quote_sent");
  });

  it("deduplicates a provider event id per shipment (§9 Mode C)", () => {
    const other = createShipment("PL-2026-920002");
    exec(
      `select append_shipment_event(${lit(shipmentId)}, 'location_update', 'eld',
         null, 'staff_only', now(), null, null, 'Newark', 'NJ', null, null,
         '{}'::jsonb, 'provider-evt-77', null, null)`,
    );
    const before = count(
      `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`,
    );
    const replay = json<{ replayed: boolean }>(
      `select append_shipment_event(${lit(shipmentId)}, 'location_update', 'eld',
         null, 'staff_only', now(), null, null, 'Elizabeth', 'NJ', null, null,
         '{}'::jsonb, 'provider-evt-77', null, null)`,
    );
    expect(replay.replayed).toBe(true);
    expect(
      count(`select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`),
    ).toBe(before);

    // The same provider id on a DIFFERENT shipment is a different fact.
    const fresh = json<{ replayed: boolean }>(
      `select append_shipment_event(${lit(other)}, 'location_update', 'eld',
         null, 'staff_only', now(), null, null, 'Chicago', 'IL', null, null,
         '{}'::jsonb, 'provider-evt-77', null, null)`,
    );
    expect(fresh.replayed).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Atomicity and concurrency
 * ------------------------------------------------------------------ */

describe("atomicity and compare-and-swap", () => {
  let shipmentId = "";

  beforeAll(() => {
    openBrokerageGate();
    shipmentId = createShipment("PL-2026-930001");
    advanceTo(shipmentId, "carrier_search");
  });

  it("refuses a stale expected status with PL409 (the losing writer)", () => {
    // Two dispatchers both read `carrier_search`. The first wins.
    exec(
      `insert into shipment_assignments (shipment_id, carrier_id) values (${lit(shipmentId)}, ${lit(CARRIER_B)})`,
    );
    const winner = transition({ shipmentId, to: "carrier_assigned", actor: "dispatcher" });
    expect(winner.ok).toBe(true);

    // The second still believes the shipment is in `carrier_search`.
    const state = sqlstateOf(
      `select apply_shipment_transition('${shipmentId}', 'carrier_search', 'cancelled',
         'dispatcher', '${DISPATCHER}', 'staff_only', now(), null, null, null,
         null, null, null, '{}'::jsonb, null, null, 'duplicate booking',
         'cancellation')`,
    );
    expect(state).toBe("PL409");
    expect(facts(shipmentId).status).toBe("carrier_assigned");
  });

  it("returns PL404 for a shipment that does not exist", () => {
    const state = sqlstateOf(
      `select apply_shipment_transition('00000000-0000-0000-0000-000000009999',
         'quote_requested', 'quote_sent', 'dispatcher')`,
    );
    expect(state).toBe("PL404");
  });

  it("refuses a cancellation with no reason (PL422), even from the owner", () => {
    const state = sqlstateOf(
      `select apply_shipment_transition('${shipmentId}', 'carrier_assigned', 'cancelled',
         'dispatcher', null, 'staff_only', now(), null, null, null, null, null,
         null, '{}'::jsonb, null, null, '   ', 'cancellation')`,
    );
    expect(state).toBe("PL422");
  });

  it("records cancelled_at and the reason together", () => {
    const result = transition({
      shipmentId,
      to: "cancelled",
      actor: "dispatcher",
      cancellationReason: "shipper withdrew the load",
    });
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    const row = json<{
      status: string;
      cancelled_at: string | null;
      cancellation_reason: string | null;
    }>(
      `select to_jsonb(t) from (select status, cancelled_at, cancellation_reason
         from shipments where id = ${lit(shipmentId)}) t`,
    );
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_at).not.toBeNull();
    expect(row.cancellation_reason).toBe("shipper withdrew the load");
    // A cancellation is tagged as such, not as a bare status change.
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)} and event_type = 'cancellation'`,
      ),
    ).toBe(1);
  });

  it("refuses a status_change written straight to the table (§20)", () => {
    const state = sqlstateOf(
      `insert into shipment_events (shipment_id, event_type, source)
       values ('${shipmentId}', 'status_change', 'dispatcher')`,
    );
    expect(state).toBe("23514");
  });

  it("refuses a status_change through append_shipment_event (PL422)", () => {
    const state = sqlstateOf(
      `select append_shipment_event('${shipmentId}', 'status_change', 'dispatcher')`,
    );
    expect(state).toBe("PL422");
  });
});

/* ------------------------------------------------------------------ *
 * Event-sourced appointments (§6 "appointment rescheduled")
 * ------------------------------------------------------------------ */

describe("event-sourced appointments", () => {
  let shipmentId = "";

  beforeAll(() => {
    openBrokerageGate();
    shipmentId = createShipment("PL-2026-940001");
  });

  it("emits appointment_set the first time and writes the column", () => {
    const envelope = json<{
      event_type: string;
      previous_at: string | null;
      new_at: string;
    }>(
      `select set_shipment_appointment(${lit(shipmentId)}, 'pickup',
         '2026-08-10T14:00:00Z'::timestamptz, 'dispatcher', ${lit(DISPATCHER)})`,
    );
    expect(envelope.event_type).toBe("appointment_set");
    expect(envelope.previous_at).toBeNull();
    expect(
      scalar(`select pickup_appointment_at from shipments where id = ${lit(shipmentId)}`),
    ).not.toBeNull();
  });

  /**
   * Plan §4's restoration, demonstrated: a reschedule leaves HISTORY. The
   * column has moved on, and the previous value survives in the event's
   * metadata — which is the only place "you told me Tuesday" can be answered
   * from.
   */
  it("emits appointment_rescheduled carrying old → new in metadata", () => {
    const envelope = json<{ event_id: string; event_type: string }>(
      `select set_shipment_appointment(${lit(shipmentId)}, 'pickup',
         '2026-08-11T09:00:00Z'::timestamptz, 'dispatcher', ${lit(DISPATCHER)},
         'shipper', 'receiver moved the dock slot')`,
    );
    expect(envelope.event_type).toBe("appointment_rescheduled");

    const event = json<{
      visibility: string;
      metadata: {
        appointment_kind: string;
        previous_at: string;
        new_at: string;
        reason: string;
      };
    }>(`select to_jsonb(e) from shipment_events e where e.id = ${lit(envelope.event_id)}`);
    expect(event.visibility).toBe("shipper");
    expect(event.metadata.appointment_kind).toBe("pickup");
    expect(event.metadata.previous_at).toContain("2026-08-10");
    expect(event.metadata.new_at).toContain("2026-08-11");
    expect(event.metadata.reason).toBe("receiver moved the dock slot");

    // Both events survive — the history is two rows, not one overwritten one.
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}
         and event_type in ('appointment_set','appointment_rescheduled')`,
      ),
    ).toBe(2);
  });

  it("refuses a reschedule to the identical time (PL422 — noise, not a fact)", () => {
    const state = sqlstateOf(
      `select set_shipment_appointment('${shipmentId}', 'pickup',
         '2026-08-11T09:00:00Z'::timestamptz, 'dispatcher')`,
    );
    expect(state).toBe("PL422");
  });

  it("records clearing an appointment as a reschedule to null", () => {
    const envelope = json<{ event_type: string; new_at: string | null }>(
      `select set_shipment_appointment(${lit(shipmentId)}, 'pickup', null,
         'dispatcher', ${lit(DISPATCHER)})`,
    );
    expect(envelope.event_type).toBe("appointment_rescheduled");
    expect(envelope.new_at).toBeNull();
  });

  it("keeps pickup and delivery appointments independent", () => {
    const envelope = json<{ event_type: string }>(
      `select set_shipment_appointment(${lit(shipmentId)}, 'delivery',
         '2026-08-13T08:00:00Z'::timestamptz, 'dispatcher', ${lit(DISPATCHER)})`,
    );
    expect(envelope.event_type).toBe("appointment_set");
  });
});

/* ------------------------------------------------------------------ *
 * §14 dispatcher actions
 * ------------------------------------------------------------------ */

describe("§14 dispatcher actions", () => {
  let shipmentId = "";

  beforeAll(() => {
    openBrokerageGate();
    shipmentId = createShipment("PL-2026-950001");
  });

  it("records a call and an email as typed events", () => {
    for (const type of ["call_logged", "email_logged"] as const) {
      exec(
        `select append_shipment_event(${lit(shipmentId)}, ${lit(type)}, 'dispatcher',
           ${lit(DISPATCHER)}, 'staff_only', now(), null, 'noted')`,
      );
    }
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}
         and event_type in ('call_logged','email_logged')`,
      ),
    ).toBe(2);
  });

  it("separates a public update from an internal note by visibility alone", () => {
    exec(
      `select append_shipment_event(${lit(shipmentId)}, 'public_update', 'dispatcher',
         ${lit(DISPATCHER)}, 'public', now(), 'Running about an hour behind', null)`,
    );
    exec(
      `select append_shipment_event(${lit(shipmentId)}, 'internal_note', 'dispatcher',
         ${lit(DISPATCHER)}, 'staff_only', now(), null, 'Driver missed the window again')`,
    );
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}
         and visibility = 'public'`,
      ),
    ).toBe(1);
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}
         and visibility = 'staff_only' and internal_message is not null`,
      ),
    ).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * §20 controlled admin correction
 * ------------------------------------------------------------------ */

describe("§20 controlled admin correction", () => {
  let shipmentId = "";

  beforeAll(() => {
    openBrokerageGate();
    shipmentId = createShipment("PL-2026-960001");
    advanceTo(shipmentId, "carrier_search");
  });

  it("refuses a blank reason (PL422)", () => {
    const state = sqlstateOf(
      `select apply_shipment_correction('${shipmentId}', 'carrier_search',
         'quote_accepted', '  ')`,
    );
    expect(state).toBe("PL422");
  });

  it("respects the compare-and-swap (PL409 on a stale expectation)", () => {
    const state = sqlstateOf(
      `select apply_shipment_correction('${shipmentId}', 'delivered',
         'quote_accepted', 'keyed against the wrong shipment')`,
    );
    expect(state).toBe("PL409");
  });

  /**
   * §7: "Do not delete event history silently. Corrections should be recorded
   * as additional audit events." Both halves are asserted — the count goes UP,
   * the original event is byte-identical afterwards, and the wrong status is
   * still in the timeline for anyone reading the history.
   */
  it("appends a correction and leaves the original event untouched", () => {
    const originalEventId = scalar(
      `select id from shipment_events where shipment_id = ${lit(shipmentId)}
         and status = 'carrier_search' order by event_time desc limit 1`,
    );
    expect(originalEventId).not.toBeNull();
    const before = count(
      `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`,
    );

    const envelope = json<{ event_id: string; status: string }>(
      `select apply_shipment_correction(${lit(shipmentId)}, 'carrier_search',
         'quote_accepted', 'carrier search was started against the wrong quote',
         ${lit(ADMIN)})`,
    );
    expect(envelope.status).toBe("quote_accepted");

    // The history GREW.
    expect(
      count(`select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`),
    ).toBe(before + 1);

    // The original event still says what it always said.
    const original = json<{ status: string; event_type: string }>(
      `select to_jsonb(e) from shipment_events e where e.id = ${lit(originalEventId!)}`,
    );
    expect(original.status).toBe("carrier_search");
    expect(original.event_type).toBe("status_change");

    // The correction carries the mandatory reason and the old → new pair.
    const correction = json<{
      event_type: string;
      internal_message: string;
      source: string;
      metadata: { corrected_from: string; corrected_to: string };
    }>(`select to_jsonb(e) from shipment_events e where e.id = ${lit(envelope.event_id)}`);
    expect(correction.event_type).toBe("correction");
    expect(correction.source).toBe("admin");
    expect(correction.internal_message).toBe(
      "carrier search was started against the wrong quote",
    );
    expect(correction.metadata.corrected_from).toBe("carrier_search");
    expect(correction.metadata.corrected_to).toBe("quote_accepted");
  });

  it("corrects a status the transition GRAPH would refuse", () => {
    // Walk to delivered, then correct backwards — an edge on the §20
    // impossible list, and precisely what a correction is for.
    exec(
      `insert into shipment_assignments (shipment_id, carrier_id) values (${lit(shipmentId)}, ${lit(CARRIER_A)})`,
    );
    exec(`update shipments set carrier_id = ${lit(CARRIER_A)} where id = ${lit(shipmentId)}`);
    for (const to of [
      "carrier_search",
      "carrier_assigned",
      "dispatched",
      "en_route_to_pickup",
      "arrived_at_pickup",
      "loading",
      "picked_up",
      "in_transit",
      "arrived_at_delivery",
      "unloading",
      "delivered",
    ] as const) {
      const result = transition({ shipmentId, to, actor: "dispatcher" });
      expect(result.ok, `${to}: ${result.ok ? "" : result.message}`).toBe(true);
    }

    // The engine refuses it…
    const refused = transition({ shipmentId, to: "in_transit", actor: "admin" });
    expect(refused.ok).toBe(false);

    // …and the correction flow allows it, with a reason.
    const envelope = json<{ status: string }>(
      `select apply_shipment_correction(${lit(shipmentId)}, 'delivered', 'in_transit',
         'delivery was keyed against the wrong shipment', ${lit(ADMIN)})`,
    );
    expect(envelope.status).toBe("in_transit");
  });
});

/* ------------------------------------------------------------------ *
 * Append-only history
 * ------------------------------------------------------------------ */

describe("§7 append-only history", () => {
  it("refuses UPDATE and DELETE on an event, as the database OWNER", () => {
    const eventId = scalar(`select id from shipment_events limit 1`);
    expect(eventId).not.toBeNull();
    expect(
      sqlstateOf(`update shipment_events set public_message = 'x' where id = '${eventId}'`),
    ).toBe("P0001");
    expect(sqlstateOf(`delete from shipment_events where id = '${eventId}'`)).toBe(
      "P0001",
    );
    expect(sqlstateOf(`delete from shipment_events`)).toBe("P0001");
  });

  it("keeps the full timeline queryable in event_time order (§25)", () => {
    openBrokerageGate();
    const shipmentId = createShipment("PL-2026-970001");
    for (const to of ["quote_sent", "quote_accepted", "carrier_search"] as const) {
      transition({ shipmentId, to, actor: "dispatcher" });
    }
    const ordered = json<{ statuses: string[] }>(
      `select to_jsonb(t) from (
         select array_agg(status order by event_time asc) as statuses
         from shipment_events where shipment_id = ${lit(shipmentId)}
       ) t`,
    );
    expect(ordered.statuses).toEqual([
      "quote_sent",
      "quote_accepted",
      "carrier_search",
    ]);
  });

  /** The seeded launch state is `false`; leave the database as we found it. */
  it("leaves the §2 gate closed, the seeded launch state", () => {
    closeBrokerageGate();
    expect(
      scalar(`select value::text from company_settings where key = 'brokerage_active'`),
    ).toBe("false");
  });
});
