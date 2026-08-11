import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOOKED_STATUSES,
  COMPLETED_STATUSES,
  EMPTY_TILE_COUNTS,
  getShipperTileCounts,
  IN_TRANSIT_STATUSES,
  operatingDayBounds,
  OPERATING_TIME_ZONE,
  SHIPMENT_TILE_PREDICATES,
  SHIPPER_TILE_IDS,
  type DayBounds,
  type ShipperTileId,
} from "@/lib/shipments/shipper-tiles";
import { SHIPMENT_STATUSES } from "@/lib/shipments/types";
import type { FilterableQuery } from "@/lib/shipments/shipper-list";
import { createRecordingClient } from "./stubs/recording-supabase";

/**
 * M-74 — §11's dashboard tiles: the aggregation, the "no fake metrics" rule
 * and the §25 shape.
 *
 * The three properties worth proving, and why each is a real hazard:
 *
 *   * **No tile loads a row.** Nine counts implemented as "fetch and count in
 *     JS" is §25's *"do not load every shipment into the browser"* failure
 *     moved one screen up, and it looks identical in a diff. `head: true` is
 *     asserted on every query.
 *   * **`null` is not `0`.** §11 forbids fake metrics. A tile with no table
 *     behind it (`documents_awaiting_review`, M-77's) and a tile whose query
 *     errored must both be "not measured", because `0` asserts a measurement.
 *   * **"Today" is Eastern, not UTC.** A UTC day boundary puts a 20:00 ET
 *     pickup on tomorrow's tile — a wrong number on an operational screen.
 *     Pinned across EST, EDT and both DST transitions.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Status buckets
 * ------------------------------------------------------------------ */

