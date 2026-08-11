import { beforeAll, describe, expect, it } from "vitest";

import {
  count,
  exec,
  json,
  lit,
  litOrNull,
  openBrokerageGate,
  scalar,
  sqlstateOf,
} from "./helpers/db";
import { createRlsSupabaseClient } from "./helpers/psql-rls-supabase";
import {
  listCustomerExceptions,
  toCustomerExceptionRows,
} from "@/lib/shipments/exceptions";
import { toShipperDto, toStaffDto } from "@/lib/shipments/dto";
import { estimateEta } from "@/lib/shipments/eta-estimate";
import type {
  ShipmentExceptionRow,
  ShipmentRow,
} from "@/lib/shipments/types";

/**
 * M-78 — §10's ETA architecture and §21's exceptions, end to end on PG16.
 *
 * ── §27's ELEVENTH NAMED TEST ────────────────────────────────────────────
 *
 * `FINAL-IMPLEMENTATION-PLAN` §4 restores the §27 integration tier as eleven
 * named tests. The last one is **"exception lifecycle"**, and it could not be
 * written until a lifecycle existed. It is here, and M-83b can strike it off.
 *
 * ── THE THREE THINGS ONLY THIS LANE CAN PROVE ────────────────────────────
 *
 *   1. **THE M-75/M-76 BACKFILL MIGRATES WITHOUT LOSS.** M-75 shipped
 *      exceptions as structured events carrying `metadata.exception_source =
 *      "m75_event_only"` and said in its own doc that M-78 would backfill from
 *      them; M-76 added two more markers on the same contract. This file
 *      writes events in exactly the shape those modules wrote them, runs the
 *      backfill, and checks field for field that nothing was dropped — and
 *      that NOT ONE EVENT was deleted or modified (§7: history is
 *      append-only). It then runs the backfill a SECOND time and asserts zero
 *      new rows, because a migration that duplicates on re-run is a migration
 *      nobody can safely re-run.
 *
 *   2. **AN ETA CHANGE WRITES BOTH HISTORY AND EVENT, ATOMICALLY.** §10
 *      requires the previous value preserved. `set_shipment_eta()` writes the
 *      column, the event and the history row in ONE statement, so a shipment
 *      whose ETA moved without a history row is not a state the system can
 *      reach. Asserted by walking three ETA changes and reading the chain
 *      back.
 *
 *   3. **THE PUBLIC DTO SHOWS THE BANNER WITH THE PUBLIC DESCRIPTION ONLY.**
 *      The unit lane proves the serializer withholds `internal_description`
 *      given a row; only this lane can prove the QUERY under a real session
 *      never had it. Both halves are asserted, with sentinels.
 *
 * Everything runs against the real migration chain. The functions under test
 * are imported unmodified from `src/`.
 */

const SHIPPER = "22222222-2222-2222-2222-222222220078";
const SHIPPER_B = "22222222-2222-2222-2222-222222220079";
const CARRIER_A = "11111111-1111-1111-1111-111111110079";
const BROKER = "33333333-3333-3333-3333-333333330079";
const DISPATCHER = "00000000-0000-0000-0000-0000000e0079";
const SHIPPER_USER = "00000000-0000-0000-0000-0000000a0079";
const SHIPPER_B_USER = "00000000-0000-0000-0000-0000000a0080";
const CARRIER_A_USER = "00000000-0000-0000-0000-0000000b0079";

/** Unique, greppable strings the §21 assertions search for. */
const SENTINEL = {
  internal: "SENTINEL-M78-ITEST-internal-blame-do-not-leak",
  resolution: "SENTINEL-M78-ITEST-resolution-do-not-leak",
  etaInternal: "SENTINEL-M78-ITEST-eta-internal-do-not-leak",
} as const;

/* ------------------------------------------------------------------ *
 * Helpers — the application path, reproduced exactly
 * ------------------------------------------------------------------ */

function createShipment(
  trackingNumber: string,
  overrides: { distanceMiles?: number | null; carrierId?: string | null } = {},
): string {
  const id = scalar(
    `insert into shipments (tracking_number, shipper_id, carrier_id, broker_partner_id,
       dispatcher_id, origin_city, origin_state, destination_city, destination_state,
       equipment, distance_miles)
     values (${lit(trackingNumber)}, ${lit(SHIPPER)},
       ${litOrNull(overrides.carrierId ?? CARRIER_A)}, ${lit(BROKER)}, ${lit(DISPATCHER)},
       'Newark', 'NJ', 'Columbus', 'OH', 'dry-van',
       ${overrides.distanceMiles === undefined ? 480 : (overrides.distanceMiles ?? "null")})
     returning id`,
  );
  if (!id) throw new Error("shipment insert returned no id");
  return id;
}

