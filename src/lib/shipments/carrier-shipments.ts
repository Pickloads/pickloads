import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { AUDIENCE_EVENT_VISIBILITY } from "@/lib/shipments/dto";
import {
  applyShipmentFilters,
  pageRange,
  type ShipmentListFilters,
} from "@/lib/shipments/shipper-list";
import {
  resolveTimelineLimit,
  type ShipmentTimelineEvent,
  type TimelinePage,
} from "@/lib/shipments/shipper-detail";
import type {
  DriverTokenView,
  ShipmentRow,
} from "@/lib/shipments/types";

/**
 * M-76 — the carrier's own shipment reads (§13 carrier portal, §19, §25).
 *
 * ── WHAT IS REUSED, AND WHY THAT IS NOT LAZINESS ─────────────────────────
 *
 * `applyShipmentFilters`, `pageRange`, `parsePage`, `sanitizeTextFilter` and
 * the timeline cursor helpers are M-74's and are imported, not re-declared.
 * The §25 bound is the reason: `MAX_PAGE_SIZE` is asserted by
 * `tests/unit/shipment-shipper-list.test.ts` to be the ceiling of every
 * `shipments` read, and a second module with its own constant would make that
 * assertion true and meaningless. M-75 made the same call for the same reason
 * ("`MAX_PAGE_SIZE` re-exported from M-74 so a second ceiling cannot exist").
 *
 * What is NOT reused is the PROJECTION, and that is the whole difference
 * between this file and M-74's: a carrier sees `carrier_pay` (their own
 * contract) and never `gross_shipper_amount` or `margin`; a shipper sees
 * none of the three. Sharing a column list would have forced one of the two
 * to be wrong.
 *
 * ── COOKIE-BOUND CLIENT ONLY ─────────────────────────────────────────────
 *
 * Every function here takes the caller's `createClient()` server client, so
 * every read runs under 0018's `"carrier member read shipments"` policy and
 * 0019's `"carrier member read shipment events"`. `tryCreateAdminClient` is
 * never imported. The carrier id comes from `getMyCarrierId` (M-57), never
 * from the request — and it is applied as a PREDICATE as well, so the query
 * uses `idx_shipments_carrier` (M-71 built it partial, `(carrier_id, status,
 * created_at desc)`, for exactly this list).
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * List (§13 "assigned shipments", §25 bounded)
 * ------------------------------------------------------------------ */

/**
 * Explicit projection for the LIST.
 *
 * Financial columns absent entirely — not even `carrier_pay`. A list renders
 * a lane and a status; a rate on a scrollable board is a number somebody
 * screenshots. `gross_shipper_amount`, `margin`, `delay_reason_internal`,
 * `public_access_hash` and `shipper_id` are named nowhere on this path, so
 * they never enter process memory on a carrier request.
 */
export const CARRIER_LIST_COLUMNS =
  "id, tracking_number, status, origin_city, origin_state, destination_city, destination_state, pickup_appointment_at, delivery_appointment_at, estimated_delivery_at, delay_minutes, equipment, po_number, created_at, updated_at";

export type CarrierListRow = Pick<
  ShipmentRow,
  | "id"
  | "tracking_number"
  | "status"
  | "origin_city"
  | "origin_state"
  | "destination_city"
  | "destination_state"
  | "pickup_appointment_at"
  | "delivery_appointment_at"
  | "estimated_delivery_at"
  | "delay_minutes"
  | "equipment"
  | "po_number"
  | "created_at"
  | "updated_at"
>;

export interface CarrierListResult {
  rows: CarrierListRow[];
  total: number | null;
  page: number;
  pageSize: number;
  pageCount: number;
  /** True when the read failed — an honest error beats a fake zero. */
  failed: boolean;
}

/**
 * One page of the carrier's assigned shipments.
 *
 * TWO bounds, deliberately, exactly as M-74 does it: `.eq("carrier_id", …)`
 * in the query AND 0018's policy behind it. The policy is the guarantee; the
 * predicate is what makes the plan use the index and what makes a mistake
 * visible in an EXPLAIN.
 */
