import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCATION_VISIBILITY,
  LOCATION_VISIBILITY_LABELS,
  LOCATION_VISIBILITY_RANK,
  LOCATION_VISIBILITY_REFUSAL_MESSAGES,
  isLocationVisibility,
  mayChangeLocationVisibility,
} from "@/lib/shipments/location-visibility";
import {
  LOCATION_PANEL_LABEL_KEY,
  mapMayMount,
  resolveLocationPanelState,
} from "@/lib/shipments/map-state";
import {
  SHIPMENT_AUDIENCES,
  toBrokerDto,
  toCarrierDto,
  toCustomerLocationDto,
  toPublicTrackingDto,
  toShipperDto,
  toStaffDto,
  type ShipmentAudience,
} from "@/lib/shipments/dto";
import {
  SHIPMENT_LOCATION_VISIBILITIES,
  type ShipmentLocationRow,
  type ShipmentLocationVisibility,
  type ShipmentRow,
} from "@/lib/shipments/types";

/**
 * M-80 — §9's FOUR location-visibility levels, end to end in pure code.
 *
 * M-70 shipped the READ side and its doc closed with *"M-80 decides per-event
 * coordinate disclosure"*. This suite proves both halves of what M-80
 * decided:
 *
 *   * the READ side, now including the location SERIES: four levels × five
 *     audiences, with the public audience capped at city/state even at
 *     `exact` (§9: "do not permanently expose exact real-time truck position
 *     to every public visitor");
 *   * the WRITE side: narrowing is a dispatcher action, widening is an admin
 *     action, and the rule is pinned against 0027's SQL so the app-level
 *     check and the authority cannot drift.
 *
 * And the decision M-70 deferred, asserted directly: **customer EVENT DTOs
 * still carry no coordinates.** Positions live in the purgeable series
 * instead, because 0019's ledger is append-only and a retention window over a
 * table nobody can delete from is not a retention window.
 */

const SENSITIVE_COORD = { lat: 37.5407, lon: -77.436 } as const;

function shipmentFixture(
  level: ShipmentLocationVisibility,
  overrides: Partial<ShipmentRow> = {},
): ShipmentRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tracking_number: "PL-2026-000458",
    shipper_id: "s-1",
    carrier_id: "c-1",
    dispatcher_id: "d-1",
    quote_id: null,
    broker_partner_id: "b-1",
    load_id: null,
    status: "in_transit",
    origin_company: "Origin Co",
    origin_address: "1 Dock St",
    origin_city: "Newark",
    origin_state: "NJ",
    origin_zip: "07102",
    destination_company: "Dest Co",
    destination_address: "9 Dock Rd",
    destination_city: "Atlanta",
    destination_state: "GA",
    destination_zip: "30301",
    pickup_appointment_at: null,
    delivery_appointment_at: null,
    equipment: "dry_van",
    commodity_category: null,
    weight_lbs: null,
    pallets: null,
    distance_miles: null,
    gross_shipper_amount: null,
    carrier_pay: null,
    margin: null,
    shipper_reference: null,
    po_number: null,
    public_tracking_enabled: true,
    tracking_mode: "manual",
    location_visibility: level,
    public_access_hash: null,
    current_latitude: SENSITIVE_COORD.lat,
    current_longitude: SENSITIVE_COORD.lon,
    current_city: "Richmond",
    current_state: "VA",
    last_location_at: "2026-08-04T13:05:00.000Z",
    estimated_pickup_at: null,
    estimated_delivery_at: null,
    eta_source: null,
    eta_confidence: null,
    eta_updated_at: null,
    delay_minutes: null,
    delay_reason_public: null,
    delay_reason_internal: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-04T13:05:00.000Z",
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    ...overrides,
  };
}