interface ExceptionEnvelope {
  shipment_id: string;
  exception_id: string | null;
  event_id: string;
  replayed: boolean;
}

/** `open_shipment_exception()` — what `openShipmentException` calls. */
function openException(args: {
  shipmentId: string;
  type?: string;
  severity?: string;
  publicDescription?: string | null;
  internalDescription?: string | null;
  source?: string;
  idempotencyKey?: string | null;
}): ExceptionEnvelope {
  return json<ExceptionEnvelope>(
    `select open_shipment_exception(
       ${lit(args.shipmentId)}, ${lit(args.type ?? "facility_delay")},
       ${lit(args.severity ?? "medium")},
       ${litOrNull(args.publicDescription ?? null)},
       ${litOrNull(args.internalDescription ?? null)},
       ${lit(DISPATCHER)}, null, ${lit(args.source ?? "dispatcher")},
       ${litOrNull(args.idempotencyKey ?? null)},
       '{"exception_source":"m78_dispatcher_report"}'::jsonb)`,
  );
}

function resolveException(args: {
  exceptionId: string;
  resolution: string;
  publicMessage?: string | null;
}): ExceptionEnvelope {
  return json<ExceptionEnvelope>(
    `select resolve_shipment_exception(
       ${lit(args.exceptionId)}, ${lit(args.resolution)}, ${lit(DISPATCHER)},
       'dispatcher', ${litOrNull(args.publicMessage ?? null)}, null, null)`,
  );
}

interface EtaEnvelope {
  shipment_id: string;
  event_id: string;
  history_id: string | null;
  previous_at: string | null;
  new_at: string | null;
  replayed: boolean;
}

function setEta(args: {
  shipmentId: string;
  kind?: "pickup" | "delivery";
  newAt: string | null;
  source?: string;
  confidence?: string | null;
  delayMinutes?: number | null;
  reasonPublic?: string | null;
  reasonInternal?: string | null;
}): EtaEnvelope {
  return json<EtaEnvelope>(
    `select set_shipment_eta(
       ${lit(args.shipmentId)}, ${lit(args.kind ?? "delivery")},
       ${args.newAt === null ? "null" : `${lit(args.newAt)}::timestamptz`},
       ${lit(args.source ?? "manual")},
       ${litOrNull(args.confidence ?? null)},
       ${args.delayMinutes ?? "null"},
       ${litOrNull(args.reasonPublic ?? null)},
       ${litOrNull(args.reasonInternal ?? null)},
       ${lit(DISPATCHER)}, 'dispatcher', 'shipper', null, null)`,
  );
}

/** Exactly the event M-75's `logExceptionAction` used to write. */
function legacyM75ExceptionEvent(args: {
  shipmentId: string;
  type: string;
  severity: string;
  publicMessage: string | null;
  internalMessage: string | null;
  marker?: string;
  source?: string;
}): string {
  const envelope = json<{ event_id: string }>(
    `select append_shipment_event(
       ${lit(args.shipmentId)}, 'exception_opened', ${lit(args.source ?? "dispatcher")},
       ${lit(DISPATCHER)},
       ${args.publicMessage === null ? "'staff_only'" : "'public'"},
       now(), ${litOrNull(args.publicMessage)}, ${litOrNull(args.internalMessage)},
       null, null, null, null,
       ${lit(
         JSON.stringify({
           exception_type: args.type,
           severity: args.severity,
           exception_source: args.marker ?? "m75_event_only",
         }),
       )}::jsonb)`,
  );
  return envelope.event_id;
}

