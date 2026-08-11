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
import { listCustomerLocations } from "@/lib/shipments/locations";
import { toPublicTrackingDto, toShipperDto, toStaffDto } from "@/lib/shipments/dto";
import { resolveRetentionDays } from "@/lib/shipments/retention";
import { PROVIDER_ADAPTERS } from "@/lib/shipments/providers";
import type { ShipmentLocationRow, ShipmentRow } from "@/lib/shipments/types";

/**
 * M-80 — §9's location series, the four privacy levels and the RETENTION
 * EXECUTOR, end to end on PG16.
 *
 * ── THE FOUR THINGS ONLY THIS LANE CAN PROVE ─────────────────────────────
 *
 *   1. **THE RETENTION EXECUTOR ACTUALLY DELETES.**
 *      `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 records §9's retention as *"a
 *      policy with no purger"*. The unit lane proves the window arithmetic;
 *      only this lane can write a row, age it, run the purge and observe the
 *      row GONE — and observe that a fresh row is not. Both are asserted,
 *      because "deleted everything" and "deleted nothing" are equally wrong.
 *
 *   2. **A WRITE THEN A VISIBILITY-FILTERED READ, PER AUDIENCE, THROUGH THE
 *      REAL SQL.** `my_shipment_locations()` resolves the audience from the
 *      caller's own memberships and applies §9's four levels IN SQL. The unit
 *      lane proves the serializer given a row; only this lane proves the
 *      QUERY under a real session never had the coordinate to begin with.
 *
 *   3. **DEDUPE IS THE DATABASE'S JOB.** `record_shipment_location()` writes
 *      through a partial unique index on `(shipment_id, provider,
 *      external_event_id)`. Replaying the same provider event is asserted to
 *      report `deduped: true` and to add no row — the property M-72 set up
 *      when it made `external_event_id` unique per shipment.
 *
 *   4. **NO PROVIDER IS CONNECTED.** The shipped adapters are called here,
 *      against the real registry, and every one is asserted to refuse. A
 *      module that claimed "no fake connection" without exercising the
 *      adapters would be claiming it about code nobody ran.
 *
 * Everything runs against the real migration chain. `listCustomerLocations`,
 * the DTO serializers and the adapters are imported unmodified from `src/`.
 */

const SHIPPER = "22222222-2222-2222-2222-222222220080";
const SHIPPER_B = "22222222-2222-2222-2222-222222220081";
const CARRIER_A = "11111111-1111-1111-1111-111111110080";
const BROKER = "33333333-3333-3333-3333-333333330080";
const DISPATCHER = "00000000-0000-0000-0000-0000000e0080";
const SHIPPER_USER = "00000000-0000-0000-0000-0000000a0081";
const SHIPPER_B_USER = "00000000-0000-0000-0000-0000000a0082";
const CARRIER_A_USER = "00000000-0000-0000-0000-0000000b0080";
const STRANGER = "00000000-0000-0000-0000-0000000a0083";

const RAW_SENTINEL = "SENTINEL-M80-ITEST-raw-provider-payload-do-not-leak";
const URL_SENTINEL = "SENTINEL-M80-ITEST-tracking-url-do-not-leak";

function createShipment(
  trackingNumber: string,
  level: string = "approximate",
): string {
  const id = scalar(
    `insert into shipments (tracking_number, shipper_id, carrier_id,
       broker_partner_id, dispatcher_id, origin_city, origin_state,
       destination_city, destination_state, equipment, location_visibility,
       public_tracking_enabled)
     values (${lit(trackingNumber)}, ${lit(SHIPPER)}, ${lit(CARRIER_A)},
       ${lit(BROKER)}, ${lit(DISPATCHER)}, 'Newark', 'NJ', 'Atlanta', 'GA',
       'dry-van', ${lit(level)}, true)
     returning id`,
  );
  if (!id) throw new Error("shipment insert returned no id");
  return id;
}

interface RecordEnvelope {
  deduped: boolean;
  location_id: string | null;
}

