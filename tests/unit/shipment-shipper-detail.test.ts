import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  CARRIER_SIDE_ROLES,
  getShipmentContacts,
  getShipmentInvoices,
  getShipmentSummary,
  getShipmentTimelinePage,
  OUTSTANDING_INVOICE_STATUSES,
  parseTimelineCursor,
  resolveTimelineLimit,
  SHIPMENT_DETAIL_COLUMNS,
  SHIPMENT_EVENT_COLUMNS,
  TIMELINE_MAX_PAGE_SIZE,
  TIMELINE_PAGE_SIZE,
  toShipmentContactViews,
  type ShipmentContactRow,
} from "@/lib/shipments/shipper-detail";
import { AUDIENCE_EVENT_VISIBILITY, toShipperDto } from "@/lib/shipments/dto";
import { SHIPMENT_PARTY_ROLES } from "@/lib/shipments/types";
import { createRecordingClient } from "./stubs/recording-supabase";

/**
 * M-74 — the §11 detail reads and the §25 summary-vs-history split.
 *
 * THE HEADLINE ASSERTION is the split: `getShipmentSummary` must touch
 * `shipments` and nothing else. The plan's §4 table restored *"query current
 * summary separately from full history"* as an explicit M-74 requirement, and
 * the failure mode it guards against — a page that reads a shipment's whole
 * event table to render a status badge — is invisible in code review and
 * catastrophic at §25's stated scale (hundreds of thousands of events).
 *
 * THE SECOND is the DTO call site. M-70's own doc says its suite cannot prove
 * that a real page calls `toShipperDto` rather than passing a row through;
 * M-73 gave that proof for `/track`. This gives it for the portal: the
 * detail page's module text is scanned, and the DTO's own output is
 * sentinel-swept at this call site's exact shape.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const DETAIL_PAGE = readFileSync(
  "src/app/[locale]/portal/shipper/shipments/[shipmentId]/page.tsx",
  "utf8",
);
const LIST_PAGE = readFileSync(
  "src/app/[locale]/portal/shipper/shipments/page.tsx",
  "utf8",
);
const DETAIL_LIB = readFileSync("src/lib/shipments/shipper-detail.ts", "utf8");
const LIST_LIB = readFileSync("src/lib/shipments/shipper-list.ts", "utf8");

/* ------------------------------------------------------------------ *
 * §18 — projections
 * ------------------------------------------------------------------ */

const FORBIDDEN_COLUMNS = [
  "gross_shipper_amount",
  "carrier_pay",
  "margin",
  "delay_reason_internal",
  "public_access_hash",
];

describe("detail projections (§18, §7)", () => {
  it("the shipment projection names none of the five staff-only columns", () => {
    for (const column of FORBIDDEN_COLUMNS) {
      expect(SHIPMENT_DETAIL_COLUMNS).not.toContain(column);
    }
    expect(SHIPMENT_DETAIL_COLUMNS).not.toContain("*");
  });

  it("the shipment projection DOES name the public delay reason", () => {
    // Non-vacuity for the assertion above: the two columns differ by a
    // suffix, so a sweep that could not tell them apart would prove nothing.
    expect(SHIPMENT_DETAIL_COLUMNS).toContain("delay_reason_public");
  });

  it("the event projection names neither the internal note nor the metadata", () => {
    expect(SHIPMENT_EVENT_COLUMNS).not.toContain("internal_message");
    expect(SHIPMENT_EVENT_COLUMNS).not.toContain("metadata");
    expect(SHIPMENT_EVENT_COLUMNS).not.toContain("latitude");
    expect(SHIPMENT_EVENT_COLUMNS).not.toContain("longitude");
    expect(SHIPMENT_EVENT_COLUMNS).toContain("public_message");
  });
});

/* ------------------------------------------------------------------ *
 * §25 — the summary/history split
 * ------------------------------------------------------------------ */

describe("summary-vs-history split (§25)", () => {
  it("PROOF: getShipmentSummary queries `shipments` and NOTHING else", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { data: null },
    });
    await getShipmentSummary(client as never, "shipper-1", "ship-1");
    expect(recorder.tables()).toEqual(["shipments"]);
    expect(recorder.queries).toHaveLength(1);
    expect(
      recorder.queries[0]!.calls.map((c) => c.method),
      "the summary must not paginate, filter events or count",
    ).toEqual(["select", "eq", "eq", "maybeSingle"]);
  });

  it("the summary is scoped by BOTH id and shipper id", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { data: null },
    });
    await getShipmentSummary(client as never, "shipper-1", "ship-1");
    expect(recorder.callsOf("eq")).toEqual([
      { method: "eq", args: ["id", "ship-1"] },
      { method: "eq", args: ["shipper_id", "shipper-1"] },
    ]);
  });

  it("the summary returns null on error — the page 404s, it does not throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createRecordingClient({
      shipments: { error: { message: "down" } },
    });
    expect(
      await getShipmentSummary(client as never, "shipper-1", "ship-1"),
    ).toBeNull();
  });
});