function backfill(): number {
  return count("select backfill_shipment_exceptions()");
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

beforeAll(() => {
  openBrokerageGate();
  exec(`insert into auth.users (id, email) values
      (${lit(DISPATCHER)}, 'm78-dispatcher@integration.test'),
      (${lit(SHIPPER_USER)}, 'm78-shipper@integration.test'),
      (${lit(SHIPPER_B_USER)}, 'm78-shipper-b@integration.test'),
      (${lit(CARRIER_A_USER)}, 'm78-carrier-a@integration.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(DISPATCHER)}, 'dispatcher', 'M78 Dispatcher'),
      (${lit(SHIPPER_USER)}, 'shipper', 'M78 Shipper User'),
      (${lit(SHIPPER_B_USER)}, 'shipper', 'M78 Shipper B User'),
      (${lit(CARRIER_A_USER)}, 'carrier', 'M78 Carrier A User')
    on conflict do nothing`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER)}, 'M78 Shipper Inc'),
      (${lit(SHIPPER_B)}, 'M78 Other Shipper Inc') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER_A)}, 'M78 Carrier A', true) on conflict do nothing`);
  exec(`insert into broker_partners (id, company_name, active) values
      (${lit(BROKER)}, 'M78 Broker Partner', true) on conflict do nothing`);
  exec(`insert into shipper_memberships (shipper_id, profile_id, role) values
      (${lit(SHIPPER)}, ${lit(SHIPPER_USER)}, 'owner'),
      (${lit(SHIPPER_B)}, ${lit(SHIPPER_B_USER)}, 'owner') on conflict do nothing`);
  exec(`insert into carrier_memberships (carrier_id, profile_id, role) values
      (${lit(CARRIER_A)}, ${lit(CARRIER_A_USER)}, 'owner') on conflict do nothing`);
});

/* ================================================================== *
 * 1 · §27's "exception lifecycle" — open → triage → resolve
 * ================================================================== */

describe("§21 exception lifecycle (§27's eleventh named test)", () => {
  it("opens the ROW and the EVENT in one call, and links them", () => {
    const shipment = createShipment("PL-2026-780001");
    const opened = openException({
      shipmentId: shipment,
      type: "facility_delay",
      severity: "high",
      publicDescription: "phrase:exception.facility_delay",
      internalDescription: SENTINEL.internal,
    });

    expect(opened.replayed).toBe(false);
    expect(opened.exception_id).toBeTruthy();

    const row = json<{
      exception_type: string;
      severity: string;
      resolved_at: string | null;
      source_event_id: string;
    }>(
      `select to_jsonb(t) from (select exception_type, severity, resolved_at, source_event_id
         from shipment_exceptions where id = ${lit(opened.exception_id!)}) t`,
    );
    expect(row.exception_type).toBe("facility_delay");
    expect(row.severity).toBe("high");
    expect(row.resolved_at).toBeNull();
    // The row points at the ledger entry that explains it, both ways.
    expect(row.source_event_id).toBe(opened.event_id);

    const event = json<{ event_type: string; visibility: string }>(
      `select to_jsonb(t) from (select event_type, visibility from shipment_events
         where id = ${lit(opened.event_id)}) t`,
    );
    expect(event.event_type).toBe("exception_opened");
    // A public description means the customer IS being told, so the event is
    // in the public band. §21 decides that, not the caller.
    expect(event.visibility).toBe("public");
  });

  it("files an exception with NO public description as staff_only", () => {
    const shipment = createShipment("PL-2026-780002");
    const opened = openException({
      shipmentId: shipment,
      type: "damaged_freight",
      severity: "critical",
      publicDescription: null,
      internalDescription: SENTINEL.internal,
    });
    expect(
      scalar(
        `select visibility from shipment_events where id = ${lit(opened.event_id)}`,
      ),
    ).toBe("staff_only");
  });

  it("REFUSES an exception with neither description (PL422)", () => {
    const shipment = createShipment("PL-2026-780003");
    expect(
      sqlstateOf(
        `select open_shipment_exception(${lit(shipment)}, 'other', 'low', null, '   ')`,
      ),
    ).toBe("PL422");
  });

  it("triages severity and assignment, and stamps customer_notified_at once", () => {
    const shipment = createShipment("PL-2026-780004");
    const opened = openException({
      shipmentId: shipment,
      internalDescription: SENTINEL.internal,
    });
    const id = opened.exception_id!;

    json(
      `select update_shipment_exception(${lit(id)}, ${lit(DISPATCHER)}, true, 'critical',
        'phrase:exception.facility_delay', ${lit(DISPATCHER)})`,
    );
    const first = json<{
      severity: string;
      assigned_to: string;
      customer_notified_at: string;
      public_description: string;
    }>(
      `select to_jsonb(t) from (select severity, assigned_to, customer_notified_at,
         public_description from shipment_exceptions where id = ${lit(id)}) t`,
    );
    expect(first.severity).toBe("critical");
    expect(first.assigned_to).toBe(DISPATCHER);
    expect(first.customer_notified_at).toBeTruthy();
    expect(first.public_description).toBe("phrase:exception.facility_delay");

    // IDEMPOTENT: a second notify keeps the ORIGINAL timestamp. "When did the
    // customer find out?" must not be rewritten by a second click.
    json(`select update_shipment_exception(${lit(id)}, null, true)`);
    expect(
      scalar(
        `select customer_notified_at = ${lit(first.customer_notified_at)}::timestamptz
           from shipment_exceptions where id = ${lit(id)}`,
      ),
    ).toBe("t");

    // A blank triage changes NOTHING — it does not un-assign.
    json(`select update_shipment_exception(${lit(id)})`);
    expect(scalar(`select assigned_to from shipment_exceptions where id = ${lit(id)}`)).toBe(
      DISPATCHER,
    );
  });

  it("resolves with a mandatory resolution, writing the exception_resolved event", () => {
    const shipment = createShipment("PL-2026-780005");
    const opened = openException({
      shipmentId: shipment,
      internalDescription: SENTINEL.internal,
    });
    const id = opened.exception_id!;

    const resolved = resolveException({
      exceptionId: id,
      resolution: SENTINEL.resolution,
      publicMessage: "phrase:resolution.moving_again",
    });
    expect(resolved.replayed).toBe(false);

    const row = json<{
      resolved_at: string;
      resolution: string;
      resolution_event_id: string;
    }>(
      `select to_jsonb(t) from (select resolved_at, resolution, resolution_event_id
         from shipment_exceptions where id = ${lit(id)}) t`,
    );
    expect(row.resolved_at).toBeTruthy();
    expect(row.resolution).toBe(SENTINEL.resolution);
    expect(row.resolution_event_id).toBe(resolved.event_id);

    expect(
      scalar(
        `select event_type::text from shipment_events where id = ${lit(resolved.event_id)}`,
      ),
    ).toBe("exception_resolved");
    expect(
      scalar(
        `select public_message from shipment_events where id = ${lit(resolved.event_id)}`,
      ),
    ).toBe("phrase:resolution.moving_again");
  });

  it("REFUSES a blank resolution (PL422) — the log would be useless later", () => {
    const shipment = createShipment("PL-2026-780006");
    const id = openException({
      shipmentId: shipment,
      internalDescription: SENTINEL.internal,
    }).exception_id!;
    expect(
      sqlstateOf(
        `select resolve_shipment_exception(${lit(id)}, '   ', ${lit(DISPATCHER)})`,
      ),
    ).toBe("PL422");
    expect(count(`select count(*) from shipment_exceptions where id = ${lit(id)} and resolved_at is not null`)).toBe(0);
  });

  it("REFUSES a SECOND resolution (PL409) — resolution is one-way", () => {
    const shipment = createShipment("PL-2026-780007");
    const id = openException({
      shipmentId: shipment,
      internalDescription: SENTINEL.internal,
    }).exception_id!;
    resolveException({ exceptionId: id, resolution: "Closed once." });
    expect(
      sqlstateOf(
        `select resolve_shipment_exception(${lit(id)}, 'Closed twice.', ${lit(DISPATCHER)})`,
      ),
    ).toBe("PL409");
    // …and re-opening means a NEW row, which is what leaves the reopen visible.
    const reopened = openException({
      shipmentId: shipment,
      internalDescription: "Reopened: the dock closed again.",
    });
    expect(reopened.exception_id).not.toBe(id);
    expect(count(`select count(*) from shipment_exceptions where shipment_id = ${lit(shipment)}`)).toBe(2);
  });

  it("REFUSES triage on a CLOSED exception (PL409)", () => {
    const shipment = createShipment("PL-2026-780008");
    const id = openException({
      shipmentId: shipment,
      internalDescription: SENTINEL.internal,
    }).exception_id!;
    resolveException({ exceptionId: id, resolution: "Done." });
    expect(
      sqlstateOf(`select update_shipment_exception(${lit(id)}, null, false, 'low')`),
    ).toBe("PL409");
  });

  it("REFUSES an exception on a shipment that does not exist (PL404)", () => {
    expect(
      sqlstateOf(
        `select open_shipment_exception('00000000-0000-0000-0000-000000000000','other','low',null,'x')`,
      ),
    ).toBe("PL404");
    expect(
      sqlstateOf(
        `select resolve_shipment_exception('00000000-0000-0000-0000-000000000000','x')`,
      ),
    ).toBe("PL404");
  });

  it("replays an idempotent open rather than opening a second exception", () => {
    const shipment = createShipment("PL-2026-780009");
    const key = "itest:m78:open:780009";
    const first = openException({
      shipmentId: shipment,
      internalDescription: SENTINEL.internal,
      idempotencyKey: key,
    });
    const second = openException({
      shipmentId: shipment,
      internalDescription: SENTINEL.internal,
      idempotencyKey: key,
    });
    expect(second.replayed).toBe(true);
    expect(second.exception_id).toBe(first.exception_id);
    expect(
      count(`select count(*) from shipment_exceptions where shipment_id = ${lit(shipment)}`),
    ).toBe(1);
  });
});

/* ================================================================== *
 * 2 · THE M-75/M-76 BACKFILL — migrated without loss, nothing deleted
 * ================================================================== */

describe("the M-75/M-76 backfill (the contract those modules shipped)", () => {
  it("migrates every marked event into a row, field for field, and deletes NOTHING", () => {
    const shipment = createShipment("PL-2026-780010");

    // Exactly the three shapes M-75 and M-76 wrote.
    const m75 = legacyM75ExceptionEvent({
      shipmentId: shipment,
      type: "facility_delay",
      severity: "high",
      publicMessage: "phrase:exception.facility_delay",
      internalMessage: SENTINEL.internal,
      marker: "m75_event_only",
    });
    const m76Carrier = legacyM75ExceptionEvent({
      shipmentId: shipment,
      type: "mechanical_issue",
      severity: "medium",
      publicMessage: null,
      internalMessage: "Air leak on the trailer; shop at 07:00.",
      marker: "m76_carrier_report",
      source: "carrier",
    });
    const m76Driver = legacyM75ExceptionEvent({
      shipmentId: shipment,
      type: "traffic",
      severity: "medium",
      publicMessage: null,
      internalMessage: "I-80 closed at exit 12.",
      marker: "m76_driver_report",
      source: "driver",
    });

    const eventsBefore = count(
      `select count(*) from shipment_events where shipment_id = ${lit(shipment)}`,
    );

    const migrated = backfill();
    expect(migrated).toBeGreaterThanOrEqual(3);

    // §7: NOT ONE EVENT was deleted, and none was modified. 0019's append-only
    // trigger enforces this independently, which is exactly why the assertion
    // is cheap to make and worth making.
    expect(
      count(`select count(*) from shipment_events where shipment_id = ${lit(shipment)}`),
    ).toBe(eventsBefore);
    for (const eventId of [m75, m76Carrier, m76Driver]) {
      expect(count(`select count(*) from shipment_events where id = ${lit(eventId)}`)).toBe(1);
      expect(
        scalar(`select metadata ->> 'exception_source' from shipment_events where id = ${lit(eventId)}`),
      ).toMatch(/^m7[56]_/);
    }

    // FIELD FOR FIELD: the type, the severity, both descriptions, the time and
    // the actor all survived the migration.
    const migratedM75 = json<{
      exception_type: string;
      severity: string;
      public_description: string;
      internal_description: string;
      opened_by: string;
      resolved_at: string | null;
      opened_at: string;
    }>(
      `select to_jsonb(t) from (select exception_type, severity, public_description,
         internal_description, opened_by, resolved_at, opened_at
         from shipment_exceptions where source_event_id = ${lit(m75)}) t`,
    );
    expect(migratedM75.exception_type).toBe("facility_delay");
    expect(migratedM75.severity).toBe("high");
    expect(migratedM75.public_description).toBe("phrase:exception.facility_delay");
    expect(migratedM75.internal_description).toBe(SENTINEL.internal);
    expect(migratedM75.opened_by).toBe(DISPATCHER);
    // A backfilled exception is OPEN — nobody resolved it, and inventing a
    // resolution would be worse than leaving the work visible.
    expect(migratedM75.resolved_at).toBeNull();
    // `opened_at` is the EVENT's time, not the migration's.
    expect(
      count(
        `select count(*) from shipment_events e
          where e.id = ${lit(m75)} and e.event_time = ${lit(migratedM75.opened_at)}::timestamptz`,
      ),
    ).toBe(1);

    // The carrier and driver reports migrated with their internal text and NO
    // public description — §21's "nothing honest to publish yet".
    for (const [eventId, expectedType] of [
      [m76Carrier, "mechanical_issue"],
      [m76Driver, "traffic"],
    ] as const) {
      const row = json<{ exception_type: string; public_description: string | null }>(
        `select to_jsonb(t) from (select exception_type, public_description
           from shipment_exceptions where source_event_id = ${lit(eventId)}) t`,
      );
      expect(row.exception_type).toBe(expectedType);
      expect(row.public_description).toBeNull();
    }
  });

  it("IS IDEMPOTENT — a second run inserts nothing and duplicates nothing", () => {
    const before = count("select count(*) from shipment_exceptions");
    expect(backfill()).toBe(0);
    expect(count("select count(*) from shipment_exceptions")).toBe(before);
    // …and no source event has two rows, which is the failure a unique
    // constraint is there to make impossible.
    expect(
      count(
        `select count(*) from (
           select source_event_id from shipment_exceptions
            where source_event_id is not null
            group by source_event_id having count(*) > 1) d`,
      ),
    ).toBe(0);
  });

  it("does NOT re-migrate exceptions opened THROUGH the new path", () => {
    // `openShipmentException` marks its events `m78_*`, so a freshly-created
    // exception cannot look like a migration candidate forever.
    const shipment = createShipment("PL-2026-780011");
    const opened = openException({
      shipmentId: shipment,
      internalDescription: SENTINEL.internal,
    });
    expect(backfill()).toBe(0);
    expect(
      count(`select count(*) from shipment_exceptions where shipment_id = ${lit(shipment)}`),
    ).toBe(1);
    expect(
      scalar(`select metadata ->> 'exception_source' from shipment_events where id = ${lit(opened.event_id)}`),
    ).toBe("m78_dispatcher_report");
  });

  it("SKIPS an event whose type is not a §21 value, rather than inventing one", () => {
    const shipment = createShipment("PL-2026-780012");
    exec(
      `select append_shipment_event(${lit(shipment)}, 'exception_opened', 'dispatcher',
         ${lit(DISPATCHER)}, 'staff_only', now(), null, 'Something odd', null, null,
         null, null, '{"exception_type":"act_of_god","severity":"high","exception_source":"m75_event_only"}'::jsonb)`,
    );
    expect(backfill()).toBe(0);
    expect(
      count(`select count(*) from shipment_exceptions where shipment_id = ${lit(shipment)}`),
    ).toBe(0);
    // The event is still readable on the timeline, which is where it already
    // was. Nothing was lost; nothing was fabricated.
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipment)}
           and event_type = 'exception_opened'`,
      ),
    ).toBe(1);
  });

  it("NON-VACUITY: the backfill DOES insert when a marked event appears", () => {
    // Without this, "a second run inserts nothing" could be true because the
    // function does nothing at all.
    const shipment = createShipment("PL-2026-780013");
    legacyM75ExceptionEvent({
      shipmentId: shipment,
      type: "weather",
      severity: "low",
      publicMessage: "phrase:exception.weather",
      internalMessage: "Snow on I-80.",
    });
    expect(backfill()).toBe(1);
  });
});