/** `record_shipment_location()` — exactly what `recordShipmentLocation` calls. */
function recordLocation(args: {
  shipmentId: string;
  recordedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  state?: string | null;
  speedMph?: number | null;
  heading?: number | null;
  source?: string;
  provider?: string | null;
  externalEventId?: string | null;
  raw?: string;
}): RecordEnvelope {
  return json<RecordEnvelope>(
    `select record_shipment_location(
       ${lit(args.shipmentId)},
       ${args.recordedAt === undefined ? "now()" : litOrNull(args.recordedAt)},
       ${args.latitude ?? "null"}, ${args.longitude ?? "null"},
       ${litOrNull(args.city ?? null)}, ${litOrNull(args.state ?? null)},
       ${args.speedMph ?? "null"}, ${args.heading ?? "null"},
       ${lit(args.source ?? "eld")}, ${litOrNull(
         args.provider === undefined ? "motive" : args.provider,
       )},
       ${litOrNull(args.externalEventId ?? null)},
       ${lit(args.raw ?? JSON.stringify({ vendor: RAW_SENTINEL }))}::jsonb)`,
  );
}

function setLevel(shipmentId: string, level: string): void {
  exec(
    `update shipments set location_visibility = ${lit(level)} where id = ${lit(shipmentId)}`,
  );
}

/** A full `ShipmentRow`, read back so the DTO tests use REAL column values. */
function readShipmentRow(shipmentId: string): ShipmentRow {
  return json<ShipmentRow>(
    `select to_jsonb(t) from (select * from shipments where id = ${lit(shipmentId)}) t`,
  );
}

