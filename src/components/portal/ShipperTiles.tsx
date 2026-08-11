"use client";

import { useV4 } from "@/i18n/v4";
import type {
  ShipperTileCounts,
  ShipperTileId,
} from "@/lib/shipments/shipper-tiles";

/**
 * M-74 — §11's dashboard summary tiles, rendered.
 *
 * ── "NO FAKE METRICS", CONCRETELY ─────────────────────────────────────────
 *
 * §11 ends: *"No fake metrics. Use zero-data and empty states."* Three rules
 * follow from that and are implemented here rather than described:
 *
 *   * A count of `null` renders an em-dash and its own sub-label, never `0`.
 *     `null` is "we did not measure this" — the query errored, or (before
 *     M-77) the table did not exist. Rendering either as a zero would state a
 *     fact nobody checked. Since M-77 every tile including
 *     `documents_awaiting_review` has a real source, so `null` here now means
 *     one thing only: the read failed.
 *   * A genuine `0` renders as `0`. That is the zero-data state §11 asks for,
 *     and it is honest: the query ran and found nothing.
 *   * Nothing here is derived from another tile. Every number is its own
 *     count against its own predicate.
 *
 * §23: the em-dash carries a `title`/sub-label in words, so the state is not
 * conveyed by a glyph alone.
 */

const TILE_LABEL: Record<ShipperTileId, string> = {
  booked: "Booked",
  pickups_today: "Pickups today",
  in_transit: "In transit",
  delayed: "Delayed",
  deliveries_today: "Deliveries today",
  completed: "Completed",
  documents_awaiting_review: "Documents awaiting review",
  outstanding_invoices: "Outstanding invoices",
};

/** Tiles whose non-zero value is a problem, not an achievement. */
const WARN_TILES: readonly ShipperTileId[] = [
  "delayed",
  "outstanding_invoices",
];
const GOOD_TILES: readonly ShipperTileId[] = ["in_transit", "completed"];

export function ShipperTiles({
  counts,
  ids,
}: {
  counts: ShipperTileCounts;
  ids: readonly ShipperTileId[];
}) {
  const tv = useV4();
  return (
    <div className="ptiles">
      {ids.map((id) => {
        const value = counts[id];
        const tone =
          value === null || value === 0
            ? ""
            : WARN_TILES.includes(id)
              ? "warn"
              : GOOD_TILES.includes(id)
                ? "good"
                : "";
        return (
          <div key={id} className={`ptile ${tone}`.trim()}>
            <b aria-hidden={value === null ? "true" : undefined}>
              {value === null ? "—" : value}
            </b>
            <span>{tv(TILE_LABEL[id])}</span>
            {value === null ? (
              <span className="sub">{tv("Not available right now")}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