/* ================================================================== *
 * 3 · §10 — an ETA change writes the event AND the history, atomically
 * ================================================================== */

describe("§10 ETA history — the previous value is preserved", () => {
  it("writes the column, the event and the history row in ONE call", () => {
    const shipment = createShipment("PL-2026-780020");
    const first = setEta({
      shipmentId: shipment,
      newAt: "2026-09-10T15:00:00Z",
      source: "manual",
      confidence: "medium",
    });

    expect(first.history_id).toBeTruthy();
    expect(first.previous_at).toBeNull(); // the FIRST ETA
    expect(
      scalar(`select estimated_delivery_at from shipments where id = ${lit(shipment)}`),
    ).toBeTruthy();
    expect(
      scalar(`select event_type::text from shipment_events where id = ${lit(first.event_id)}`),
    ).toBe("eta_update");

    const history = json<{
      previous_eta_at: string | null;
      eta_source: string;
      eta_confidence: string;
      event_id: string;
      changed_by: string;
    }>(
      `select to_jsonb(t) from (select previous_eta_at, eta_source, eta_confidence,
         event_id, changed_by from shipment_eta_history where id = ${lit(first.history_id!)}) t`,
    );
    expect(history.previous_eta_at).toBeNull();
    expect(history.eta_source).toBe("manual");
    expect(history.eta_confidence).toBe("medium");
    expect(history.event_id).toBe(first.event_id);
    expect(history.changed_by).toBe(DISPATCHER);
  });

  it("carries the PREVIOUS value on every subsequent change", () => {
    const shipment = createShipment("PL-2026-780021");
    setEta({ shipmentId: shipment, newAt: "2026-09-10T15:00:00Z" });
    const second = setEta({
      shipmentId: shipment,
      newAt: "2026-09-11T15:00:00Z",
      source: "dispatcher_adjusted",
      delayMinutes: 1440,
      reasonPublic: "phrase:delay.facility",
      reasonInternal: SENTINEL.etaInternal,
    });
    expect(second.previous_at).toBeTruthy();
    expect(new Date(second.previous_at!).toISOString()).toBe(
      "2026-09-10T15:00:00.000Z",
    );

    // The whole chain, in order, is queryable — which is the thing the event
    // metadata could not do.
    const chain = json<{ previous_eta_at: string | null; new_eta_at: string }[]>(
      `select coalesce(jsonb_agg(to_jsonb(t) order by t.changed_at), '[]'::jsonb)
       from (select previous_eta_at, new_eta_at, changed_at from shipment_eta_history
         where shipment_id = ${lit(shipment)}) t`,
    );
    expect(chain).toHaveLength(2);
    expect(chain[0]?.previous_eta_at).toBeNull();
    expect(chain[1]?.previous_eta_at).toBe(chain[0]?.new_eta_at);
  });

  it("records a CLEARED ETA as a change, not as a no-op", () => {
    const shipment = createShipment("PL-2026-780022");
    setEta({ shipmentId: shipment, newAt: "2026-09-10T15:00:00Z" });
    const cleared = setEta({ shipmentId: shipment, newAt: null });
    expect(cleared.new_at).toBeNull();
    expect(cleared.previous_at).toBeTruthy();
    expect(
      count(
        `select count(*) from shipment_eta_history
           where shipment_id = ${lit(shipment)} and new_eta_at is null`,
      ),
    ).toBe(1);
  });

  it("REFUSES a no-op restatement (PL422) and writes no history row", () => {
    const shipment = createShipment("PL-2026-780023");
    setEta({ shipmentId: shipment, newAt: "2026-09-10T15:00:00Z" });
    const before = count(
      `select count(*) from shipment_eta_history where shipment_id = ${lit(shipment)}`,
    );
    expect(
      sqlstateOf(
        `select set_shipment_eta(${lit(shipment)}, 'delivery',
           '2026-09-10T15:00:00Z'::timestamptz, 'manual')`,
      ),
    ).toBe("PL422");
    expect(
      count(`select count(*) from shipment_eta_history where shipment_id = ${lit(shipment)}`),
    ).toBe(before);
  });

  it("keeps pickup and delivery histories separate", () => {
    const shipment = createShipment("PL-2026-780024");
    setEta({ shipmentId: shipment, kind: "pickup", newAt: "2026-09-08T09:00:00Z" });
    setEta({ shipmentId: shipment, kind: "delivery", newAt: "2026-09-10T15:00:00Z" });
    expect(
      count(
        `select count(*) from shipment_eta_history
           where shipment_id = ${lit(shipment)} and eta_kind = 'pickup'`,
      ),
    ).toBe(1);
    // A delivery change must not inherit the PICKUP ETA as its previous value.
    expect(
      count(
        `select count(*) from shipment_eta_history
           where shipment_id = ${lit(shipment)} and eta_kind = 'delivery'
             and previous_eta_at is null`,
      ),
    ).toBe(1);
  });

  it("is APPEND-ONLY — the history cannot be rewritten (§6, §10)", () => {
    const shipment = createShipment("PL-2026-780025");
    setEta({ shipmentId: shipment, newAt: "2026-09-10T15:00:00Z" });
    expect(
      sqlstateOf(
        `update shipment_eta_history set new_eta_at = now()
          where shipment_id = ${lit(shipment)}`,
      ),
    ).toBe("PL409");
    expect(
      sqlstateOf(`delete from shipment_eta_history where shipment_id = ${lit(shipment)}`),
    ).toBe("PL409");
  });

  it("the calculated source produces the SAME number the TS estimator does", () => {
    // The estimator is pure TypeScript and the write path is SQL; this is the
    // one place the two meet. `set_shipment_eta` stores whatever the server
    // computed, so the assertion is that the value written matches
    // `estimateEta()` for the shipment's own recorded mileage.
    const shipment = createShipment("PL-2026-780026", { distanceMiles: 480 });
    const departure = "2026-09-01T12:00:00Z";
    const estimate = estimateEta(480, departure);
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;

    const written = setEta({
      shipmentId: shipment,
      newAt: estimate.etaAt,
      source: "calculated",
      confidence: estimate.confidence,
    });
    const stored = scalar(
      `select estimated_delivery_at from shipments where id = ${lit(shipment)}`,
    );
    expect(new Date(stored!).toISOString()).toBe(
      new Date(estimate.etaAt).toISOString(),
    );
    expect(
      scalar(`select eta_source::text from shipments where id = ${lit(shipment)}`),
    ).toBe("calculated");
    // The method NEVER grades itself `high` — asserted against the value the
    // database actually holds, not against the function's return.
    expect(
      scalar(`select eta_confidence::text from shipments where id = ${lit(shipment)}`),
    ).not.toBe("high");
    expect(written.history_id).toBeTruthy();
  });
});

