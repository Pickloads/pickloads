import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  applyShipmentFilters,
  MAX_PAGE_SIZE,
  pageRange,
  type FilterableQuery,
  type ShipmentListFilters,
} from "@/lib/shipments/shipper-list";
import { operatingDayBounds } from "@/lib/shipments/shipper-tiles";
import {
  shipmentScopeExpression,
  type StaffScope,
} from "@/lib/staff-scope";
import {
  SHIPMENT_STATUSES,
  type ShipmentRow,
  type ShipmentStatus,
} from "@/lib/shipments/types";

/**
 * M-75 — the §14 operational board: eight columns, server-side queries.
 *
 * ── WHY THIS IS A LIBRARY AND NOT EIGHT QUERIES IN A PAGE ─────────────────
 *
 * §14 asks for a board with eight named columns and then says *"use filters
 * and server-side queries"*; §25 adds *"server-side pagination"*, *"indexed
 * status/date/organization columns"*, *"no N+1"* and — the one a kanban gets
 * wrong by default — *"do not load all events or documents by default when a
 * shipment has a large history."* A board is exactly the surface where the
 * lazy implementation is `select * from shipments` followed by eight
 * `Array.filter` calls in the browser, which satisfies none of them and looks
 * fine in a screenshot.
 *
 * So the column membership rules live here as data, every column is its own
 * bounded, counted query, and `tests/unit/shipment-board.test.ts` asserts over
 * a recording client that no reachable path issues a `shipments` select
 * without a `range()` of at most `MAX_PAGE_SIZE` rows. That is the same proof
 * shape M-74 used for the shipper list, and it is deliberately the same
 * constant — a second ceiling would be a second thing to keep true.
 *
 * ── WHY THE CRM-KANBAN IDIOM AND NOT A NEW BOARD PATTERN ──────────────────
 *
 * `src/components/portal/KanbanBoard.tsx` (M-23) already established what a
 * PickLoads board is: `.kanban` / `.kcol` / `.kcard` in `portal.css`, a
 * `.kfilters` bar above it, a count in each column heading. M-75 renders the
 * same vocabulary. What it deliberately does NOT copy is the drag-and-drop
 * status move: a lead's status is free-form pipeline bookkeeping, while a
 * shipment's status is §20's transition graph with preconditions, an actor
 * gate and a compare-and-swap. A drag gesture cannot carry a cancellation
 * reason, cannot assert operational closeout and has no natural way to
 * SURFACE a refusal — so a dragged card would either silently fail or quietly
 * bypass the engine. Status moves happen on the shipment detail page, through
 * `availableTransitions`, one explicit button per legal target.
 *
 * ── REALTIME: DELIBERATELY NOT USED (§14) ─────────────────────────────────
 *
 * §14: *"Use real-time updates only where useful. Do not use Realtime for
 * every table without need."* This board does not subscribe to anything, for
 * three reasons that are specific rather than general:
 *
 *   1. **It would leak across the dispatcher scope.** Supabase Realtime
 *      filters broadcast rows through RLS, and 0018's policy is `"staff
 *      manage shipments"` — every staff row. Dispatcher least-privilege here
 *      is QUERY-LEVEL (M-71's R-2, inherited by M-72 and honoured above), so
 *      a subscription would push dispatcher B's freight to dispatcher A's
 *      browser even though the board query excludes it. A control that a
 *      websocket walks around is not a control.
 *   2. **The board's expensive part is the eight counts, not the rows.** A
 *      change event would have to re-run them anyway, so the "cheap live
 *      update" is a full page's worth of work triggered by every keystroke of
 *      every dispatcher.
 *   3. **The write path is already optimistic-concurrency-safe.** M-72's
 *      compare-and-swap returns `status_conflict` when somebody else moved a
 *      shipment, and M-75 renders that as "somebody else moved this shipment
 *      — reload" (M-72's residual risk R-4). Stale is therefore SAFE here,
 *      not merely tolerable, which is the condition that makes polling or a
 *      manual refresh the honest choice.
 *
 * Where realtime IS useful is a single shipment being worked by two people,
 * and that is a per-row subscription on one detail page — a much narrower
 * thing than a board, and it belongs to whoever measures the need. Nothing
 * here forecloses it.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Bounds (§25)
 * ------------------------------------------------------------------ */

