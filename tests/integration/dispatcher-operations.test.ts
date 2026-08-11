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
  applyBoardColumn,
  BOARD_COLUMNS,
  findBoardColumn,
} from "@/lib/shipments/board";
import {
  buildCreatePayload,
  mapQuoteToShipmentDraft,
  type ConvertibleQuote,
} from "@/lib/shipments/create";
import { parseTrackingSearch } from "@/lib/shipments/search";
import {
  dispatcherMayActOn,
  shipmentScopeExpression,
  type StaffScope,
} from "@/lib/staff-scope";
import {
  evaluateTransition,
  NO_TRANSITION_FACTS,
  type TransitionFacts,
} from "@/lib/shipments/transitions";
import { generateTrackingNumber } from "@/lib/shipments/tracking-number";
import type { ShipmentStatus } from "@/lib/shipments/types";

/**
 * M-75 — the dispatcher lane, against a real PostgreSQL 16.
 *
 * WHAT MAKES THIS AN INTEGRATION TEST. Every decision is made by code imported
 * from `src/` — the real column-membership rules, the real quote mapping, the
 * real §5 search parser, the real transition engine, the real scope
 * expression — and every write goes through the real migration-0022 and -0019
 * functions. The unit lane mocks the client and can prove none of that; the
 * RLS lane is pure SQL and imports no TypeScript. This is the only lane where
 * the two halves have to agree.
 *
 * It covers §27's dispatcher-flow end to end (create → assign → pickup status
 * → delay → ETA → delivered → request POD → complete), plus the two refusals
 * the task names explicitly: the §2 brokerage gate refusing CREATION, and
 * dispatcher A being unable to act on dispatcher B's scope.
 */

/**
 * M-75's OWN identities. The lane shares one database with the other
 * integration files and vitest runs them in file order, so borrowing another
 * file's fixtures would make this suite depend on which one ran first — the
 * exact flake `fileParallelism: false` exists to avoid. Every id below is
 * namespaced `…075…` and created here.
 */
const SHIPPER = "22222222-2222-2222-2222-222222075001";
const SHIPPER_B = "22222222-2222-2222-2222-222222075002";
const CARRIER_A = "11111111-1111-1111-1111-111111075001";
const CARRIER_B = "11111111-1111-1111-1111-111111075002";
const DISPATCHER_A = "00000000-0000-0000-0000-000000075d01";
const DISPATCHER_B = "00000000-0000-0000-0000-000000075d02";
const ADMIN = "00000000-0000-0000-0000-000000075a01";
const DRIVER_A = "0d0d0d0d-0000-0000-0000-000000075001";
const TRUCK_A = "0e0e0e0e-0000-0000-0000-000000075001";
const DRIVER_B = "0d0d0d0d-0000-0000-0000-000000075002";

/* ------------------------------------------------------------------ *
 * Helpers that mirror the real service layer
 * ------------------------------------------------------------------ */

function jsonLit(value: unknown): string {
  return `${lit(JSON.stringify(value))}::jsonb`;
}

/** `createShipment()` minus the mocked client: same payload, same RPC. */
function createShipment(
  draft: Record<string, unknown>,
  trackingNumber = generateTrackingNumber(),
  actor: string | null = DISPATCHER_A,
): { shipmentId: string; trackingNumber: string; eventId: string } {
  const payload = buildCreatePayload(
    draft as never,
    trackingNumber,
  );
  const row = json<{
    shipment_id: string;
    tracking_number: string;
    event_id: string;
  }>(
    `select create_shipment(${jsonLit(payload)}, ${litOrNull(actor)}, 'dispatcher')`,
  );
  return {
    shipmentId: row.shipment_id,
    trackingNumber: row.tracking_number,
    eventId: row.event_id,
  };
}

function facts(shipmentId: string): TransitionFacts & { status: ShipmentStatus } {
  const row = json<{
    status: ShipmentStatus;
    active_assignment_id: string | null;
    pickup_confirmed_at: string | null;
    delivered_at: string | null;
    approved_pod_document_id: string | null;
  }>(`select shipment_transition_facts(${lit(shipmentId)})`);
  return {
    ...NO_TRANSITION_FACTS,
    status: row.status,
    activeAssignmentId: row.active_assignment_id,
    pickupConfirmedAt: row.pickup_confirmed_at,
    deliveredAt: row.delivered_at,
    approvedPodDocumentId: row.approved_pod_document_id,
  };
}

/** The engine decides, then the RPC writes — `apply-transition.ts`'s order. */
function transition(args: {
  shipmentId: string;
  to: ShipmentStatus;
  actor: "admin" | "dispatcher";
  assertions?: Partial<TransitionFacts>;
  cancellationReason?: string | null;
  publicMessage?: string | null;
  visibility?: string;
}): { ok: boolean; code?: string; message?: string } {
  const state = facts(args.shipmentId);
  const eventTime = new Date().toISOString();
  const decision = evaluateTransition({
    from: state.status,
    to: args.to,
    actor: args.actor,
    facts: {
      ...state,
      ...args.assertions,
      deliveryTimestamp: eventTime,
      cancellationReason: args.cancellationReason ?? null,
    },
  });
  if (!decision.ok) return { ok: false, code: decision.code, message: decision.message };

  exec(
    `select apply_shipment_transition(${lit(args.shipmentId)}, ${lit(state.status)},
       ${lit(args.to)}, 'dispatcher', ${lit(DISPATCHER_A)},
       ${lit(args.visibility ?? "public")}, ${lit(eventTime)},
       ${litOrNull(args.publicMessage ?? null)}, null, null, null, null, null,
       '{}'::jsonb, null, null, ${litOrNull(args.cancellationReason ?? null)},
       ${args.to === "cancelled" ? "'cancellation'" : "'status_change'"})`,
  );
  return { ok: true };
}

