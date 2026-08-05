import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M-72 — the server application layer (`src/lib/shipments/apply-transition.ts`).
 *
 * These are UNIT tests: the Supabase client and the audit writer are mocked,
 * so what is proved here is the layer's own logic — that the engine runs
 * before any write, that a rejection costs no round trip, that idempotent
 * replays are surfaced rather than absorbed, that a correction demands a
 * reason and an admin, and that §15's ledger receives exactly the writes that
 * actually happened.
 *
 * That the RPCs themselves are atomic, deduplicating and append-only is proved
 * against a real PostgreSQL 16 in `tests/integration/` (`npm run
 * test:integration`) and `supabase/tests/` (`npm run test:rls`). A mock cannot
 * prove a transaction boundary, and pretending otherwise would be the vacuous
 * kind of green.
 */

const rpc = vi.fn();
const adminClient = { rpc };
const tryCreateAdminClient = vi.fn<() => typeof adminClient | null>(
  () => adminClient,
);
const recordAuditEvent = vi.fn<(input: unknown) => Promise<void>>(
  async () => {},
);

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => tryCreateAdminClient(),
  createAdminClient: () => adminClient,
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (input: unknown) => recordAuditEvent(input as never),
}));

const {
  appendShipmentEvent,
  applyShipmentCorrection,
  applyShipmentTransition,
  resolveShipmentFacts,
  setShipmentAppointment,
} = await import("@/lib/shipments/apply-transition");

const SHIPMENT = "ffffffff-ffff-ffff-ffff-ffffffff0a01";