/** Rows shown in a collapsed column. Deliberately small — eight of them. */
export const BOARD_PREVIEW_SIZE = 8;

/** Rows per page when one column is expanded (`?col=…&page=…`). */
export const BOARD_PAGE_SIZE = 25;

/**
 * Explicit projection. §18's three financial columns, `delay_reason_internal`
 * and `public_access_hash` are NOT named: a board renders none of them, and a
 * column that never enters process memory cannot be leaked by a future
 * component that spreads its props. Staff MAY see the financial trio — the
 * shipment DETAIL page selects it — but "may" is not "must", and §25 wants the
 * hot query lean.
 */
export const SHIPMENT_BOARD_COLUMNS =
  "id, tracking_number, status, shipper_id, carrier_id, dispatcher_id, origin_city, origin_state, destination_city, destination_state, pickup_appointment_at, delivery_appointment_at, estimated_delivery_at, delay_minutes, equipment, created_at, updated_at";

export type ShipmentBoardRow = Pick<
  ShipmentRow,
  | "id"
  | "tracking_number"
  | "status"
  | "shipper_id"
  | "carrier_id"
  | "dispatcher_id"
  | "origin_city"
  | "origin_state"
  | "destination_city"
  | "destination_state"
  | "pickup_appointment_at"
  | "delivery_appointment_at"
  | "estimated_delivery_at"
  | "delay_minutes"
  | "equipment"
  | "created_at"
  | "updated_at"
>;

/* ------------------------------------------------------------------ *
 * §14's eight columns
 * ------------------------------------------------------------------ */

export type BoardColumnId =
  | "needs_carrier"
  | "carrier_assigned"
  | "pickup_today"
  | "in_transit"
  | "delivery_today"
  | "delayed"
  | "pod_pending"
  | "completed";

/**
 * How a column decides membership.
 *
 *   `status`       — a fixed status set. The common case.
 *   `pickup_day`   — an appointment window, ANDed with the statuses for which
 *                    "today's pickup" is still a live question.
 *   `delivery_day` — the same for delivery.
 *   `delayed`      — §11's two-fact rule: flagged status OR recorded minutes.
 */
export type BoardColumnKind =
  | "status"
  | "pickup_day"
  | "delivery_day"
  | "delayed";

export interface BoardColumn {
  id: BoardColumnId;
  /** §14's own column name, verbatim. */
  label: string;
  /** One honest sentence about what the column actually contains. */
  hint: string;
  kind: BoardColumnKind;
  statuses: readonly ShipmentStatus[];
}

/** Statuses in which freight is physically moving or being worked at a dock. */
export const IN_TRANSIT_BOARD_STATUSES: readonly ShipmentStatus[] = [
  "en_route_to_pickup",
  "arrived_at_pickup",
  "loading",
  "picked_up",
  "in_transit",
  "arrived_at_delivery",
  "unloading",
];

/**
 * Statuses for which "is it picking up today?" is still an open question. A
 * delivered shipment with a pickup appointment dated today is history, not
 * work, and putting it on a dispatcher's morning column is noise.
 */
export const PICKUP_DAY_STATUSES: readonly ShipmentStatus[] = [
  "quote_accepted",
  "carrier_search",
  "carrier_assigned",
  "dispatched",
  "en_route_to_pickup",
  "arrived_at_pickup",
  "loading",
  "delayed",
];

/** The same, for delivery. */
export const DELIVERY_DAY_STATUSES: readonly ShipmentStatus[] = [
  "carrier_assigned",
  "dispatched",
  "picked_up",
  "in_transit",
  "delayed",
  "arrived_at_delivery",
  "unloading",
];

/** Everything except the two terminal statuses — a delay column's universe. */
export const NON_TERMINAL_STATUSES: readonly ShipmentStatus[] =
  SHIPMENT_STATUSES.filter((s) => s !== "completed" && s !== "cancelled");

