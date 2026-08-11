import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DELIVERY_DWELL_HOURS,
  ETA_ESTIMATE_METHOD,
  MAX_DRIVING_HOURS_PER_DAY,
  MAX_ESTIMABLE_MILES,
  PICKUP_DWELL_HOURS,
  PLANNING_SPEED_MPH,
  REST_HOURS_PER_RESET,
  SINGLE_DAY_MILES,
  describeEstimate,
  estimateConfidence,
  estimateEta,
} from "@/lib/shipments/eta-estimate";
import {
  DISPATCHER_ETA_SOURCES,
  ETA_CONFIDENCES,
  ETA_SOURCES,
  UNREACHABLE_ETA_SOURCES,
} from "@/lib/shipments/types";

/**
 * M-78 — the §10/§30 honesty tests for the ONE ETA source this module makes
 * real, and for the one it deliberately leaves unreachable.
 *
 * The most important test in this file is the LAST one: the partition proof.
 * `calculated` is only an honest label while something actually calculates,
 * and `provider` is only an honest omission while nothing pretends to. Both
 * facts live in `types.ts` as data, and the partition assertion is what stops
 * a future module widening one without moving the other.
 */

const DEPART = "2026-08-05T12:00:00.000Z";

function hoursBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

function ok(distance: number, departAt: string = DEPART) {
  const result = estimateEta(distance, departAt);
  if (!result.ok) throw new Error(`expected an estimate, got ${result.reason}`);
  return result;
}

/* ------------------------------------------------------------------ *
 * 1. The method does what it says
 * ------------------------------------------------------------------ */

describe("the stated method (§10, §30)", () => {
  it("is distance ÷ planning speed, plus dwell, for a single driving day", () => {
    // 400 mi ÷ 50 mph = 8 h driving, under the 11 h limit, so NO reset.
    const estimate = ok(400);
    expect(estimate.drivingHours).toBe(8);
    expect(estimate.restHours).toBe(0);
    expect(estimate.dwellHours).toBe(
      PICKUP_DWELL_HOURS + DELIVERY_DWELL_HOURS,
    );
    expect(estimate.totalHours).toBe(12);
    expect(hoursBetween(DEPART, estimate.etaAt)).toBeCloseTo(12, 5);
  });

  it("adds one 10-hour reset once the drive exceeds a duty day", () => {
    // 600 mi = 12 h driving = one full 11 h day plus 1 h, so ONE reset.
    const estimate = ok(600);
    expect(estimate.drivingHours).toBe(12);
    expect(estimate.restHours).toBe(REST_HOURS_PER_RESET);
    expect(estimate.totalHours).toBe(12 + REST_HOURS_PER_RESET + 4);
  });

  it("adds NO reset at exactly one duty day — the driver arrives before the clock runs out", () => {
    const estimate = ok(SINGLE_DAY_MILES); // 550 mi = exactly 11 h
    expect(estimate.drivingHours).toBe(MAX_DRIVING_HOURS_PER_DAY);
    expect(estimate.restHours).toBe(0);
  });

  it("adds two resets on a genuine two-and-a-bit-day lane", () => {
    // 1 400 mi = 28 h driving = two full 11 h days plus 6 h → two resets.
    const estimate = ok(1400);
    expect(estimate.drivingHours).toBe(28);
    expect(estimate.restHours).toBe(2 * REST_HOURS_PER_RESET);
  });

  it("rounds LATE, never early — an early arrival is a good surprise", () => {
    const estimate = ok(401); // 8.02 h → not a 5-minute boundary
    expect(new Date(estimate.etaAt).getTime()).toBeGreaterThanOrEqual(
      new Date(DEPART).getTime() + 12.02 * 3_600_000,
    );
    expect(new Date(estimate.etaAt).getUTCMinutes() % 5).toBe(0);
  });

  it("is deterministic — the same inputs give the same answer forever", () => {
    expect(estimateEta(720, DEPART)).toEqual(estimateEta(720, DEPART));
  });

  it("accepts a Date as readily as an ISO string", () => {
    expect(estimateEta(300, new Date(DEPART))).toEqual(estimateEta(300, DEPART));
  });

  it("reports every assumption as data, so no surface has to spell it twice", () => {
    expect(ok(300).assumptions).toEqual({
      planningSpeedMph: PLANNING_SPEED_MPH,
      maxDrivingHoursPerDay: MAX_DRIVING_HOURS_PER_DAY,
      restHoursPerReset: REST_HOURS_PER_RESET,
      pickupDwellHours: PICKUP_DWELL_HOURS,
      deliveryDwellHours: DELIVERY_DWELL_HOURS,
    });
    expect(ok(300).method).toBe(ETA_ESTIMATE_METHOD);
  });
});

/* ------------------------------------------------------------------ *
 * 2. It REFUSES rather than inventing (§26, §30)
 * ------------------------------------------------------------------ */

