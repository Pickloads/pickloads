import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toPublicTrackingDto } from "@/lib/shipments/dto";
import type {
  ShipmentEventRow,
  ShipmentRow,
} from "@/lib/shipments/types";

/**
 * M-73 — the public tracking lookup (`src/lib/shipments/public-lookup.ts`).
 *
 * THREE THINGS ARE PROVED HERE, and they are the three that would matter most
 * on the day somebody attacks this page:
 *
 *   1. **The route returns the DTO, not a row.** M-70's honest-limitations
 *      note says its own suite "cannot show that M-73 calls
 *      `toPublicTrackingDto` rather than returning the row". This is that
 *      proof: behavioural (key-set equality plus a sentinel sweep over the
 *      serialized payload) and structural (a source scan of the module).
 *   2. **Enumeration returns one identical value.** Unknown number, wrong
 *      secondary value and admin-suspended tracking are asserted DEEP EQUAL
 *      to each other, so a future refactor cannot widen one of them into an
 *      oracle without failing here.
 *   3. **The ledger is written, and never with the secret.** Every branch
 *      writes exactly one `shipment_tracking_access` row with the correct
 *      outcome, and the inserted object is swept for the submitted secondary
 *      value in every form.
 *
 * The Supabase client is mocked: this lane is secretless and has no database.
 * What a mock CANNOT prove — that the insert really lands, that RLS refuses
 * anon, that the append-only trigger holds — is proved against a real
 * PostgreSQL 16 in `tests/integration/public-tracking.test.ts` and
 * `supabase/tests/20_rls_isolation.sql`.
 */

const SECRET = "m73-lookup-test-secret";
process.env.TRACKING_ACCESS_SECRET = SECRET;

/* ------------------------------------------------------------------ *
 * A fake supabase-js surface, shaped to the three calls the module makes
 * ------------------------------------------------------------------ */

interface MockOptions {
  shipment?: ShipmentRow | null;
  shipmentError?: { message: string } | null;
  events?: ShipmentEventRow[];
  eventsError?: { message: string } | null;
  logError?: { message: string } | null;
}

let options: MockOptions = {};
let inserts: Record<string, unknown>[] = [];
let shipmentProjection = "";
let eventFilters: [string, unknown][] = [];
let eventLimit = 0;

function makeClient() {
  return {
    from(table: string) {
      if (table === "shipment_tracking_access") {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return Promise.resolve({ error: options.logError ?? null });
          },
        };
      }
      if (table === "shipments") {
        return {
          select(columns: string) {
            shipmentProjection = columns;
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: options.shipment ?? null,
                    error: options.shipmentError ?? null,
                  }),
                };
              },
            };
          },
        };
      }
      // shipment_events
      const chain = {
        eq(column: string, value: unknown) {
          eventFilters.push([column, value]);
          return chain;
        },
        order() {
          return chain;
        },
        limit(n: number) {
          eventLimit = n;
          return Promise.resolve({
            data: options.events ?? [],
            error: options.eventsError ?? null,
          });
        },
      };
      return {
        select() {
          return chain;
        },
      };
    },
  };
}

let client: ReturnType<typeof makeClient> | null = makeClient();

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => client,
  createAdminClient: () => client,
}));

const {
  FORBIDDEN_PUBLIC_COLUMNS,
  MIN_RESPONSE_MS,
  PUBLIC_EVENT_LIMIT,
  TRACK_RATE_LIMIT,
  lookupPublicTracking,
} = await import("@/lib/shipments/public-lookup");
const { hashSecondaryValue } = await import("@/lib/shipments/access-code");

/* ------------------------------------------------------------------ *
 * Fixture
 * ------------------------------------------------------------------ */

/** Values that must never leave the server on a public request. */
const SENTINELS = {
  gross: 918_273,
  carrierPay: 828_374,
  margin: 738_475,
  internalDelay: "SENTINEL-INTERNAL-DELAY-REASON",
  accessHash: "SENTINEL-ACCESS-HASH",
  originAddress: "SENTINEL-ORIGIN-DOCK-ADDRESS",
  shipmentId: "11111111-2222-3333-4444-555566667777",
};

const ZIP = "07111";

