/**
 * M-78 — the ONE thing that makes `eta_source = 'calculated'` an honest label.
 *
 * ── READ THIS BEFORE CHANGING ANYTHING HERE ───────────────────────────────
 *
 * §30: *"Do not display fake ETAs … Do not call the tracking system
 * 'AI-powered' unless real AI functionality is implemented and validated."*
 * §10: *"Do not claim AI-powered or live predictive ETA unless it is truly
 * implemented and supported by real data."*
 *
 * M-75 read those two sentences and deliberately withheld `calculated` from
 * the dispatcher form, because a dropdown offering a value nothing computed
 * would let an operator relabel a typed guess. That was correct then. This
 * module is what changes it — not by relaxing the rule, but by building the
 * thing the rule was protecting.
 *
 * WHAT THIS IS: arithmetic over a distance, with every assumption named and
 * every assumption checkable by a dispatcher who disagrees with it.
 *
 * WHAT THIS IS NOT, stated so nobody has to guess:
 *   * NOT a prediction. It does not learn, does not look at history, does not
 *     use a model, and returns the same answer for the same inputs forever.
 *   * NOT traffic-aware, weather-aware or road-aware. It has no map. It has a
 *     mileage number somebody else supplied.
 *   * NOT live. Nothing recomputes it when the truck moves; a dispatcher asks
 *     for it, looks at it, and saves it or does not.
 *   * NOT AI, and the word appears in no string this module produces.
 *
 * The customer-facing label for a value from here is
 * `shipment.label.eta_estimated` — *"Estimated from distance and standard
 * transit times"* — which is a different sentence from §30's *"ETA provided by
 * dispatcher"* precisely because it is a different claim. Rendering a computed
 * ETA under the dispatcher label would be the dishonesty §30 forbids in the
 * opposite direction.
 *
 * ── THE METHOD, IN FULL ───────────────────────────────────────────────────
 *
 *   driving hours   = distance ÷ PLANNING_SPEED_MPH
 *   full duty days  = ⌊driving hours ÷ MAX_DRIVING_HOURS_PER_DAY⌋
 *   total hours     = driving hours
 *                   + full duty days × REST_HOURS_PER_RESET
 *                   + PICKUP_DWELL_HOURS + DELIVERY_DWELL_HOURS
 *   eta             = departure + total hours
 *
 * Each constant is sourced below. There is no fitted parameter, no fudge
 * factor and no rounding that flatters the answer — `Math.ceil` to the next
 * five minutes is the only rounding, and it rounds LATE, because an ETA that
 * arrives early is a good surprise and one that arrives late is a complaint.
 *
 * ── CONFIDENCE IS CAPPED AT `medium`, ON PURPOSE ──────────────────────────
 *
 * §10 names `eta_confidence` but not its domain; M-70 chose three bands. This
 * module never returns `high`. `high` is what an OBSERVED ETA deserves — a
 * provider feed, a driver at the dock — and nothing in this product produces
 * one yet. A calculator that graded its own output as high confidence would be
 * making exactly the claim §30 forbids, in a field instead of in a sentence.
 *
 * Pure module by design (no `server-only`): the dispatcher form previews the
 * estimate as the operator types, and the server recomputes it before writing.
 * A second copy of these constants in client code is the drift M-70 exists to
 * prevent. The SERVER's number is the one that is stored — see
 * `src/lib/shipments/eta.ts`, which discards the submitted datetime entirely
 * when the source is `calculated`.
 */

import type { EtaConfidence } from "@/lib/shipments/types";

/* ------------------------------------------------------------------ *
 * The assumptions, each with its source
 * ------------------------------------------------------------------ */

/**
 * 49 CFR §395.3(a)(3)(i) — a property-carrying driver may drive a maximum of
 * 11 hours after 10 consecutive hours off duty. This is law, not a guess.
 */
export const MAX_DRIVING_HOURS_PER_DAY = 11;