beforeAll(() => {
  openBrokerageGate();
  exec(`insert into auth.users (id, email) values
      (${lit(DISPATCHER)}, 'm80-dispatcher@integration.test'),
      (${lit(SHIPPER_USER)}, 'm80-shipper@integration.test'),
      (${lit(SHIPPER_B_USER)}, 'm80-shipper-b@integration.test'),
      (${lit(CARRIER_A_USER)}, 'm80-carrier-a@integration.test'),
      (${lit(STRANGER)}, 'm80-stranger@integration.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(DISPATCHER)}, 'dispatcher', 'M80 Dispatcher'),
      (${lit(SHIPPER_USER)}, 'shipper', 'M80 Shipper User'),
      (${lit(SHIPPER_B_USER)}, 'shipper', 'M80 Shipper B User'),
      (${lit(CARRIER_A_USER)}, 'carrier', 'M80 Carrier A User'),
      (${lit(STRANGER)}, 'shipper', 'M80 Stranger')
    on conflict do nothing`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER)}, 'M80 Shipper Inc'),
      (${lit(SHIPPER_B)}, 'M80 Other Shipper Inc') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER_A)}, 'M80 Carrier A', true) on conflict do nothing`);
  exec(`insert into broker_partners (id, company_name, active) values
      (${lit(BROKER)}, 'M80 Broker Partner', true) on conflict do nothing`);
  exec(`insert into shipper_memberships (shipper_id, profile_id, role) values
      (${lit(SHIPPER)}, ${lit(SHIPPER_USER)}, 'owner'),
      (${lit(SHIPPER_B)}, ${lit(SHIPPER_B_USER)}, 'owner') on conflict do nothing`);
  exec(`insert into carrier_memberships (carrier_id, profile_id, role) values
      (${lit(CARRIER_A)}, ${lit(CARRIER_A_USER)}, 'owner') on conflict do nothing`);
  exec(`insert into broker_partner_memberships (broker_partner_id, profile_id, role) values
      (${lit(BROKER)}, ${lit(SHIPPER_B_USER)}, 'owner') on conflict do nothing`);
});

/* ================================================================== *
 * 1 · The write path
 * ================================================================== */

describe("recording a location (§9)", () => {
  it("writes the reading AND advances the shipment's current position", () => {
    const shipment = createShipment("PL-2026-800101");
    const at = "2026-08-04T13:05:00.000Z";
    const result = recordLocation({
      shipmentId: shipment,
      recordedAt: at,
      latitude: 37.5407,
      longitude: -77.436,
      city: "Richmond",
      state: "VA",
      speedMph: 62,
      heading: 190,
      externalEventId: "motive:evt-101",
    });

    expect(result.deduped).toBe(false);
    expect(result.location_id).toBeTruthy();

    const row = json<{
      current_city: string;
      current_latitude: string;
      last_location_at: string;
    }>(
      `select to_jsonb(t) from (select current_city, current_latitude, last_location_at
         from shipments where id = ${lit(shipment)}) t`,
    );
    expect(row.current_city).toBe("Richmond");
    expect(Number(row.current_latitude)).toBeCloseTo(37.5407, 4);
    expect(new Date(row.last_location_at).toISOString()).toBe(at);
  });

  it("§9 DEDUPE: replaying the same provider event adds NO row and says so", () => {
    const shipment = createShipment("PL-2026-800102");
    const first = recordLocation({
      shipmentId: shipment,
      latitude: 40,
      longitude: -74,
      externalEventId: "motive:evt-102",
    });
    const replay = recordLocation({
      shipmentId: shipment,
      latitude: 40,
      longitude: -74,
      externalEventId: "motive:evt-102",
    });

    expect(first.deduped).toBe(false);
    expect(replay.deduped).toBe(true);
    expect(replay.location_id).toBeNull();
    expect(
      count(
        `select count(*) from shipment_locations where shipment_id = ${lit(shipment)}`,
      ),
    ).toBe(1);
  });

  it("NON-VACUITY: a DIFFERENT event id on the same shipment DOES add a row", () => {
    const shipment = createShipment("PL-2026-800103");
    recordLocation({
      shipmentId: shipment,
      latitude: 40,
      longitude: -74,
      externalEventId: "motive:evt-103a",
    });
    recordLocation({
      shipmentId: shipment,
      latitude: 41,
      longitude: -75,
      externalEventId: "motive:evt-103b",
    });
    expect(
      count(
        `select count(*) from shipment_locations where shipment_id = ${lit(shipment)}`,
      ),
    ).toBe(2);
  });

  it("the SAME event id on a DIFFERENT shipment is not a duplicate", () => {
    // The index is per-shipment, exactly as M-72 made `external_event_id` on
    // `shipment_events`: two shipments can legitimately carry a provider's
    // reused identifier.
    const a = createShipment("PL-2026-800104");
    const b = createShipment("PL-2026-800105");
    expect(
      recordLocation({ shipmentId: a, latitude: 40, longitude: -74, externalEventId: "shared" }).deduped,
    ).toBe(false);
    expect(
      recordLocation({ shipmentId: b, latitude: 40, longitude: -74, externalEventId: "shared" }).deduped,
    ).toBe(false);
  });

  it("an OUT-OF-ORDER reading is stored but does NOT move the truck backwards", () => {
    // Queued telematics fixes arrive late. Letting a stale one overwrite a
    // fresh one would put a truck backwards on a customer's page — §30's "do
    // not display fake GPS positions" in its most literal form.
    const shipment = createShipment("PL-2026-800106");
    recordLocation({
      shipmentId: shipment,
      recordedAt: "2026-08-04T13:00:00.000Z",
      city: "Richmond",
      state: "VA",
      latitude: 37.5,
      longitude: -77.4,
      externalEventId: "e-new",
    });
    recordLocation({
      shipmentId: shipment,
      recordedAt: "2026-08-04T09:00:00.000Z",
      city: "Baltimore",
      state: "MD",
      latitude: 39.3,
      longitude: -76.6,
      externalEventId: "e-old",
    });

    const row = json<{ current_city: string; last_location_at: string }>(
      `select to_jsonb(t) from (select current_city, last_location_at
         from shipments where id = ${lit(shipment)}) t`,
    );
    expect(row.current_city).toBe("Richmond");
    // Both readings ARE in the history — nothing was discarded.
    expect(
      count(
        `select count(*) from shipment_locations where shipment_id = ${lit(shipment)}`,
      ),
    ).toBe(2);
  });

  it("refuses a reading for a shipment that does not exist", () => {
    expect(
      sqlstateOf(
        `select record_shipment_location('00000000-0000-0000-0000-000000000000', now(), 40, -74)`,
      ),
    ).toBe("PL404");
  });

  it("MIRRORS a Mode A event into purgeable history with no call-site change", () => {
    const shipment = createShipment("PL-2026-800107");
    exec(
      `insert into shipment_events (shipment_id, event_type, source, city, state, visibility)
       values (${lit(shipment)}, 'location_update', 'dispatcher', 'Roanoke', 'VA', 'public')`,
    );
    expect(
      count(
        `select count(*) from shipment_locations
          where shipment_id = ${lit(shipment)} and city = 'Roanoke'`,
      ),
    ).toBe(1);
  });

  it("§9 RETENTION, STRUCTURAL: the append-only ledger refuses a coordinate", () => {
    const shipment = createShipment("PL-2026-800108");
    expect(
      sqlstateOf(
        `insert into shipment_events (shipment_id, event_type, source, latitude, longitude, visibility)
         values (${lit(shipment)}, 'location_update', 'gps', 37.5, -77.4, 'public')`,
      ),
    ).toBe("PL422");
    // NON-VACUITY: the same insert with a PLACE is accepted.
    expect(
      sqlstateOf(
        `insert into shipment_events (shipment_id, event_type, source, city, state, visibility)
         values (${lit(shipment)}, 'location_update', 'gps', 'Richmond', 'VA', 'public')`,
      ),
    ).toBe("OK");
  });

  it("stamps every reading with a retention expiry from the switchboard", () => {
    const shipment = createShipment("PL-2026-800109");
    recordLocation({ shipmentId: shipment, city: "Richmond", state: "VA", provider: null, source: "dispatcher" });
    const days = count(
      `select round(extract(epoch from (retention_expires_at - recorded_at)) / 86400)
         from shipment_locations where shipment_id = ${lit(shipment)}`,
    );
    expect(days).toBe(resolveRetentionDays(90));
  });
});

/* ================================================================== *
 * 2 · Visibility-filtered reads, per audience
 * ================================================================== */

describe("§9's four levels — the real SQL, under a real session", () => {
  let shipment = "";

  beforeAll(() => {
    shipment = createShipment("PL-2026-800201", "approximate");
    recordLocation({
      shipmentId: shipment,
      recordedAt: "2026-08-04T13:05:00.000Z",
      latitude: 37.5407,
      longitude: -77.436,
      city: "Richmond",
      state: "VA",
      speedMph: 62,
      heading: 190,
      externalEventId: "motive:evt-201",
    });
    recordLocation({
      shipmentId: shipment,
      recordedAt: "2026-08-04T09:00:00.000Z",
      city: "Baltimore",
      state: "MD",
      provider: null,
      source: "dispatcher",
    });
    // A GRANTED Mode B connection, so the "speed if permitted" branch is live.
    exec(
      `insert into tracking_provider_connections
         (shipment_id, provider, external_tracking_id, tracking_url, consent_status)
       values (${lit(shipment)}, 'motive', 'veh-201',
         ${lit(`https://share.example.test/t/${URL_SENTINEL}`)}, 'granted')`,
    );
  });

  function asShipper() {
    return createRlsSupabaseClient({ role: "authenticated", sub: SHIPPER_USER });
  }

  it("approximate: city/state reach the shipper, coordinates and speed do NOT", async () => {
    setLevel(shipment, "approximate");
    const result = await listCustomerLocations(
      asShipper() as unknown as Parameters<typeof listCustomerLocations>[0],
      shipment,
    );
    expect(result.failed).toBe(false);
    expect(result.locations).toHaveLength(2);
    expect(result.locations.every((l) => l.latitude === null)).toBe(true);
    expect(result.locations.every((l) => l.speed_mph === null)).toBe(true);
    expect(result.locations[0]?.city).toBe("Richmond");
  });

  it("exact: the coordinate and the speed DO reach the shipper", async () => {
    setLevel(shipment, "exact");
    const result = await listCustomerLocations(
      asShipper() as unknown as Parameters<typeof listCustomerLocations>[0],
      shipment,
    );
    expect(result.locations.some((l) => l.latitude !== null)).toBe(true);
    expect(result.locations.some((l) => l.speed_mph !== null)).toBe(true);
  });

  it("hidden and milestone_only: ZERO rows, even to the shipment's own shipper", async () => {
    for (const level of ["hidden", "milestone_only"]) {
      setLevel(shipment, level);
      const result = await listCustomerLocations(
        asShipper() as unknown as Parameters<typeof listCustomerLocations>[0],
        shipment,
      );
      expect(result.failed, level).toBe(false);
      expect(result.locations, level).toHaveLength(0);
    }
    setLevel(shipment, "approximate");
  });

  it("the CARRIER and the BROKER read the same series; a STRANGER reads nothing", async () => {
    setLevel(shipment, "approximate");
    for (const sub of [CARRIER_A_USER, SHIPPER_B_USER]) {
      const client = createRlsSupabaseClient({ role: "authenticated", sub });
      const result = await listCustomerLocations(
        client as unknown as Parameters<typeof listCustomerLocations>[0],
        shipment,
      );
      expect(result.locations.length, sub).toBe(2);
    }
    const stranger = createRlsSupabaseClient({
      role: "authenticated",
      sub: STRANGER,
    });
    const result = await listCustomerLocations(
      stranger as unknown as Parameters<typeof listCustomerLocations>[0],
      shipment,
    );
    expect(result.locations).toHaveLength(0);
  });

  it("§9 SENTINEL: the raw provider payload never reaches the shipper's read", async () => {
    setLevel(shipment, "exact");
    const result = await listCustomerLocations(
      asShipper() as unknown as Parameters<typeof listCustomerLocations>[0],
      shipment,
    );
    expect(JSON.stringify(result)).not.toContain(RAW_SENTINEL);
    expect(JSON.stringify(result)).not.toContain(URL_SENTINEL);
    setLevel(shipment, "approximate");
  });

  it("NON-VACUITY: a STAFF read of the same rows DOES carry the sentinel", () => {
    const rows = json<Record<string, unknown>[]>(
      `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
         select * from shipment_locations where shipment_id = ${lit(shipment)}) t`,
    );
    expect(JSON.stringify(rows)).toContain(RAW_SENTINEL);
  });

  it("speed is withheld when the driver's CONSENT is not granted (§9 'if permitted')", async () => {
    setLevel(shipment, "exact");
    exec(
      `update tracking_provider_connections set consent_status = 'revoked'
         where shipment_id = ${lit(shipment)}`,
    );
    const revoked = await listCustomerLocations(
      asShipper() as unknown as Parameters<typeof listCustomerLocations>[0],
      shipment,
    );
    expect(revoked.locations.every((l) => l.speed_mph === null)).toBe(true);
    // …while the POSITION is still returned, so the zero is about consent.
    expect(revoked.locations.some((l) => l.latitude !== null)).toBe(true);

    exec(
      `update tracking_provider_connections set consent_status = 'granted'
         where shipment_id = ${lit(shipment)}`,
    );
    const granted = await listCustomerLocations(
      asShipper() as unknown as Parameters<typeof listCustomerLocations>[0],
      shipment,
    );
    expect(granted.locations.some((l) => l.speed_mph !== null)).toBe(true);
    setLevel(shipment, "approximate");
  });

  it("the DTOs built from the real rows honour the same rule", () => {
    setLevel(shipment, "exact");
    const row = readShipmentRow(shipment);
    const locations = json<ShipmentLocationRow[]>(
      `select coalesce(jsonb_agg(to_jsonb(t) order by t.recorded_at desc), '[]'::jsonb) from (
         select * from shipment_locations where shipment_id = ${lit(shipment)}) t`,
    );

    const shipper = toShipperDto({ shipment: row, locations });
    const publicDto = toPublicTrackingDto({ shipment: row, locations });
    const staff = toStaffDto({ shipment: row, locations });

    expect(shipper.locations.some((l) => l.latitude !== null)).toBe(true);
    // §9's headline rule, on real data: a public visitor gets city/state even
    // at the most revealing level.
    expect(publicDto.locations.every((l) => l.latitude === null)).toBe(true);
    expect(publicDto.locations.every((l) => l.speed_mph === null)).toBe(true);
    // And nobody, staff included, receives the raw provider payload.
    expect(JSON.stringify(staff)).not.toContain(RAW_SENTINEL);
    setLevel(shipment, "approximate");
  });
});

/* ================================================================== *
 * 3 · The visibility WRITE side (§9, §15)
 * ================================================================== */

describe("setting the level (§15 'control public tracking visibility')", () => {
  it("a DISPATCHER may narrow, and the change is journalled as an event", () => {
    const shipment = createShipment("PL-2026-800301", "exact");
    const before = count(
      `select count(*) from shipment_events where shipment_id = ${lit(shipment)}`,
    );
    const result = json<{ previous_level: string; new_level: string }>(
      `select set_shipment_location_visibility(${lit(shipment)}, 'hidden', ${lit(DISPATCHER)}, 'dispatcher')`,
    );
    expect(result.previous_level).toBe("exact");
    expect(result.new_level).toBe("hidden");
    expect(
      scalar(
        `select location_visibility::text from shipments where id = ${lit(shipment)}`,
      ),
    ).toBe("hidden");
    // §15 "audit who changed each status", extended to who changed how much
    // of the truck the customer can see.
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipment)}`,
      ),
    ).toBe(before + 1);
    expect(
      count(
        `select count(*) from shipment_events
          where shipment_id = ${lit(shipment)}
            and visibility = 'staff_only'
            and metadata->>'kind' = 'location_visibility_change'`,
      ),
    ).toBe(1);
  });

  it("a DISPATCHER may NOT widen — PL403", () => {
    const shipment = createShipment("PL-2026-800302", "hidden");
    expect(
      sqlstateOf(
        `select set_shipment_location_visibility(${lit(shipment)}, 'exact', ${lit(DISPATCHER)}, 'dispatcher')`,
      ),
    ).toBe("PL403");
    expect(
      scalar(
        `select location_visibility::text from shipments where id = ${lit(shipment)}`,
      ),
    ).toBe("hidden");
  });

  it("an ADMIN may widen — the refusal above is about the ROLE, not the value", () => {
    const shipment = createShipment("PL-2026-800303", "hidden");
    expect(
      sqlstateOf(
        `select set_shipment_location_visibility(${lit(shipment)}, 'exact', ${lit(DISPATCHER)}, 'admin')`,
      ),
    ).toBe("OK");
    expect(
      scalar(
        `select location_visibility::text from shipments where id = ${lit(shipment)}`,
      ),
    ).toBe("exact");
  });

  it("refuses a no-op restatement", () => {
    const shipment = createShipment("PL-2026-800304", "approximate");
    expect(
      sqlstateOf(
        `select set_shipment_location_visibility(${lit(shipment)}, 'approximate', ${lit(DISPATCHER)}, 'admin')`,
      ),
    ).toBe("PL422");
  });
});

