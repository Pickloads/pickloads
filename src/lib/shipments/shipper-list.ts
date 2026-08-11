import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  SHIPMENT_STATUSES,
  type ShipmentRow,
  type ShipmentStatus,
} from "@/lib/shipments/types";

/**
 * M-74 — the §11 shipper shipment LIST: filters, server-side pagination and
 * the bounded read that §25 demands.
 *
 * ── WHY THIS IS A MODULE AND NOT INLINE IN THE PAGE ───────────────────────
 *
 * §25 states two requirements a page body cannot honestly prove:
 * *"server-side pagination"* and *"do not load every shipment into the
 * browser."* A `.limit(200)` typed into a page component is a claim that has
 * to be re-checked by eye on every edit. Here the bound is a constant, the
 * range is computed by one function, and `tests/unit/shipment-shipper-list.
 * test.ts` asserts over a RECORDING query builder that **no** reachable code
 * path issues a `shipments` select without a `range()` whose span is at most
 * `MAX_PAGE_SIZE`. That is the difference between a limit and a proof.
 *
 * ── COOKIE-BOUND CLIENT ONLY ──────────────────────────────────────────────
 *
 * Every function here takes the caller's `createClient()` server client, so
 * every read runs under 0018's `"shipper member read shipments"` policy.
 * `tryCreateAdminClient` is deliberately never imported: the shipper list is
 * exactly the surface where a service-role convenience would turn a tenant
 * boundary into an application `if`. The M-56 legacy email-matching path
 * (`shipper-quotes.ts`) has no analogue here and must not grow one — a
 * shipment is created by dispatch with a `shipper_id`, never claimed by an
 * email match.
 *
 * ── EXACT COUNT, NOT KEYSET ───────────────────────────────────────────────
 *
 * Both were on the table. Keyset wins at depth; exact-count wins on a page
 * that must render "Page 3 of 9" and let a shipper jump to the last page —
 * which is what a customer looking for a shipment from March actually does.
 * The order key is `(created_at desc, id desc)`, so the ordering is TOTAL and
 * a row cannot appear on two pages because two shipments share a timestamp.
 * At shipper scale (§25 sizes the system for thousands of shippers, not
 * hundreds of thousands of shipments *per shipper*) the offset cost is
 * bounded by `idx_shipments_shipper`, which M-71 built as
 * `(shipper_id, status, created_at desc)` for this exact query.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Bounds (§25)
 * ------------------------------------------------------------------ */

/** Rows per page in the UI. */
export const SHIPMENT_PAGE_SIZE = 25;

/**
 * Hard ceiling on rows any single `shipments` read may return.
 *
 * Not a default — a CEILING. `resolvePageSize` clamps to it, and the unit
 * suite asserts every built range spans at most this many rows. A caller
 * cannot widen it by passing a bigger number.
 */
export const MAX_PAGE_SIZE = 50;

/**
 * Explicit column projection. §18's three financial columns
 * (`gross_shipper_amount`, `carrier_pay`, `margin`), `delay_reason_internal`
 * and `public_access_hash` are NOT named here, so they never enter process
 * memory on a shipper request — M-71's residual risk R-1 (RLS is row-level)
 * is mitigated at this layer as well as by the DTO.
 */
export const SHIPMENT_LIST_COLUMNS =
  "id, tracking_number, status, origin_city, origin_state, destination_city, destination_state, pickup_appointment_at, delivery_appointment_at, estimated_delivery_at, delay_minutes, equipment, shipper_reference, po_number, carrier_id, created_at, updated_at";

/* ------------------------------------------------------------------ *
 * Filters (§11's nine)
 * ------------------------------------------------------------------ */

/**
 * §11 names nine filters. Seven are free text or enum; two (`delayed`,
 * `delivered`) are toggles.
 *
 * `null` always means "not applied" — never "applied with an empty value",
 * because an empty `ilike '%%'` is a full scan wearing a filter's clothes.
 */
export interface ShipmentListFilters {
  /** Partial match on the §5 tracking number. */
  tracking: string | null;
  /** Partial match across `shipper_reference` OR `po_number`. */
  reference: string | null;
  /** Pickup-appointment window, inclusive. ISO date (`YYYY-MM-DD`). */
  dateFrom: string | null;
  dateTo: string | null;
  /** Partial match across origin city OR state. */
  origin: string | null;
  /** Partial match across destination city OR state. */
  destination: string | null;
  status: ShipmentStatus | null;
  /** Partial match on the equipment string. */
  equipment: string | null;
  /** §11 toggle: running late (`delayed` status OR positive delay minutes). */
  delayed: boolean;
  /** §11 toggle: freight is at the receiver (delivered / POD / completed). */
  delivered: boolean;
}