function locationFixture(
  overrides: Partial<ShipmentLocationRow> = {},
): ShipmentLocationRow {
  return {
    id: "loc-1",
    shipment_id: "11111111-1111-4111-8111-111111111111",
    recorded_at: "2026-08-04T13:05:00.000Z",
    latitude: SENSITIVE_COORD.lat,
    longitude: SENSITIVE_COORD.lon,
    city: "Richmond",
    state: "VA",
    speed_mph: 62,
    heading_degrees: 190,
    source: "eld",
    provider: "motive",
    external_event_id: "motive:evt-1",
    raw_metadata: { SENTINEL: "RAW-PROVIDER-PAYLOAD-DO-NOT-LEAK" },
    retention_expires_at: "2026-11-02T13:05:00.000Z",
    ...overrides,
  };
}

/* ================================================================== *
 * 1 · The four levels, per audience, on the SERIES
 * ================================================================== */

describe("§9's four levels × five audiences (location series)", () => {
  it("hidden and milestone_only disclose NOTHING to any customer audience", () => {
    for (const level of ["hidden", "milestone_only"] as const) {
      for (const audience of ["public", "shipper", "carrier", "broker"] as const) {
        expect(
          toCustomerLocationDto(audience, level, locationFixture()),
          `${audience} at ${level}`,
        ).toBeNull();
      }
    }
  });

  it("approximate discloses city/state and NEVER a coordinate or a speed", () => {
    for (const audience of ["public", "shipper", "carrier", "broker"] as const) {
      const dto = toCustomerLocationDto(
        audience,
        "approximate",
        locationFixture(),
      );
      expect(dto).not.toBeNull();
      expect(dto?.city).toBe("Richmond");
      expect(dto?.state).toBe("VA");
      expect(dto?.latitude).toBeNull();
      expect(dto?.longitude).toBeNull();
      expect(dto?.speed_mph).toBeNull();
    }
  });

  it("exact discloses coordinates and speed to the three ACCOUNT audiences", () => {
    for (const audience of ["shipper", "carrier", "broker"] as const) {
      const dto = toCustomerLocationDto(audience, "exact", locationFixture());
      expect(dto?.latitude).toBe(SENSITIVE_COORD.lat);
      expect(dto?.longitude).toBe(SENSITIVE_COORD.lon);
      expect(dto?.speed_mph).toBe(62);
    }
  });

  it("§9's HEADLINE RULE: the PUBLIC audience is capped at city/state even at `exact`", () => {
    // "Do not permanently expose exact real-time truck position to every
    // public visitor." A tracking number plus a ZIP is not an account.
    const dto = toCustomerLocationDto("public", "exact", locationFixture());
    expect(dto).not.toBeNull();
    expect(dto?.city).toBe("Richmond");
    expect(dto?.latitude).toBeNull();
    expect(dto?.longitude).toBeNull();
    expect(dto?.speed_mph).toBeNull();
  });

  it("the KEY SET never varies with the level — the setting is not a signal", () => {
    const approximate = toCustomerLocationDto(
      "shipper",
      "approximate",
      locationFixture(),
    );
    const exact = toCustomerLocationDto("shipper", "exact", locationFixture());
    expect(Object.keys(approximate ?? {}).sort()).toEqual(
      Object.keys(exact ?? {}).sort(),
    );
  });

  it("no customer DTO carries §9's RAW PROVIDER METADATA — at any level", () => {
    for (const level of SHIPMENT_LOCATION_VISIBILITIES) {
      for (const audience of SHIPMENT_AUDIENCES) {
        const dto = toCustomerLocationDto(
          audience as ShipmentAudience,
          level,
          locationFixture(),
        );
        expect(JSON.stringify(dto ?? {})).not.toContain(
          "RAW-PROVIDER-PAYLOAD-DO-NOT-LEAK",
        );
      }
    }
  });

  it("the STAFF DTO carries no raw metadata either — the one field nobody serializes", () => {
    const staff = toStaffDto({
      shipment: shipmentFixture("exact"),
      locations: [locationFixture()],
    });
    expect(JSON.stringify(staff)).not.toContain(
      "RAW-PROVIDER-PAYLOAD-DO-NOT-LEAK",
    );
    // NON-VACUITY: staff DO get the coordinates and the provider, so the
    // absence above is about `raw_metadata` and not about an empty list.
    expect(staff.locations[0]?.latitude).toBe(SENSITIVE_COORD.lat);
    expect(staff.locations[0]?.provider).toBe("motive");
    expect(staff.locations[0]?.external_event_id).toBe("motive:evt-1");
  });

  it("staff are unaffected by the level — dispatch cannot operate what it cannot see", () => {
    for (const level of SHIPMENT_LOCATION_VISIBILITIES) {
      const staff = toStaffDto({
        shipment: shipmentFixture(level),
        locations: [locationFixture()],
      });
      expect(staff.locations).toHaveLength(1);
      expect(staff.locations[0]?.latitude).toBe(SENSITIVE_COORD.lat);
    }
  });
});