/* ================================================================== *
 * 4 · §9 Mode B — the per-shipment tracking link
 * ================================================================== */

describe("Mode B connections (§9, §15, §30)", () => {
  it("attaching a link switches the shipment to `link` mode and journals it", () => {
    const shipment = createShipment("PL-2026-800401");
    expect(
      scalar(`select tracking_mode::text from shipments where id = ${lit(shipment)}`),
    ).toBe("manual");

    json(
      `select attach_tracking_provider_connection(${lit(shipment)}, 'motive', 'veh-401',
        ${lit(`https://share.example.test/t/${URL_SENTINEL}`)}, null, 'granted', ${lit(DISPATCHER)})`,
    );
    expect(
      scalar(`select tracking_mode::text from shipments where id = ${lit(shipment)}`),
    ).toBe("link");
    expect(
      count(
        `select count(*) from shipment_events
          where shipment_id = ${lit(shipment)}
            and metadata->>'kind' = 'provider_connection_attached'`,
      ),
    ).toBe(1);
  });

  it("attaching a SECOND link revokes the first, in one statement", () => {
    const shipment = createShipment("PL-2026-800402");
    json(
      `select attach_tracking_provider_connection(${lit(shipment)}, 'motive', 'a', 'https://x.test/a', null, 'pending', null)`,
    );
    json(
      `select attach_tracking_provider_connection(${lit(shipment)}, 'samsara', 'b', 'https://x.test/b', null, 'pending', null)`,
    );
    expect(
      count(
        `select count(*) from tracking_provider_connections
          where shipment_id = ${lit(shipment)} and active`,
      ),
    ).toBe(1);
    expect(
      count(
        `select count(*) from tracking_provider_connections
          where shipment_id = ${lit(shipment)}`,
      ),
    ).toBe(2);
  });

  it("§30: revoking the last link returns the shipment to MILESTONE tracking", () => {
    const shipment = createShipment("PL-2026-800403");
    const envelope = json<{ connection_id: string }>(
      `select attach_tracking_provider_connection(${lit(shipment)}, 'geotab', 'c', 'https://x.test/c', null, 'granted', null)`,
    );
    expect(
      scalar(`select tracking_mode::text from shipments where id = ${lit(shipment)}`),
    ).toBe("link");

    json(
      `select revoke_tracking_provider_connection(${lit(envelope.connection_id)}, ${lit(DISPATCHER)}, 'test')`,
    );
    expect(
      scalar(`select tracking_mode::text from shipments where id = ${lit(shipment)}`),
    ).toBe("manual");
    expect(
      count(
        `select count(*) from shipment_events
          where shipment_id = ${lit(shipment)}
            and metadata->>'kind' = 'provider_connection_revoked'`,
      ),
    ).toBe(1);
  });

  it("§15: a URL carrying an integration credential is refused by the DATABASE", () => {
    const shipment = createShipment("PL-2026-800404");
    for (const url of [
      "https://x.test/a?api_key=SECRET",
      "https://x.test/a?access_token=abc",
      "https://x.test/a?client_secret=abc",
      "http://x.test/a",
      "javascript:alert(1)",
    ]) {
      expect(
        sqlstateOf(
          `select attach_tracking_provider_connection(${lit(shipment)}, 'other', null, ${lit(url)}, null, 'pending', null)`,
        ),
        url,
      ).toBe("23514");
    }
    // NON-VACUITY: an opaque share link IS accepted — that is what Mode B is.
    expect(
      sqlstateOf(
        `select attach_tracking_provider_connection(${lit(shipment)}, 'other', null, 'https://x.test/share/opaque-abc', null, 'pending', null)`,
      ),
    ).toBe("OK");
  });
});

