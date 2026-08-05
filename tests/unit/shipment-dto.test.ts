import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUDIENCE_EVENT_VISIBILITY,
  filterEventsFor,
  isEventVisibleTo,
  SHIPMENT_AUDIENCES,
  toBrokerDto,
  toCarrierDto,
  toPublicTrackingDto,
  toShipperDto,
  toStaffDto,
  type ShipmentAudience,
} from "@/lib/shipments/dto";
import {
  SHIPMENT_EVENT_VISIBILITIES,
  type ShipmentEventRow,
  type ShipmentEventVisibility,
  type ShipmentExceptionRow,
  type ShipmentLocationVisibility,
  type ShipmentRow,
} from "@/lib/shipments/types";

/**
 * M-70 — DTO allow-list proofs (directive §4, §7, §9, §12, §18, §19).
 *
 * Following the M-61 pattern (`tests/unit/security.test.ts`): assert the
 * exposed KEY SET rather than sampling a few fields, and back it with a
 * sentinel sweep over the serialized JSON so a field that leaks through a
 * nested structure is caught too.
 *
 * Two properties are non-negotiable and are each asserted from both sides:
 *   1. a public DTO's keys EQUAL the approved allow-list — widening it fails;
 *   2. no staff-only financial value appears anywhere in a customer payload,
 *      and the detector that proves it is shown to be capable of failing
 *      (the anti-vacuity check against a naive spread).
 */

/* ------------------------------------------------------------------ *
 * Fixtures — every field populated, sensitive ones with sentinels
 * ------------------------------------------------------------------ */

/** Unique, greppable, JSON-stable values. None can occur by accident. */
const S = {
  gross: 911_111_111.11,
  carrierPay: 922_222_222.22,
  margin: 933_333_333.33,
  accessHash: "SENTINEL-access-hash-do-not-leak",
  delayInternal: "SENTINEL-delay-reason-internal-do-not-leak",
  staffNote: "SENTINEL-internal-message-do-not-leak",
  staffOnlyEventText: "SENTINEL-staff-only-event-body-do-not-leak",
  metadata: "SENTINEL-provider-metadata-do-not-leak",
  exceptionInternal: "SENTINEL-exception-internal-do-not-leak",
  exceptionResolution: "SENTINEL-exception-resolution-do-not-leak",
} as const;

/** The three §18 `@staffOnly` columns and their sentinel values. */
const FINANCIAL_SENTINELS: Record<string, number> = {
  gross_shipper_amount: S.gross,
  carrier_pay: S.carrierPay,
  margin: S.margin,
};

function shipmentFixture(overrides: Partial<ShipmentRow> = {}): ShipmentRow {
  const base: ShipmentRow = {
    id: "11111111-1111-4111-8111-111111111111",
    tracking_number: "PL-2026-000458",
    shipper_id: "22222222-2222-4222-8222-222222222222",
    carrier_id: "33333333-3333-4333-8333-333333333333",
    dispatcher_id: "44444444-4444-4444-8444-444444444444",
    quote_id: "55555555-5555-4555-8555-555555555555",
    broker_partner_id: "66666666-6666-4666-8666-666666666666",
    load_id: "77777777-7777-4777-8777-777777777777",
    status: "in_transit",
    origin_company: "Harbor Foods LLC",
    origin_address: "48 Dock Street",
    origin_city: "Newark",
    origin_state: "NJ",
    origin_zip: "07102",
    destination_company: "Midwest Grocers",
    destination_address: "900 Industrial Parkway",
    destination_city: "Columbus",
    destination_state: "OH",
    destination_zip: "43215",
    pickup_appointment_at: "2026-08-06T13:00:00.000Z",
    delivery_appointment_at: "2026-08-07T15:00:00.000Z",
    equipment: "dry_van",
    commodity_category: "packaged_food",
    weight_lbs: 41000,
    pallets: 24,
    distance_miles: 552,
    gross_shipper_amount: S.gross,
    carrier_pay: S.carrierPay,
    margin: S.margin,
    shipper_reference: "HF-88213",
    po_number: "PO-4471",
    public_tracking_enabled: true,
    tracking_mode: "manual",
    location_visibility: "exact",
    public_access_hash: S.accessHash,
    current_latitude: 40.7357,
    current_longitude: -74.1724,
    current_city: "Harrisburg",
    current_state: "PA",
    last_location_at: "2026-08-07T09:12:00.000Z",
    estimated_pickup_at: "2026-08-06T13:30:00.000Z",
    estimated_delivery_at: "2026-08-07T16:45:00.000Z",
    eta_source: "dispatcher_adjusted",
    eta_confidence: "medium",
    eta_updated_at: "2026-08-07T09:15:00.000Z",
    delay_minutes: 105,
    delay_reason_public: "Delayed by weather on I-80.",
    delay_reason_internal: S.delayInternal,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-07T09:15:00.000Z",
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
  };
  return { ...base, ...overrides };
}