function shipmentRow(overrides: Partial<ShipmentRow> = {}): ShipmentRow {
  return {
    id: SENTINELS.shipmentId,
    tracking_number: "PL-2026-000101",
    shipper_id: "22222222-2222-2222-2222-2222222aaaaa",
    carrier_id: "11111111-1111-1111-1111-11111111aaaa",
    dispatcher_id: "00000000-0000-0000-0000-0000000000e1",
    quote_id: null,
    broker_partner_id: null,
    load_id: null,
    status: "in_transit",
    origin_company: "Origin Co",
    origin_address: SENTINELS.originAddress,
    origin_city: "Newark",
    origin_state: "NJ",
    origin_zip: "07102",
    destination_company: "Destination Co",
    destination_address: "500 Dock Rd",
    destination_city: "Atlanta",
    destination_state: "GA",
    destination_zip: ZIP,
    pickup_appointment_at: "2026-08-01T13:00:00.000Z",
    delivery_appointment_at: "2026-08-04T13:00:00.000Z",
    equipment: "dry-van",
    commodity_category: "general",
    weight_lbs: 38000,
    pallets: 22,
    distance_miles: 870,
    gross_shipper_amount: SENTINELS.gross,
    carrier_pay: SENTINELS.carrierPay,
    margin: SENTINELS.margin,
    shipper_reference: "REF-9",
    po_number: "PO-9",
    public_tracking_enabled: true,
    tracking_mode: "manual",
    location_visibility: "approximate",
    public_access_hash: hashSecondaryValue(ZIP),
    current_latitude: 35.1,
    current_longitude: -84.2,
    current_city: "Chattanooga",
    current_state: "TN",
    last_location_at: "2026-08-03T15:00:00.000Z",
    estimated_pickup_at: "2026-08-01T13:00:00.000Z",
    estimated_delivery_at: "2026-08-04T14:00:00.000Z",
    eta_source: "manual",
    eta_confidence: "medium",
    eta_updated_at: "2026-08-03T15:00:00.000Z",
    delay_minutes: null,
    delay_reason_public: null,
    delay_reason_internal: SENTINELS.internalDelay,
    created_at: "2026-07-30T09:00:00.000Z",
    updated_at: "2026-08-03T15:00:00.000Z",
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    ...overrides,
  };
}

function eventRow(overrides: Partial<ShipmentEventRow> = {}): ShipmentEventRow {
  return {
    id: "eeeeeeee-0000-0000-0000-000000000001",
    shipment_id: SENTINELS.shipmentId,
    event_type: "status_change",
    status: "in_transit",
    event_time: "2026-08-02T12:00:00.000Z",
    recorded_at: "2026-08-02T12:05:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: "Knoxville",
    state: "TN",
    latitude: null,
    longitude: null,
    public_message: "phrase:update.in_transit",
    internal_message: null,
    visibility: "public",
    metadata: {},
    external_event_id: null,
    idempotency_key: null,
    ...overrides,
  };
}

function request(overrides: Partial<Parameters<typeof lookupPublicTracking>[0]> = {}) {
  return {
    trackingNumber: "PL-2026-000101",
    secondaryValue: ZIP,
    ip: "198.51.100.10",
    userAgent: "Mozilla/5.0 (test)",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.TRACKING_ACCESS_SECRET = SECRET;
  options = {};
  inserts = [];
  shipmentProjection = "";
  eventFilters = [];
  eventLimit = 0;
  client = makeClient();
});

/* ================================================================== *
 * 1 · The route returns the DTO, not a row
 * ================================================================== */