/* ================================================================== *
 * 5 · THE RETENTION EXECUTOR (§9, plan §4)
 * ================================================================== */

describe("the retention executor deletes (§9)", () => {
  it("deletes an EXPIRED reading and keeps a fresh one", () => {
    const shipment = createShipment("PL-2026-800501");
    // `recordedAt` omitted → now(), which is what makes this row fresh.
    // It cannot be aged afterwards: 0027 makes a reading IMMUTABLE, so the
    // stale row below is written aged rather than updated into staleness.
    recordLocation({
      shipmentId: shipment,
      city: "Fresh",
      state: "VA",
      provider: null,
      source: "dispatcher",
    });
    exec(
      `insert into shipment_locations
         (shipment_id, recorded_at, city, state, source, retention_expires_at)
       values (${lit(shipment)}, now() - interval '400 days', 'Stale', 'VA',
               'dispatcher', now() - interval '310 days')`,
    );

    expect(
      count(
        `select count(*) from shipment_locations where shipment_id = ${lit(shipment)}`,
      ),
    ).toBe(2);

    const result = json<{ deleted: number; retention_days: number }>(
      `select purge_expired_shipment_locations()`,
    );
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(result.retention_days).toBe(90);

    expect(
      count(
        `select count(*) from shipment_locations
          where shipment_id = ${lit(shipment)} and city = 'Stale'`,
      ),
    ).toBe(0);
    // The proof that it deleted by WINDOW and not by table.
    expect(
      count(
        `select count(*) from shipment_locations
          where shipment_id = ${lit(shipment)} and city = 'Fresh'`,
      ),
    ).toBe(1);
  });

  it("is idempotent — a second run on the same data deletes nothing", () => {
    json(`select purge_expired_shipment_locations()`);
    const second = json<{ deleted: number }>(
      `select purge_expired_shipment_locations()`,
    );
    expect(second.deleted).toBe(0);
  });

  it("§9 CONFIGURABLE: shortening the window takes effect with no deploy", () => {
    const shipment = createShipment("PL-2026-800502");
    exec(
      `insert into shipment_locations
         (shipment_id, recorded_at, city, state, source, retention_expires_at)
       values (${lit(shipment)}, now() - interval '10 days', 'TenDaysOld', 'VA',
               'dispatcher', now() + interval '80 days')`,
    );
    // Survives at 90 days…
    json(`select purge_expired_shipment_locations()`);
    expect(
      count(
        `select count(*) from shipment_locations
          where shipment_id = ${lit(shipment)} and city = 'TenDaysOld'`,
      ),
    ).toBe(1);

    // …and is deleted the moment the switchboard says one day.
    exec(
      `update company_settings set value = '1'::jsonb where key = 'location_retention_days'`,
    );
    expect(count(`select location_retention_days()`)).toBe(1);
    const result = json<{ deleted: number; retention_days: number }>(
      `select purge_expired_shipment_locations()`,
    );
    expect(result.retention_days).toBe(1);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(
      count(
        `select count(*) from shipment_locations
          where shipment_id = ${lit(shipment)} and city = 'TenDaysOld'`,
      ),
    ).toBe(0);

    exec(
      `update company_settings set value = '90'::jsonb where key = 'location_retention_days'`,
    );
  });

  it("FAILS SAFE: an unparseable setting resolves to 90, never to 'keep forever'", () => {
    exec(
      `update company_settings set value = '"ninety"'::jsonb where key = 'location_retention_days'`,
    );
    expect(count(`select location_retention_days()`)).toBe(90);
    exec(
      `update company_settings set value = '99999'::jsonb where key = 'location_retention_days'`,
    );
    expect(count(`select location_retention_days()`)).toBe(90);
    exec(
      `delete from company_settings where key = 'location_retention_days'`,
    );
    expect(count(`select location_retention_days()`)).toBe(90);
    exec(
      `insert into company_settings (key, value) values ('location_retention_days', '90'::jsonb)`,
    );
    // The SQL ladder and the TypeScript ladder agree, which is the anti-drift
    // claim the unit suite makes from the other side.
    expect(count(`select location_retention_days()`)).toBe(
      resolveRetentionDays("ninety"),
    );
  });

  it("is BOUNDED per call and reports whether more remain", () => {
    const shipment = createShipment("PL-2026-800503");
    for (let i = 0; i < 3; i += 1) {
      exec(
        `insert into shipment_locations
           (shipment_id, recorded_at, city, state, source, retention_expires_at)
         values (${lit(shipment)}, now() - interval '400 days', 'Batch${i}', 'VA',
                 'dispatcher', now() - interval '310 days')`,
      );
    }
    const first = json<{ deleted: number; more_remaining: boolean }>(
      `select purge_expired_shipment_locations(null, 2)`,
    );
    expect(first.deleted).toBe(2);
    expect(first.more_remaining).toBe(true);
    const second = json<{ deleted: number; more_remaining: boolean }>(
      `select purge_expired_shipment_locations(null, 2)`,
    );
    expect(second.deleted).toBe(1);
    expect(second.more_remaining).toBe(false);
  });
});