function eventFixture(
  visibility: ShipmentEventVisibility,
  overrides: Partial<ShipmentEventRow> = {},
): ShipmentEventRow {
  const base: ShipmentEventRow = {
    id: `event-${visibility}`,
    shipment_id: "11111111-1111-4111-8111-111111111111",
    event_type: "status_change",
    status: "in_transit",
    event_time: "2026-08-07T09:00:00.000Z",
    recorded_at: "2026-08-07T09:01:00.000Z",
    source: "dispatcher",
    created_by: "44444444-4444-4444-8444-444444444444",
    city: "Harrisburg",
    state: "PA",
    latitude: 40.2732,
    longitude: -76.8867,
    public_message: `visible-to-${visibility}`,
    internal_message: S.staffNote,
    visibility,
    metadata: { provider_payload: S.metadata },
    external_event_id: "ext-1",
    idempotency_key: "idem-1",
  };
  return { ...base, ...overrides };
}

/** One event per visibility band — the whole matrix in five rows. */
function allBandEvents(): ShipmentEventRow[] {
  return SHIPMENT_EVENT_VISIBILITIES.map((visibility) =>
    visibility === "staff_only"
      ? eventFixture(visibility, { public_message: S.staffOnlyEventText })
      : eventFixture(visibility),
  );
}

function exceptionFixture(
  overrides: Partial<ShipmentExceptionRow> = {},
): ShipmentExceptionRow {
  const base: ShipmentExceptionRow = {
    id: "88888888-8888-4888-8888-888888888888",
    shipment_id: "11111111-1111-4111-8111-111111111111",
    exception_type: "weather",
    severity: "medium",
    public_description: "Winter weather is slowing traffic on I-80.",
    internal_description: S.exceptionInternal,
    opened_at: "2026-08-07T08:00:00.000Z",
    resolved_at: null,
    opened_by: "44444444-4444-4444-8444-444444444444",
    assigned_to: "44444444-4444-4444-8444-444444444444",
    customer_notified_at: "2026-08-07T08:05:00.000Z",
    resolution: S.exceptionResolution,
  };
  return { ...base, ...overrides };
}

const FULL_INPUT = {
  shipment: shipmentFixture(),
  events: allBandEvents(),
  exceptions: [exceptionFixture()],
};

const SERIALIZERS = {
  public: toPublicTrackingDto,
  shipper: toShipperDto,
  carrier: toCarrierDto,
  broker: toBrokerDto,
  staff: toStaffDto,
} satisfies Record<ShipmentAudience, (input: typeof FULL_INPUT) => object>;

function jsonFor(audience: ShipmentAudience): string {
  return JSON.stringify(SERIALIZERS[audience](FULL_INPUT));
}

/* ------------------------------------------------------------------ *
 * 1. Key sets
 * ------------------------------------------------------------------ */

/**
 * The approved public field list. Changing this array is a deliberate
 * decision about what an unauthenticated visitor may read; nothing reaches
 * `/track` without appearing here first.
 */