export const EMPTY_FILTERS: ShipmentListFilters = {
  tracking: null,
  reference: null,
  dateFrom: null,
  dateTo: null,
  origin: null,
  destination: null,
  status: null,
  equipment: null,
  delayed: false,
  delivered: false,
};

/** §11's "delivered" bucket — freight the receiver has. */
export const DELIVERED_STATUSES: readonly ShipmentStatus[] = [
  "delivered",
  "pod_uploaded",
  "completed",
];

/**
 * Characters a free-text filter may contain.
 *
 * PostgREST's `or()` takes a COMMA-SEPARATED, PARENTHESISED expression
 * string, so a comma, a parenthesis, a dot or a backslash in user input would
 * change the shape of the filter rather than the value inside it. Rather than
 * escape (and get one escape wrong), the allow-list drops everything that is
 * not plausibly part of a tracking number, a PO number or a place name. A
 * shipper searching for `PO-4471/A` still finds it; a shipper pasting
 * `x,status.eq.completed` searches for `xstatus.eq.completed` and finds
 * nothing, which is the honest outcome.
 *
 * `%` and `_` are dropped too: they are `ilike` wildcards, and a user typing
 * `%` means the character, not "match anything".
 */
const TEXT_ALLOWED = /[^A-Za-z0-9 \-/#&']/g;
const MAX_TEXT_LENGTH = 64;

/** Normalise a free-text filter, or null when nothing usable is left. */
export function sanitizeTextFilter(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(TEXT_ALLOWED, "")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
  return cleaned === "" ? null : cleaned;
}

/** ISO calendar date (`YYYY-MM-DD`) or null. Rejects anything else. */
export function sanitizeDateFilter(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip guard: "2026-02-31" parses but is not that date.
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isTrue(value: string | string[] | undefined): boolean {
  const v = first(value);
  return v === "1" || v === "true" || v === "on";
}

/**
 * Parse `searchParams` into filters. Pure, total and defensive: anything
 * unrecognised becomes "not applied" rather than an error page. A URL is user
 * input, and a shipper who hand-edits one should see their shipments, not a
 * stack trace.
 */
export function parseShipmentFilters(
  params: Record<string, string | string[] | undefined>,
): ShipmentListFilters {
  const status = first(params.status);
  return {
    tracking: sanitizeTextFilter(first(params.tracking)),
    reference: sanitizeTextFilter(first(params.reference)),
    dateFrom: sanitizeDateFilter(first(params.from)),
    dateTo: sanitizeDateFilter(first(params.to)),
    origin: sanitizeTextFilter(first(params.origin)),
    destination: sanitizeTextFilter(first(params.destination)),
    status: SHIPMENT_STATUSES.find((s) => s === status) ?? null,
    equipment: sanitizeTextFilter(first(params.equipment)),
    delayed: isTrue(params.delayed),
    delivered: isTrue(params.delivered),
  };
}

/** True when at least one filter narrows the result set. */
export function hasActiveFilters(f: ShipmentListFilters): boolean {
  return (
    f.tracking !== null ||
    f.reference !== null ||
    f.dateFrom !== null ||
    f.dateTo !== null ||
    f.origin !== null ||
    f.destination !== null ||
    f.status !== null ||
    f.equipment !== null ||
    f.delayed ||
    f.delivered
  );
}

/** The query-shape surface these builders use — nothing wider. */
export interface FilterableQuery<Q> {
  eq(column: string, value: unknown): Q;
  in(column: string, values: readonly unknown[]): Q;
  gte(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  ilike(column: string, pattern: string): Q;
  or(expression: string): Q;
}

/** Day bounds for a `YYYY-MM-DD` filter, as an inclusive timestamptz range. */
function dayStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}
function dayEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/**
 * Apply §11's filters to a `shipments` query.
 *
 * Generic over the builder so the unit suite can pass a recorder and assert
 * the exact filter chain — the same object shape supabase-js's
 * `PostgrestFilterBuilder` presents, with none of its transport.
 */
export function applyShipmentFilters<Q extends FilterableQuery<Q>>(
  query: Q,
  f: ShipmentListFilters,
): Q {
  let q = query;
  if (f.tracking !== null) q = q.ilike("tracking_number", `%${f.tracking}%`);
  if (f.reference !== null) {
    q = q.or(
      `shipper_reference.ilike.*${f.reference}*,po_number.ilike.*${f.reference}*`,
    );
  }
  // §11's "date" is the PICKUP appointment: the question a shipper asks is
  // "what was picked up that week", not "what row was created that week".
  // A shipment with no appointment yet cannot satisfy a pickup-date window
  // and is correctly excluded rather than silently included.
  if (f.dateFrom !== null) {
    q = q.gte("pickup_appointment_at", dayStart(f.dateFrom));
  }
  if (f.dateTo !== null) q = q.lte("pickup_appointment_at", dayEnd(f.dateTo));
  if (f.origin !== null) {
    q = q.or(
      `origin_city.ilike.*${f.origin}*,origin_state.ilike.*${f.origin}*`,
    );
  }
  if (f.destination !== null) {
    q = q.or(
      `destination_city.ilike.*${f.destination}*,destination_state.ilike.*${f.destination}*`,
    );
  }
  if (f.status !== null) q = q.eq("status", f.status);
  if (f.equipment !== null) q = q.ilike("equipment", `%${f.equipment}%`);
  // "Running late" is two facts, not one: dispatch may have flagged the
  // status, or recorded minutes against a shipment still nominally in
  // transit. §11 asks for one filter, so it covers both.
  if (f.delayed) q = q.or("status.eq.delayed,delay_minutes.gt.0");
  if (f.delivered) q = q.in("status", DELIVERED_STATUSES);
  return q;
}

/* ------------------------------------------------------------------ *
 * Pagination (§25)
 * ------------------------------------------------------------------ */

export interface PageRange {
  page: number;
  pageSize: number;
  from: number;
  to: number;
}

export function resolvePageSize(raw?: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return SHIPMENT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(raw)));
}