describe("tile status buckets", () => {
  it("every bucket member is a real §6 status", () => {
    for (const bucket of [
      BOOKED_STATUSES,
      IN_TRANSIT_STATUSES,
      COMPLETED_STATUSES,
    ]) {
      for (const status of bucket) {
        expect(SHIPMENT_STATUSES).toContain(status);
      }
    }
  });

  it("the three buckets are DISJOINT — a shipment is counted once", () => {
    const all = [
      ...BOOKED_STATUSES,
      ...IN_TRANSIT_STATUSES,
      ...COMPLETED_STATUSES,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("`delayed` is in no bucket — it has its own tile", () => {
    expect(BOOKED_STATUSES).not.toContain("delayed");
    expect(IN_TRANSIT_STATUSES).not.toContain("delayed");
    expect(COMPLETED_STATUSES).not.toContain("delayed");
  });

  it("a quote is not a booking", () => {
    expect(BOOKED_STATUSES).not.toContain("quote_requested");
    expect(BOOKED_STATUSES).not.toContain("quote_sent");
    expect(BOOKED_STATUSES).toContain("quote_accepted");
  });

  it("`cancelled` is counted nowhere — it is not an operational number", () => {
    for (const bucket of [
      BOOKED_STATUSES,
      IN_TRANSIT_STATUSES,
      COMPLETED_STATUSES,
    ]) {
      expect(bucket).not.toContain("cancelled");
    }
  });

  it("§11's eight tile ids are present exactly once, in order", () => {
    expect(SHIPPER_TILE_IDS).toEqual([
      "booked",
      "pickups_today",
      "in_transit",
      "delayed",
      "deliveries_today",
      "completed",
      "documents_awaiting_review",
      "outstanding_invoices",
    ]);
    expect(new Set(SHIPPER_TILE_IDS).size).toBe(SHIPPER_TILE_IDS.length);
    expect(Object.keys(EMPTY_TILE_COUNTS).sort()).toEqual(
      [...SHIPPER_TILE_IDS].sort(),
    );
  });
});

/* ------------------------------------------------------------------ *
 * "Today" in the operating time zone
 * ------------------------------------------------------------------ */

describe("operatingDayBounds", () => {
  it("the operating zone is the dispatch desk's, not the server's", () => {
    expect(OPERATING_TIME_ZONE).toBe("America/New_York");
  });

  it("EST (UTC−5): the day runs 05:00Z → 04:59:59.999Z", () => {
    const bounds = operatingDayBounds(new Date("2026-01-15T18:00:00.000Z"));
    expect(bounds.start).toBe("2026-01-15T05:00:00.000Z");
    expect(bounds.end).toBe("2026-01-16T04:59:59.999Z");
  });

  it("EDT (UTC−4): the day runs 04:00Z → 03:59:59.999Z", () => {
    const bounds = operatingDayBounds(new Date("2026-07-15T18:00:00.000Z"));
    expect(bounds.start).toBe("2026-07-15T04:00:00.000Z");
    expect(bounds.end).toBe("2026-07-16T03:59:59.999Z");
  });

  it("THE FAILURE THIS PREVENTS: a 20:00 ET pickup is TODAY, not tomorrow", () => {
    // 2026-07-15 20:00 ET is 2026-07-16 00:00 UTC. A UTC-day tile would put
    // it on the 16th; the shipper is expecting a truck this evening.
    const now = new Date("2026-07-15T18:00:00.000Z"); // 14:00 ET, same day
    const pickup = new Date("2026-07-16T00:00:00.000Z"); // 20:00 ET, same day
    const bounds = operatingDayBounds(now);
    expect(pickup.toISOString() >= bounds.start).toBe(true);
    expect(pickup.toISOString() <= bounds.end).toBe(true);
    // …and the naive UTC comparison gets it wrong, which is the point.
    expect(pickup.toISOString().slice(0, 10)).not.toBe(
      now.toISOString().slice(0, 10),
    );
  });

  it("the spring-forward day is 23 hours long", () => {
    // 2026-03-08: EST → EDT at 02:00 local.
    const bounds = operatingDayBounds(new Date("2026-03-08T18:00:00.000Z"));
    const hours =
      (Date.parse(bounds.end) + 1 - Date.parse(bounds.start)) / 3_600_000;
    expect(bounds.start).toBe("2026-03-08T05:00:00.000Z");
    expect(hours).toBeCloseTo(23, 5);
  });

  it("the fall-back day is 25 hours long", () => {
    // 2026-11-01: EDT → EST at 02:00 local.
    const bounds = operatingDayBounds(new Date("2026-11-01T18:00:00.000Z"));
    const hours =
      (Date.parse(bounds.end) + 1 - Date.parse(bounds.start)) / 3_600_000;
    expect(bounds.start).toBe("2026-11-01T04:00:00.000Z");
    expect(hours).toBeCloseTo(25, 5);
  });

  it("start is always before end, at every hour of a year", () => {
    for (let day = 0; day < 365; day += 7) {
      const now = new Date(Date.UTC(2026, 0, 1 + day, 13, 0, 0));
      const bounds = operatingDayBounds(now);
      expect(bounds.start < bounds.end).toBe(true);
      expect(now.toISOString() >= bounds.start).toBe(true);
      expect(now.toISOString() <= bounds.end).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Tile predicates
 * ------------------------------------------------------------------ */

interface Recorded {
  method: string;
  args: unknown[];
}

class Recorder implements FilterableQuery<Recorder> {
  readonly calls: Recorded[] = [];
  private push(method: string, args: unknown[]): Recorder {
    this.calls.push({ method, args });
    return this;
  }
  eq(c: string, v: unknown) {
    return this.push("eq", [c, v]);
  }
  in(c: string, v: readonly unknown[]) {
    return this.push("in", [c, v]);
  }
  gte(c: string, v: unknown) {
    return this.push("gte", [c, v]);
  }
  lte(c: string, v: unknown) {
    return this.push("lte", [c, v]);
  }
  ilike(c: string, p: string) {
    return this.push("ilike", [c, p]);
  }
  or(e: string) {
    return this.push("or", [e]);
  }
}

const DAY: DayBounds = {
  start: "2026-08-05T04:00:00.000Z",
  end: "2026-08-06T03:59:59.999Z",
};

function chain(id: keyof typeof SHIPMENT_TILE_PREDICATES): Recorded[] {
  const recorder = new Recorder();
  SHIPMENT_TILE_PREDICATES[id](recorder, DAY);
  return recorder.calls;
}

describe("tile predicates (§11)", () => {
  it("booked / in transit / completed are status set membership", () => {
    expect(chain("booked")).toEqual([
      { method: "in", args: ["status", BOOKED_STATUSES] },
    ]);
    expect(chain("in_transit")).toEqual([
      { method: "in", args: ["status", IN_TRANSIT_STATUSES] },
    ]);
    expect(chain("completed")).toEqual([
      { method: "in", args: ["status", COMPLETED_STATUSES] },
    ]);
  });

  it("today's pickups and deliveries bound BOTH ends of the operating day", () => {
    expect(chain("pickups_today")).toEqual([
      { method: "gte", args: ["pickup_appointment_at", DAY.start] },
      { method: "lte", args: ["pickup_appointment_at", DAY.end] },
    ]);
    expect(chain("deliveries_today")).toEqual([
      { method: "gte", args: ["delivery_appointment_at", DAY.start] },
      { method: "lte", args: ["delivery_appointment_at", DAY.end] },
    ]);
  });

  it("`delayed` matches the status OR recorded minutes — the same rule as the list", () => {
    expect(chain("delayed")).toEqual([
      { method: "or", args: ["status.eq.delayed,delay_minutes.gt.0"] },
    ]);
  });

  it("every predicate returns a query — none drops the chain", () => {
    for (const id of Object.keys(
      SHIPMENT_TILE_PREDICATES,
    ) as (keyof typeof SHIPMENT_TILE_PREDICATES)[]) {
      const recorder = new Recorder();
      expect(SHIPMENT_TILE_PREDICATES[id](recorder, DAY)).toBe(recorder);
      expect(recorder.calls.length).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The aggregation
 * ------------------------------------------------------------------ */

describe("getShipperTileCounts (§11, §25)", () => {
  const NOW = new Date("2026-08-05T18:00:00.000Z");

  it("§25 PROOF: every query is head:true — not one row is loaded", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { count: 3 },
      invoices: { count: 1 },
    });
    await getShipperTileCounts(client as never, "shipper-1", NOW);
    expect(recorder.queries.length).toBeGreaterThan(0);
    for (const query of recorder.queries) {
      expect(query.selectOptions, `${query.table} loaded rows`).toEqual({
        count: "exact",
        head: true,
      });
    }
  });

  it("every query is scoped to the caller's organization", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { count: 0 },
      invoices: { count: 0 },
    });
    await getShipperTileCounts(client as never, "shipper-1", NOW);
    for (const query of recorder.queries) {
      const scoped = query.calls.some(
        (c) =>
          c.method === "eq" &&
          c.args[0] === "shipper_id" &&
          c.args[1] === "shipper-1",
      );
      expect(scoped, `${query.table} was not scoped`).toBe(true);
    }
  });

  it("touches only `shipments` and `invoices` — six + one query, no N+1 walk", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { count: 0 },
      invoices: { count: 0 },
    });
    await getShipperTileCounts(client as never, "shipper-1", NOW);
    expect(recorder.tables().sort()).toEqual(["invoices", "shipments"]);
    expect(recorder.forTable("shipments")).toHaveLength(6);
    expect(recorder.forTable("invoices")).toHaveLength(1);
  });

  it("a genuine zero renders as zero — that is §11's zero-data state", async () => {
    const { client } = createRecordingClient({
      shipments: { count: 0 },
      invoices: { count: 0 },
    });
    const counts = await getShipperTileCounts(
      client as never,
      "shipper-1",
      NOW,
    );
    expect(counts.booked).toBe(0);
    expect(counts.delayed).toBe(0);
    expect(counts.outstanding_invoices).toBe(0);
  });

  it("`documents_awaiting_review` is NULL, never 0 — M-77 owns the table", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { count: 4 },
      invoices: { count: 2 },
    });
    const counts = await getShipperTileCounts(
      client as never,
      "shipper-1",
      NOW,
    );
    expect(counts.documents_awaiting_review).toBeNull();
    // …and nothing was queried for it: there is no table to query.
    expect(recorder.tables()).not.toContain("shipment_documents");
  });

  it("a failed count stays NULL — a database error is not `you have zero`", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createRecordingClient({
      shipments: { error: { message: "denied" } },
      invoices: { error: { message: "denied" } },
    });
    const counts = await getShipperTileCounts(
      client as never,
      "shipper-1",
      NOW,
    );
    for (const id of SHIPPER_TILE_IDS) {
      expect(counts[id as ShipperTileId], id).toBeNull();
    }
  });

  it("NON-VACUITY: a working count is NOT null", async () => {
    const { client } = createRecordingClient({
      shipments: { count: 7 },
      invoices: { count: 2 },
    });
    const counts = await getShipperTileCounts(
      client as never,
      "shipper-1",
      NOW,
    );
    expect(counts.in_transit).toBe(7);
    expect(counts.outstanding_invoices).toBe(2);
  });

  it("uses the operating day for the two 'today' tiles", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { count: 0 },
      invoices: { count: 0 },
    });
    await getShipperTileCounts(client as never, "shipper-1", NOW);
    const day = operatingDayBounds(NOW);
    const bounds = recorder.callsOf("gte").map((c) => c.args[1]);
    expect(bounds).toEqual([day.start, day.start]);
  });
});