/* ================================================================== *
 * 2 · The whole-DTO view, per serializer
 * ================================================================== */

describe("the level flows through every serializer", () => {
  const serializers = {
    public: toPublicTrackingDto,
    shipper: toShipperDto,
    carrier: toCarrierDto,
    broker: toBrokerDto,
  } as const;

  it("drops the whole series at hidden and milestone_only", () => {
    for (const level of ["hidden", "milestone_only"] as const) {
      for (const [name, serialize] of Object.entries(serializers)) {
        const dto = serialize({
          shipment: shipmentFixture(level),
          locations: [locationFixture(), locationFixture({ id: "loc-2" })],
        });
        expect(dto.locations, `${name} at ${level}`).toEqual([]);
      }
    }
  });

  it("preserves order (newest first) and count at approximate", () => {
    const dto = toShipperDto({
      shipment: shipmentFixture("approximate"),
      locations: [
        locationFixture({ recorded_at: "2026-08-04T13:05:00.000Z" }),
        locationFixture({ id: "loc-2", recorded_at: "2026-08-03T13:05:00.000Z" }),
      ],
    });
    expect(dto.locations).toHaveLength(2);
    expect(dto.locations[0]?.recorded_at).toBe("2026-08-04T13:05:00.000Z");
  });

  it("the public DTO's series carries no coordinate at ANY level", () => {
    for (const level of SHIPMENT_LOCATION_VISIBILITIES) {
      const dto = toPublicTrackingDto({
        shipment: shipmentFixture(level),
        locations: [locationFixture()],
      });
      for (const reading of dto.locations) {
        expect(reading.latitude).toBeNull();
        expect(reading.longitude).toBeNull();
        expect(reading.speed_mph).toBeNull();
      }
    }
  });
});

/* ================================================================== *
 * 3 · THE DECISION M-70 DEFERRED: per-event coordinate disclosure
 * ================================================================== */

describe("per-event coordinate disclosure — M-80's decision", () => {
  it("customer EVENT DTOs still carry NO latitude or longitude", () => {
    // The decision, asserted rather than described. Positions reach customers
    // through the purgeable series only; the append-only event ledger keeps
    // places, never fixes.
    const dto = toShipperDto({
      shipment: shipmentFixture("exact"),
      events: [
        {
          id: "e-1",
          shipment_id: "11111111-1111-4111-8111-111111111111",
          event_type: "location_update",
          status: null,
          event_time: "2026-08-04T13:00:00.000Z",
          recorded_at: "2026-08-04T13:01:00.000Z",
          source: "dispatcher",
          created_by: null,
          city: "Richmond",
          state: "VA",
          latitude: SENSITIVE_COORD.lat,
          longitude: SENSITIVE_COORD.lon,
          public_message: null,
          internal_message: null,
          visibility: "shipper",
          metadata: {},
          external_event_id: null,
          idempotency_key: null,
        },
      ],
    });
    expect(dto.events).toHaveLength(1);
    expect(Object.keys(dto.events[0] ?? {})).not.toContain("latitude");
    expect(Object.keys(dto.events[0] ?? {})).not.toContain("longitude");
    expect(JSON.stringify(dto.events)).not.toContain("37.5407");
  });

  it("0027 makes it structural: `shipment_events` REFUSES a coordinate", () => {
    // The argument for the decision is that the event ledger cannot be
    // purged (0019's append-only trigger), so a coordinate there would
    // outlive the retention window. 0027 closes it at the writer.
    const sql = readFileSync(
      "supabase/migrations/0027_shipment_locations_providers.sql",
      "utf8",
    );
    expect(sql).toContain("guard_shipment_event_coordinates");
    expect(sql).toContain("trg_shipment_events_no_coordinates");
    expect(sql).toContain("PL422");
  });
});