export async function getCarrierShipments(
  supabase: ServerSupabase,
  carrierId: string,
  filters: ShipmentListFilters,
  page: number,
  pageSize?: number,
): Promise<CarrierListResult> {
  const range = pageRange(page, pageSize);
  const base = supabase
    .from("shipments")
    .select(CARRIER_LIST_COLUMNS, { count: "exact" })
    .eq("carrier_id", carrierId);

  const { data, count, error } = await applyShipmentFilters(base, filters)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(range.from, range.to);

  if (error) {
    console.error("[carrier-shipments] list read failed", error.message);
    return {
      rows: [],
      total: null,
      page: range.page,
      pageSize: range.pageSize,
      pageCount: 1,
      failed: true,
    };
  }

  const total = count ?? null;
  return {
    rows: data ?? [],
    total,
    page: range.page,
    pageSize: range.pageSize,
    pageCount:
      total === null ? range.page : Math.max(1, Math.ceil(total / range.pageSize)),
    failed: false,
  };
}

/**
 * Does this carrier have ANY assigned shipment?
 *
 * The §2 gate's question, asked the way M-74 asks it: with `brokerage_active`
 * false, 0017's trigger refuses every shipment INSERT, so "none" is the
 * ordinary pre-launch state and the page shows an honest notice rather than
 * an empty operational table. A carrier that DOES have freight must still see
 * it — M-71's gate is INSERT-only precisely so in-flight shipments stay
 * operable.
 */
export async function carrierHasAnyShipment(
  supabase: ServerSupabase,
  carrierId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("shipments")
    .select("id", { count: "exact", head: true })
    .eq("carrier_id", carrierId)
    .limit(1);
  if (error) {
    console.error("[carrier-shipments] existence probe failed", error.message);
    return false;
  }
  return (count ?? 0) > 0;
}

/* ------------------------------------------------------------------ *
 * Detail (§25 summary-vs-history split)
 * ------------------------------------------------------------------ */

/**
 * Explicit projection for the DETAIL page.
 *
 * `carrier_pay` IS here and `gross_shipper_amount` / `margin` are not. M-70's
 * DTO doc settles it: *"the carrier gets their own rate because it is their
 * own contract"*, and what stays out is everything that would let them derive
 * the margin. Two of §18's three financial columns therefore never enter
 * memory on a carrier request at all, which is defence in depth behind
 * `toCarrierDto`'s allow-list rather than a substitute for it.
 */
export const CARRIER_DETAIL_COLUMNS =
  "id, tracking_number, carrier_id, quote_id, status, origin_company, origin_address, origin_city, origin_state, origin_zip, destination_company, destination_address, destination_city, destination_state, destination_zip, pickup_appointment_at, delivery_appointment_at, equipment, commodity_category, weight_lbs, pallets, distance_miles, shipper_reference, po_number, carrier_pay, public_tracking_enabled, tracking_mode, location_visibility, current_latitude, current_longitude, current_city, current_state, last_location_at, estimated_pickup_at, estimated_delivery_at, eta_source, eta_confidence, eta_updated_at, delay_minutes, delay_reason_public, load_id, broker_partner_id, dispatcher_id, shipper_id, cancellation_reason, completed_at, cancelled_at, created_at, updated_at";

/**
 * The shipment row as the carrier detail page sees it.
 *
 * `Omit` rather than `Pick`, for M-74's reason restated: a NEW column on
 * `ShipmentRow` becomes a compile error here until somebody decides whether
 * a carrier may see it.
 */
export type CarrierDetailRow = Omit<
  ShipmentRow,
  "gross_shipper_amount" | "margin" | "delay_reason_internal" | "public_access_hash"
>;

/**
 * One shipment, by id, for one carrier. `null` when it does not exist OR is
 * not assigned to this carrier — the page turns both into a 404, the only
 * answer that does not confirm another carrier's freight exists.
 *
 * NO event query: §25's summary-vs-history split, so everything above the
 * fold costs one indexed lookup whether the shipment has four events or four
 * thousand.
 */