/**
 * The board query, built from the REAL column rules and the REAL scope
 * expression, translated into SQL. The translator is deliberately dumb — it
 * understands exactly the operators `board.ts` emits and throws on anything
 * else, so a future predicate cannot silently take an untested path.
 */
function boardSql(
  columnId: string,
  scope: StaffScope,
  userId: string,
  now: Date,
): string {
  const clauses: string[] = [];
  const q = {
    eq(c: string, v: unknown) {
      clauses.push(`${c} = ${lit(String(v))}`);
      return q;
    },
    in(c: string, vs: readonly unknown[]) {
      clauses.push(
        vs.length === 0
          ? "false"
          : `${c} in (${vs.map((v) => lit(String(v))).join(", ")})`,
      );
      return q;
    },
    gte(c: string, v: unknown) {
      clauses.push(`${c} >= ${lit(String(v))}::timestamptz`);
      return q;
    },
    lte(c: string, v: unknown) {
      clauses.push(`${c} <= ${lit(String(v))}::timestamptz`);
      return q;
    },
    ilike(c: string, p: string) {
      clauses.push(`${c} ilike ${lit(p)}`);
      return q;
    },
    or(expression: string) {
      // PostgREST `or()` → SQL OR. Only the two shapes board.ts emits.
      const parts = splitOr(expression).map(translateOperand);
      clauses.push(`(${parts.join(" or ")})`);
      return q;
    },
  };

  const scopeExpression = shipmentScopeExpression(scope, userId);
  if (scopeExpression !== null) q.or(scopeExpression);
  const column = findBoardColumn(columnId);
  if (!column) throw new Error(`no such column: ${columnId}`);
  applyBoardColumn(q, column, now);

  return `select count(*) from shipments where ${clauses.join(" and ")}`;
}

