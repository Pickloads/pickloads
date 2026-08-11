import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  toPublicTrackingDto,
  toShipperDto,
  toCarrierDto,
  toBrokerDto,
  type ShipmentDtoInput,
} from "@/lib/shipments/dto";
import { FORBIDDEN_PUBLIC_COLUMNS } from "@/lib/shipments/public-lookup";
import { SHIPMENT_RESTRICTED_COLUMNS } from "@/lib/shipments/staff-detail";
import type { ShipmentEventRow, ShipmentRow } from "@/lib/shipments/types";

/**
 * M-83 — ROUTE-level public-DTO key sets (§18, §19's fourth proof).
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────
 *
 * `docs/modules/M-70-shipment-domain.md` states the limit of its own tests
 * plainly: they prove the serializers in isolation and *"cannot show that
 * M-73 calls `toPublicTrackingDto` rather than returning the row."* M-74
 * added a structural scan for ONE page. This file does it for EVERY
 * customer-facing tracking surface, and pairs each scan with an exact
 * key-set assertion on the serializer's output for the same input the route
 * feeds it.
 *
 * The other half — the real HTTP/action response, from a real database, on a
 * row that genuinely holds sentinel values — is
 * `tests/integration/tracking-security.test.ts`. Neither is sufficient alone:
 * this lane can read every route module but has no database; that lane has a
 * database but scans no source. Together they answer "does the route call the
 * serializer, and does what actually comes back match?"
 */

const ROUTES = {
  track: "src/app/[locale]/(site)/track/page.tsx",
  shipper: "src/app/[locale]/portal/shipper/shipments/[shipmentId]/page.tsx",
  carrier: "src/app/[locale]/portal/carrier/shipments/[shipmentId]/page.tsx",
  broker: "src/app/[locale]/portal/broker/shipments/[shipmentId]/page.tsx",
  driver: "src/app/[locale]/driver/update/[token]/page.tsx",
} as const;

const SOURCE = Object.fromEntries(
  Object.entries(ROUTES).map(([k, p]) => [k, readFileSync(p, "utf8")]),
) as Record<keyof typeof ROUTES, string>;

/**
 * The same source with comments removed.
 *
 * These modules document their own security decisions at length — the shipper
 * page's header literally contains the sentence *"EVERY 'NOT YOURS' IS A 404,
 * NEVER A 403"* — so a structural scan run over the raw text finds every
 * forbidden token in the prose that explains why it is forbidden. Scanning
 * CODE only is what makes the assertions statements about behaviour.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = Object.fromEntries(
  Object.entries(SOURCE).map(([k, v]) => [k, stripComments(v)]),
) as Record<keyof typeof ROUTES, string>;

const ACTION_SOURCE = readFileSync("src/app/actions/public-tracking.ts", "utf8");

/** Every column no customer route may name in a projection or a render. */
const NEVER_ON_A_CUSTOMER_ROUTE = [
  "gross_shipper_amount",
  "margin",
  "delay_reason_internal",
  "public_access_hash",
] as const;

/* ------------------------------------------------------------------ *
 * A shipment row carrying a sentinel in every private column
 * ------------------------------------------------------------------ */

const SENTINEL = "M83-PRIVATE-SENTINEL";