/** What `shipment_transition_facts()` returns for a shipment mid-transit. */
function factsRow(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      shipment_id: SHIPMENT,
      tracking_number: "PL-2026-000101",
      status: "in_transit",
      carrier_id: "11111111-1111-1111-1111-11111111aaaa",
      shipper_id: "22222222-2222-2222-2222-2222222aaaaa",
      pickup_appointment_at: null,
      delivery_appointment_at: null,
      cancellation_reason: null,
      active_assignment_id: "fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01",
      pickup_confirmed_at: "2026-08-05T10:00:00.000Z",
      delivered_at: null,
      approved_pod_document_id: null,
      closeout_completed_at: null,
      event_count: 3,
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  rpc.mockReset();
  recordAuditEvent.mockClear();
  tryCreateAdminClient.mockReset();
  tryCreateAdminClient.mockReturnValue(adminClient);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Facts
 * ------------------------------------------------------------------ */

describe("resolveShipmentFacts", () => {
  it("reads every §20 fact in ONE round trip (§25: no N+1)", async () => {
    rpc.mockResolvedValueOnce(factsRow());
    const result = await resolveShipmentFacts(SHIPMENT);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("shipment_transition_facts", {
      p_shipment_id: SHIPMENT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("in_transit");
    expect(result.facts.activeAssignmentId).toBe(
      "fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01",
    );
    // M-77 has not landed, so the POD fact is null and `pod_uploaded` will be
    // refused. That is the intended state, not a gap.
    expect(result.facts.approvedPodDocumentId).toBeNull();
  });

  it("lets the caller assert the facts the DB cannot derive (M-75/M-77)", async () => {
    rpc.mockResolvedValueOnce(factsRow());
    const result = await resolveShipmentFacts(SHIPMENT, {
      approvedPodDocumentId: "doc-9",
      closeoutCompletedAt: "2026-08-07T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.approvedPodDocumentId).toBe("doc-9");
    expect(result.facts.closeoutCompletedAt).toBe("2026-08-07T00:00:00.000Z");
  });

  it("returns shipment_not_found when the function yields nothing", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const result = await resolveShipmentFacts(SHIPMENT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("shipment_not_found");
  });

  it("is honest without a service-role key", async () => {
    tryCreateAdminClient.mockReturnValue(null);
    const result = await resolveShipmentFacts(SHIPMENT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_configured");
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * applyShipmentTransition
 * ------------------------------------------------------------------ */

describe("applyShipmentTransition", () => {
  it("validates BEFORE writing — an illegal edge costs no write", async () => {
    rpc.mockResolvedValueOnce(factsRow());
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "carrier_search",
      actor: "dispatcher",
      source: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("illegal_transition");
    // Exactly one call: the facts read. No write RPC.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses an unmet precondition and names it", async () => {
    rpc.mockResolvedValueOnce(
      factsRow({ status: "unloading", delivered_at: null }),
    );
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "delivered",
      to: "completed",
      actor: "dispatcher",
      source: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("precondition_failed");
    expect(result.preconditions).toEqual([
      "delivery_required",
      "closeout_required",
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a carrier the transitions §19 does not approve", async () => {
    rpc.mockResolvedValueOnce(factsRow());
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "cancelled",
      actor: "carrier",
      source: "carrier",
      cancellationReason: "truck broke down",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("actor_not_permitted");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("writes the status and its event in ONE call, and journals it", async () => {
    rpc
      .mockResolvedValueOnce(factsRow())
      .mockResolvedValueOnce({
        data: {
          event_id: "11111111-2222-3333-4444-555555555555",
          shipment_id: SHIPMENT,
          status: "arrived_at_delivery",
          replayed: false,
        },
        error: null,
      });

    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "arrived_at_delivery",
      actor: "dispatcher",
      actorId: "00000000-0000-0000-0000-0000000000e1",
      source: "dispatcher",
      visibility: "shipper",
      publicMessage: "Arrived at the receiver",
      idempotencyKey: "key-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventId).toBe("11111111-2222-3333-4444-555555555555");
    expect(result.replayed).toBe(false);

    // Facts read + ONE write. The status change and the event are a single
    // round trip by construction — see 0019's rationale.
    expect(rpc).toHaveBeenCalledTimes(2);
    const [fn, args] = rpc.mock.calls[1] as [string, Record<string, unknown>];
    expect(fn).toBe("apply_shipment_transition");
    expect(args.p_expected_status).toBe("in_transit");
    expect(args.p_new_status).toBe("arrived_at_delivery");
    expect(args.p_idempotency_key).toBe("key-1");
    expect(args.p_event_type).toBe("status_change");

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shipment.status_change",
        targetTable: "shipments",
        targetId: SHIPMENT,
      }),
    );
  });

  it("tags a cancellation as a `cancellation` event, not a bare status change", async () => {
    rpc.mockResolvedValueOnce(factsRow()).mockResolvedValueOnce({
      data: { event_id: "e1", shipment_id: SHIPMENT, status: "cancelled", replayed: false },
      error: null,
    });
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "cancelled",
      actor: "dispatcher",
      source: "dispatcher",
      cancellationReason: "shipper withdrew the load",
    });
    expect(result.ok).toBe(true);
    const [, args] = rpc.mock.calls[1] as [string, Record<string, unknown>];
    expect(args.p_event_type).toBe("cancellation");
    expect(args.p_cancellation_reason).toBe("shipper withdrew the load");
  });

  it("refuses a cancellation with no reason before it reaches the database", async () => {
    rpc.mockResolvedValueOnce(factsRow());
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "cancelled",
      actor: "dispatcher",
      source: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("precondition_failed");
    expect(result.preconditions).toEqual(["cancellation_reason_required"]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("surfaces an idempotent replay and writes NO audit row for it", async () => {
    rpc.mockResolvedValueOnce(factsRow()).mockResolvedValueOnce({
      data: {
        event_id: "original-event",
        shipment_id: SHIPMENT,
        status: "arrived_at_delivery",
        replayed: true,
      },
      error: null,
    });
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "arrived_at_delivery",
      actor: "dispatcher",
      source: "dispatcher",
      idempotencyKey: "key-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replayed).toBe(true);
    expect(result.eventId).toBe("original-event");
    // A replay changed nothing; a ledger entry would record a write that did
    // not happen.
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("maps PL409 to a typed status_conflict (compare-and-swap lost)", async () => {
    rpc.mockResolvedValueOnce(factsRow()).mockResolvedValueOnce({
      data: null,
      error: { code: "PL409", message: "shipment is delayed, not in_transit" },
    });
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "arrived_at_delivery",
      actor: "dispatcher",
      source: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("status_conflict");
    expect(result.from).toBe("in_transit");
    expect(result.to).toBe("arrived_at_delivery");
  });

  it("maps PL404 / PL422 / anything else to distinct typed codes", async () => {
    const cases: [string, string][] = [
      ["PL404", "shipment_not_found"],
      ["PL422", "invalid_input"],
      ["23514", "invalid_input"],
      ["42501", "write_failed"],
    ];
    for (const [sqlstate, expected] of cases) {
      rpc.mockReset();
      rpc.mockResolvedValueOnce(factsRow()).mockResolvedValueOnce({
        data: null,
        error: { code: sqlstate, message: "boom" },
      });
      const result = await applyShipmentTransition({
        shipmentId: SHIPMENT,
        expectedStatus: "in_transit",
        to: "arrived_at_delivery",
        actor: "dispatcher",
        source: "dispatcher",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code, `SQLSTATE ${sqlstate}`).toBe(expected);
    }
  });

  it("does not journal a carrier-initiated transition (§15 is the operator ledger)", async () => {
    rpc.mockResolvedValueOnce(factsRow()).mockResolvedValueOnce({
      data: { event_id: "e2", shipment_id: SHIPMENT, status: "arrived_at_delivery", replayed: false },
      error: null,
    });
    await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "arrived_at_delivery",
      actor: "carrier",
      source: "carrier",
    });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("is honest without a service-role key", async () => {
    tryCreateAdminClient.mockReturnValue(null);
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "arrived_at_delivery",
      actor: "dispatcher",
      source: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // It fails at the FACTS read, before any write is attempted — which is
    // the honest order: without a key there is nothing to validate against.
    expect(result.code).toBe("not_configured");
    expect(result.message).toContain("SUPABASE_SERVICE_ROLE_KEY is unset");
  });

  it("is honest without a key even when the facts were pre-resolved", async () => {
    rpc.mockResolvedValueOnce(factsRow());
    const facts = await resolveShipmentFacts(SHIPMENT);
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    tryCreateAdminClient.mockReturnValue(null);
    const result = await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "arrived_at_delivery",
      actor: "dispatcher",
      source: "dispatcher",
      facts,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_configured");
    expect(result.message).toContain("NOT written");
  });

  it("emits a §26 status_update_error signal on every failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce(factsRow());
    await applyShipmentTransition({
      shipmentId: SHIPMENT,
      expectedStatus: "in_transit",
      to: "carrier_search",
      actor: "dispatcher",
      source: "dispatcher",
    });
    expect(spy).toHaveBeenCalledWith("[shipment]", expect.any(String));
    const payload = JSON.parse(spy.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(payload.signal).toBe("status_update_error");
    expect(payload.code).toBe("illegal_transition");
    expect(payload.shipment_id).toBe(SHIPMENT);
  });
});

/* ------------------------------------------------------------------ *
 * §14 dispatcher actions
 * ------------------------------------------------------------------ */

describe("appendShipmentEvent (§14 dispatcher actions)", () => {
  it("records a call as a typed event, staff-only by default", async () => {
    rpc.mockResolvedValueOnce({
      data: { event_id: "e3", shipment_id: SHIPMENT, status: null, replayed: false },
      error: null,
    });
    const result = await appendShipmentEvent({
      shipmentId: SHIPMENT,
      eventType: "call_logged",
      actor: "dispatcher",
      source: "dispatcher",
      internalMessage: "Called the receiver about the dock time",
    });
    expect(result.ok).toBe(true);
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("append_shipment_event");
    expect(args.p_event_type).toBe("call_logged");
    expect(args.p_visibility).toBe("staff_only");
  });

  it("records an email the same way", async () => {
    rpc.mockResolvedValueOnce({
      data: { event_id: "e4", shipment_id: SHIPMENT, status: null, replayed: false },
      error: null,
    });
    await appendShipmentEvent({
      shipmentId: SHIPMENT,
      eventType: "email_logged",
      actor: "dispatcher",
      source: "dispatcher",
      internalMessage: "Sent the rate confirmation",
    });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_event_type).toBe("email_logged");
  });

  /**
   * §14 distinguishes "add public update" from "add internal note". They are
   * the SAME table and the SAME writer, differing only in the §7 visibility
   * band — which is why a staff-only note can never leak into a customer
   * timeline by a query mistake: `dto.ts` filters on the band and 0019's RLS
   * enforces it a second time.
   */
  it("separates a public update from an internal note by visibility alone", async () => {
    rpc
      .mockResolvedValueOnce({
        data: { event_id: "e5", shipment_id: SHIPMENT, status: null, replayed: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { event_id: "e6", shipment_id: SHIPMENT, status: null, replayed: false },
        error: null,
      });

    await appendShipmentEvent({
      shipmentId: SHIPMENT,
      eventType: "public_update",
      actor: "dispatcher",
      source: "dispatcher",
      visibility: "public",
      publicMessage: "Running about an hour behind schedule",
    });
    await appendShipmentEvent({
      shipmentId: SHIPMENT,
      eventType: "internal_note",
      actor: "dispatcher",
      source: "dispatcher",
      internalMessage: "Driver missed the appointment window again",
    });

    const first = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    const second = rpc.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(first.p_event_type).toBe("public_update");
    expect(first.p_visibility).toBe("public");
    expect(first.p_internal_message).toBeNull();
    expect(second.p_event_type).toBe("internal_note");
    expect(second.p_visibility).toBe("staff_only");
    expect(second.p_public_message).toBeNull();
  });

  it("surfaces an idempotent replay", async () => {
    rpc.mockResolvedValueOnce({
      data: { event_id: "original", shipment_id: SHIPMENT, status: null, replayed: true },
      error: null,
    });
    const result = await appendShipmentEvent({
      shipmentId: SHIPMENT,
      eventType: "notification_sent",
      actor: "system",
      source: "system",
      idempotencyKey: "notify-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replayed).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Event-sourced appointments
 * ------------------------------------------------------------------ */

describe("setShipmentAppointment (§6 appointment rescheduled)", () => {
  it("emits appointment_set the first time, shipper-visible by default", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        event_id: "a1",
        shipment_id: SHIPMENT,
        event_type: "appointment_set",
        previous_at: null,
        new_at: "2026-08-10T14:00:00.000Z",
        replayed: false,
      },
      error: null,
    });
    const result = await setShipmentAppointment({
      shipmentId: SHIPMENT,
      kind: "pickup",
      newAt: "2026-08-10T14:00:00.000Z",
      actor: "dispatcher",
      actorId: "00000000-0000-0000-0000-0000000000e1",
      source: "dispatcher",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventType).toBe("appointment_set");
    expect(result.previousAt).toBeNull();
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("set_shipment_appointment");
    expect(args.p_visibility).toBe("shipper");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "shipment.appointment_set" }),
    );
  });

  /**
   * The whole point of plan §4's restoration: a reschedule carries old → new,
   * so "you told me Tuesday" has an answer. A column UPDATE would not.
   */
  it("emits appointment_rescheduled carrying old → new", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        event_id: "a2",
        shipment_id: SHIPMENT,
        event_type: "appointment_rescheduled",
        previous_at: "2026-08-10T14:00:00.000Z",
        new_at: "2026-08-11T09:00:00.000Z",
        replayed: false,
      },
      error: null,
    });
    const result = await setShipmentAppointment({
      shipmentId: SHIPMENT,
      kind: "delivery",
      newAt: "2026-08-11T09:00:00.000Z",
      actor: "dispatcher",
      actorId: "00000000-0000-0000-0000-0000000000e1",
      source: "dispatcher",
      reason: "receiver moved the dock slot",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventType).toBe("appointment_rescheduled");
    expect(result.previousAt).toBe("2026-08-10T14:00:00.000Z");
    expect(result.newAt).toBe("2026-08-11T09:00:00.000Z");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shipment.appointment_rescheduled",
        detail: expect.objectContaining({
          previous_at: "2026-08-10T14:00:00.000Z",
          new_at: "2026-08-11T09:00:00.000Z",
          reason: "receiver moved the dock slot",
        }),
      }),
    );
  });

  it("maps the no-op reschedule (PL422) to invalid_input", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PL422", message: "pickup appointment is already …" },
    });
    const result = await setShipmentAppointment({
      shipmentId: SHIPMENT,
      kind: "pickup",
      newAt: "2026-08-10T14:00:00.000Z",
      actor: "dispatcher",
      source: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
  });
});

/* ------------------------------------------------------------------ *
 * §20 controlled admin correction
 * ------------------------------------------------------------------ */

describe("applyShipmentCorrection (§20)", () => {
  it("refuses everyone but an admin, before any write", async () => {
    for (const actor of ["dispatcher", "carrier", "driver", "shipper", "system"] as const) {
      rpc.mockReset();
      const result = await applyShipmentCorrection({
        shipmentId: SHIPMENT,
        expectedStatus: "delivered",
        correctedStatus: "in_transit",
        reason: "status keyed against the wrong shipment",
        actor,
      });
      expect(result.ok, actor).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("actor_not_permitted");
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("refuses a blank reason, before any write", async () => {
    const result = await applyShipmentCorrection({
      shipmentId: SHIPMENT,
      expectedStatus: "delivered",
      correctedStatus: "in_transit",
      reason: "   ",
      actor: "admin",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
    expect(result.message).toContain("mandatory reason");
    expect(rpc).not.toHaveBeenCalled();
  });

  /**
   * §7 is absolute: corrections are ADDITIONAL events, never edits. The layer
   * never issues a delete or an update against `shipment_events` — and 0019's
   * append-only trigger means it could not succeed if it tried.
   */
  it("bypasses the GRAPH (that is the point) but not the reason or the audit", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        event_id: "c1",
        shipment_id: SHIPMENT,
        status: "in_transit",
        replayed: false,
      },
      error: null,
    });
    // delivered → in_transit is on the IMPOSSIBLE list for a transition.
    const result = await applyShipmentCorrection({
      shipmentId: SHIPMENT,
      expectedStatus: "delivered",
      correctedStatus: "in_transit",
      reason: "delivery was keyed against the wrong shipment",
      actor: "admin",
      actorId: "00000000-0000-0000-0000-0000000000f1",
    });
    expect(result.ok).toBe(true);

    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("apply_shipment_correction");
    expect(args.p_expected_status).toBe("delivered");
    expect(args.p_corrected_status).toBe("in_transit");
    expect(args.p_reason).toBe("delivery was keyed against the wrong shipment");
    // Compare-and-swap is NOT bypassed.
    expect(args.p_expected_status).toBeDefined();

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shipment.status_correction",
        targetTable: "shipments",
        targetId: SHIPMENT,
        detail: expect.objectContaining({
          corrected_from: "delivered",
          corrected_to: "in_transit",
          reason: "delivery was keyed against the wrong shipment",
        }),
      }),
    );
  });

  it("trims the reason before storing it", async () => {
    rpc.mockResolvedValueOnce({
      data: { event_id: "c2", shipment_id: SHIPMENT, status: "in_transit", replayed: false },
      error: null,
    });
    await applyShipmentCorrection({
      shipmentId: SHIPMENT,
      expectedStatus: "delivered",
      correctedStatus: "in_transit",
      reason: "  wrong shipment  ",
      actor: "admin",
    });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_reason).toBe("wrong shipment");
  });

  it("writes no audit row for a replayed correction", async () => {
    rpc.mockResolvedValueOnce({
      data: { event_id: "c1", shipment_id: SHIPMENT, status: "in_transit", replayed: true },
      error: null,
    });
    await applyShipmentCorrection({
      shipmentId: SHIPMENT,
      expectedStatus: "delivered",
      correctedStatus: "in_transit",
      reason: "wrong shipment",
      actor: "admin",
      idempotencyKey: "corr-1",
    });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