export function parsePage(raw: string | string[] | undefined): number {
  const value = Number(first(raw));
  if (!Number.isFinite(value) || value < 1) return 1;
  // A hand-edited `?page=1e9` must not become a 10⁹-row OFFSET. The cap is
  // arbitrary but finite, and the caller re-clamps against the real count.
  return Math.min(10_000, Math.floor(value));
}

/**
 * The inclusive `[from, to]` PostgREST range for a page.
 *
 * `to` is always `from + pageSize - 1`, so the span is `pageSize` and never
 * more — which is the assertion the §25 proof rests on.
 */
export function pageRange(page: number, pageSize?: number): PageRange {
  const size = resolvePageSize(pageSize);
  const safePage = Math.max(1, Math.floor(page));
  const from = (safePage - 1) * size;
  return { page: safePage, pageSize: size, from, to: from + size - 1 };
}

export type ShipmentListRow = Pick<
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
  | "shipper_reference"
  | "po_number"
  | "carrier_id"
  | "created_at"
  | "updated_at"
>;

export interface ShipmentListResult {
  rows: ShipmentListRow[];
  /** Exact matching row count, or null when the database did not report one. */
  total: number | null;
  page: number;
  pageSize: number;
  pageCount: number;
  /** True when the read failed — the page renders an honest error, not "0". */
  failed: boolean;
}

/**
 * One page of the shipper's own shipments.
 *
 * TWO bounds, deliberately: `.eq("shipper_id", …)` in the query AND 0018's
 * policy behind it. The policy is the guarantee; the predicate is what makes
 * the query use `idx_shipments_shipper` instead of filtering after the fact,
 * and what makes a mistake visible in an EXPLAIN rather than only in a
 * penetration test.
 */
export async function getShipperShipments(
  supabase: ServerSupabase,
  shipperId: string,
  filters: ShipmentListFilters,
  page: number,
  pageSize?: number,
): Promise<ShipmentListResult> {
  const range = pageRange(page, pageSize);
  const base = supabase
    .from("shipments")
    .select(SHIPMENT_LIST_COLUMNS, { count: "exact" })
    .eq("shipper_id", shipperId);

  const { data, count, error } = await applyShipmentFilters(base, filters)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(range.from, range.to);

  if (error) {
    console.error("[shipper-shipments] list read failed", error.message);
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
  const pageCount =
    total === null
      ? range.page
      : Math.max(1, Math.ceil(total / range.pageSize));
  return {
    rows: data ?? [],
    total,
    page: range.page,
    pageSize: range.pageSize,
    pageCount,
    failed: false,
  };
}

/**
 * Does this shipper have ANY shipment at all?
 *
 * Used by the §2 brokerage gate: with `brokerage_active` false the 0017
 * trigger refuses every shipment INSERT, so "no shipments" is the ordinary
 * pre-launch state and the page shows the M-56 waitlist rather than an empty
 * operational table. A shipper who DOES have shipments — brokerage was on,
 * freight is in flight, the flag went back off — must still see them, which
 * is the same reasoning M-71 used to make its gate INSERT-only.
 *
 * `head: true` — a count, never a row.
 */
export async function shipperHasAnyShipment(
  supabase: ServerSupabase,
  shipperId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("shipments")
    .select("id", { count: "exact", head: true })
    .eq("shipper_id", shipperId)
    .limit(1);
  if (error) {
    console.error("[shipper-shipments] existence probe failed", error.message);
    return false;
  }
  return (count ?? 0) > 0;
}