/** Split a PostgREST `or()` on top-level commas (parenthesised `in` lists). */
function splitOr(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of expression) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function translateOperand(operand: string): string {
  const [column, op, ...rest] = operand.split(".");
  const value = rest.join(".");
  if (op === "eq") return `${column} = ${lit(value)}`;
  if (op === "gt") return `coalesce(${column}, 0) > ${lit(value)}::numeric`;
  if (op === "in") {
    const values = value.replace(/^\(|\)$/g, "").split(",").filter(Boolean);
    return values.length === 0
      ? "false"
      : `${column} in (${values.map((v) => lit(v)).join(", ")})`;
  }
  throw new Error(`board SQL translator does not implement "${op}"`);
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

beforeAll(() => {
  exec(`insert into auth.users (id, email) values
    (${lit(DISPATCHER_A)}, 'm75-dispatcher-a@integration.test'),
    (${lit(DISPATCHER_B)}, 'm75-dispatcher-b@integration.test'),
    (${lit(ADMIN)}, 'm75-admin@integration.test') on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
    (${lit(DISPATCHER_A)}, 'dispatcher', 'M75 Dispatcher A'),
    (${lit(DISPATCHER_B)}, 'dispatcher', 'M75 Dispatcher B'),
    (${lit(ADMIN)}, 'admin', 'M75 Admin') on conflict do nothing`);
  exec(`insert into shippers (id, company_name) values
    (${lit(SHIPPER)}, 'M75 Shipper A'),
    (${lit(SHIPPER_B)}, 'M75 Shipper B') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active, assigned_dispatcher_id) values
    (${lit(CARRIER_A)}, 'M75 Carrier A', true, ${lit(DISPATCHER_A)}),
    (${lit(CARRIER_B)}, 'M75 Carrier B', true, ${lit(DISPATCHER_B)})
    on conflict (id) do update set assigned_dispatcher_id = excluded.assigned_dispatcher_id`);
  exec(`insert into drivers (id, carrier_id, full_name) values
    (${lit(DRIVER_A)}, ${lit(CARRIER_A)}, 'Driver A'),
    (${lit(DRIVER_B)}, ${lit(CARRIER_B)}, 'Driver B') on conflict do nothing`);
  exec(`insert into trucks (id, carrier_id, unit_number, equipment) values
    (${lit(TRUCK_A)}, ${lit(CARRIER_A)}, '101', 'Dry Van') on conflict do nothing`);
});

const LANE = {
  shipper_id: SHIPPER,
  origin_city: "Newark",
  origin_state: "NJ",
  destination_city: "Atlanta",
  destination_state: "GA",
  equipment: "Dry Van",
  dispatcher_id: DISPATCHER_A,
  status: "carrier_search",
};

/* ================================================================== *
 * §2 — the brokerage gate refuses CREATION
 * ================================================================== */

describe("§2 brokerage gate — the DB half, reached through the real payload builder", () => {
  it("refuses create_shipment with P0001 while brokerage_active is false", () => {
    closeBrokerageGate();
    const payload = buildCreatePayload(LANE as never, "PL-2026-700001");
    const state = sqlstateOf(`select create_shipment(${jsonLit(payload)})`);
    expect(state).toBe("P0001");
    expect(count("select count(*) from shipments where tracking_number = 'PL-2026-700001'")).toBe(0);
    openBrokerageGate();
  });

  it("fails CLOSED when the switchboard key is missing entirely", () => {
    exec("delete from company_settings where key = 'brokerage_active'");
    const payload = buildCreatePayload(LANE as never, "PL-2026-700002");
    expect(sqlstateOf(`select create_shipment(${jsonLit(payload)})`)).toBe("P0001");
    exec(
      "insert into company_settings (key, value) values ('brokerage_active', 'true'::jsonb)",
    );
  });

  it("CREATES once the gate is open — the non-vacuity control", () => {
    openBrokerageGate();
    const { shipmentId } = createShipment(LANE, "PL-2026-700003");
    expect(count(`select count(*) from shipments where id = ${lit(shipmentId)}`)).toBe(1);
  });

  it("keeps existing shipments operable while the gate is CLOSED (M-71's rule)", () => {
    const { shipmentId } = createShipment(LANE, "PL-2026-700004");
    closeBrokerageGate();
    // A status change on freight already in flight must still work — refusing
    // it would strand real freight, which M-71 called the worse outcome.
    expect(transition({ shipmentId, to: "carrier_assigned", actor: "dispatcher" }).ok).toBe(
      false, // no assignment yet — refused by the PRECONDITION, not the gate
    );
    exec(
      `insert into shipment_assignments (shipment_id, carrier_id) values (${lit(shipmentId)}, ${lit(CARRIER_A)})`,
    );
    expect(transition({ shipmentId, to: "carrier_assigned", actor: "dispatcher" }).ok).toBe(true);
    openBrokerageGate();
  });
});

/* ================================================================== *
 * §14 create + the timeline it starts
 * ================================================================== */

describe("§14 create shipment — atomically, with its own event", () => {
  it("writes the shipment AND its shipment_created event in one call", () => {
    const { shipmentId, eventId, trackingNumber } = createShipment(
      LANE,
      "PL-2026-710001",
    );
    expect(trackingNumber).toBe("PL-2026-710001");
    expect(
      count(
        `select count(*) from shipment_events where id = ${lit(eventId)} and shipment_id = ${lit(shipmentId)} and event_type = 'shipment_created'`,
      ),
    ).toBe(1);
  });

  it("takes the DDL defaults for every column the payload omits", () => {
    const { shipmentId } = createShipment(LANE, "PL-2026-710002");
    const row = json<{
      public_tracking_enabled: boolean;
      tracking_mode: string;
      location_visibility: string;
    }>(
      `select to_jsonb(t) from (select public_tracking_enabled, tracking_mode, location_visibility
         from shipments where id = ${lit(shipmentId)}) t`,
    );
    // Privacy-first defaults from 0017 — NOT nulls from an over-eager insert.
    expect(row).toEqual({
      public_tracking_enabled: false,
      tracking_mode: "manual",
      location_visibility: "approximate",
    });
  });

  it("STRIPS the five forbidden keys even when the payload carries them", () => {
    const chosenId = "0f0f0f0f-0000-0000-0000-000000000001";
    const payload = buildCreatePayload(
      {
        ...LANE,
        id: chosenId,
        completed_at: "1999-01-01T00:00:00Z",
        cancelled_at: "1999-01-01T00:00:00Z",
        created_at: "1999-01-01T00:00:00Z",
      } as never,
      "PL-2026-710003",
    );
    // The TypeScript builder strips them…
    expect(payload).not.toHaveProperty("id");
    // …and so does the SQL, proved by sending them past the builder.
    const raw = { ...payload, id: chosenId, completed_at: "1999-01-01T00:00:00Z" };
    const row = json<{ shipment_id: string }>(
      `select create_shipment(${jsonLit(raw)})`,
    );
    expect(row.shipment_id).not.toBe(chosenId);
    expect(
      scalar(
        `select completed_at::text from shipments where id = ${lit(row.shipment_id)}`,
      ),
    ).toBeNull();
  });

  it("refuses a payload with no tracking number (PL422)", () => {
    expect(
      sqlstateOf(
        `select create_shipment(${jsonLit({ ...LANE })})`,
      ),
    ).toBe("PL422");
  });

  it("raises 23505 on a duplicate tracking number — the caller's retry signal", () => {
    createShipment(LANE, "PL-2026-710004");
    const payload = buildCreatePayload(LANE as never, "PL-2026-710004");
    expect(sqlstateOf(`select create_shipment(${jsonLit(payload)})`)).toBe("23505");
  });

  it("refuses a malformed tracking number at the 0017 CHECK", () => {
    const payload = buildCreatePayload(LANE as never, "PL-26-458");
    expect(sqlstateOf(`select create_shipment(${jsonLit(payload)})`)).toBe("23514");
  });
});

/* ================================================================== *
 * §14 quote → shipment conversion
 * ================================================================== */

describe("§14 quote → shipment conversion, through the REAL mapping", () => {
  it("carries the quote's shipper_id and its data onto a real shipment", () => {
    const quoteId = scalar(
      `insert into freight_quotes (email, shipper_id, status, quoted_rate, equipment,
         commodity, weight_lbs, pallets, pickup_date, pickup_city, pickup_state,
         pickup_zip, delivery_city, delivery_state, delivery_zip)
       values ('ops@example.com', ${lit(SHIPPER_B)}, 'agreement', 2450, 'Reefer',
         'Produce', 42000, '24', '2026-09-01', 'Newark', 'NJ', '07105',
         'Atlanta', 'GA', '30336') returning id`,
    )!;
    const quote = json<ConvertibleQuote>(
      `select to_jsonb(t) from (select id, shipper_id, status, quoted_rate, equipment,
         commodity, weight_lbs, pallets, pickup_date, delivery_deadline,
         pickup_company, pickup_address, pickup_city, pickup_state, pickup_zip,
         delivery_company, delivery_address, delivery_city, delivery_state,
         delivery_zip, special_instructions
         from freight_quotes where id = ${lit(quoteId)}) t`,
    );

    const mapped = mapQuoteToShipmentDraft(quote);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("unreachable");

    const { shipmentId } = createShipment(
      mapped.draft as unknown as Record<string, unknown>,
      "PL-2026-720001",
    );
    const row = json<{
      shipper_id: string;
      quote_id: string;
      status: string;
      gross_shipper_amount: number;
      pallets: number;
      equipment: string;
    }>(
      `select to_jsonb(t) from (select shipper_id, quote_id, status,
         gross_shipper_amount::float8 as gross_shipper_amount, pallets, equipment
         from shipments where id = ${lit(shipmentId)}) t`,
    );
    // THE requirement: the quote's shipper becomes the shipment's shipper.
    expect(row.shipper_id).toBe(SHIPPER_B);
    expect(row.quote_id).toBe(quoteId);
    expect(row.status).toBe("quote_accepted");
    expect(row.gross_shipper_amount).toBe(2450);
    expect(row.pallets).toBe(24);
    expect(row.equipment).toBe("Reefer");
  });

  it("the created event records the provenance, so 'where did this come from?' has an answer", () => {
    const converted = json<{ metadata: { converted_from_quote: boolean } }>(
      `select to_jsonb(t) from (select metadata from shipment_events
         where shipment_id = (select id from shipments where tracking_number = 'PL-2026-720001')
           and event_type = 'shipment_created') t`,
    );
    expect(converted.metadata.converted_from_quote).toBe(true);
  });

  it("the idx_shipments_quote lookup answers 'already converted?'", () => {
    const quoteId = scalar(
      "select quote_id::text from shipments where tracking_number = 'PL-2026-720001'",
    )!;
    expect(
      count(`select count(*) from shipments where quote_id = ${lit(quoteId)}`),
    ).toBe(1);
  });
});

/* ================================================================== *
 * §27's dispatcher flow, end to end
 * ================================================================== */

describe("§27 dispatcher flow — create → assign → pickup → delay → ETA → delivered → POD → complete", () => {
  let shipmentId = "";

  it("1 · creates the shipment", () => {
    const created = createShipment(LANE, "PL-2026-730001");
    shipmentId = created.shipmentId;
    expect(facts(shipmentId).status).toBe("carrier_search");
  });

  it("2 · assigns a carrier, a driver and a truck — atomically", () => {
    const row = json<{ assignment_id: string; event_id: string }>(
      `select assign_shipment_carrier(${lit(shipmentId)}, ${lit(CARRIER_A)},
         ${lit(DRIVER_A)}, ${lit(TRUCK_A)}, ${lit(DISPATCHER_A)}, ${lit(DISPATCHER_A)})`,
    );
    expect(row.assignment_id).toBeTruthy();
    // All three writes landed: assignment row, shipments.carrier_id, event.
    expect(
      scalar(`select carrier_id::text from shipments where id = ${lit(shipmentId)}`),
    ).toBe(CARRIER_A);
    expect(
      count(
        `select count(*) from shipment_events where id = ${lit(row.event_id)} and event_type = 'assignment_created'`,
      ),
    ).toBe(1);
    // …and the precondition §20 needs is now satisfiable.
    expect(facts(shipmentId).activeAssignmentId).toBe(row.assignment_id);
  });

  it("2b · refuses another carrier's driver (PL422) — §20's driver rule, structurally", () => {
    const { shipmentId: other } = createShipment(LANE, "PL-2026-730002");
    expect(
      sqlstateOf(
        `select assign_shipment_carrier(${lit(other)}, ${lit(CARRIER_A)}, ${lit(DRIVER_B)})`,
      ),
    ).toBe("PL422");
    expect(
      count(`select count(*) from shipment_assignments where shipment_id = ${lit(other)}`),
    ).toBe(0);
  });

  it("2c · refuses a SECOND open assignment (23505) rather than two carriers on one load", () => {
    expect(
      sqlstateOf(
        `select assign_shipment_carrier(${lit(shipmentId)}, ${lit(CARRIER_B)})`,
      ),
    ).toBe("23505");
  });

  it("3 · walks the pickup statuses through the engine", () => {
    for (const to of [
      "carrier_assigned",
      "dispatched",
      "en_route_to_pickup",
      "arrived_at_pickup",
      "loading",
      "picked_up",
      "in_transit",
    ] as ShipmentStatus[]) {
      const result = transition({ shipmentId, to, actor: "dispatcher" });
      expect(result.ok, `${to}: ${result.message}`).toBe(true);
    }
    expect(facts(shipmentId).status).toBe("in_transit");
  });

  it("4 · records a delay, and the board's Delayed column finds it", () => {
    expect(transition({ shipmentId, to: "delayed", actor: "dispatcher" }).ok).toBe(true);
    const sql = boardSql(
      "delayed",
      { carrierIds: null, restricted: false },
      ADMIN,
      new Date(),
    );
    expect(count(sql)).toBeGreaterThanOrEqual(1);
  });

  it("5 · updates the ETA, preserving the previous value in the event", () => {
    const first = json<{ previous_at: string | null; new_at: string }>(
      `select set_shipment_eta(${lit(shipmentId)}, 'delivery',
         '2026-09-03T17:00:00Z'::timestamptz, 'manual', 'medium', 90,
         'phrase:delay.traffic', 'receiver ran late', ${lit(DISPATCHER_A)})`,
    );
    expect(first.previous_at).toBeNull();

    const second = json<{ previous_at: string; new_at: string }>(
      `select set_shipment_eta(${lit(shipmentId)}, 'delivery',
         '2026-09-04T09:00:00Z'::timestamptz, 'dispatcher_adjusted', 'low', 990,
         null, null, ${lit(DISPATCHER_A)})`,
    );
    expect(second.previous_at).not.toBeNull();
    expect(new Date(second.previous_at).toISOString()).toBe(
      "2026-09-03T17:00:00.000Z",
    );

    const row = json<{
      estimated_delivery_at: string;
      eta_source: string;
      delay_minutes: number;
      delay_reason_public: string;
    }>(
      `select to_jsonb(t) from (select estimated_delivery_at, eta_source, delay_minutes,
         delay_reason_public from shipments where id = ${lit(shipmentId)}) t`,
    );
    expect(row.eta_source).toBe("dispatcher_adjusted");
    expect(row.delay_minutes).toBe(990);
    // The customer-safe D-6 token survives — it is a value the column accepts.
    expect(row.delay_reason_public).toBe("phrase:delay.traffic");
  });

  it("5b · refuses a no-op ETA restatement (PL422) rather than recording nothing", () => {
    expect(
      sqlstateOf(
        `select set_shipment_eta(${lit(shipmentId)}, 'delivery',
           '2026-09-04T09:00:00Z'::timestamptz, 'manual')`,
      ),
    ).toBe("PL422");
  });

  it("6 · marks delivered", () => {
    expect(transition({ shipmentId, to: "in_transit", actor: "dispatcher" }).ok).toBe(true);
    expect(
      transition({ shipmentId, to: "arrived_at_delivery", actor: "dispatcher" }).ok,
    ).toBe(true);
    expect(transition({ shipmentId, to: "unloading", actor: "dispatcher" }).ok).toBe(true);
    expect(transition({ shipmentId, to: "delivered", actor: "dispatcher" }).ok).toBe(true);
    expect(facts(shipmentId).status).toBe("delivered");
  });

  it("7 · requests the POD as a carrier-band event", () => {
    const row = json<{ event_id: string }>(
      `select append_shipment_event(${lit(shipmentId)}, 'pod_requested', 'dispatcher',
         ${lit(DISPATCHER_A)}, 'carrier')`,
    );
    const visibility = scalar(
      `select visibility::text from shipment_events where id = ${lit(row.event_id)}`,
    );
    // Addressed to the carrier — a customer learns nothing from "we chased the POD".
    expect(visibility).toBe("carrier");
  });

  it("7b · `pod_uploaded` is still REFUSED — M-77 owns documents, honestly", () => {
    const result = transition({ shipmentId, to: "pod_uploaded", actor: "dispatcher" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("precondition_failed");
  });

  it("8 · completes ONLY with the human closeout assertion (§20)", () => {
    const without = transition({ shipmentId, to: "completed", actor: "dispatcher" });
    expect(without.ok).toBe(false);
    expect(without.message).toContain("closeout");

    const withCloseout = transition({
      shipmentId,
      to: "completed",
      actor: "dispatcher",
      assertions: { closeoutCompletedAt: new Date().toISOString() },
    });
    expect(withCloseout.ok, withCloseout.message).toBe(true);
    expect(facts(shipmentId).status).toBe("completed");
  });

  it("9 · the whole flow left an unbroken, append-only history", () => {
    const events = count(
      `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`,
    );
    expect(events).toBeGreaterThanOrEqual(15);
    // §7: nothing may be edited or deleted, by anybody, including the owner.
    expect(
      sqlstateOf(
        `update shipment_events set internal_message = 'tampered' where shipment_id = ${lit(shipmentId)}`,
      ),
    ).not.toBe("OK");
  });
});

/* ================================================================== *
 * §20 admin correction, end to end
 * ================================================================== */

describe("§20 admin correction — additive, reasoned, and it calls M-72's RPC", () => {
  let shipmentId = "";
  let wrongEventId = "";

  beforeAll(() => {
    const created = createShipment(LANE, "PL-2026-745001");
    shipmentId = created.shipmentId;
    exec(
      `insert into shipment_assignments (shipment_id, carrier_id) values (${lit(shipmentId)}, ${lit(CARRIER_A)})`,
    );
    transition({ shipmentId, to: "carrier_assigned", actor: "dispatcher" });
    transition({ shipmentId, to: "dispatched", actor: "dispatcher" });
    wrongEventId = scalar(
      `select id::text from shipment_events where shipment_id = ${lit(shipmentId)}
         and status = 'dispatched' order by event_time desc limit 1`,
    )!;
  });

  it("refuses a correction with no reason (PL422)", () => {
    expect(
      sqlstateOf(
        `select apply_shipment_correction(${lit(shipmentId)}, 'dispatched',
           'carrier_assigned', '   ', ${lit(ADMIN)})`,
      ),
    ).toBe("PL422");
  });

  it("applies a reasoned correction and leaves the original event byte-identical", () => {
    const before = scalar(
      `select md5(t::text) from shipment_events t where id = ${lit(wrongEventId)}`,
    );
    exec(
      `select apply_shipment_correction(${lit(shipmentId)}, 'dispatched',
         'carrier_assigned', 'keyed the wrong status this morning', ${lit(ADMIN)})`,
    );
    expect(
      scalar(`select status::text from shipments where id = ${lit(shipmentId)}`),
    ).toBe("carrier_assigned");
    expect(
      scalar(`select md5(t::text) from shipment_events t where id = ${lit(wrongEventId)}`),
    ).toBe(before);
  });

  it("records the correction as a NEW event carrying from → to and the reason", () => {
    const row = json<{
      metadata: { corrected_from: string; corrected_to: string };
      internal_message: string;
    }>(
      `select to_jsonb(t) from (select metadata, internal_message from shipment_events
         where shipment_id = ${lit(shipmentId)} and event_type = 'correction'
         order by recorded_at desc limit 1) t`,
    );
    expect(row.metadata.corrected_from).toBe("dispatched");
    expect(row.metadata.corrected_to).toBe("carrier_assigned");
    expect(row.internal_message).toContain("keyed the wrong status");
  });

  it("refuses a correction whose expected status is stale (PL409)", () => {
    expect(
      sqlstateOf(
        `select apply_shipment_correction(${lit(shipmentId)}, 'in_transit',
           'delivered', 'stale page', ${lit(ADMIN)})`,
      ),
    ).toBe("PL409");
  });

  it("still cannot rewrite the tracking number — §5 immutability holds", () => {
    expect(
      sqlstateOf(
        `update shipments set tracking_number = 'PL-2026-999999' where id = ${lit(shipmentId)}`,
      ),
    ).not.toBe("OK");
  });
});

/* ================================================================== *
 * §19 — dispatcher A cannot act on dispatcher B's scope
 * ================================================================== */

describe("§19 dispatcher least-privilege, against real rows", () => {
  let mine = "";
  let theirs = "";

  beforeAll(() => {
    mine = createShipment({ ...LANE, dispatcher_id: DISPATCHER_A }, "PL-2026-750001")
      .shipmentId;
    theirs = createShipment(
      { ...LANE, dispatcher_id: DISPATCHER_B, shipper_id: SHIPPER_B },
      "PL-2026-750002",
    ).shipmentId;
    exec(
      `select assign_shipment_carrier(${lit(theirs)}, ${lit(CARRIER_B)}, null, null, ${lit(DISPATCHER_B)})`,
    );
  });

  const scopeA: StaffScope = { carrierIds: [CARRIER_A], restricted: true };
  const scopeB: StaffScope = { carrierIds: [CARRIER_B], restricted: true };

  it("dispatcher A's board query returns A's shipment and NOT B's", () => {
    const sql = boardSql("needs_carrier", scopeA, DISPATCHER_A, new Date());
    expect(count(`${sql} and id = ${lit(mine)}`)).toBe(1);
    expect(count(`${sql} and id = ${lit(theirs)}`)).toBe(0);
  });

  it("dispatcher B's board query is the mirror image — the non-vacuity control", () => {
    // Both shipments are still `carrier_search` (assigning a carrier is a fact,
    // not a transition — §20 owns the status), so both live in Needs Carrier
    // and the ONLY thing separating them is the scope.
    const sql = boardSql("needs_carrier", scopeB, DISPATCHER_B, new Date());
    expect(count(`${sql} and id = ${lit(theirs)}`)).toBe(1);
    expect(count(`${sql} and id = ${lit(mine)}`)).toBe(0);
  });

  it("an ADMIN sees both — so every zero above is a scope result, not an empty table", () => {
    const sql = boardSql(
      "needs_carrier",
      { carrierIds: null, restricted: false },
      ADMIN,
      new Date(),
    );
    expect(count(`${sql} and id in (${lit(mine)}, ${lit(theirs)})`)).toBe(2);
  });

  it("the WRITE gate refuses dispatcher A on dispatcher B's shipment", () => {
    const row = json<{ dispatcher_id: string | null; carrier_id: string | null }>(
      `select to_jsonb(t) from (select dispatcher_id, carrier_id from shipments
         where id = ${lit(theirs)}) t`,
    );
    expect(dispatcherMayActOn(scopeA, DISPATCHER_A, row)).toBe(false);
    expect(dispatcherMayActOn(scopeB, DISPATCHER_B, row)).toBe(true);
  });

  it("a dispatcher with NO assigned carriers still sees their OWN shipments", () => {
    const sql = boardSql(
      "needs_carrier",
      { carrierIds: [], restricted: true },
      DISPATCHER_A,
      new Date(),
    );
    expect(count(`${sql} and id = ${lit(mine)}`)).toBe(1);
  });
});

/* ================================================================== *
 * §5 search, against real rows
 * ================================================================== */

describe("§5 search — a pasted number is findable, and the scope still applies", () => {
  it("finds an exact number however it was mangled in transit", () => {
    for (const raw of [
      "PL-2026-750001",
      "  pl-2026-750001 ",
      "2026-750001",
      "PL 2026 750001",
    ]) {
      const term = parseTrackingSearch(raw);
      expect(term.kind, raw).toBe("exact");
      expect(
        count(
          `select count(*) from shipments where tracking_number = ${lit(term.value)}`,
        ),
        raw,
      ).toBe(1);
    }
  });

  it("finds a shipment by the last digits a customer read out", () => {
    const term = parseTrackingSearch("750001");
    expect(term.kind).toBe("pattern");
    expect(
      count(
        `select count(*) from shipments where tracking_number ilike ${lit(term.pattern!)}`,
      ),
    ).toBe(1);
  });

  it("cannot be turned into a wildcard or an injection by a hostile value", () => {
    // Only digits survive the parser, so the worst a hostile string can become
    // is a harmless two-digit tail — never `%`, never a quote, never a clause.
    const term = parseTrackingSearch("' or 1=1 --");
    expect(term.pattern).toBe("PL%11");
    /*
     * The claim is that the hostile string became a BOUNDED TAIL MATCH and
     * not a wildcard — so the assertion is that it matches strictly fewer
     * rows than `PL%` does, and that the query runs at all (an injection
     * would have errored or dropped the table).
     *
     * It used to assert exactly zero, which was a statement about the FIXTURE
     * POPULATION rather than about the parser: this lane shares one database,
     * `generateTrackingNumber()` is random, and M-76 added ~25 shipments —
     * about a one-in-five chance per run that one legitimately ended in `11`.
     * Caught on a repeat run before ship.
     */
    const hostile = count(
      `select count(*) from shipments where tracking_number ilike ${lit(term.pattern!)}`,
    );
    const everything = count(
      `select count(*) from shipments where tracking_number ilike 'PL%'`,
    );
    expect(hostile).toBeLessThan(everything);
    expect(parseTrackingSearch("%").kind).toBe("none");
    expect(parseTrackingSearch("'; drop table shipments; --").kind).toBe("none");
    // The control: the table is still there.
    expect(count("select count(*) from shipments")).toBeGreaterThan(0);
  });

  it("SCOPES the search — dispatcher A cannot find B's number", () => {
    const term = parseTrackingSearch("PL-2026-750002");
    const scoped = shipmentScopeExpression(
      { carrierIds: [CARRIER_A], restricted: true },
      DISPATCHER_A,
    )!;
    const [dispatcherArm, carrierArm] = splitOr(scoped).map(translateOperand);
    expect(
      count(
        `select count(*) from shipments where tracking_number = ${lit(term.value)}
           and (${dispatcherArm} or ${carrierArm})`,
      ),
    ).toBe(0);
    // The row exists — proved without the scope, so the zero is a scope result.
    expect(
      count(
        `select count(*) from shipments where tracking_number = ${lit(term.value)}`,
      ),
    ).toBe(1);
  });
});

/* ================================================================== *
 * §14's remaining timeline actions, and the release path
 * ================================================================== */

describe("§14 timeline actions — call, email, note, exception, notification", () => {
  let shipmentId = "";

  beforeAll(() => {
    shipmentId = createShipment(LANE, "PL-2026-760001").shipmentId;
  });

  it("records a call with its structured facts in metadata, not in the prose", () => {
    const row = json<{ event_id: string }>(
      `select append_shipment_event(${lit(shipmentId)}, 'call_logged', 'dispatcher',
         ${lit(DISPATCHER_A)}, 'staff_only', now() - interval '3 hours',
         null, 'Driver confirmed loaded', null, null, null, null,
         ${jsonLit({ direction: "inbound", party: "driver", contact_name: "A Driver" })})`,
    );
    const event = json<{
      metadata: { direction: string; party: string };
      event_time: string;
      recorded_at: string;
    }>(
      `select to_jsonb(t) from (select metadata, event_time, recorded_at
         from shipment_events where id = ${lit(row.event_id)}) t`,
    );
    expect(event.metadata.direction).toBe("inbound");
    expect(event.metadata.party).toBe("driver");
    // §7 keeps BOTH times, and they differ — a 06:40 call typed up later.
    expect(new Date(event.event_time) < new Date(event.recorded_at)).toBe(true);
  });

  it("records an email the same way", () => {
    const row = json<{ event_id: string }>(
      `select append_shipment_event(${lit(shipmentId)}, 'email_logged', 'dispatcher',
         ${lit(DISPATCHER_A)}, 'staff_only', now(), null, 'Sent rate con', null, null,
         null, null, ${jsonLit({ direction: "outbound", party: "carrier", subject: "Rate confirmation" })})`,
    );
    expect(
      scalar(
        `select metadata ->> 'subject' from shipment_events where id = ${lit(row.event_id)}`,
      ),
    ).toBe("Rate confirmation");
  });

  it("keeps a public update and an internal note in DIFFERENT bands and columns", () => {
    exec(
      `select append_shipment_event(${lit(shipmentId)}, 'public_update', 'dispatcher',
         ${lit(DISPATCHER_A)}, 'public', now(), 'The shipment is in transit.', null)`,
    );
    exec(
      `select append_shipment_event(${lit(shipmentId)}, 'internal_note', 'dispatcher',
         ${lit(DISPATCHER_A)}, 'staff_only', now(), null, 'Receiver closes at 15:00')`,
    );
    // The public one carries no internal message and vice versa — which is what
    // makes M-74's shipper projection correct by construction.
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}
           and event_type = 'public_update' and visibility = 'public'
           and public_message is not null and internal_message is null`,
      ),
    ).toBe(1);
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}
           and event_type = 'internal_note' and visibility = 'staff_only'
           and public_message is null`,
      ),
    ).toBe(1);
  });

  it("logs an exception with a STRUCTURED type and severity M-78 can backfill from", () => {
    const row = json<{ event_id: string }>(
      `select append_shipment_event(${lit(shipmentId)}, 'exception_opened', 'dispatcher',
         ${lit(DISPATCHER_A)}, 'public', now(),
         'phrase:exception.facility_delay', 'Receiver dock backed up', null, null,
         null, null, ${jsonLit({ exception_type: "facility_delay", severity: "medium", exception_source: "m75_event_only" })})`,
    );
    const meta = json<{ metadata: { exception_type: string; severity: string } }>(
      `select to_jsonb(t) from (select metadata from shipment_events where id = ${lit(row.event_id)}) t`,
    );
    expect(meta.metadata.exception_type).toBe("facility_delay");
    expect(meta.metadata.severity).toBe("medium");
    // `shipment_exceptions` deliberately does not exist yet (M-78).
    expect(
      count(
        "select count(*) from information_schema.tables where table_name = 'shipment_exceptions'",
      ),
    ).toBe(0);
  });

  it("deduplicates a notification resend by its idempotency key", () => {
    const key = `m75:notify:${shipmentId}:shipment_status:2026-09-01`;
    const first = json<{ event_id: string; replayed: boolean }>(
      `select append_shipment_event(${lit(shipmentId)}, 'notification_sent', 'dispatcher',
         ${lit(DISPATCHER_A)}, 'staff_only', now(), null, 'resent', null, null, null,
         null, '{}'::jsonb, null, ${lit(key)})`,
    );
    const second = json<{ event_id: string; replayed: boolean }>(
      `select append_shipment_event(${lit(shipmentId)}, 'notification_sent', 'dispatcher',
         ${lit(DISPATCHER_A)}, 'staff_only', now(), null, 'resent again', null, null,
         null, null, '{}'::jsonb, null, ${lit(key)})`,
    );
    expect(second.replayed).toBe(true);
    expect(second.event_id).toBe(first.event_id);
  });

  it("releases a carrier: history kept, carrier_id cleared, event written", () => {
    exec(`select assign_shipment_carrier(${lit(shipmentId)}, ${lit(CARRIER_A)})`);
    const row = json<{ assignment_id: string; event_id: string }>(
      `select release_shipment_assignment(${lit(shipmentId)}, 'carrier fell through',
         ${lit(DISPATCHER_A)})`,
    );
    expect(
      scalar(`select carrier_id::text from shipments where id = ${lit(shipmentId)}`),
    ).toBeNull();
    expect(
      count(
        `select count(*) from shipment_assignments where id = ${lit(row.assignment_id)}
           and released_at is not null and release_reason = 'carrier fell through'`,
      ),
    ).toBe(1);
    expect(
      count(
        `select count(*) from shipment_events where id = ${lit(row.event_id)}
           and event_type = 'assignment_released'`,
      ),
    ).toBe(1);
    // …and a second release finds nothing open.
    expect(
      sqlstateOf(`select release_shipment_assignment(${lit(shipmentId)})`),
    ).toBe("PL422");
  });
});