const ROW: ShipmentRow = {
  id: "11111111-1111-1111-1111-111111111111",
  tracking_number: "PL-2026-083101",
  shipper_id: "22222222-2222-2222-2222-222222222222",
  carrier_id: "33333333-3333-3333-3333-333333333333",
  dispatcher_id: "44444444-4444-4444-4444-444444444444",
  quote_id: null,
  broker_partner_id: "55555555-5555-5555-5555-555555555555",
  load_id: null,
  status: "in_transit",
  origin_company: "Origin Co",
  origin_address: "1 Origin Way",
  origin_city: "Newark",
  origin_state: "NJ",
  origin_zip: "07104",
  destination_company: "Dest Co",
  destination_address: "2 Dest Way",
  destination_city: "Atlanta",
  destination_state: "GA",
  destination_zip: "30301",
  pickup_appointment_at: "2026-08-01T12:00:00Z",
  delivery_appointment_at: "2026-08-04T12:00:00Z",
  equipment: "dry-van",
  commodity_category: "general",
  weight_lbs: 24000,
  pallets: 20,
  distance_miles: 870,
  gross_shipper_amount: 918273,
  carrier_pay: 645342,
  margin: 272931,
  shipper_reference: "REF-1",
  po_number: "PO-1",
  public_tracking_enabled: true,
  tracking_mode: "manual",
  location_visibility: "approximate",
  public_access_hash: `v1:${SENTINEL}`,
  current_latitude: 40.7,
  current_longitude: -74.1,
  current_city: "Knoxville",
  current_state: "TN",
  last_location_at: "2026-08-02T09:00:00Z",
  estimated_pickup_at: "2026-08-01T12:00:00Z",
  estimated_delivery_at: "2026-08-04T12:00:00Z",
  eta_source: "manual",
  eta_confidence: "medium",
  eta_updated_at: "2026-08-02T09:00:00Z",
  delay_minutes: 45,
  delay_reason_public: "phrase:delay.traffic",
  delay_reason_internal: `${SENTINEL}-DELAY`,
  created_at: "2026-07-30T09:00:00Z",
  updated_at: "2026-08-02T09:00:00Z",
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
};

const EVENTS: ShipmentEventRow[] = [
  {
    id: "e1111111-1111-1111-1111-111111111111",
    shipment_id: ROW.id,
    event_type: "public_update",
    status: "in_transit",
    event_time: "2026-08-02T09:00:00Z",
    recorded_at: "2026-08-02T09:00:01Z",
    source: "dispatcher",
    created_by: ROW.dispatcher_id,
    city: "Knoxville",
    state: "TN",
    latitude: 35.9,
    longitude: -83.9,
    public_message: "phrase:update.in_transit",
    internal_message: `${SENTINEL}-NOTE`,
    visibility: "public",
    metadata: { secret: `${SENTINEL}-META` },
    idempotency_key: null,
    external_event_id: null,
  },
];

const INPUT: ShipmentDtoInput = { shipment: ROW, events: EVENTS };

function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, into);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      keysDeep(v, into);
    }
  }
  return into;
}

/* ================================================================== *
 * 1 · Exact key sets, per audience
 * ================================================================== */

describe("§18 — every customer serializer answers with an EXACT key set", () => {
  const AUDIENCES = [
    ["public", toPublicTrackingDto],
    ["shipper", toShipperDto],
    ["carrier", toCarrierDto],
    ["broker", toBrokerDto],
  ] as const;

  it.each(AUDIENCES)("%s carries no sentinel value at any depth", (_name, fn) => {
    const blob = JSON.stringify(fn(INPUT));
    expect(blob).not.toContain(SENTINEL);
    expect(blob).not.toContain("918273");
    expect(blob).not.toContain("272931");
  });

  it.each(AUDIENCES)("%s names no forbidden key at any depth", (name, fn) => {
    const keys = keysDeep(fn(INPUT));
    for (const forbidden of NEVER_ON_A_CUSTOMER_ROUTE) {
      expect(keys, `${name} exposed ${forbidden}`).not.toContain(forbidden);
    }
    // `internal_message` and `metadata` are §7's staff band — a shipper-band
    // event may legitimately reach a customer, but those two fields may not.
    expect(keys, `${name} exposed internal_message`).not.toContain(
      "internal_message",
    );
    expect(keys, `${name} exposed metadata`).not.toContain("metadata");
  });

  it("public tracking exposes NO internal identifier", () => {
    const keys = keysDeep(toPublicTrackingDto(INPUT));
    for (const id of [
      "id",
      "shipment_id",
      "shipper_id",
      "carrier_id",
      "dispatcher_id",
      "broker_partner_id",
      "load_id",
      "quote_id",
    ]) {
      expect(keys, `public tracking exposed ${id}`).not.toContain(id);
    }
  });

  it("carrier_pay is the ONE deliberate crossing, and only for the carrier", () => {
    expect(Object.keys(toCarrierDto(INPUT))).toContain("carrier_pay");
    for (const [name, fn] of [
      ["public", toPublicTrackingDto],
      ["shipper", toShipperDto],
      ["broker", toBrokerDto],
    ] as const) {
      expect(
        keysDeep(fn(INPUT)),
        `${name} received carrier_pay`,
      ).not.toContain("carrier_pay");
    }
  });
});