export async function getCarrierShipmentSummary(
  supabase: ServerSupabase,
  carrierId: string,
  shipmentId: string,
): Promise<CarrierDetailRow | null> {
  const { data, error } = await supabase
    .from("shipments")
    .select(CARRIER_DETAIL_COLUMNS)
    .eq("id", shipmentId)
    .eq("carrier_id", carrierId)
    .maybeSingle();
  if (error) {
    console.error("[carrier-shipments] summary read failed", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * One bounded page of the carrier-visible timeline, newest first.
 *
 * The band list is `AUDIENCE_EVENT_VISIBILITY.carrier` — `public` + `carrier`,
 * M-70's table, applied IN SQL as well as by 0019's policy so the query uses
 * `idx_shipment_events_audience` rather than fetching rows the policy will
 * then discard. A carrier never sees the `shipper` band (the customer's
 * commercial correspondence) or `staff_only`.
 *
 * Keyset, not offset, and the cursor helpers are M-74's — history is read
 * strictly forward, never jumped into.
 */
export async function getCarrierTimelinePage(
  supabase: ServerSupabase,
  shipmentId: string,
  options: { before?: string | null; limit?: number } = {},
): Promise<TimelinePage> {
  const limit = resolveTimelineLimit(options.limit);
  let query = supabase
    .from("shipment_events")
    .select(
      "id, shipment_id, event_type, status, event_time, recorded_at, source, city, state, public_message, visibility",
    )
    .eq("shipment_id", shipmentId)
    .in("visibility", AUDIENCE_EVENT_VISIBILITY.carrier);
  if (options.before) query = query.lt("event_time", options.before);

  const { data, error } = await query
    .order("event_time", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (error) {
    console.error("[carrier-shipments] timeline read failed", error.message);
    return { events: [], hasMore: false, nextBefore: null, failed: true };
  }
  const rows = (data ?? []) as ShipmentTimelineEvent[];
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return {
    events,
    hasMore,
    nextBefore: hasMore ? (events[events.length - 1]?.event_time ?? null) : null,
    failed: false,
  };
}

/* ------------------------------------------------------------------ *
 * Driver links (§13 lifecycle, read side)
 * ------------------------------------------------------------------ */

/**
 * The columns any browser-reachable surface may read from
 * `shipment_driver_tokens`.
 *
 * `token_hash` is NOT among them — and this projection is the second of three
 * independent guarantees, not the only one. 0023 revokes SELECT on that
 * column from `authenticated` and `anon` at the COLUMN level (so naming it
 * here would produce a permission error, not a leak), the row type
 * `DriverTokenView` omits it (so rendering it is a compile error), and this
 * string never mentions it. M-71's residual risk R-1 — "RLS is row-level, so
 * every column of a readable row is in the payload" — does not apply to this
 * table, which is the one place in the schema where it would have mattered.
 */
export const DRIVER_TOKEN_VIEW_COLUMNS =
  "id, shipment_id, carrier_id, driver_id, driver_name, issued_by, issued_by_role, issued_at, expires_at, revoked_at, revoked_by, revoke_reason, consent_status, consent_at, last_used_at, use_count, created_at";

/** §25: a shipment does not accumulate driver links; twenty is generous. */
export const DRIVER_TOKEN_LIMIT = 20;

export interface DriverTokenListResult {
  tokens: DriverTokenView[];
  failed: boolean;
}

/**
 * Driver links for one shipment, newest first, through the CALLER's client.
 *
 * Used by both the carrier detail page (0023's `"carrier member read driver
 * tokens"` policy) and M-75's dispatcher detail page (`"staff manage driver
 * tokens"`). One function, two policies, no service-role read — which is what
 * makes the two surfaces provably scoped rather than scoped by convention.
 */
export async function getDriverTokens(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<DriverTokenListResult> {
  const { data, error } = await supabase
    .from("shipment_driver_tokens")
    .select(DRIVER_TOKEN_VIEW_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("issued_at", { ascending: false })
    .limit(DRIVER_TOKEN_LIMIT);
  if (error) {
    console.error("[carrier-shipments] driver link read failed", error.message);
    return { tokens: [], failed: true };
  }
  return { tokens: (data ?? []) as DriverTokenView[], failed: false };
}