describe("refusals — no fallback distance exists (§26, §30)", () => {
  it("refuses a null distance", () => {
    expect(estimateEta(null, DEPART)).toEqual({
      ok: false,
      reason: "no_distance",
    });
  });

  it("refuses an undefined distance", () => {
    expect(estimateEta(undefined, DEPART)).toEqual({
      ok: false,
      reason: "no_distance",
    });
  });

  it.each([0, -1, -500, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s as a distance rather than treating it as a short trip",
    (distance) => {
      expect(estimateEta(distance, DEPART)).toEqual({
        ok: false,
        reason: "distance_out_of_range",
      });
    },
  );

  it("refuses a distance beyond the longest plausible lane", () => {
    expect(estimateEta(MAX_ESTIMABLE_MILES + 1, DEPART).ok).toBe(false);
    expect(estimateEta(MAX_ESTIMABLE_MILES, DEPART).ok).toBe(true);
  });

  it("refuses an unparseable departure", () => {
    expect(estimateEta(400, "not a date")).toEqual({
      ok: false,
      reason: "invalid_departure",
    });
  });

  it("NON-VACUITY: the module contains no fallback distance at all", () => {
    // The failure this guards against is somebody "helpfully" defaulting a
    // missing mileage, which turns a refusal into the fake ETA §30 forbids.
    const source = readFileSync("src/lib/shipments/eta-estimate.ts", "utf8");
    expect(source).not.toMatch(/distanceMiles\s*\?\?\s*\d/);
    expect(source).not.toMatch(/DEFAULT_DISTANCE/);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Confidence is capped, and that is the §30 claim
 * ------------------------------------------------------------------ */

describe("eta_confidence (§10, §30)", () => {
  it("never returns `high` at any distance in range", () => {
    for (let miles = 1; miles <= MAX_ESTIMABLE_MILES; miles += 37) {
      expect(estimateConfidence(miles)).not.toBe("high");
    }
  });

  it("is `medium` inside one driving day and `low` beyond it", () => {
    expect(estimateConfidence(SINGLE_DAY_MILES)).toBe("medium");
    expect(estimateConfidence(SINGLE_DAY_MILES + 1)).toBe("low");
    expect(estimateConfidence(1)).toBe("medium");
    expect(estimateConfidence(3000)).toBe("low");
  });

  it("only ever returns a value M-70's enum has", () => {
    for (const miles of [1, 100, 550, 551, 2000]) {
      expect(ETA_CONFIDENCES).toContain(estimateConfidence(miles));
    }
    expect(ETA_CONFIDENCES).toContain(ok(700).confidence);
  });

  it("NON-VACUITY: `high` exists in the enum, so the cap is a choice", () => {
    expect(ETA_CONFIDENCES).toContain("high");
  });
});

/* ------------------------------------------------------------------ *
 * 4. The internal description says what it is and what it is not
 * ------------------------------------------------------------------ */

describe("describeEstimate — the staff audit trail (§24: internal, English)", () => {
  it("names the method, the inputs and the legal basis for the rest", () => {
    const text = describeEstimate(ok(600));
    expect(text).toContain(ETA_ESTIMATE_METHOD);
    expect(text).toContain("600 mi");
    expect(text).toContain(`${PLANNING_SPEED_MPH} mph`);
    expect(text).toContain("49 CFR 395.3");
  });

  it("says out loud what it is NOT — §30's rule applied to the audit trail", () => {
    const text = describeEstimate(ok(600));
    expect(text).toContain("not a prediction");
    expect(text.toLowerCase()).toContain("not traffic-");
  });

  it("never uses a word that would claim intelligence it does not have", () => {
    const text = describeEstimate(ok(600)).toLowerCase();
    for (const forbidden of ["ai", "machine learning", "predictive", "smart"]) {
      // Word-boundary match: "ai" must not appear as a word (it may appear
      // inside "available", which is not a claim).
      expect(text).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

/* ------------------------------------------------------------------ *
 * 5. THE PARTITION — which sources are real, as an enforced fact
 * ------------------------------------------------------------------ */

describe("§30 — real sources vs deliberately unreachable ones", () => {
  it("partitions ETA_SOURCES exactly: every source is reachable or named unreachable", () => {
    const union = [...DISPATCHER_ETA_SOURCES, ...UNREACHABLE_ETA_SOURCES];
    expect([...union].sort()).toEqual([...ETA_SOURCES].sort());
    // No overlap: a source cannot be both offered and unreachable.
    expect(new Set(union).size).toBe(union.length);
  });

  it("offers `calculated`, because THIS MODULE is what makes it real", () => {
    expect(DISPATCHER_ETA_SOURCES).toContain("calculated");
    expect(estimateEta(400, DEPART).ok).toBe(true);
  });

  it("leaves `provider` unreachable — no adapter exists (M-80 owns them)", () => {
    expect(UNREACHABLE_ETA_SOURCES).toContain("provider");
    expect(DISPATCHER_ETA_SOURCES).not.toContain("provider");
  });

  it("NON-VACUITY: nothing in src/ writes eta_source `provider`", () => {
    // The partition above is a statement about a constant; this is the
    // statement about the code. A future provider adapter must move the value
    // between the two lists in the same commit that makes it true.
    const eta = readFileSync("src/lib/shipments/eta.ts", "utf8");
    expect(eta).not.toMatch(/etaSource:\s*["']provider["']/);
    expect(eta).not.toMatch(/p_eta_source:\s*["']provider["']/);
  });

  it("keeps the honest label distinct: calculated is not 'provided by dispatcher'", () => {
    // The two claims are different sentences in five catalogues. A calculated
    // ETA rendered under the dispatcher label would be a lie in the other
    // direction, which is why M-78 added a seventh label rather than reusing
    // one of §30's six.
    for (const locale of ["en", "es", "fr", "ht", "ru"]) {
      const messages = JSON.parse(
        readFileSync(`messages/${locale}.json`, "utf8"),
      ) as { shipment: { label: Record<string, string> } };
      expect(messages.shipment.label.eta_estimated).toBeTruthy();
      expect(messages.shipment.label.eta_estimated).not.toBe(
        messages.shipment.label.eta_by_dispatcher,
      );
    }
  });
});