describe("getShipmentTimelinePage (§7, §25)", () => {
  function events(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `e-${i}`,
      shipment_id: "ship-1",
      event_type: "public_update",
      status: null,
      event_time: `2026-08-0${(i % 9) + 1}T10:00:00.000Z`,
      recorded_at: `2026-08-0${(i % 9) + 1}T10:01:00.000Z`,
      source: "dispatcher",
      city: null,
      state: null,
      public_message: null,
      visibility: "shipper",
    }));
  }

  it("is BOUNDED and fetches exactly one lookahead row", async () => {
    const { client, recorder } = createRecordingClient({
      shipment_events: { data: events(5) },
    });
    await getShipmentTimelinePage(client as never, "ship-1");
    expect(recorder.callsOf("limit")).toEqual([
      { method: "limit", args: [TIMELINE_PAGE_SIZE + 1] },
    ]);
  });

  it("filters the audience band IN SQL as well as by policy (§7)", async () => {
    const { client, recorder } = createRecordingClient({
      shipment_events: { data: [] },
    });
    await getShipmentTimelinePage(client as never, "ship-1");
    expect(recorder.callsOf("in")).toEqual([
      { method: "in", args: ["visibility", AUDIENCE_EVENT_VISIBILITY.shipper] },
    ]);
    // §7's hard rule, restated where it is enforced.
    expect(AUDIENCE_EVENT_VISIBILITY.shipper).not.toContain("staff_only");
    expect(AUDIENCE_EVENT_VISIBILITY.shipper).not.toContain("carrier");
  });

  it("hasMore is true only when the lookahead row came back", async () => {
    const under = createRecordingClient({
      shipment_events: { data: events(TIMELINE_PAGE_SIZE) },
    });
    const page1 = await getShipmentTimelinePage(
      under.client as never,
      "ship-1",
    );
    expect(page1.hasMore).toBe(false);
    expect(page1.events).toHaveLength(TIMELINE_PAGE_SIZE);
    expect(page1.nextBefore).toBeNull();

    const over = createRecordingClient({
      shipment_events: { data: events(TIMELINE_PAGE_SIZE + 1) },
    });
    const page2 = await getShipmentTimelinePage(over.client as never, "ship-1");
    expect(page2.hasMore).toBe(true);
    // The lookahead row is DROPPED, never rendered.
    expect(page2.events).toHaveLength(TIMELINE_PAGE_SIZE);
    expect(page2.nextBefore).toBe(
      page2.events[page2.events.length - 1]!.event_time,
    );
  });

  it("a cursor becomes a keyset predicate, not an offset", async () => {
    const { client, recorder } = createRecordingClient({
      shipment_events: { data: [] },
    });
    await getShipmentTimelinePage(client as never, "ship-1", {
      before: "2026-08-01T10:00:00.000Z",
    });
    expect(recorder.callsOf("lt")).toEqual([
      { method: "lt", args: ["event_time", "2026-08-01T10:00:00.000Z"] },
    ]);
    expect(recorder.callsOf("range")).toEqual([]);
  });

  it("orders by a TOTAL key (event_time, id)", async () => {
    const { client, recorder } = createRecordingClient({
      shipment_events: { data: [] },
    });
    await getShipmentTimelinePage(client as never, "ship-1");
    expect(recorder.callsOf("order").map((c) => c.args[0])).toEqual([
      "event_time",
      "id",
    ]);
  });

  it("a caller cannot raise the history ceiling", () => {
    expect(resolveTimelineLimit()).toBe(TIMELINE_PAGE_SIZE);
    expect(resolveTimelineLimit(10_000)).toBe(TIMELINE_MAX_PAGE_SIZE);
    expect(resolveTimelineLimit(0)).toBe(1);
    expect(resolveTimelineLimit(Number.NaN)).toBe(TIMELINE_PAGE_SIZE);
  });

  it("rejects a cursor that is not a timestamp", () => {
    expect(parseTimelineCursor("2026-08-01T10:00:00.000Z")).toBe(
      "2026-08-01T10:00:00.000Z",
    );
    expect(parseTimelineCursor("not a date")).toBeNull();
    expect(parseTimelineCursor("")).toBeNull();
    expect(parseTimelineCursor("x".repeat(200))).toBeNull();
    expect(parseTimelineCursor(undefined)).toBeNull();
    expect(parseTimelineCursor(7)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * §11 invoice status — from `invoices`, under its own RLS
 * ------------------------------------------------------------------ */

describe("getShipmentInvoices (§11)", () => {
  it("reads `invoices` scoped to the shipment, bounded", async () => {
    const { client, recorder } = createRecordingClient({
      invoices: { data: [] },
    });
    await getShipmentInvoices(client as never, "ship-1");
    expect(recorder.tables()).toEqual(["invoices"]);
    expect(recorder.callsOf("eq")).toEqual([
      { method: "eq", args: ["shipment_id", "ship-1"] },
    ]);
    expect(recorder.callsOf("limit")).toEqual([
      { method: "limit", args: [10] },
    ]);
  });

  it("never selects a shipment financial column — the amount is the invoice's", () => {
    const columns = String(
      createRecordingClient().recorder.queries[0]?.columns ?? "",
    );
    expect(columns).toBe("");
    // The projection is inspected directly: it is the invoice's own amount,
    // which the customer is entitled to, and none of §18's shipment fields.
    expect(DETAIL_LIB).toContain("id, status, amount_cents, currency");
    for (const column of FORBIDDEN_COLUMNS) {
      expect(
        DETAIL_LIB.slice(DETAIL_LIB.indexOf('from("invoices")')).includes(
          column,
        ),
      ).toBe(false);
    }
  });

  it("an error is reported, not silently rendered as `no invoice`", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createRecordingClient({
      invoices: { error: { message: "denied" } },
    });
    const result = await getShipmentInvoices(client as never, "ship-1");
    expect(result.failed).toBe(true);
    expect(result.invoices).toEqual([]);
  });

  it("the outstanding set is the two statuses a customer can act on", () => {
    expect(OUTSTANDING_INVOICE_STATUSES).toEqual(["draft", "open"]);
    expect(OUTSTANDING_INVOICE_STATUSES).not.toContain("paid");
    expect(OUTSTANDING_INVOICE_STATUSES).not.toContain("void");
  });
});

/* ------------------------------------------------------------------ *
 * §11 contacts — M-71's visibility rules
 * ------------------------------------------------------------------ */

describe("shipment contacts (§11, M-71 visibility)", () => {
  function party(over: Partial<ShipmentContactRow> = {}): ShipmentContactRow {
    return {
      id: "p-1",
      party_role: "consignee",
      company_name: "Atlanta DC",
      contact_name: "Receiving Desk",
      phone: "4045550100",
      email: "dock@atlanta-dc.test",
      public_contact: false,
      ...over,
    };
  }

  it("every role in CARRIER_SIDE_ROLES is a real §18 party role", () => {
    for (const role of CARRIER_SIDE_ROLES) {
      expect(SHIPMENT_PARTY_ROLES).toContain(role);
    }
  });

  it("the shipper's OWN counterparties keep their channels", () => {
    for (const role of [
      "shipper",
      "consignee",
      "billing",
      "third_party",
    ] as const) {
      const [view] = toShipmentContactViews([party({ party_role: role })]);
      expect(view!.phone).toBe("4045550100");
      expect(view!.email).toBe("dock@atlanta-dc.test");
      expect(view!.channels_withheld).toBe(false);
    }
  });

  it("the carrier's channels are withheld unless dispatch shared them", () => {
    const [withheld] = toShipmentContactViews([
      party({ party_role: "carrier", public_contact: false }),
    ]);
    expect(withheld!.phone).toBeNull();
    expect(withheld!.email).toBeNull();
    expect(withheld!.contact_name).toBeNull();
    expect(withheld!.channels_withheld).toBe(true);
    // The company name is NOT withheld — a shipper is entitled to know who
    // is hauling their freight; §12's rule is about contact CHANNELS.
    expect(withheld!.company_name).toBe("Atlanta DC");

    const [shared] = toShipmentContactViews([
      party({ party_role: "carrier", public_contact: true }),
    ]);
    expect(shared!.phone).toBe("4045550100");
    expect(shared!.channels_withheld).toBe(false);
  });

  it("`channels_withheld` is false when there was nothing to withhold", () => {
    const [view] = toShipmentContactViews([
      party({ party_role: "carrier", phone: null, email: null }),
    ]);
    expect(view!.channels_withheld).toBe(false);
  });

  it("NON-VACUITY: a carrier row with a phone IS masked", () => {
    const rows = [party({ party_role: "carrier" })];
    const naive = rows.map((r) => ({ ...r }));
    expect(naive[0]!.phone).toBe("4045550100");
    expect(toShipmentContactViews(rows)[0]!.phone).toBeNull();
  });

  it("the query is scoped and bounded", async () => {
    const { client, recorder } = createRecordingClient({
      shipment_parties: { data: [] },
    });
    await getShipmentContacts(client as never, "ship-1");
    expect(recorder.callsOf("eq")).toEqual([
      { method: "eq", args: ["shipment_id", "ship-1"] },
    ]);
    expect(recorder.callsOf("limit")).toEqual([
      { method: "limit", args: [25] },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * The DTO call site (M-70's stated gap, closed for the portal)
 * ------------------------------------------------------------------ */

describe("DTO call-site proof (§18, §19)", () => {
  it("the detail page calls toShipperDto and never passes a row through", () => {
    const source = DETAIL_PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(source).toContain("toShipperDto(");
    expect(source).not.toContain("...shipment,");
    expect(source).not.toContain("shipment={summary}");
    expect(source).not.toContain('select("*")');
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toContain("as unknown as");
    expect(source).not.toContain("tryCreateAdminClient");
  });

  it("neither page nor lib ever reaches for the admin client", () => {
    for (const source of [DETAIL_PAGE, LIST_PAGE, DETAIL_LIB, LIST_LIB]) {
      expect(source).not.toContain("supabase/admin");
      expect(source).not.toContain("SERVICE_ROLE");
    }
  });

  it("SENTINEL SWEEP: nothing forbidden survives the call site's shape", () => {
    // The exact object the page builds, with sentinels where the projection
    // deliberately supplies nulls — if a future edit ever selects them, the
    // serializer is the last line of defence and this proves it holds.
    const dto = toShipperDto({
      shipment: {
        id: "ship-1",
        tracking_number: "PL-2026-000458",
        shipper_id: "shipper-1",
        carrier_id: "carrier-1",
        dispatcher_id: null,
        quote_id: null,
        broker_partner_id: null,
        load_id: null,
        status: "in_transit",
        origin_company: "Origin Co",
        origin_address: "1 Dock St",
        origin_city: "Newark",
        origin_state: "NJ",
        origin_zip: "07102",
        destination_company: "Dest Co",
        destination_address: "500 Dock Rd",
        destination_city: "Atlanta",
        destination_state: "GA",
        destination_zip: "30301",
        pickup_appointment_at: null,
        delivery_appointment_at: null,
        equipment: "dry-van",
        commodity_category: null,
        weight_lbs: null,
        pallets: null,
        distance_miles: null,
        gross_shipper_amount: 999111,
        carrier_pay: 999222,
        margin: 999333,
        shipper_reference: null,
        po_number: null,
        public_tracking_enabled: false,
        tracking_mode: "manual",
        location_visibility: "approximate",
        public_access_hash: "SENTINEL-HASH-999444",
        current_latitude: null,
        current_longitude: null,
        current_city: null,
        current_state: null,
        last_location_at: null,
        estimated_pickup_at: null,
        estimated_delivery_at: null,
        eta_source: null,
        eta_confidence: null,
        eta_updated_at: null,
        delay_minutes: null,
        delay_reason_public: null,
        delay_reason_internal: "SENTINEL-INTERNAL-999555",
        cancellation_reason: null,
        completed_at: null,
        cancelled_at: null,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
      events: [],
    });
    const serialized = JSON.stringify(dto);
    for (const sentinel of [
      "999111",
      "999222",
      "999333",
      "SENTINEL-HASH-999444",
      "SENTINEL-INTERNAL-999555",
    ]) {
      expect(serialized, `leaked ${sentinel}`).not.toContain(sentinel);
    }
  });

  it("NON-VACUITY: the same sweep FINDS the sentinels in a naive passthrough", () => {
    const serialized = JSON.stringify({
      gross_shipper_amount: 999111,
      margin: 999333,
      public_access_hash: "SENTINEL-HASH-999444",
    });
    for (const sentinel of ["999111", "999333", "SENTINEL-HASH-999444"]) {
      expect(serialized).toContain(sentinel);
    }
  });
});
