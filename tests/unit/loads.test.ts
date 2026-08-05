import { describe, expect, it } from "vitest";
import type { LoadStatus } from "@/lib/supabase/database.types";
import {
  formatLane,
  formatMoney,
  formatLoadedRpm,
  formatTrueRpm,
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

  /*
   * M-69/P-7. The RENAME is the fix: the value is unchanged (M-69 relabels,
   * it never silently moves a number under an operator), but the name now
   * says which miles it divides by.
   */
  it("formatLoadedRpm divides gross by LOADED miles, guarding zero/null", () => {
    expect(formatLoadedRpm(2450, 1000)).toBe("$2.45/mi");
    expect(formatLoadedRpm(2450, 0)).toBe("—");
    expect(formatLoadedRpm(null, 1000)).toBe("—");
    expect(formatLoadedRpm(2450, null)).toBe("—");
  });

  it("formatTrueRpm divides gross by deadhead + loaded miles", () => {
    // 2450 / (1000 + 225) = 2.0 — materially below the 2.45 "RPM" the
    // board showed before M-69. That gap is the whole defect.
    expect(formatTrueRpm(2450, 1000, 225)).toBe("$2.00/mi");
    // Zero deadhead is a real answer (truck was already there), not "unknown".
    expect(formatTrueRpm(2450, 1000, 0)).toBe("$2.45/mi");
  });

  it("formatTrueRpm renders — when deadhead was never captured", () => {
    // Critically: it must NOT fall back to the loaded figure, which would
    // re-create the exact mislabel P-7 fixes.
    expect(formatTrueRpm(2450, 1000, null)).toBe("—");
    expect(formatTrueRpm(null, 1000, 100)).toBe("—");
    expect(formatTrueRpm(2450, null, 100)).toBe("—");
    expect(formatTrueRpm(2450, 0, 0)).toBe("—");
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