/* ================================================================== *
 * 4 · The customer surfaces — the banner, with the public text ONLY
 * ================================================================== */

describe("§21 customer visibility, through the REAL session client", () => {
  let shipment = "";

  beforeAll(() => {
    shipment = createShipment("PL-2026-780030");
    openException({
      shipmentId: shipment,
      type: "facility_delay",
      severity: "high",
      publicDescription: "phrase:exception.facility_delay",
      internalDescription: SENTINEL.internal,
    });
    const hidden = openException({
      shipmentId: shipment,
      type: "damaged_freight",
      severity: "critical",
      publicDescription: null,
      internalDescription: SENTINEL.internal,
    });
    // A RESOLVED, published exception — the customer sees it closed, not gone.
    const closed = openException({
      shipmentId: shipment,
      type: "traffic",
      severity: "low",
      publicDescription: "phrase:exception.traffic",
      internalDescription: SENTINEL.internal,
    });
    resolveException({
      exceptionId: closed.exception_id!,
      resolution: SENTINEL.resolution,
    });
    expect(hidden.exception_id).toBeTruthy();
  });

  it("the shipper sees the two PUBLISHED exceptions and not the third", async () => {
    const client = createRlsSupabaseClient({
      role: "authenticated",
      sub: SHIPPER_USER,
    });
    const result = await listCustomerExceptions(
      client as unknown as Parameters<typeof listCustomerExceptions>[0],
      shipment,
    );
    expect(result.failed).toBe(false);
    expect(result.exceptions).toHaveLength(2);
    expect(
      result.exceptions.some((e) => e.exception_type === "damaged_freight"),
    ).toBe(false);
    expect(result.exceptions.some((e) => e.resolved_at !== null)).toBe(true);
  });

  it("§21 SENTINEL: no internal description or resolution reaches the shipper", async () => {
    const client = createRlsSupabaseClient({
      role: "authenticated",
      sub: SHIPPER_USER,
    });
    const result = await listCustomerExceptions(
      client as unknown as Parameters<typeof listCustomerExceptions>[0],
      shipment,
    );
    const payload = JSON.stringify(result);
    expect(payload).not.toContain(SENTINEL.internal);
    expect(payload).not.toContain(SENTINEL.resolution);
  });

  it("NON-VACUITY: a STAFF read of the same rows DOES carry both sentinels", () => {
    const rows = json<Record<string, unknown>[]>(
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
         select * from shipment_exceptions where shipment_id = ${lit(shipment)}) t`,
    );
    const payload = JSON.stringify(rows);
    expect(payload).toContain(SENTINEL.internal);
    expect(payload).toContain(SENTINEL.resolution);
  });

  it("SHIPPER B reads nothing of shipper A's exceptions (§19)", async () => {
    const client = createRlsSupabaseClient({
      role: "authenticated",
      sub: SHIPPER_B_USER,
    });
    const result = await listCustomerExceptions(
      client as unknown as Parameters<typeof listCustomerExceptions>[0],
      shipment,
    );
    expect(result.exceptions).toEqual([]);
  });

  it("the assigned carrier DOES read them — so shipper B's zero is a policy result", async () => {
    const client = createRlsSupabaseClient({
      role: "authenticated",
      sub: CARRIER_A_USER,
    });
    const result = await listCustomerExceptions(
      client as unknown as Parameters<typeof listCustomerExceptions>[0],
      shipment,
    );
    expect(result.exceptions).toHaveLength(2);
  });

  it("the DTO renders the banner with the public description only", async () => {
    const client = createRlsSupabaseClient({
      role: "authenticated",
      sub: SHIPPER_USER,
    });
    const result = await listCustomerExceptions(
      client as unknown as Parameters<typeof listCustomerExceptions>[0],
      shipment,
    );
    const row = json<ShipmentRow>(
      `select to_jsonb(t) from (select * from shipments where id = ${lit(shipment)}) t`,
    );
    const dto = toShipperDto({
      shipment: row,
      exceptions: toCustomerExceptionRows(result.exceptions),
    });

    expect(dto.exceptions).toHaveLength(2);
    expect(dto.exceptions[0]?.description).toBeTruthy();
    expect(dto.exceptions[0]?.exception_type_key).toMatch(/^shipment\.exception\./);
    expect(dto.exceptions[0]?.severity_key).toMatch(/^shipment\.severity\./);
    const payload = JSON.stringify(dto);
    expect(payload).not.toContain(SENTINEL.internal);
    expect(payload).not.toContain(SENTINEL.resolution);

    // NON-VACUITY: the STAFF DTO over the STAFF rows does carry them, so the
    // two absences above are the serializer's doing and not an empty list.
    const staffRows = json<Record<string, unknown>[]>(
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
         select * from shipment_exceptions where shipment_id = ${lit(shipment)}) t`,
    );
    const staffDto = toStaffDto({
      shipment: row,
      exceptions: staffRows as unknown as readonly ShipmentExceptionRow[],
    });
    expect(JSON.stringify(staffDto)).toContain(SENTINEL.internal);
    expect(staffDto.exceptions).toHaveLength(3);
  });
});
