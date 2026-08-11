import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { ShipmentStatus } from "@/lib/shipments/types";
import { OUTSTANDING_INVOICE_STATUSES } from "@/lib/shipments/shipper-detail";
import type { FilterableQuery } from "@/lib/shipments/shipper-list";

/**
 * M-74 — §11's dashboard summary tiles for the shipper overview.
 *
 * §11 names nine: pending quotes · booked shipments · pickups today ·
 * in-transit · delayed · deliveries today · completed · documents awaiting
 * review · outstanding invoices. Then: *"No fake metrics. Use zero-data and
 * empty states."*
 *
 * ── HOW THE NINE ARE SOURCED, AND THE TWO THAT ARE NOT COUNTS ─────────────
 *
 * **pending quotes** is NOT computed here. `/portal/shipper` has shipped a
 * "Pending review" tile since M-56, derived from `freight_quotes` through
 * `getShipperQuotes`. §11's requirement is already met by it, and computing a
 * second pending-quote number from `shipments` would put two different
 * answers to one question on the same screen. The overview keeps its quote
 * row and adds the eight below beneath it — extending the page, not
 * duplicating it.
 *
 * **documents awaiting review** returns `null`, not `0`. `shipment_documents`
 * does not exist: M-71's doc records it as one of the seven tables
 * deliberately not created, and M-77 owns it together with the §16 visibility
 * matrix. A tile rendering `0` would be a fake metric in §11's own words —
 * it would assert "we checked, there are none" when nothing was checked. The
 * UI renders an em-dash and says uploads are not live yet.
 *
 * ── WHY COUNTS AND NOT ROWS (§25) ─────────────────────────────────────────
 *
 * Every tile is `select("id", { count: "exact", head: true })` — PostgREST
 * returns the count in a header and **no rows at all**. Nine tiles on a
 * dashboard implemented as "fetch the shipments and count them in JS" is
 * exactly the *"do not load every shipment into the browser"* failure, one
 * layer up. The unit suite asserts `head: true` on every tile query.
 *
 * They run in ONE `Promise.all`, so the wall clock is one round trip, not
 * eight — §25's "no N+1" applied to a dashboard.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Status buckets — argued once, used everywhere
 * ------------------------------------------------------------------ */

/**
 * "Booked" — the shipper has said yes and the freight has not moved yet.
 *
 * §6's first two statuses (`quote_requested`, `quote_sent`) are a QUOTE, not
 * a booking, so they are excluded; `quote_accepted` is the moment a booking
 * exists. The bucket ends at `dispatched`, because once a truck is en route
 * to the pickup the shipment belongs to the in-transit tile and counting it
 * in both would make the row sum to more than the shipper has.
 */
export const BOOKED_STATUSES: readonly ShipmentStatus[] = [
  "quote_accepted",
  "carrier_search",
  "carrier_assigned",
  "dispatched",
];

/**
 * "In transit" — PickLoads is physically moving the freight.
 *
 * Wider than the literal `in_transit` status on purpose: a shipper asking
 * "how many are on the road right now" means the truck is working, whether
 * it is at the shipper's dock loading or at the receiver's unloading. §6
 * models those as separate statuses; §11 asks one question about all of them.
 * `delayed` is NOT here — it has its own tile, and double-counting a delayed
 * shipment as in-transit would hide the thing the tile exists to surface.
 */
export const IN_TRANSIT_STATUSES: readonly ShipmentStatus[] = [
  "en_route_to_pickup",
  "arrived_at_pickup",
  "loading",
  "picked_up",
  "in_transit",
  "arrived_at_delivery",
  "unloading",
];

/** "Completed" — the receiver has the freight; paperwork may still be open. */
export const COMPLETED_STATUSES: readonly ShipmentStatus[] = [
  "delivered",
  "pod_uploaded",
  "completed",
];

/* ------------------------------------------------------------------ *
 * "Today" — in the operating time zone, not the server's
 * ------------------------------------------------------------------ */

/**
 * PickLoads dispatches out of New Jersey and every appointment on the board
 * is quoted in Eastern Time. "Pickups today" computed from a UTC calendar day
 * would move the boundary five hours and put a 20:00 ET pickup on tomorrow's
 * tile — a wrong number on an operational screen, which §11's "no fake
 * metrics" covers just as much as an invented one.
 */
export const OPERATING_TIME_ZONE = "America/New_York";

export interface DayBounds {
  /** Inclusive ISO start of the operating day containing `now`. */
  start: string;
  /** Inclusive ISO end (…T…:59.999Z) of that same day. */
  end: string;
}

/**
 * The UTC instants bounding the operating-time-zone calendar day that
 * contains `now`.
 *
 * Derived from `Intl` rather than a hard-coded −05:00, so it is correct on
 * both sides of a daylight-saving change without a table to maintain.
 * Exported and pure — `tests/unit/shipment-shipper-tiles.test.ts` pins it at
 * an EST date, an EDT date and both DST transition days.
 */