/**
 * 49 CFR §395.3(a)(1) — the 10 consecutive hours off duty that must precede
 * the next driving period. Added once per full driving day consumed.
 */
export const REST_HOURS_PER_RESET = 10;

/**
 * Planning speed, mph. NOT a speed limit and not an average of speed limits:
 * it is distance ÷ elapsed driving time, so it absorbs fuel stops, scales,
 * urban approaches, construction and the fact that a governed truck does not
 * run at 70. 50 mph is the conservative end of the 45–55 range the industry
 * plans with, and conservative is the correct direction for a number a
 * customer will hold us to.
 */
export const PLANNING_SPEED_MPH = 50;

/**
 * Dock dwell. Two hours at each end is the free time before detention accrues
 * in a standard rate confirmation — the same 2-hour figure the carrier
 * management playbook records as the norm — so it is the shortest dwell it is
 * honest to plan for.
 */
export const PICKUP_DWELL_HOURS = 2;
export const DELIVERY_DWELL_HOURS = 2;

/** Below this, a shipment is a single driving day and no reset applies. */
export const SINGLE_DAY_MILES = MAX_DRIVING_HOURS_PER_DAY * PLANNING_SPEED_MPH;

/**
 * Refusals. A distance of zero or a negative distance is not a short trip, it
 * is bad data, and computing an ETA from it would publish a fiction.
 */
export const MIN_ESTIMABLE_MILES = 1;
/** Roughly twice the longest lower-48 lane. Beyond it, the input is wrong. */
export const MAX_ESTIMABLE_MILES = 6000;

const MS_PER_HOUR = 3_600_000;
const ROUNDING_MINUTES = 5;

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

/** Machine-readable identifier for the method, stored on the history row. */
export const ETA_ESTIMATE_METHOD = "distance_hos_v1";

export type EtaEstimateRefusal =
  /** `shipments.distance_miles` is null — nothing to compute from. */
  | "no_distance"
  /** Zero, negative, non-finite, or beyond `MAX_ESTIMABLE_MILES`. */
  | "distance_out_of_range"
  /** The departure timestamp was unparseable. */
  | "invalid_departure";

export interface EtaEstimate {
  ok: true;
  /** ISO 8601. The value `set_shipment_eta` stores. */
  etaAt: string;
  /** Never `high`. See the module header. */
  confidence: EtaConfidence;
  method: typeof ETA_ESTIMATE_METHOD;
  distanceMiles: number;
  drivingHours: number;
  restHours: number;
  dwellHours: number;
  totalHours: number;
  /**
   * The assumptions, as data, so the surface that renders the estimate and
   * the history row that stores it say the same thing without either of them
   * spelling a sentence twice.
   */
  assumptions: {
    planningSpeedMph: number;
    maxDrivingHoursPerDay: number;
    restHoursPerReset: number;
    pickupDwellHours: number;
    deliveryDwellHours: number;
  };
}

export interface EtaEstimateFailure {
  ok: false;
  reason: EtaEstimateRefusal;
}

export type EtaEstimateResult = EtaEstimate | EtaEstimateFailure;

/* ------------------------------------------------------------------ *
 * The calculation
 * ------------------------------------------------------------------ */

/**
 * Estimate an arrival time from a distance and a departure time.
 *
 * Returns a REFUSAL rather than a fallback when it cannot compute honestly.
 * There is no "assume 500 miles" branch: §26 names `eta_calculation_failure`
 * as a tracked signal precisely so a refusal is visible, and a made-up
 * distance would be the fake ETA §30 forbids wearing a calculated label.
 *
 * `departAt` defaults to now, which is what "when will it get there if it
 * leaves now" means. A pickup ETA in the future is the caller's to pass.
 */