/* ================================================================== *
 * 4 · The WRITE side
 * ================================================================== */

describe("who may set the level (§14, §15)", () => {
  it("ranks the four levels most-to-least revealing", () => {
    expect(LOCATION_VISIBILITY_RANK.exact).toBeGreaterThan(
      LOCATION_VISIBILITY_RANK.approximate,
    );
    expect(LOCATION_VISIBILITY_RANK.approximate).toBeGreaterThan(
      LOCATION_VISIBILITY_RANK.milestone_only,
    );
    expect(LOCATION_VISIBILITY_RANK.milestone_only).toBeGreaterThan(
      LOCATION_VISIBILITY_RANK.hidden,
    );
  });

  it("defaults to `approximate` — privacy-first, matching 0017's column default", () => {
    expect(DEFAULT_LOCATION_VISIBILITY).toBe("approximate");
    const ddl = readFileSync(
      "supabase/migrations/0017_shipment_schema.sql",
      "utf8",
    );
    expect(ddl).toContain(
      "location_visibility shipment_location_visibility not null default 'approximate'",
    );
  });

  it("a DISPATCHER may narrow to any less-revealing level", () => {
    for (const [from, to] of [
      ["exact", "approximate"],
      ["exact", "hidden"],
      ["approximate", "milestone_only"],
      ["milestone_only", "hidden"],
    ] as const) {
      const decision = mayChangeLocationVisibility("dispatcher", from, to);
      expect(decision.allowed, `${from} → ${to}`).toBe(true);
      expect(decision.widening).toBe(false);
    }
  });

  it("a DISPATCHER may NOT widen — every widening pair is refused", () => {
    for (const [from, to] of [
      ["hidden", "milestone_only"],
      ["hidden", "approximate"],
      ["hidden", "exact"],
      ["milestone_only", "approximate"],
      ["milestone_only", "exact"],
      ["approximate", "exact"],
    ] as const) {
      const decision = mayChangeLocationVisibility("dispatcher", from, to);
      expect(decision.allowed, `${from} → ${to}`).toBe(false);
      expect(decision.refusal).toBe("widening_requires_admin");
      expect(decision.widening).toBe(true);
    }
  });

  it("an ADMIN may do both directions", () => {
    expect(mayChangeLocationVisibility("admin", "hidden", "exact").allowed).toBe(
      true,
    );
    expect(mayChangeLocationVisibility("admin", "exact", "hidden").allowed).toBe(
      true,
    );
  });

  it("refuses a no-op, and says which refusal it is", () => {
    const decision = mayChangeLocationVisibility("admin", "exact", "exact");
    expect(decision.allowed).toBe(false);
    expect(decision.refusal).toBe("unchanged");
  });

  it("refuses a value that is not one of the four", () => {
    for (const bad of ["EXACT", "precise", "", null, 3, {}]) {
      const decision = mayChangeLocationVisibility("admin", "approximate", bad);
      expect(decision.allowed, String(bad)).toBe(false);
      expect(decision.refusal).toBe("unknown_level");
    }
    expect(isLocationVisibility("exact")).toBe(true);
    expect(isLocationVisibility("EXACT")).toBe(false);
  });

  it("every refusal has an operator sentence, and every level has copy", () => {
    for (const key of Object.keys(LOCATION_VISIBILITY_REFUSAL_MESSAGES)) {
      const message =
        LOCATION_VISIBILITY_REFUSAL_MESSAGES[
          key as keyof typeof LOCATION_VISIBILITY_REFUSAL_MESSAGES
        ];
      expect(message.length).toBeGreaterThan(15);
    }
    for (const level of SHIPMENT_LOCATION_VISIBILITIES) {
      expect(LOCATION_VISIBILITY_LABELS[level].label.length).toBeGreaterThan(3);
      expect(LOCATION_VISIBILITY_LABELS[level].help.length).toBeGreaterThan(20);
    }
  });

  it("0027 applies the SAME rank comparison — the app check is not the authority", () => {
    const sql = readFileSync(
      "supabase/migrations/0027_shipment_locations_providers.sql",
      "utf8",
    );
    expect(sql).toContain(
      '{"hidden":0,"milestone_only":1,"approximate":2,"exact":3}',
    );
    expect(sql).toContain("PL403");
    // And the ranks are identical, read out of the SQL rather than assumed.
    const embedded = JSON.parse(
      (sql.match(/'(\{"hidden":0[^']*\})'::jsonb/) ?? [])[1] ?? "{}",
    ) as Record<string, number>;
    expect(embedded).toEqual(LOCATION_VISIBILITY_RANK);
  });
});