describe("the public route returns a strict public DTO (§18, §19)", () => {
  it("emits exactly the PublicTrackingDto key set — not the row's", async () => {
    const row = shipmentRow();
    options = { shipment: row, events: [eventRow()] };

    const result = await lookupPublicTracking(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = Object.keys(
      toPublicTrackingDto({ shipment: row, events: [], exceptions: [] }),
    ).sort();
    expect(Object.keys(result.tracking).sort()).toEqual(expected);

    // …and NOT the row's key set, stated as its own assertion so a DTO that
    // ever grew to match the row would still fail.
    expect(Object.keys(result.tracking).sort()).not.toEqual(
      Object.keys(row).sort(),
    );
  });

  it("carries none of §4's forbidden values anywhere in the payload", async () => {
    options = { shipment: shipmentRow(), events: [eventRow()] };
    const result = await lookupPublicTracking(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.tracking);
    for (const [name, sentinel] of Object.entries(SENTINELS)) {
      expect(
        serialized.includes(String(sentinel)),
        `public payload leaked ${name}`,
      ).toBe(false);
    }
  });

  it("NON-VACUITY: the same two assertions FAIL against a naive row passthrough", async () => {
    const row = shipmentRow();
    const naive = { ...row } as unknown as Record<string, unknown>;

    const expected = Object.keys(
      toPublicTrackingDto({ shipment: row, events: [], exceptions: [] }),
    ).sort();
    // The key-set assertion detects the widening…
    expect(() =>
      expect(Object.keys(naive).sort()).toEqual(expected),
    ).toThrow();
    // …and the sentinel sweep detects the leak. If either of these ever stops
    // throwing, the two tests above have become decoration.
    const serialized = JSON.stringify(naive);
    expect(serialized.includes(String(SENTINELS.margin))).toBe(true);
    expect(serialized.includes(SENTINELS.internalDelay)).toBe(true);
  });

  it("STRUCTURAL: the module calls toPublicTrackingDto and never returns a row", () => {
    const source = readFileSync(
      "src/lib/shipments/public-lookup.ts",
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(source).toContain("toPublicTrackingDto(");
    // The failure modes this guards against, each spelled out: returning the
    // row, spreading it into the payload, or casting past the DTO type.
    expect(source).not.toMatch(/tracking:\s*shipment\b/);
    expect(source).not.toMatch(/\.\.\.shipment\b/);
    expect(source).not.toMatch(/\.\.\.s\b/);
    expect(source).not.toContain("select(\"*\")");
    expect(source).not.toContain(": any");
  });

  it("never SELECTs a financial or internal column in the first place", () => {
    // Defence in depth: the DTO would drop them anyway, but a public request
    // should not pull a margin into process memory at all.
    expect(shipmentProjection).toBe("");
    return lookupPublicTracking(request()).then(() => {
      for (const column of FORBIDDEN_PUBLIC_COLUMNS) {
        expect(
          shipmentProjection.includes(column),
          `public projection includes ${column}`,
        ).toBe(false);
      }
      // Non-vacuous: the projection is a real, non-empty column list.
      expect(shipmentProjection).toContain("tracking_number");
      expect(shipmentProjection.split(",").length).toBeGreaterThan(20);
    });
  });
});

/* ================================================================== *
 * 2 · Enumeration protection
 * ================================================================== */

describe("enumeration protection (§19)", () => {
  it("returns ONE identical value for unknown number, wrong secret and suspended tracking", async () => {
    options = { shipment: null };
    const unknown = await lookupPublicTracking(
      request({ trackingNumber: "PL-2026-999999" }),
    );

    options = { shipment: shipmentRow() };
    const wrongSecret = await lookupPublicTracking(
      request({ secondaryValue: "99999" }),
    );

    options = { shipment: shipmentRow({ public_tracking_enabled: false }) };
    const suspended = await lookupPublicTracking(request());

    expect(unknown).toEqual({ ok: false, code: "refused" });
    expect(wrongSecret).toEqual(unknown);
    expect(suspended).toEqual(unknown);
    // Deep equality is not enough on its own — assert the key sets too, so an
    // added optional field on one branch cannot pass by being undefined.
    expect(Object.keys(wrongSecret)).toEqual(Object.keys(unknown));
    expect(Object.keys(suspended)).toEqual(Object.keys(unknown));
  });

  it("NON-VACUITY: a refusal that revealed the reason would fail that test", () => {
    const leaky = { ok: false, code: "refused", reason: "bad_secondary" };
    const clean = { ok: false, code: "refused" };
    expect(() => expect(leaky).toEqual(clean)).toThrow();
  });

  it("a malformed number is refused identically, without querying the table", async () => {
    options = { shipment: shipmentRow() };
    const result = await lookupPublicTracking(
      request({ trackingNumber: "not-a-tracking-number" }),
    );
    expect(result).toEqual({ ok: false, code: "refused" });
    // No shipment SELECT was issued — a number that cannot match the unique
    // index is a miss by construction.
    expect(shipmentProjection).toBe("");
    // …but the attempt still reached the ledger, so a script probing with
    // garbage is still counted.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.outcome).toBe("not_found");
  });

  it("holds every outcome to the response floor", async () => {
    options = { shipment: null };
    const started = Date.now();
    await lookupPublicTracking(request({ trackingNumber: "PL-2026-999999" }));
    const missElapsed = Date.now() - started;

    options = { shipment: shipmentRow() };
    const started2 = Date.now();
    await lookupPublicTracking(request({ secondaryValue: "99999" }));
    const wrongElapsed = Date.now() - started2;

    // Both failure branches sit on the same floor — which is the property that
    // makes them indistinguishable over the wire, not just in the body.
    expect(missElapsed).toBeGreaterThanOrEqual(MIN_RESPONSE_MS - 5);
    expect(wrongElapsed).toBeGreaterThanOrEqual(MIN_RESPONSE_MS - 5);
  });

  it("the tighter rate limit is actually tighter than the shared default of 5", () => {
    expect(TRACK_RATE_LIMIT).toBeLessThan(5);
  });
});

/* ================================================================== *
 * 3 · The access ledger
 * ================================================================== */

describe("access logging (§19, §26)", () => {
  it("writes one row per attempt with the true outcome", async () => {
    options = { shipment: shipmentRow(), events: [] };
    await lookupPublicTracking(request());
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      outcome: "granted",
      shipment_id: SENTINELS.shipmentId,
      tracking_number_attempted: "PL-2026-000101",
      ip: "198.51.100.10",
    });

    inserts = [];
    options = { shipment: null };
    await lookupPublicTracking(request({ trackingNumber: "PL-2026-999999" }));
    expect(inserts[0]).toMatchObject({
      outcome: "not_found",
      shipment_id: null,
    });

    inserts = [];
    options = { shipment: shipmentRow() };
    await lookupPublicTracking(request({ secondaryValue: "99999" }));
    expect(inserts[0]?.outcome).toBe("bad_secondary");

    inserts = [];
    options = { shipment: shipmentRow({ public_tracking_enabled: false }) };
    await lookupPublicTracking(request());
    expect(inserts[0]?.outcome).toBe("tracking_disabled");
  });

  it("NEVER writes the attempted secondary value, in any form", async () => {
    const submitted = "SECRETZIP42";
    options = { shipment: shipmentRow() };
    await lookupPublicTracking(request({ secondaryValue: submitted }));

    const serialized = JSON.stringify(inserts);
    expect(serialized.includes(submitted)).toBe(false);
    expect(serialized.includes(submitted.toLowerCase())).toBe(false);
    // Not even a hash of it: the row must carry no field that is a function of
    // the secret at all, so assert the exact key set the ledger accepts.
    expect(Object.keys(inserts[0] ?? {}).sort()).toEqual([
      "ip",
      "outcome",
      "profile_id",
      "shipment_id",
      "tracking_number_attempted",
      "user_agent",
    ]);
  });

  it("REFUSES a correct lookup whose ledger write failed", async () => {
    options = {
      shipment: shipmentRow(),
      events: [eventRow()],
      logError: { message: "insert failed" },
    };
    const result = await lookupPublicTracking(request());
    // The credential was correct. §19 says the route logs access; an unlogged
    // access is the one this module refuses to serve.
    expect(result).toEqual({ ok: false, code: "refused" });
  });

  it("truncates an oversized attempted number rather than dropping the row", async () => {
    options = { shipment: null };
    await lookupPublicTracking(
      request({ trackingNumber: "P".repeat(200) }),
    );
    const attempted = String(inserts[0]?.tracking_number_attempted ?? "");
    expect(attempted.length).toBeLessThanOrEqual(64);
    expect(inserts).toHaveLength(1);
  });
});