const PUBLIC_KEYS = [
  "tracking_number",
  "status",
  "status_key",
  "origin_city",
  "origin_state",
  "destination_city",
  "destination_state",
  "pickup_appointment_at",
  "delivery_appointment_at",
  "estimated_pickup_at",
  "estimated_delivery_at",
  "eta_source",
  "eta_confidence",
  "eta_updated_at",
  "delay_minutes",
  "delay_reason",
  "equipment",
  "commodity_category",
  "weight_lbs",
  "pallets",
  "shipper_reference",
  "po_number",
  "carrier_assigned",
  "tracking_mode",
  "location_visibility",
  "current_city",
  "current_state",
  "current_latitude",
  "current_longitude",
  "last_location_at",
  "completed_at",
  "cancelled_at",
  "events",
  "exceptions",
];

const PUBLIC_EVENT_KEYS = [
  "event_type",
  "event_type_key",
  "status",
  "status_key",
  "event_time",
  "source",
  "city",
  "state",
  "message",
];

const PUBLIC_EXCEPTION_KEYS = [
  "exception_type",
  "exception_type_key",
  "severity",
  "severity_key",
  "description",
  "opened_at",
  "resolved_at",
];

/** §4's forbidden-for-public list, expressed as column names. */
const FORBIDDEN_PUBLIC_KEYS = [
  "gross_shipper_amount",
  "carrier_pay",
  "margin",
  "public_access_hash",
  "delay_reason_internal",
  "internal_message",
  "internal_description",
  "resolution",
  "metadata",
  "shipper_id",
  "carrier_id",
  "broker_partner_id",
  "dispatcher_id",
  "load_id",
  "quote_id",
  "id",
  "origin_address",
  "destination_address",
];

describe("public DTO key set (§4, §19)", () => {
  it("equals the approved allow-list exactly", () => {
    const dto = toPublicTrackingDto(FULL_INPUT);
    expect(Object.keys(dto).sort()).toEqual([...PUBLIC_KEYS].sort());
  });

  it("holds the same key set when the shipment is empty of optional data", () => {
    // A sparse row must not produce a narrower object: a key set that varies
    // with the data leaks the shape of what is missing.
    const sparse = toPublicTrackingDto({
      shipment: shipmentFixture({
        carrier_id: null,
        commodity_category: null,
        weight_lbs: null,
        pallets: null,
        shipper_reference: null,
        po_number: null,
        delay_minutes: null,
        delay_reason_public: null,
        eta_source: null,
        eta_confidence: null,
      }),
    });
    expect(Object.keys(sparse).sort()).toEqual([...PUBLIC_KEYS].sort());
    expect(sparse.events).toEqual([]);
    expect(sparse.exceptions).toEqual([]);
  });

  it("ANTI-VACUITY: the same assertion fails on a widened allow-list", () => {
    // If this did not fail, the key-set test above would prove nothing.
    const widened = { ...toPublicTrackingDto(FULL_INPUT), margin: S.margin };
    expect(Object.keys(widened).sort()).not.toEqual([...PUBLIC_KEYS].sort());
  });

  it("ANTI-VACUITY: the allow-list itself is well formed", () => {
    expect(PUBLIC_KEYS.length).toBeGreaterThan(0);
    expect(new Set(PUBLIC_KEYS).size).toBe(PUBLIC_KEYS.length);
    for (const forbidden of FORBIDDEN_PUBLIC_KEYS) {
      expect(PUBLIC_KEYS).not.toContain(forbidden);
    }
  });

  it("nested public event and exception objects are allow-listed too", () => {
    const dto = toPublicTrackingDto(FULL_INPUT);
    const [event] = dto.events;
    expect(event).toBeDefined();
    expect(Object.keys(event ?? {}).sort()).toEqual(
      [...PUBLIC_EVENT_KEYS].sort(),
    );
    const [exception] = dto.exceptions;
    expect(exception).toBeDefined();
    expect(Object.keys(exception ?? {}).sort()).toEqual(
      [...PUBLIC_EXCEPTION_KEYS].sort(),
    );
  });
});

