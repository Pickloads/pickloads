import { describe, expect, it } from "vitest";

import {
  applyBoardColumn,
  BOARD_COLUMNS,
  BOARD_COLUMN_IDS,
  BOARD_PAGE_SIZE,
  BOARD_PREVIEW_SIZE,
  DELIVERY_DAY_STATUSES,
  findBoardColumn,
  getBoard,
  getBoardColumn,
  IN_TRANSIT_BOARD_STATUSES,
  MAX_PAGE_SIZE,
  NON_TERMINAL_STATUSES,
  parseBoardColumn,
  PICKUP_DAY_STATUSES,
  SHIPMENT_BOARD_COLUMNS,
  type BoardColumn,
} from "@/lib/shipments/board";
import { EMPTY_FILTERS, parseShipmentFilters } from "@/lib/shipments/shipper-list";
import {
  dispatcherMayActOn,
  shipmentScopeExpression,
  type StaffScope,
} from "@/lib/staff-scope";
import { SHIPMENT_STATUSES } from "@/lib/shipments/types";
import { createRecordingClient } from "./stubs/recording-supabase";

/**
 * M-75 — the §14 board's query building, and the §19 scope that narrows it.
 *
 * WHAT THIS LANE PROVES AND WHAT IT DOES NOT. These are assertions about the
 * SHAPE of the queries: which table, which predicates, which bound, in which
 * order. The recording client executes nothing. That the queries WORK against
 * real SQL and real RLS is `tests/integration/dispatcher-operations.test.ts`;
 * that a session cannot cross a tenant boundary is the RLS suite. Neither of
 * those can answer "is every board read bounded", which is the §25 claim, and
 * this is the only lane that can.
 */

const ADMIN_SCOPE: StaffScope = { carrierIds: null, restricted: false };
const DISPATCHER_SCOPE: StaffScope = {
  carrierIds: ["c-1", "c-2"],
  restricted: true,
};
const EMPTY_DISPATCHER_SCOPE: StaffScope = { carrierIds: [], restricted: true };
const USER = "u-1";
const NOW = new Date("2026-08-05T15:00:00.000Z");

function column(id: string): BoardColumn {
  const found = findBoardColumn(id);
  if (!found) throw new Error(`no such column: ${id}`);
  return found;
}

/* ------------------------------------------------------------------ *
 * §14's eight columns
 * ------------------------------------------------------------------ */