export function estimateEta(
  distanceMiles: number | null | undefined,
  departAt: Date | string = new Date(),
): EtaEstimateResult {
  if (distanceMiles === null || distanceMiles === undefined) {
    return { ok: false, reason: "no_distance" };
  }
  if (
    !Number.isFinite(distanceMiles) ||
    distanceMiles < MIN_ESTIMABLE_MILES ||
    distanceMiles > MAX_ESTIMABLE_MILES
  ) {
    return { ok: false, reason: "distance_out_of_range" };
  }

  const departure =
    typeof departAt === "string" ? new Date(departAt) : departAt;
  if (Number.isNaN(departure.getTime())) {
    return { ok: false, reason: "invalid_departure" };
  }

  const drivingHours = distanceMiles / PLANNING_SPEED_MPH;
  /*
   * `ceil − 1`, not `floor`, and the off-by-one is load-bearing.
   *
   * A reset happens BETWEEN duty days, so the count is the number of gaps and
   * not the number of days. A drive of exactly 11 h fits one duty period and
   * needs NO reset — the driver arrives before the clock runs out. `floor`
   * would charge that trip a full 10 hours it never spends, which is a
   * pessimistic ETA rather than a wrong one, but wrong in a way that would
   * compound at every multiple of 11.
   */
  const resets = Math.max(
    0,
    Math.ceil(drivingHours / MAX_DRIVING_HOURS_PER_DAY) - 1,
  );
  const restHours = resets * REST_HOURS_PER_RESET;
  const dwellHours = PICKUP_DWELL_HOURS + DELIVERY_DWELL_HOURS;
  const totalHours = drivingHours + restHours + dwellHours;

  const rawMs = departure.getTime() + totalHours * MS_PER_HOUR;
  // Round UP to the next five minutes. Late, never early — see the header.
  const stepMs = ROUNDING_MINUTES * 60_000;
  const etaMs = Math.ceil(rawMs / stepMs) * stepMs;

  return {
    ok: true,
    etaAt: new Date(etaMs).toISOString(),
    confidence: estimateConfidence(distanceMiles),
    method: ETA_ESTIMATE_METHOD,
    distanceMiles,
    drivingHours,
    restHours,
    dwellHours,
    totalHours,
    assumptions: {
      planningSpeedMph: PLANNING_SPEED_MPH,
      maxDrivingHoursPerDay: MAX_DRIVING_HOURS_PER_DAY,
      restHoursPerReset: REST_HOURS_PER_RESET,
      pickupDwellHours: PICKUP_DWELL_HOURS,
      deliveryDwellHours: DELIVERY_DWELL_HOURS,
    },
  };
}

/**
 * `medium` for one driving day, `low` beyond it. Never `high`.
 *
 * The band boundary is not arbitrary: inside `SINGLE_DAY_MILES` the answer
 * depends on one driver's one shift and the error is bounded by dock dwell.
 * Past it, every additional day compounds a 10-hour reset the driver takes
 * when THEY choose, and the method's ignorance of that choice grows with the
 * distance. Saying so in a field is cheaper than saying so in a footnote.
 */
export function estimateConfidence(distanceMiles: number): EtaConfidence {
  return distanceMiles <= SINGLE_DAY_MILES ? "medium" : "low";
}

/**
 * The method, as one internal sentence for the ETA history's
 * `reason_internal`. English and staff-only by design — §24 exempts internal
 * staff notes from translation, and this is the audit trail for "where did
 * that number come from?", not a customer string.
 */
export function describeEstimate(estimate: EtaEstimate): string {
  const hours = (n: number) => `${Math.round(n * 10) / 10}h`;
  return (
    `Calculated (${ETA_ESTIMATE_METHOD}): ${estimate.distanceMiles} mi ` +
    `at ${PLANNING_SPEED_MPH} mph = ${hours(estimate.drivingHours)} driving, ` +
    `+${hours(estimate.restHours)} required rest (49 CFR 395.3), ` +
    `+${hours(estimate.dwellHours)} dock dwell = ${hours(estimate.totalHours)} total. ` +
    `Not traffic-, weather- or route-aware; not a prediction.`
  );
}