/**
 * §14's eight columns, in §14's order.
 *
 * TWO DECISIONS WORTH ARGUING, because both change what a dispatcher sees:
 *
 * **"Needs Carrier" holds all four carrier-less statuses**, not just
 * `carrier_search`. §6's first four statuses have no carrier by construction,
 * and a shipment created in `quote_requested` that appeared in NO column would
 * be a shipment a dispatcher can only find by search — the "where did it go?"
 * failure that makes people distrust a board. The quotes desk
 * (`/portal/admin/quotes`, M-60) still owns the quote CONVERSATION; this
 * column owns the freight.
 *
 * **`cancelled` is in no column at all, deliberately.** A cancelled shipment
 * is not operational work, and an eight-column board with a growing ninth pile
 * of dead freight is how boards stop being read. It remains reachable through
 * the status filter and through §5 search, both of which are on this page — so
 * the rule is "not surfaced by default", never "hidden".
 */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  {
    id: "needs_carrier",
    label: "Needs Carrier",
    hint: "No carrier assigned yet",
    kind: "status",
    statuses: [
      "quote_requested",
      "quote_sent",
      "quote_accepted",
      "carrier_search",
    ],
  },
  {
    id: "carrier_assigned",
    label: "Carrier Assigned",
    hint: "Covered, not yet rolling",
    kind: "status",
    statuses: ["carrier_assigned", "dispatched"],
  },
  {
    id: "pickup_today",
    label: "Pickup Today",
    hint: "Pickup appointment falls today (Eastern)",
    kind: "pickup_day",
    statuses: PICKUP_DAY_STATUSES,
  },
  {
    id: "in_transit",
    label: "In Transit",
    hint: "On the road or working a dock",
    kind: "status",
    statuses: IN_TRANSIT_BOARD_STATUSES,
  },
  {
    id: "delivery_today",
    label: "Delivery Today",
    hint: "Delivery appointment falls today (Eastern)",
    kind: "delivery_day",
    statuses: DELIVERY_DAY_STATUSES,
  },
  {
    id: "delayed",
    label: "Delayed",
    hint: "Flagged delayed, or delay minutes recorded",
    kind: "delayed",
    statuses: NON_TERMINAL_STATUSES,
  },
  {
    id: "pod_pending",
    label: "POD Pending",
    hint: "Delivered, proof of delivery not yet on file",
    kind: "status",
    statuses: ["delivered"],
  },
  {
    id: "completed",
    label: "Completed",
    hint: "Closed out",
    kind: "status",
    statuses: ["completed"],
  },
];

export const BOARD_COLUMN_IDS: readonly BoardColumnId[] = BOARD_COLUMNS.map(
  (c) => c.id,
);

export function findBoardColumn(id: string | undefined): BoardColumn | null {
  return BOARD_COLUMNS.find((c) => c.id === id) ?? null;
}

/** Parse `?col=` into a column, or null for the full eight-column view. */
export function parseBoardColumn(
  raw: string | string[] | undefined,
): BoardColumn | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return findBoardColumn(value);
}

/* ------------------------------------------------------------------ *
 * Query building
 * ------------------------------------------------------------------ */

/** The builder surface these functions use — the M-74 shape plus nothing. */
export interface BoardQuery<Q> extends FilterableQuery<Q> {
  order(column: string, options?: { ascending?: boolean }): Q;
  range(from: number, to: number): unknown;
}

/**
 * Apply one column's membership rule.
 *
 * Generic over the builder so the unit suite can pass a recorder and assert
 * the EXACT filter chain each column produces — the same technique M-74 used,
 * and the only way to prove "Pickup Today excludes delivered freight" without
 * a database.
 *
 * `now` is a parameter, never `new Date()` inside: the two day columns are
 * timezone-sensitive (`operatingDayBounds` is Eastern, not UTC — a 20:00 ET
 * pickup is not tomorrow's work) and a function that reads the clock cannot be
 * pinned to a DST boundary in a test.
 */
