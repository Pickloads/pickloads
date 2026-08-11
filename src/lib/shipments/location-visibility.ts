import {
  SHIPMENT_LOCATION_VISIBILITIES,
  type ShipmentLocationVisibility,
} from "@/lib/shipments/types";

/**
 * M-80 — the WRITE side of §9's four privacy levels.
 *
 * M-70 shipped the read side: `dto.ts` resolves a level into what each
 * audience receives, and its own doc says *"M-80 decides per-event coordinate
 * disclosure"*. This module is the other half — who may move the dial, and in
 * which direction.
 *
 * Pure. The authoritative enforcement is 0027's
 * `set_shipment_location_visibility()`, which applies the identical rank
 * comparison inside the database; this file exists so the dispatcher UI can
 * draw the right controls and the server action can refuse before a round
 * trip, not so the rule lives in two places with one of them decorative.
 *
 * ── THE RULE, AND WHY IT IS NOT SIMPLY "STAFF" ───────────────────────────
 *
 * §15 puts *"control public tracking visibility"* on the ADMIN list. §14's
 * dispatcher list does not mention it at all. Read literally that would make
 * a dispatcher unable to turn a map OFF when a shipper phones and asks —
 * which is the privacy-increasing action, and making that one the slow one is
 * backwards.
 *
 * So the rule is directional:
 *
 *   * NARROWING (toward `hidden`) — any in-scope dispatcher. It only ever
 *     discloses less.
 *   * WIDENING (toward `exact`) — ADMIN ONLY. `exact` is the setting §9
 *     spends its warning paragraph on, and widening is the only direction in
 *     which a mistake discloses something.
 *
 * `approximate` is the per-shipment default (0017's column default, chosen by
 * M-71 for the same privacy-first reason), so the un-touched state of every
 * shipment is city/state and never coordinates.
 */

/** Most revealing to least. `exact` is 3 so "greater rank ⇒ wider". */
export const LOCATION_VISIBILITY_RANK: Record<ShipmentLocationVisibility, number> =
  {
    exact: 3,
    approximate: 2,
    milestone_only: 1,
    hidden: 0,
  };

/** The per-shipment default. Mirrors 0017's `default 'approximate'`. */
export const DEFAULT_LOCATION_VISIBILITY: ShipmentLocationVisibility =
  "approximate";

export type LocationVisibilityActor = "admin" | "dispatcher";

export type LocationVisibilityRefusal =
  | "unchanged"
  | "widening_requires_admin"
  | "unknown_level";

export interface LocationVisibilityDecision {
  allowed: boolean;
  refusal: LocationVisibilityRefusal | null;
  widening: boolean;
}

export function isLocationVisibility(
  value: unknown,
): value is ShipmentLocationVisibility {
  return (
    typeof value === "string" &&
    (SHIPMENT_LOCATION_VISIBILITIES as readonly string[]).includes(value)
  );
}

/**
 * May this actor move this shipment from `current` to `next`?
 *
 * Returns a decision rather than a boolean so the caller can say WHY — the
 * same reason M-72's engine returns typed refusals. "You cannot do that" with
 * no reason produces a support ticket; "widening to exact is an admin action"
 * produces the right next step.
 */
export function mayChangeLocationVisibility(
  actor: LocationVisibilityActor,
  current: ShipmentLocationVisibility,
  next: unknown,
): LocationVisibilityDecision {
  if (!isLocationVisibility(next)) {
    return { allowed: false, refusal: "unknown_level", widening: false };
  }
  if (next === current) {
    return { allowed: false, refusal: "unchanged", widening: false };
  }
  const widening =
    LOCATION_VISIBILITY_RANK[next] > LOCATION_VISIBILITY_RANK[current];
  if (widening && actor !== "admin") {
    return { allowed: false, refusal: "widening_requires_admin", widening };
  }
  return { allowed: true, refusal: null, widening };
}

export const LOCATION_VISIBILITY_REFUSAL_MESSAGES: Record<
  LocationVisibilityRefusal,
  string
> = {
  unchanged: "That is already this shipment's location visibility.",
  widening_requires_admin:
    "Showing more of a truck's position is an admin action. Ask an admin to widen it, or choose a narrower level.",
  unknown_level: "That is not a location visibility level.",
};

/**
 * §9's four levels as operator-facing copy for the dispatcher control.
 *
 * Deliberately NOT in the i18n catalogue: `/portal/admin` is an English-only
 * staff surface (M-75's decision, applied to every dispatcher form in
 * `ShipmentOpsForms.tsx`), while every CUSTOMER-facing string M-80 adds is
 * translated ×5. Mixing the two would put staff jargon in five dictionaries.
 */
export const LOCATION_VISIBILITY_LABELS: Record<
  ShipmentLocationVisibility,
  { label: string; help: string }
> = {
  exact: {
    label: "Exact position",
    help: "Coordinates and speed to the shipper, carrier and broker. The PUBLIC tracking page is still capped at city and state (§9).",
  },
  approximate: {
    label: "Approximate (city / state)",
    help: "The default. City and state and the update time. No coordinates to anybody but staff.",
  },
  milestone_only: {
    label: "Milestone only",
    help: "No position at all. Progress is told through the timeline.",
  },
  hidden: {
    label: "Hidden",
    help: "No position and no location panel. Use when a shipper asks for the map to be switched off.",
  },
};