describe("audience key sets", () => {
  const SHIPPER_KEYS = [
    "id",
    "tracking_number",
    "status",
    "status_key",
    "quote_id",
    "origin_company",
    "origin_address",
    "origin_city",
    "origin_state",
    "origin_zip",
    "destination_company",
    "destination_address",
    "destination_city",
    "destination_state",
    "destination_zip",
    "pickup_appointment_at",
    "delivery_appointment_at",
    "estimated_pickup_at",
    "estimated_delivery_at",
    "eta_source",
    "eta_confidence",
    "eta_updated_at",
    "delay_minutes",
    "delay_reason",
    "equipment",
    "commodity_category",
    "weight_lbs",
    "pallets",
    "distance_miles",
    "shipper_reference",
    "po_number",
    "carrier_assigned",
    "tracking_mode",
    "location_visibility",
    "current_city",
    "current_state",
    "current_latitude",
    "current_longitude",
    "last_location_at",
    "created_at",
    "updated_at",
    "completed_at",
    "cancelled_at",
    "cancellation_reason",
    "events",
    "exceptions",
  ];

  it("shipper DTO exposes no financial column at all", () => {
    expect(Object.keys(toShipperDto(FULL_INPUT)).sort()).toEqual(
      [...SHIPPER_KEYS].sort(),
    );
    for (const financial of Object.keys(FINANCIAL_SENTINELS)) {
      expect(SHIPPER_KEYS).not.toContain(financial);
    }
  });

  it("carrier DTO exposes carrier_pay and nothing else financial", () => {
    const keys = Object.keys(toCarrierDto(FULL_INPUT));
    expect(keys).toContain("carrier_pay");
    expect(keys).not.toContain("gross_shipper_amount");
    expect(keys).not.toContain("margin");
    // Counterparty identifiers are PickLoads' relationships, not theirs.
    expect(keys).not.toContain("shipper_id");
    expect(keys).not.toContain("broker_partner_id");
  });

  it("broker DTO exposes no financial column — §12 forbids the commission", () => {
    const keys = Object.keys(toBrokerDto(FULL_INPUT));
    for (const financial of Object.keys(FINANCIAL_SENTINELS)) {
      expect(keys).not.toContain(financial);
    }
    // Broker and carrier differ by exactly one field: the carrier's own pay
    // becomes an assignment flag.
    expect(keys).toContain("carrier_assigned");
  });

  it("staff DTO covers every shipment column except the access credential", () => {
    // Static scan of the ShipmentRow declaration: a column added in M-71 or
    // later must be a conscious decision on the staff surface too.
    const source = readFileSync("src/lib/shipments/types.ts", "utf8");
    const start = source.indexOf("export interface ShipmentRow {");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n}", start));
    const rowFields = [...body.matchAll(/^ {2}(\w+)(\??):/gm)].map(
      (match) => match[1] ?? "",
    );
    expect(rowFields.length).toBeGreaterThan(30);

    const staffKeys = new Set(Object.keys(toStaffDto(FULL_INPUT)));
    const missing = rowFields.filter((field) => !staffKeys.has(field));
    expect(missing).toEqual(["public_access_hash"]);
  });

  it("no serializer at any audience emits the access credential", () => {
    for (const audience of SHIPMENT_AUDIENCES) {
      expect(Object.keys(SERIALIZERS[audience](FULL_INPUT))).not.toContain(
        "public_access_hash",
      );
      expect(jsonFor(audience)).not.toContain(S.accessHash);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. Financial sentinels (§18 "never included in public queries")
 * ------------------------------------------------------------------ */

describe("staff-only financial fields (§4, §18)", () => {
  it("the sentinel row populates every field tagged @staffOnly in types.ts", () => {
    // Anti-vacuity for the sweep below: a new @staffOnly column with no
    // sentinel would make the sweep pass while proving nothing about it.
    const source = readFileSync("src/lib/shipments/types.ts", "utf8");
    const tagged = [...source.matchAll(/@staffOnly[\s\S]*?\*\/\s*(\w+):/g)].map(
      (match) => match[1] ?? "",
    );
    expect(tagged.sort()).toEqual(Object.keys(FINANCIAL_SENTINELS).sort());
    const row = shipmentFixture();
    for (const [field, sentinel] of Object.entries(FINANCIAL_SENTINELS)) {
      expect(row[field as keyof ShipmentRow]).toBe(sentinel);
    }
  });

  it("no sentinel survives into the public payload", () => {
    const json = jsonFor("public");
    for (const sentinel of Object.values(FINANCIAL_SENTINELS)) {
      expect(json).not.toContain(String(sentinel));
    }
  });

  it("no sentinel survives into the shipper or broker payload", () => {
    for (const audience of ["shipper", "broker"] as const) {
      const json = jsonFor(audience);
      for (const sentinel of Object.values(FINANCIAL_SENTINELS)) {
        expect(json).not.toContain(String(sentinel));
      }
    }
  });

  it("the carrier payload carries only its own pay", () => {
    const json = jsonFor("carrier");
    expect(json).toContain(String(S.carrierPay));
    expect(json).not.toContain(String(S.gross));
    expect(json).not.toContain(String(S.margin));
  });

  it("staff keep every figure — the redaction is audience-scoped, not global", () => {
    const json = jsonFor("staff");
    for (const sentinel of Object.values(FINANCIAL_SENTINELS)) {
      expect(json).toContain(String(sentinel));
    }
  });

  it("ANTI-VACUITY: the sweep catches a naive spread-based serializer", () => {
    // The failure mode this module exists to prevent: `{ ...row }` minus a
    // few deleted keys. If the detector could not see it, every assertion
    // above would be worthless.
    const leaky = JSON.stringify({ ...shipmentFixture() });
    for (const sentinel of Object.values(FINANCIAL_SENTINELS)) {
      expect(leaky).toContain(String(sentinel));
    }
    expect(leaky).toContain(S.accessHash);
    expect(leaky).toContain(S.delayInternal);
  });
});

describe("private operational commentary (§4, §21)", () => {
  const PRIVATE_TEXT = [
    S.delayInternal,
    S.staffNote,
    S.staffOnlyEventText,
    S.metadata,
    S.exceptionInternal,
    S.exceptionResolution,
  ];

  it("never reaches any customer audience", () => {
    for (const audience of [
      "public",
      "shipper",
      "carrier",
      "broker",
    ] as const) {
      const json = jsonFor(audience);
      for (const secret of PRIVATE_TEXT) {
        expect(json).not.toContain(secret);
      }
    }
  });

  it("does reach staff — otherwise the assertion above is vacuous", () => {
    const json = jsonFor("staff");
    for (const secret of PRIVATE_TEXT) {
      expect(json).toContain(secret);
    }
  });

  it("shows customers the public delay reason, not the internal one", () => {
    expect(toPublicTrackingDto(FULL_INPUT).delay_reason).toBe(
      "Delayed by weather on I-80.",
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. Event visibility (§7, §12)
 * ------------------------------------------------------------------ */

describe("event visibility filtering (§7)", () => {
  it("matches the audience matrix for every band", () => {
    const matrix: Record<ShipmentAudience, readonly ShipmentEventVisibility[]> =
      {
        public: ["public"],
        shipper: ["public", "shipper"],
        carrier: ["public", "carrier"],
        broker: ["public", "broker"],
        staff: ["public", "shipper", "carrier", "broker", "staff_only"],
      };
    for (const audience of SHIPMENT_AUDIENCES) {
      for (const band of SHIPMENT_EVENT_VISIBILITIES) {
        expect(isEventVisibleTo(audience, band)).toBe(
          matrix[audience].includes(band),
        );
      }
      expect([...AUDIENCE_EVENT_VISIBILITY[audience]]).toEqual([
        ...matrix[audience],
      ]);
    }
  });

  it("a staff_only note never reaches a customer timeline", () => {
    for (const audience of [
      "public",
      "shipper",
      "carrier",
      "broker",
    ] as const) {
      const kept = filterEventsFor(audience, allBandEvents());
      expect(kept.map((event) => event.visibility)).not.toContain("staff_only");
      expect(jsonFor(audience)).not.toContain(S.staffOnlyEventText);
    }
  });

  it("a broker sees the broker band and no counterparty band", () => {
    const broker = toBrokerDto(FULL_INPUT);
    const bands = broker.events.map((event) => event.message);
    expect(bands).toEqual(["visible-to-public", "visible-to-broker"]);
    expect(bands).not.toContain("visible-to-shipper");
    expect(bands).not.toContain("visible-to-carrier");
  });

  it("shipper and carrier bands do not cross", () => {
    expect(
      toShipperDto(FULL_INPUT).events.map((event) => event.message),
    ).toEqual(["visible-to-public", "visible-to-shipper"]);
    expect(
      toCarrierDto(FULL_INPUT).events.map((event) => event.message),
    ).toEqual(["visible-to-public", "visible-to-carrier"]);
  });

  it("staff read the whole timeline in order", () => {
    const staff = toStaffDto(FULL_INPUT);
    expect(staff.events).toHaveLength(SHIPMENT_EVENT_VISIBILITIES.length);
    expect(staff.events.map((event) => event.visibility)).toEqual([
      ...SHIPMENT_EVENT_VISIBILITIES,
    ]);
  });

  it("preserves chronological order while filtering", () => {
    const events = [
      eventFixture("public", { id: "a", event_time: "2026-08-01T00:00:00Z" }),
      eventFixture("staff_only", { id: "b" }),
      eventFixture("public", { id: "c", event_time: "2026-08-02T00:00:00Z" }),
    ];
    expect(filterEventsFor("public", events).map((event) => event.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("customer timelines carry no event coordinates", () => {
    // Per-event position disclosure waits for M-80's consent + provider
    // model; the honest customer answer today is the operator's city/state.
    const dto = toPublicTrackingDto(FULL_INPUT);
    const [event] = dto.events;
    expect(Object.keys(event ?? {})).not.toContain("latitude");
    expect(Object.keys(event ?? {})).not.toContain("longitude");
    expect(event?.city).toBe("Harrisburg");
  });
});

/* ------------------------------------------------------------------ *
 * 4. Location privacy (§9)
 * ------------------------------------------------------------------ */

describe("location visibility levels (§9)", () => {
  /** The five location keys every DTO shares — structural, no assertion. */
  interface LocationSlice {
    current_city: string | null;
    current_state: string | null;
    current_latitude: number | null;
    current_longitude: number | null;
    last_location_at: string | null;
  }

  function locationOf(
    audience: ShipmentAudience,
    level: ShipmentLocationVisibility,
  ): {
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
    at: string | null;
  } {
    const dto: LocationSlice = SERIALIZERS[audience]({
      shipment: shipmentFixture({ location_visibility: level }),
    });
    return {
      city: dto.current_city,
      state: dto.current_state,
      latitude: dto.current_latitude,
      longitude: dto.current_longitude,
      at: dto.last_location_at,
    };
  }

  it("hidden and milestone_only reveal nothing to any customer", () => {
    for (const level of ["hidden", "milestone_only"] as const) {
      for (const audience of [
        "public",
        "shipper",
        "carrier",
        "broker",
      ] as const) {
        expect(locationOf(audience, level)).toEqual({
          city: null,
          state: null,
          latitude: null,
          longitude: null,
          at: null,
        });
      }
    }
  });

  it("approximate reveals city and state but never coordinates", () => {
    for (const audience of [
      "public",
      "shipper",
      "carrier",
      "broker",
    ] as const) {
      const view = locationOf(audience, "approximate");
      expect(view.city).toBe("Harrisburg");
      expect(view.state).toBe("PA");
      expect(view.latitude).toBeNull();
      expect(view.longitude).toBeNull();
      expect(view.at).toBe("2026-08-07T09:12:00.000Z");
    }
  });

  it("exact never means exact for the public visitor", () => {
    // §9: "do not permanently expose exact real-time truck position to every
    // public visitor". A tracking number plus a ZIP is not an account.
    const view = locationOf("public", "exact");
    expect(view.city).toBe("Harrisburg");
    expect(view.latitude).toBeNull();
    expect(view.longitude).toBeNull();
  });

  it("exact gives authenticated audiences the precise position", () => {
    for (const audience of ["shipper", "carrier", "broker"] as const) {
      const view = locationOf(audience, "exact");
      expect(view.latitude).toBe(40.7357);
      expect(view.longitude).toBe(-74.1724);
    }
  });

  it("staff see the position regardless of the customer-facing setting", () => {
    for (const level of [
      "hidden",
      "milestone_only",
      "approximate",
      "exact",
    ] as const) {
      const view = locationOf("staff", level);
      expect(view.latitude).toBe(40.7357);
      expect(view.city).toBe("Harrisburg");
    }
  });

  it("redacts by nulling values, never by dropping keys", () => {
    const hidden = toPublicTrackingDto({
      shipment: shipmentFixture({ location_visibility: "hidden" }),
    });
    for (const key of [
      "current_city",
      "current_state",
      "current_latitude",
      "current_longitude",
      "last_location_at",
    ]) {
      expect(Object.keys(hidden)).toContain(key);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 5. Exceptions (§21)
 * ------------------------------------------------------------------ */

describe("exception serialization (§21)", () => {
  it("omits an exception with nothing honest to tell the customer", () => {
    const input = {
      shipment: shipmentFixture(),
      exceptions: [
        exceptionFixture({ id: "with-public" }),
        exceptionFixture({ id: "no-public", public_description: null }),
      ],
    };
    expect(toPublicTrackingDto(input).exceptions).toHaveLength(1);
    expect(toShipperDto(input).exceptions).toHaveLength(1);
    // Staff still see both — the incident exists, it just has no public copy.
    expect(toStaffDto(input).exceptions).toHaveLength(2);
  });

  it("gives the customer a localizable label, not an English string", () => {
    const [exception] = toPublicTrackingDto(FULL_INPUT).exceptions;
    expect(exception?.exception_type_key).toBe("shipment.exception.weather");
    expect(exception?.severity_key).toBe("shipment.severity.medium");
  });
});

/* ------------------------------------------------------------------ *
 * 6. Structural guard on the serializers themselves
 * ------------------------------------------------------------------ */

describe("allow-list construction is structural, not conventional", () => {
  // Comments are stripped: this guard is about what the code does, and the
  // module's own documentation necessarily names the patterns it forbids.
  const source = readFileSync("src/lib/shipments/dto.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("never spreads a row or an event into a DTO", () => {
    // The whole safety argument is that a future column defaults to
    // INVISIBLE. One `...shipment` would silently invert that.
    expect(source).not.toMatch(/\.\.\.\s*(s|row|shipment|event|exception)\b/);
    expect(source).not.toMatch(/\.\.\.\s*input\./);
  });

  it("never deletes or omits keys after the fact", () => {
    expect(source).not.toMatch(/\bdelete\s+/);
    expect(source).not.toMatch(/\bomit\(/i);
  });

  it("names the three financial columns in exactly the intended places", () => {
    // gross and margin appear once each (the staff DTO's interface and its
    // literal); carrier_pay additionally in the carrier DTO.
    const count = (needle: string) =>
      source.split(new RegExp(`\\b${needle}\\b`)).length - 1;
    expect(count("gross_shipper_amount")).toBe(count("margin"));
    expect(count("carrier_pay")).toBeGreaterThan(count("margin"));
  });

  it("keeps every serializer free of `any`", () => {
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toMatch(/\bas\s+unknown\s+as\b/);
  });
});