/* ================================================================== *
 * 2 · The ROUTE actually calls the serializer
 * ================================================================== */

describe("§19 — the route calls the serializer (not the row)", () => {
  it.each([
    ["shipper", "toShipperDto("],
    ["carrier", "toCarrierDto("],
    ["broker", "toBrokerDto("],
  ] as const)("%s detail page calls %s", (route, call) => {
    expect(SOURCE[route as keyof typeof SOURCE]).toContain(call);
  });

  it("the /track action returns the lookup's DTO and reads no shipment itself", () => {
    expect(ACTION_SOURCE).toContain("lookupPublicTracking");
    expect(stripComments(ACTION_SOURCE)).not.toContain('from("shipments")');
    expect(stripComments(ACTION_SOURCE)).not.toContain("tryCreateAdminClient");
    // The success branch hands back `result.tracking` — the DTO — and never
    // a spread of anything wider.
    expect(ACTION_SOURCE).toContain("tracking: result.tracking");
  });

  it("no customer route spreads a raw shipment row", () => {
    for (const [route, src] of Object.entries(CODE)) {
      expect(src, `${route} spreads a row`).not.toContain("...shipment,");
      expect(src, `${route} spreads a row`).not.toContain("...row,");
      expect(src, `${route} selects *`).not.toContain('select("*")');
    }
  });

  it("no customer route names a staff-only column", () => {
    for (const [route, src] of Object.entries(CODE)) {
      for (const column of NEVER_ON_A_CUSTOMER_ROUTE) {
        // The shipper/carrier/broker pages set these to `null` explicitly when
        // widening a narrow projection to `ShipmentRow` for the serializer,
        // which is the opposite of a leak — allow exactly that spelling.
        const leaked = new RegExp(`${column}(?!\\s*:\\s*null)`).test(src);
        expect(leaked, `${route} names ${column}`).toBe(false);
      }
    }
  });

  it("no customer route reaches for the service-role client", () => {
    for (const [route, src] of Object.entries(CODE)) {
      expect(src, `${route} imports the admin client`).not.toContain(
        "tryCreateAdminClient",
      );
      expect(src, `${route} imports the admin client`).not.toContain(
        "createAdminClient",
      );
    }
  });

  it("every customer refusal is a 404, never a 403", () => {
    for (const route of ["shipper", "carrier", "broker"] as const) {
      expect(CODE[route]).toContain("notFound()");
      expect(CODE[route]).not.toContain("403");
      expect(CODE[route]).not.toContain("forbidden(");
    }
  });
});

/* ================================================================== *
 * 3 · The two column lists that must not drift
 * ================================================================== */

describe("M-83 — the revoked columns and the forbidden projections agree", () => {
  it("everything the public path forbids is either revoked or staff-only", () => {
    for (const column of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(SHIPMENT_RESTRICTED_COLUMNS as readonly string[]).toContain(
        column,
      );
    }
  });

  it("the staff accessor covers exactly the four columns 0030 revokes", () => {
    // The migration is the source of truth; this is the TypeScript side of
    // the same list, and a drift between them is a page that renders "—" for
    // a rate a dispatcher is entitled to.
    const migration = readFileSync(
      "supabase/migrations/0030_dispatcher_scope_and_column_privileges.sql",
      "utf8",
    );
    const grant = migration.slice(
      migration.indexOf("grant select ("),
      migration.indexOf(") on public.shipments to authenticated"),
    );
    for (const column of [
      ...SHIPMENT_RESTRICTED_COLUMNS,
      "public_access_hash",
    ]) {
      expect(grant, `${column} is still granted to authenticated`).not.toMatch(
        new RegExp(`\\b${column}\\b`),
      );
    }
    // Non-vacuity: an operational column IS in the grant.
    expect(grant).toMatch(/\bstatus\b/);
    expect(grant).toMatch(/\btracking_number\b/);
  });
});
