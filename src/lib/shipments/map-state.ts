import type {
  ShipmentLocationVisibility,
  ShipmentTrackingMode,
} from "@/lib/shipments/types";

/**
 * M-80 — which of §30's honest labels a location panel is allowed to show,
 * and whether the map may mount at all.
 *
 * Pure, so the rule is provable without a browser and cannot differ between
 * `/track`, the shipper portal and the dispatcher page — which is exactly how
 * a "Live location available" badge ends up on a shipment nobody is tracking.
 *
 * ── §30's THREE LABELS, AND WHEN EACH IS TRUE ────────────────────────────
 *
 *   "Live location available"        — there is a real coordinate AND the
 *                                      shipment is on a live source
 *                                      (`tracking_mode` ≠ `manual`, i.e. a
 *                                      Mode B link or a Mode C connection).
 *   "Milestone tracking"             — there is a place (a city/state an
 *                                      operator recorded) but no live source.
 *                                      **This is the state of every PickLoads
 *                                      shipment today**, because no provider
 *                                      is connected.
 *   "Location temporarily unavailable" — nothing to show.
 *
 * ── WHY `hidden` AND `milestone_only` COLLAPSE INTO ONE STATE ────────────
 *
 * They render identically, and deliberately. M-70's DTO nulls values rather
 * than removing keys so the privacy setting is not itself a signal; a panel
 * that said "the shipper has hidden this" would undo that in the markup. Both
 * render the neutral "temporarily unavailable"/"milestone" wording a shipment
 * with no readings would show.
 */

export type LocationPanelState = "live" | "milestone" | "unavailable";

export interface LocationPanelInput {
  level: ShipmentLocationVisibility;
  trackingMode: ShipmentTrackingMode;
  /** Any disclosed coordinate pair — current position or a history reading. */
  hasCoordinates: boolean;
  /** Any disclosed city or state. */
  hasPlace: boolean;
}

export function resolveLocationPanelState(
  input: LocationPanelInput,
): LocationPanelState {
  if (input.level === "hidden" || input.level === "milestone_only") {
    return "unavailable";
  }
  // A live claim needs BOTH a live source and a real position. M-73 shipped
  // this rule for the header badge; M-80 is where it becomes shared code
  // rather than the same three lines in three components.
  if (input.hasCoordinates && input.trackingMode !== "manual") return "live";
  if (input.hasPlace || input.hasCoordinates) return "milestone";
  return "unavailable";
}

/** The i18n key each state renders. §30's wording, M-73's catalogue. */
export const LOCATION_PANEL_LABEL_KEY: Record<LocationPanelState, string> = {
  live: "shipment.label.live_location_available",
  milestone: "shipment.label.milestone_tracking",
  unavailable: "shipment.label.location_unavailable",
};

/**
 * May the map component mount?
 *
 * ONLY in the `live` state, and only with at least one plotted point. A map
 * drawn from a single manually typed city would be a picture of a guess —
 * §30's "do not display fake GPS positions" applies to a marker placed at a
 * city centroid just as much as to an invented coordinate.
 *
 * With no provider connected this returns `false` for every customer-facing
 * shipment in the product today, which is the honest outcome and the reason
 * the accessible text equivalent — not the map — is the primary surface.
 */
export function mapMayMount(
  state: LocationPanelState,
  plottablePoints: number,
): boolean {
  return state === "live" && plottablePoints >= 1;
}