export function applyBoardColumn<Q extends FilterableQuery<Q>>(
  query: Q,
  column: BoardColumn,
  now: Date,
): Q {
  let q = query;
  switch (column.kind) {
    case "status":
      return q.in("status", column.statuses);
    case "pickup_day": {
      const day = operatingDayBounds(now);
      q = q.in("status", column.statuses);
      q = q.gte("pickup_appointment_at", day.start);
      return q.lte("pickup_appointment_at", day.end);
    }
    case "delivery_day": {
      const day = operatingDayBounds(now);
      q = q.in("status", column.statuses);
      q = q.gte("delivery_appointment_at", day.start);
      return q.lte("delivery_appointment_at", day.end);
    }
    case "delayed":
      // Two facts, one column — the same rule §11's shipper filter uses:
      // dispatch may have flagged the status, or recorded minutes against a
      // shipment still nominally in transit. The status `in` list is what
      // keeps completed and cancelled freight out of it.
      q = q.in("status", column.statuses);
      return q.or("status.eq.delayed,delay_minutes.gt.0");
  }
}

export interface BoardColumnResult {
  column: BoardColumn;
  rows: ShipmentBoardRow[];
  /** Exact matching count, or null when the database did not report one. */
  total: number | null;
  page: number;
  pageSize: number;
  pageCount: number;
  /** True when the read failed — the column says so instead of showing "0". */
  failed: boolean;
}

export interface BoardQueryOptions {
  filters: ShipmentListFilters;
  scope: StaffScope;
  userId: string;
  now: Date;
  page?: number;
  pageSize?: number;
}

/**
 * One column, one bounded and counted query.
 *
 * FOUR predicates compose, in this order and for these reasons:
 *   1. the §3/§19 dispatcher scope (first, so it narrows everything after it);
 *   2. the column's own membership rule;
 *   3. the operator's §11-style filters, reused verbatim from M-74's builder
 *      — the board does not need a second implementation of "delayed" or of
 *      the `or()` allow-list, and a second one would be the first to drift;
 *   4. a total order key (`created_at desc, id desc`) so a row cannot appear
 *      on two pages when two shipments share a timestamp.
 */
export async function getBoardColumn(
  supabase: ServerSupabase,
  column: BoardColumn,
  options: BoardQueryOptions,
): Promise<BoardColumnResult> {
  const range = pageRange(options.page ?? 1, options.pageSize ?? BOARD_PREVIEW_SIZE);

  let query = supabase
    .from("shipments")
    .select(SHIPMENT_BOARD_COLUMNS, { count: "exact" });

  const scopeExpression = shipmentScopeExpression(options.scope, options.userId);
  if (scopeExpression !== null) query = query.or(scopeExpression);

  query = applyBoardColumn(query, column, options.now);
  query = applyShipmentFilters(query, options.filters);

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(range.from, range.to);

  if (error) {
    console.error(
      `[shipment-board] column "${column.id}" read failed`,
      error.message,
    );
    return {
      column,
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
    column,
    rows: (data ?? []) as ShipmentBoardRow[],
    total,
    page: range.page,
    pageSize: range.pageSize,
    pageCount:
      total === null ? range.page : Math.max(1, Math.ceil(total / range.pageSize)),
    failed: false,
  };
}

/**
 * All eight columns, concurrently.
 *
 * §25's "no N+1" is about queries proportional to ROWS, not to columns: this
 * is eight fixed queries whatever the board holds, issued in one round trip's
 * worth of wall time, each bounded at `BOARD_PREVIEW_SIZE` rows and each
 * returning its exact count in a header. The alternative — one unbounded read
 * plus client-side bucketing — is a single query and is the thing §25
 * actually forbids.
 */
export async function getBoard(
  supabase: ServerSupabase,
  options: BoardQueryOptions,
): Promise<BoardColumnResult[]> {
  return Promise.all(
    BOARD_COLUMNS.map((column) =>
      getBoardColumn(supabase, column, {
        ...options,
        pageSize: options.pageSize ?? BOARD_PREVIEW_SIZE,
      }),
    ),
  );
}

/** Ceiling re-exported so a caller cannot import a different one. */
export { MAX_PAGE_SIZE };
