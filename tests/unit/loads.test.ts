import { describe, expect, it } from "vitest";
import type { LoadStatus } from "@/lib/supabase/database.types";
import {
  formatLane,
  formatMoney,
  formatRpm,
  LOAD_STATUSES,
  LOAD_TRANSITIONS,
} from "@/lib/loads";

describe("load status machine", () => {
  it("allows the arch happy path booked → … → paid", () => {
    expect(LOAD_TRANSITIONS.booked).toContain("in_transit");
    expect(LOAD_TRANSITIONS.in_transit).toContain("delivered");
    expect(LOAD_TRANSITIONS.delivered).toContain("invoiced");
    expect(LOAD_TRANSITIONS.invoiced).toContain("paid");
  });

  it("allows cancellation only until money moves", () => {
    expect(LOAD_TRANSITIONS.booked).toContain("cancelled");
    expect(LOAD_TRANSITIONS.in_transit).toContain("cancelled");
    expect(LOAD_TRANSITIONS.delivered).toContain("cancelled");
    expect(LOAD_TRANSITIONS.invoiced).not.toContain("cancelled");
  });

  it("treats paid and cancelled as terminal", () => {
    expect(LOAD_TRANSITIONS.paid).toHaveLength(0);
    expect(LOAD_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it("forbids skipping and reversing states", () => {
    const illegal: Array<[LoadStatus, LoadStatus]> = [
      ["booked", "delivered"],
      ["booked", "paid"],
      ["in_transit", "booked"],
      ["in_transit", "invoiced"],
      ["delivered", "paid"],
      ["invoiced", "in_transit"],
      ["paid", "booked"],
      ["cancelled", "booked"],
    ];
    for (const [from, to] of illegal) {
      expect(
        LOAD_TRANSITIONS[from],
        `${from} → ${to} must be illegal`,
      ).not.toContain(to);
    }
  });

  it("defines transitions for every status exactly once", () => {
    expect(Object.keys(LOAD_TRANSITIONS).sort()).toEqual(
      [...LOAD_STATUSES].sort(),
    );
  });
});

describe("display helpers", () => {
  it("formatMoney renders USD and an em-dash for null", () => {
    expect(formatMoney(2450)).toBe("$2,450.00");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(null)).toBe("—");
  });

  it("formatRpm divides gross by miles, guarding zero/null", () => {
    expect(formatRpm(2450, 1000)).toBe("$2.45/mi");
    expect(formatRpm(2450, 0)).toBe("—");
    expect(formatRpm(null, 1000)).toBe("—");
    expect(formatRpm(2450, null)).toBe("—");
  });

  it("formatLane joins city/state pairs with fallbacks", () => {
    expect(
      formatLane({
        origin_city: "Newark",
        origin_state: "NJ",
        dest_city: "Chicago",
        dest_state: "IL",
      }),
    ).toBe("Newark, NJ → Chicago, IL");
    expect(
      formatLane({
        origin_city: null,
        origin_state: "NJ",
        dest_city: null,
        dest_state: null,
      }),
    ).toBe("NJ → —");
  });
});