export function operatingDayBounds(now: Date): DayBounds {
  const today = localCalendarDate(now);
  const startMs = localMidnightUtcMs(today);
  // The end is the instant BEFORE the next local midnight — not
  // `start + 24h`. On the two DST transition days the operating day is 23 or
  // 25 hours long, and a fixed 24-hour window would put an 01:00 pickup on
  // the wrong tile every March and every November. Deriving both ends the
  // same way makes the arithmetic impossible to get wrong once.
  const endMs = localMidnightUtcMs(nextCalendarDate(today)) - 1;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

/** `YYYY-MM-DD` of an instant, as the operating zone sees it. */
function localCalendarDate(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nextCalendarDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The UTC instant at which a given operating-zone calendar day begins.
 *
 * TWO PASSES, and the second one is not defensive padding. The offset must be
 * sampled AT LOCAL MIDNIGHT, not at whatever instant the caller happened to
 * pass: on 2026-03-08 the zone is EST (−05:00) at 00:00 local and EDT
 * (−04:00) by lunchtime, so a single pass anchored on the caller's clock puts
 * the day boundary an hour out — and a 20:00 pickup on the wrong day. Pass
 * one lands within an hour of the true midnight; pass two samples the offset
 * there and is exact.
 */
function localMidnightUtcMs(localDate: string): number {
  const naive = Date.parse(`${localDate}T00:00:00.000Z`);
  const firstGuess = naive - zoneOffsetMinutes(new Date(naive)) * 60_000;
  return naive - zoneOffsetMinutes(new Date(firstGuess)) * 60_000;
}

function zoneOffsetMinutes(at: Date): number {
  // `en-US` with `timeZoneName: "longOffset"` yields e.g. "GMT-04:00".
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATING_TIME_ZONE,
    timeZoneName: "longOffset",
  }).format(at);
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(formatted);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/* ------------------------------------------------------------------ *
 * Tile specs
 * ------------------------------------------------------------------ */

export type ShipperTileId =
  | "booked"
  | "pickups_today"
  | "in_transit"
  | "delayed"
  | "deliveries_today"
  | "completed"
  | "documents_awaiting_review"
  | "outstanding_invoices";

/** The eight tiles this module counts, in §11's order. */
export const SHIPPER_TILE_IDS: readonly ShipperTileId[] = [
  "booked",
  "pickups_today",
  "in_transit",
  "delayed",
  "deliveries_today",
  "completed",
  "documents_awaiting_review",
  "outstanding_invoices",
];

/** Tiles counted against `shipments`, with the predicate each applies. */
export const SHIPMENT_TILE_PREDICATES: Record<
  Exclude<ShipperTileId, "documents_awaiting_review" | "outstanding_invoices">,
  <Q extends FilterableQuery<Q>>(query: Q, day: DayBounds) => Q
> = {
  booked: (q) => q.in("status", BOOKED_STATUSES),
  pickups_today: (q, day) =>
    q
      .gte("pickup_appointment_at", day.start)
      .lte("pickup_appointment_at", day.end),
  in_transit: (q) => q.in("status", IN_TRANSIT_STATUSES),
  delayed: (q) => q.or("status.eq.delayed,delay_minutes.gt.0"),
  deliveries_today: (q, day) =>
    q
      .gte("delivery_appointment_at", day.start)
      .lte("delivery_appointment_at", day.end),
  completed: (q) => q.in("status", COMPLETED_STATUSES),
};

/**
 * A tile value. `null` means "not measurable", never "zero" — the honest
 * distinction §11 asks for.
 */
export type ShipperTileCounts = Record<ShipperTileId, number | null>;

export const EMPTY_TILE_COUNTS: ShipperTileCounts = {
  booked: null,
  pickups_today: null,
  in_transit: null,
  delayed: null,
  deliveries_today: null,
  completed: null,
  documents_awaiting_review: null,
  outstanding_invoices: null,
};

/**
 * Count every §11 tile for one shipper.
 *
 * `head: true` on all of them, so nothing but a number crosses the wire.
 * A failed count stays `null` and the tile renders an em-dash: a database
 * error must not be displayed as "you have zero delayed shipments".
 */
export async function getShipperTileCounts(
  supabase: ServerSupabase,
  shipperId: string,
  now: Date = new Date(),
): Promise<ShipperTileCounts> {
  const day = operatingDayBounds(now);

  const shipmentTiles = (
    Object.keys(
      SHIPMENT_TILE_PREDICATES,
    ) as (keyof typeof SHIPMENT_TILE_PREDICATES)[]
  ).map(async (id) => {
    const base = supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("shipper_id", shipperId);
    const { count, error } = await SHIPMENT_TILE_PREDICATES[id](base, day);
    if (error) {
      console.error(`[shipper-tiles] ${id} count failed`, error.message);
      return [id, null] as const;
    }
    return [id, count ?? 0] as const;
  });

  const invoiceTile = (async () => {
    const { count, error } = await supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      // Scoped in the query as well as by 0021's policy: the predicate is
      // what makes `idx_invoices_shipper` usable, the policy is the
      // guarantee. A carrier-side invoice has a null `shipper_id` and can
      // never satisfy this even for a user who is also a carrier member.
      .eq("shipper_id", shipperId)
      .in("status", OUTSTANDING_INVOICE_STATUSES);
    if (error) {
      console.error(
        "[shipper-tiles] outstanding invoices failed",
        error.message,
      );
      return ["outstanding_invoices", null] as const;
    }
    return ["outstanding_invoices", count ?? 0] as const;
  })();

  const settled = await Promise.all([...shipmentTiles, invoiceTile]);
  const counts: ShipperTileCounts = { ...EMPTY_TILE_COUNTS };
  for (const [id, value] of settled) counts[id] = value;
  // M-77 owns `shipment_documents`. Until it lands there is nothing to count,
  // and `0` would be a claim rather than a measurement.
  counts.documents_awaiting_review = null;
  return counts;
}