/* ================================================================== *
 * 5 · §30's honest labels, and when the map may mount
 * ================================================================== */

describe("§30 honest labels and map mounting", () => {
  it("hidden and milestone_only render the neutral 'unavailable' state", () => {
    // They must be INDISTINGUISHABLE from "no readings yet": a panel that
    // announced "the shipper hid this" would turn the setting into a signal.
    for (const level of ["hidden", "milestone_only"] as const) {
      expect(
        resolveLocationPanelState({
          level,
          trackingMode: "eld",
          hasCoordinates: true,
          hasPlace: true,
        }),
      ).toBe("unavailable");
    }
  });

  it("claims LIVE only with a live source AND a real coordinate", () => {
    expect(
      resolveLocationPanelState({
        level: "exact",
        trackingMode: "eld",
        hasCoordinates: true,
        hasPlace: true,
      }),
    ).toBe("live");
    // Manual mode never claims live, however much data there is.
    expect(
      resolveLocationPanelState({
        level: "exact",
        trackingMode: "manual",
        hasCoordinates: true,
        hasPlace: true,
      }),
    ).toBe("milestone");
    // A live source with no position is not a live location either.
    expect(
      resolveLocationPanelState({
        level: "exact",
        trackingMode: "link",
        hasCoordinates: false,
        hasPlace: true,
      }),
    ).toBe("milestone");
  });

  it("falls back to 'unavailable' when there is nothing at all", () => {
    expect(
      resolveLocationPanelState({
        level: "approximate",
        trackingMode: "manual",
        hasCoordinates: false,
        hasPlace: false,
      }),
    ).toBe("unavailable");
  });

  it("maps each state to one of §30's three labels", () => {
    expect(LOCATION_PANEL_LABEL_KEY.live).toBe(
      "shipment.label.live_location_available",
    );
    expect(LOCATION_PANEL_LABEL_KEY.milestone).toBe(
      "shipment.label.milestone_tracking",
    );
    expect(LOCATION_PANEL_LABEL_KEY.unavailable).toBe(
      "shipment.label.location_unavailable",
    );
  });

  it("the map mounts ONLY in the live state with at least one point", () => {
    expect(mapMayMount("live", 1)).toBe(true);
    expect(mapMayMount("live", 0)).toBe(false);
    expect(mapMayMount("milestone", 5)).toBe(false);
    expect(mapMayMount("unavailable", 5)).toBe(false);
  });

  it("TODAY'S STATE: with no provider connected, no shipment reaches `live`", () => {
    // Every PickLoads shipment is `tracking_mode = 'manual'` (0017's default,
    // and nothing sets it otherwise without an attached Mode B link), so the
    // honest state of the product is milestone tracking.
    const state = resolveLocationPanelState({
      level: "approximate",
      trackingMode: "manual",
      hasCoordinates: false,
      hasPlace: true,
    });
    expect(state).toBe("milestone");
    expect(mapMayMount(state, 3)).toBe(false);
  });
});