/* ================================================================== *
 * 4 · §25 — bounded, filtered timeline
 * ================================================================== */

describe("timeline bounds (§25)", () => {
  it("filters to the public band in SQL and caps the page", async () => {
    options = { shipment: shipmentRow(), events: [eventRow()] };
    await lookupPublicTracking(request());
    expect(eventFilters).toContainEqual(["visibility", "public"]);
    expect(eventLimit).toBe(PUBLIC_EVENT_LIMIT + 1);
  });

  it("reports truncation when the shipment has more events than the cap", async () => {
    const many = Array.from({ length: PUBLIC_EVENT_LIMIT + 1 }, (_, i) =>
      eventRow({ id: `e-${i}`, event_time: `2026-08-0${(i % 9) + 1}T12:00:00.000Z` }),
    );
    options = { shipment: shipmentRow(), events: many };
    const result = await lookupPublicTracking(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timelineTruncated).toBe(true);
    expect(result.tracking.events).toHaveLength(PUBLIC_EVENT_LIMIT);
  });
});

/* ================================================================== *
 * 5 · Unconfigured environments fail closed
 * ================================================================== */

describe("configuration", () => {
  it("is unavailable — not refused — with no service-role key", async () => {
    client = null;
    const result = await lookupPublicTracking(request());
    expect(result).toEqual({ ok: false, code: "unavailable" });
    expect(inserts).toHaveLength(0);
  });

  it("is unavailable with no TRACKING_ACCESS_SECRET, even for a real shipment", async () => {
    delete process.env.TRACKING_ACCESS_SECRET;
    options = { shipment: shipmentRow() };
    const result = await lookupPublicTracking(request());
    // "Cannot verify" is not "verified". A secretless environment serves
    // nothing rather than serving everything.
    expect(result).toEqual({ ok: false, code: "unavailable" });
  });

  it("is unavailable when the shipment query itself errors", async () => {
    options = { shipmentError: { message: "connection reset" } };
    const result = await lookupPublicTracking(request());
    expect(result).toEqual({ ok: false, code: "unavailable" });
  });
});