/* ================================================================== *
 * §14 board columns, against real rows
 * ================================================================== */

describe("§14 board — the real column rules against real data", () => {
  it("every column's SQL runs and returns a number", () => {
    for (const column of BOARD_COLUMNS) {
      const sql = boardSql(
        column.id,
        { carrierIds: null, restricted: false },
        ADMIN,
        new Date(),
      );
      expect(Number.isFinite(count(sql)), column.id).toBe(true);
    }
  });

  it("Pickup Today matches a shipment appointed today and not one appointed last week", () => {
    const today = createShipment(LANE, "PL-2026-770001").shipmentId;
    const past = createShipment(LANE, "PL-2026-770002").shipmentId;
    exec(
      `update shipments set pickup_appointment_at = now() where id = ${lit(today)}`,
    );
    exec(
      `update shipments set pickup_appointment_at = now() - interval '7 days' where id = ${lit(past)}`,
    );
    const sql = boardSql(
      "pickup_today",
      { carrierIds: null, restricted: false },
      ADMIN,
      new Date(),
    );
    expect(count(`${sql} and id = ${lit(today)}`)).toBe(1);
    expect(count(`${sql} and id = ${lit(past)}`)).toBe(0);
  });

  it("Delayed catches delay MINUTES on a shipment that is not flagged `delayed`", () => {
    const id = createShipment(LANE, "PL-2026-770003").shipmentId;
    exec(`update shipments set delay_minutes = 45 where id = ${lit(id)}`);
    const sql = boardSql(
      "delayed",
      { carrierIds: null, restricted: false },
      ADMIN,
      new Date(),
    );
    expect(count(`${sql} and id = ${lit(id)}`)).toBe(1);
    // The control: zero minutes, not delayed → not in the column.
    exec(`update shipments set delay_minutes = 0 where id = ${lit(id)}`);
    expect(count(`${sql} and id = ${lit(id)}`)).toBe(0);
  });

  it("no column surfaces a CANCELLED shipment", () => {
    const id = createShipment(LANE, "PL-2026-770004").shipmentId;
    exec(
      `update shipments set status = 'cancelled', cancellation_reason = 'customer pulled it',
         delay_minutes = 60, pickup_appointment_at = now(), delivery_appointment_at = now()
       where id = ${lit(id)}`,
    );
    for (const column of BOARD_COLUMNS) {
      const sql = boardSql(
        column.id,
        { carrierIds: null, restricted: false },
        ADMIN,
        new Date(),
      );
      expect(count(`${sql} and id = ${lit(id)}`), column.id).toBe(0);
    }
    // …but the status filter still finds it, so it is not hidden.
    expect(
      count(`select count(*) from shipments where id = ${lit(id)} and status = 'cancelled'`),
    ).toBe(1);
  });
});