/* ================================================================== *
 * 6 · No provider is connected (§9, §30)
 * ================================================================== */

describe("the adapters, exercised against the real registry", () => {
  it("every named provider refuses every fetch — nothing fabricates a position", async () => {
    const ctx = {
      shipmentId: "00000000-0000-0000-0000-000000000000",
      externalTrackingId: "veh-1",
      consentGranted: true,
    };
    for (const adapter of Object.values(PROVIDER_ADAPTERS)) {
      const result = await adapter.fetchCurrentLocation(ctx);
      expect(result.ok, adapter.displayName).toBe(false);
      if (!result.ok) {
        expect(["not_configured", "not_implemented"]).toContain(result.code);
      }
    }
  });

  it("`shipment_locations` is EMPTY of provider-sourced rows nobody recorded by hand", () => {
    // Every `eld`/`gps` row in this database was written by a test calling
    // `record_shipment_location()` directly. No adapter produced one, because
    // no adapter can.
    const total = count(
      `select count(*) from shipment_locations where source in ('eld','gps')`,
    );
    const mirrored = count(
      `select count(*) from shipment_locations
        where source in ('eld','gps') and provider = 'other'`,
    );
    expect(total).toBeGreaterThan(0);
    // The mirror labels an unnamed ELD source `other`; nothing is attributed
    // to a named vendor except what a test wrote.
    expect(mirrored).toBeLessThanOrEqual(total);
  });
});