describe("§14 board columns", () => {
  it("declares exactly the eight columns §14 names, in §14's order", () => {
    expect(BOARD_COLUMNS.map((c) => c.label)).toEqual([
      "Needs Carrier",
      "Carrier Assigned",
      "Pickup Today",
      "In Transit",
      "Delivery Today",
      "Delayed",
      "POD Pending",
      "Completed",
    ]);
  });

  it("gives every column a distinct id and a non-empty hint", () => {
    expect(new Set(BOARD_COLUMN_IDS).size).toBe(BOARD_COLUMNS.length);
    for (const c of BOARD_COLUMNS) expect(c.hint.length).toBeGreaterThan(0);
  });

  it("names only real statuses in every column", () => {
    const known = new Set<string>(SHIPMENT_STATUSES);
    for (const c of BOARD_COLUMNS) {
      for (const s of c.statuses) expect(known.has(s)).toBe(true);
    }
  });

  it("puts every carrier-less status in Needs Carrier — no shipment is invisible", () => {
    expect([...column("needs_carrier").statuses].sort()).toEqual(
      ["carrier_search", "quote_accepted", "quote_requested", "quote_sent"].sort(),
    );
  });

  it("excludes `cancelled` from every column — a documented decision", () => {
    for (const c of BOARD_COLUMNS) {
      if (c.kind === "delayed") continue; // its list is the non-terminal universe
      expect(c.statuses).not.toContain("cancelled");
    }
    expect(NON_TERMINAL_STATUSES).not.toContain("cancelled");
    expect(NON_TERMINAL_STATUSES).not.toContain("completed");
  });

  it("covers every non-terminal status in at least one column", () => {
    const covered = new Set(BOARD_COLUMNS.flatMap((c) => [...c.statuses]));
    for (const status of SHIPMENT_STATUSES) {
      if (status === "cancelled") continue;
      expect(covered.has(status), `${status} appears in no column`).toBe(true);
    }
  });

  it("keeps delivered/completed freight out of the two day columns", () => {
    for (const list of [PICKUP_DAY_STATUSES, DELIVERY_DAY_STATUSES]) {
      expect(list).not.toContain("delivered");
      expect(list).not.toContain("completed");
      expect(list).not.toContain("cancelled");
      expect(list).not.toContain("pod_uploaded");
    }
  });

  it("treats POD Pending as `delivered` only — pod_uploaded means the POD is in", () => {
    expect(column("pod_pending").statuses).toEqual(["delivered"]);
    expect(column("pod_pending").statuses).not.toContain("pod_uploaded");
  });

  it("has an In Transit column that is the moving-freight statuses", () => {
    expect(IN_TRANSIT_BOARD_STATUSES).toContain("in_transit");
    expect(IN_TRANSIT_BOARD_STATUSES).toContain("unloading");
    expect(IN_TRANSIT_BOARD_STATUSES).not.toContain("delayed");
  });

  it("parses ?col= and refuses an unknown value", () => {
    expect(parseBoardColumn("delayed")?.id).toBe("delayed");
    expect(parseBoardColumn(["completed"])?.id).toBe("completed");
    expect(parseBoardColumn("not-a-column")).toBeNull();
    expect(parseBoardColumn(undefined)).toBeNull();
    expect(parseBoardColumn("'; drop table shipments; --")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Column predicates
 * ------------------------------------------------------------------ */

interface Call {
  method: string;
  args: unknown[];
}

/** A minimal chain recorder for `applyBoardColumn` (pure builder, no client). */
function chain() {
  const calls: Call[] = [];
  const q = {
    calls,
    eq(c: string, v: unknown) {
      calls.push({ method: "eq", args: [c, v] });
      return q;
    },
    in(c: string, v: readonly unknown[]) {
      calls.push({ method: "in", args: [c, v] });
      return q;
    },
    gte(c: string, v: unknown) {
      calls.push({ method: "gte", args: [c, v] });
      return q;
    },
    lte(c: string, v: unknown) {
      calls.push({ method: "lte", args: [c, v] });
      return q;
    },
    ilike(c: string, v: string) {
      calls.push({ method: "ilike", args: [c, v] });
      return q;
    },
    or(e: string) {
      calls.push({ method: "or", args: [e] });
      return q;
    },
  };
  return q;
}

describe("applyBoardColumn — the exact predicate per column", () => {
  it("a status column is one `in`, and nothing else", () => {
    const q = chain();
    applyBoardColumn(q, column("in_transit"), NOW);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0]?.method).toBe("in");
    expect(q.calls[0]?.args[0]).toBe("status");
  });

  it("Pickup Today is a status `in` PLUS an appointment window", () => {
    const q = chain();
    applyBoardColumn(q, column("pickup_today"), NOW);
    expect(q.calls.map((c) => c.method)).toEqual(["in", "gte", "lte"]);
    expect(q.calls[1]?.args[0]).toBe("pickup_appointment_at");
    expect(q.calls[2]?.args[0]).toBe("pickup_appointment_at");
  });

  it("Delivery Today windows the DELIVERY appointment, not the pickup one", () => {
    const q = chain();
    applyBoardColumn(q, column("delivery_today"), NOW);
    expect(q.calls[1]?.args[0]).toBe("delivery_appointment_at");
    expect(q.calls[2]?.args[0]).toBe("delivery_appointment_at");
  });

  it("the day window is the EASTERN operating day, not the UTC one", () => {
    // 2026-08-05 15:00Z is 11:00 EDT, so the window is 04:00Z → 03:59:59.999Z.
    const q = chain();
    applyBoardColumn(q, column("pickup_today"), NOW);
    expect(q.calls[1]?.args[1]).toBe("2026-08-05T04:00:00.000Z");
    expect(q.calls[2]?.args[1]).toBe("2026-08-06T03:59:59.999Z");
  });

  it("a 20:00 ET pickup lands on TODAY, not tomorrow (the bug the zone prevents)", () => {
    // 2026-08-06T00:30Z is 20:30 EDT on the 5th.
    const q = chain();
    applyBoardColumn(q, column("pickup_today"), new Date("2026-08-06T00:30:00.000Z"));
    const start = q.calls[1]?.args[1] as string;
    const end = q.calls[2]?.args[1] as string;
    expect(start <= "2026-08-06T00:30:00.000Z").toBe(true);
    expect(end >= "2026-08-06T00:30:00.000Z").toBe(true);
    expect(start).toBe("2026-08-05T04:00:00.000Z");
  });

  it("Delayed is §11's TWO facts — flagged status OR recorded minutes", () => {
    const q = chain();
    applyBoardColumn(q, column("delayed"), NOW);
    expect(q.calls.map((c) => c.method)).toEqual(["in", "or"]);
    expect(q.calls[1]?.args[0]).toBe("status.eq.delayed,delay_minutes.gt.0");
  });

  it("Delayed cannot include completed or cancelled freight", () => {
    const q = chain();
    applyBoardColumn(q, column("delayed"), NOW);
    const statuses = q.calls[0]?.args[1] as readonly string[];
    expect(statuses).not.toContain("completed");
    expect(statuses).not.toContain("cancelled");
  });
});

/* ------------------------------------------------------------------ *
 * §19 scope
 * ------------------------------------------------------------------ */

describe("§19 dispatcher scope", () => {
  it("an admin scope produces NO expression at all", () => {
    expect(shipmentScopeExpression(ADMIN_SCOPE, USER)).toBeNull();
  });

  it("a dispatcher scope covers own shipments AND assigned carriers", () => {
    expect(shipmentScopeExpression(DISPATCHER_SCOPE, USER)).toBe(
      "dispatcher_id.eq.u-1,carrier_id.in.(c-1,c-2)",
    );
  });

  it("a dispatcher with NO carriers still gets the dispatcher_id arm", () => {
    // The expression must never be empty — an empty expression is no filter.
    expect(shipmentScopeExpression(EMPTY_DISPATCHER_SCOPE, USER)).toBe(
      "dispatcher_id.eq.u-1",
    );
  });

  it("dispatcherMayActOn mirrors the read rule exactly", () => {
    // Own shipment, no carrier: allowed (the case a carrier-only rule breaks).
    expect(
      dispatcherMayActOn(DISPATCHER_SCOPE, USER, {
        dispatcher_id: USER,
        carrier_id: null,
      }),
    ).toBe(true);
    // Assigned carrier, someone else's shipment: allowed.
    expect(
      dispatcherMayActOn(DISPATCHER_SCOPE, USER, {
        dispatcher_id: "u-2",
        carrier_id: "c-2",
      }),
    ).toBe(true);
    // Neither: refused. THIS is dispatcher A acting on dispatcher B's freight.
    expect(
      dispatcherMayActOn(DISPATCHER_SCOPE, USER, {
        dispatcher_id: "u-2",
        carrier_id: "c-9",
      }),
    ).toBe(false);
    expect(
      dispatcherMayActOn(DISPATCHER_SCOPE, USER, {
        dispatcher_id: null,
        carrier_id: null,
      }),
    ).toBe(false);
    // An admin is unrestricted — the non-vacuity control for every false above.
    expect(
      dispatcherMayActOn(ADMIN_SCOPE, USER, {
        dispatcher_id: "u-2",
        carrier_id: "c-9",
      }),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * §25 bounds and query composition
 * ------------------------------------------------------------------ */

describe("§25 — every board read is bounded, counted and scoped", () => {
  it("issues a counted select against `shipments` with the lean projection", async () => {
    const { client, recorder } = createRecordingClient({ shipments: { data: [], count: 0 } });
    await getBoardColumn(client as never, column("in_transit"), {
      filters: EMPTY_FILTERS,
      scope: ADMIN_SCOPE,
      userId: USER,
      now: NOW,
    });
    const q = recorder.forTable("shipments")[0]!;
    expect(q.columns).toBe(SHIPMENT_BOARD_COLUMNS);
    expect(q.selectOptions).toEqual({ count: "exact" });
  });

  it("never selects a §18 staff-only financial column on the board", () => {
    for (const banned of [
      "gross_shipper_amount",
      "carrier_pay",
      "margin",
      "delay_reason_internal",
      "public_access_hash",
    ]) {
      expect(SHIPMENT_BOARD_COLUMNS).not.toContain(banned);
    }
  });

  it("bounds EVERY column read at MAX_PAGE_SIZE rows or fewer", async () => {
    for (const c of BOARD_COLUMNS) {
      const { client, recorder } = createRecordingClient({
        shipments: { data: [], count: 0 },
      });
      await getBoardColumn(client as never, c, {
        filters: EMPTY_FILTERS,
        scope: ADMIN_SCOPE,
        userId: USER,
        now: NOW,
        // A caller trying to widen the ceiling must not be able to.
        pageSize: 100_000,
      });
      const range = recorder.callsOf("range")[0];
      expect(range, `${c.id} issued no range()`).toBeDefined();
      const [from, to] = range!.args as [number, number];
      expect(to - from + 1).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    }
  });

  it("clamps a hand-edited ?page so it cannot become a huge OFFSET", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { data: [], count: 0 },
    });
    await getBoardColumn(client as never, column("completed"), {
      filters: EMPTY_FILTERS,
      scope: ADMIN_SCOPE,
      userId: USER,
      now: NOW,
      page: 10_000,
      pageSize: BOARD_PAGE_SIZE,
    });
    const [from] = recorder.callsOf("range")[0]!.args as [number, number];
    expect(from).toBe((10_000 - 1) * BOARD_PAGE_SIZE);
    expect(Number.isFinite(from)).toBe(true);
  });

  it("applies the scope BEFORE the column rule, and the filters after", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { data: [], count: 0 },
    });
    await getBoardColumn(client as never, column("in_transit"), {
      filters: { ...EMPTY_FILTERS, equipment: "Reefer" },
      scope: DISPATCHER_SCOPE,
      userId: USER,
      now: NOW,
    });
    const methods = recorder.forTable("shipments")[0]!.calls.map((c) => c.method);
    expect(methods).toEqual([
      "select",
      "or", // scope
      "in", // column
      "ilike", // filter
      "order",
      "order",
      "range",
    ]);
  });

  it("issues NO scope predicate for an admin", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { data: [], count: 0 },
    });
    await getBoardColumn(client as never, column("completed"), {
      filters: EMPTY_FILTERS,
      scope: ADMIN_SCOPE,
      userId: USER,
      now: NOW,
    });
    expect(recorder.callsOf("or")).toHaveLength(0);
  });

  it("orders on a TOTAL key so a row cannot appear on two pages", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { data: [], count: 0 },
    });
    await getBoardColumn(client as never, column("completed"), {
      filters: EMPTY_FILTERS,
      scope: ADMIN_SCOPE,
      userId: USER,
      now: NOW,
    });
    const orders = recorder.callsOf("order").map((c) => c.args[0]);
    expect(orders).toEqual(["created_at", "id"]);
  });

  it("reuses M-74's §11 filter builder verbatim — every filter reaches the query", async () => {
    const filters = parseShipmentFilters({
      status: "in_transit",
      origin: "Newark",
      destination: "Atlanta",
      equipment: "Reefer",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    const { client, recorder } = createRecordingClient({
      shipments: { data: [], count: 0 },
    });
    await getBoardColumn(client as never, column("in_transit"), {
      filters,
      scope: ADMIN_SCOPE,
      userId: USER,
      now: NOW,
    });
    const calls = recorder.forTable("shipments")[0]!.calls;
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "status")).toBe(true);
    expect(
      calls.some((c) => c.method === "ilike" && c.args[0] === "equipment"),
    ).toBe(true);
    expect(
      calls.filter((c) => c.method === "or" && String(c.args[0]).includes("origin_city")),
    ).toHaveLength(1);
    expect(
      calls.some((c) => c.method === "gte" && c.args[0] === "pickup_appointment_at"),
    ).toBe(true);
  });

  it("getBoard issues exactly eight queries — fixed, not proportional to rows", async () => {
    const { client, recorder } = createRecordingClient({
      shipments: { data: [], count: 0 },
    });
    await getBoard(client as never, {
      filters: EMPTY_FILTERS,
      scope: ADMIN_SCOPE,
      userId: USER,
      now: NOW,
    });
    expect(recorder.forTable("shipments")).toHaveLength(8);
    expect(recorder.tables()).toEqual(["shipments"]);
    // …each bounded at the small preview size, not the page size.
    for (const call of recorder.callsOf("range")) {
      const [from, to] = call.args as [number, number];
      expect(to - from + 1).toBe(BOARD_PREVIEW_SIZE);
    }
  });

  it("reports a failed read as FAILED, never as an empty column", async () => {
    const { client } = createRecordingClient({
      shipments: { data: null, error: { message: "boom" } },
    });
    const result = await getBoardColumn(client as never, column("delayed"), {
      filters: EMPTY_FILTERS,
      scope: ADMIN_SCOPE,
      userId: USER,
      now: NOW,
    });
    expect(result.failed).toBe(true);
    expect(result.total).toBeNull();
    expect(result.rows).toEqual([]);
  });

  it("computes pageCount from the exact count", async () => {
    const { client } = createRecordingClient({
      shipments: { data: [], count: 63 },
    });
    const result = await getBoardColumn(client as never, column("completed"), {
      filters: EMPTY_FILTERS,
      scope: ADMIN_SCOPE,
      userId: USER,
      now: NOW,
      pageSize: BOARD_PAGE_SIZE,
    });
    expect(result.total).toBe(63);
    expect(result.pageCount).toBe(3);
  });
});
