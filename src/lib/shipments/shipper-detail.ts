import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { AUDIENCE_EVENT_VISIBILITY } from "@/lib/shipments/dto";
import type {
  ShipmentEventRow,
  ShipmentPartyRow,
  ShipmentRow,
} from "@/lib/shipments/types";
import type { InvoiceStatus } from "@/lib/supabase/database.types";

/**
 * M-74 — the §11 shipper shipment DETAIL reads.
 *
 * ── §25's SUMMARY-vs-HISTORY SPLIT, AS SEPARATE FUNCTIONS ─────────────────
 *
 * §25: *"query current summary separately from full history when needed"* and
 * *"do not load all events or documents by default when a shipment has a
 * large history."*
 *
 * Those two sentences are structural here, not a comment. `getShipmentSummary`
 * reads ONE row from `shipments` and touches `shipment_events` not at all —
 * `tests/unit/shipment-shipper-detail.test.ts` asserts over a recording client
 * that the only table it queries is `shipments`. The header, the status, the
 * ETA and the summary block therefore render from a single indexed lookup
 * regardless of whether the shipment has four events or four thousand.
 *
 * `getShipmentTimelinePage` is the other half: newest-first, capped at
 * `TIMELINE_PAGE_SIZE`, fetching ONE extra row to answer "is there more?"
 * without a second count query. The same trick M-73 uses on `/track`, for the
 * same reason — a `count: exact` on an event table is the expensive part of
 * an event table.
 *
 * ── COOKIE-BOUND CLIENT, THREE POLICIES ───────────────────────────────────
 *
 * Every read here runs under the caller's session:
 *   `shipments`         → 0018 "shipper member read shipments"
 *   `shipment_events`   → 0019 "shipper member read shipment events" (which
 *                          also enforces the `public`/`shipper` bands)
 *   `shipment_parties`  → 0018 "shipper member read shipment parties"
 *   `invoices`          → 0021 "member read shipper invoices"
 * Four tables, four policies, one session. No admin client anywhere.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Summary (§11: timeline / status / ETA / summary)
 * ------------------------------------------------------------------ */

/**
 * Explicit projection. Same discipline as the list: §18's three financial
 * columns, `delay_reason_internal` and `public_access_hash` are named
 * nowhere, so a shipper request never has them in memory.
 */
export const SHIPMENT_DETAIL_COLUMNS =
  "id, tracking_number, shipper_id, carrier_id, quote_id, status, origin_company, origin_address, origin_city, origin_state, origin_zip, destination_company, destination_address, destination_city, destination_state, destination_zip, pickup_appointment_at, delivery_appointment_at, equipment, commodity_category, weight_lbs, pallets, distance_miles, shipper_reference, po_number, public_tracking_enabled, tracking_mode, location_visibility, current_latitude, current_longitude, current_city, current_state, last_location_at, estimated_pickup_at, estimated_delivery_at, eta_source, eta_confidence, eta_updated_at, delay_minutes, delay_reason_public, load_id, broker_partner_id, dispatcher_id, cancellation_reason, completed_at, cancelled_at, created_at, updated_at";

/**
 * The shipment row as the detail page sees it: every `ShipmentRow` field the
 * projection above names, and none of the ones it does not.
 *
 * `Omit` rather than `Pick` on purpose — a NEW column added to `ShipmentRow`
 * in a later module is then a **compile error** here until somebody decides
 * whether a shipper may see it, instead of silently defaulting to invisible
 * (which would be safe) or, worse, being pasted into the projection string
 * (which would not).
 */
export type ShipmentDetailRow = Omit<
  ShipmentRow,
  | "gross_shipper_amount"
  | "carrier_pay"
  | "margin"
  | "delay_reason_internal"
  | "public_access_hash"
>;

/**
 * One shipment, by id, for one shipper. `null` when it does not exist OR the
 * caller may not see it — the page turns both into a 404, which is the only
 * answer that does not confirm the existence of another shipper's shipment.
 *
 * NO event query. See the module header.
 */
export async function getShipmentSummary(
  supabase: ServerSupabase,
  shipperId: string,
  shipmentId: string,
): Promise<ShipmentDetailRow | null> {
  const { data, error } = await supabase
    .from("shipments")
    .select(SHIPMENT_DETAIL_COLUMNS)
    .eq("id", shipmentId)
    .eq("shipper_id", shipperId)
    .maybeSingle();
  if (error) {
    console.error("[shipper-shipments] summary read failed", error.message);
    return null;
  }
  return data ?? null;
}

/* ------------------------------------------------------------------ *
 * History (§7 timeline, §11 update history, §25 bounds)
 * ------------------------------------------------------------------ */

/** Events per history page. Newest first. */
export const TIMELINE_PAGE_SIZE = 25;

/** Ceiling a caller cannot raise. */
export const TIMELINE_MAX_PAGE_SIZE = 50;

export const SHIPMENT_EVENT_COLUMNS =
  "id, shipment_id, event_type, status, event_time, recorded_at, source, city, state, public_message, visibility";

/**
 * The event as a shipper sees it.
 *
 * `internal_message` and `metadata` are not projected AT ALL. 0019's policy
 * already keeps `staff_only` events out of the result set, but a `carrier`- or
 * `shipper`-band event can still carry an internal note in
 * `internal_message`, and §7's rule ("a staff-only note must never appear in
 * the customer timeline") is about the NOTE, not only about the row. Not
 * selecting the column is the version of that rule a future refactor cannot
 * accidentally undo.
 */
export type ShipmentTimelineEvent = Pick<
  ShipmentEventRow,
  | "id"
  | "shipment_id"
  | "event_type"
  | "status"
  | "event_time"
  | "recorded_at"
  | "source"
  | "city"
  | "state"
  | "public_message"
  | "visibility"
>;

export interface TimelinePage {
  events: ShipmentTimelineEvent[];
  /** True when older events exist beyond this page. */
  hasMore: boolean;
  /** Cursor for the next (older) page: the oldest `event_time` returned. */
  nextBefore: string | null;
  failed: boolean;
}

export function resolveTimelineLimit(raw?: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return TIMELINE_PAGE_SIZE;
  return Math.min(TIMELINE_MAX_PAGE_SIZE, Math.max(1, Math.floor(raw)));
}

/** ISO-8601 timestamp or null — the timeline cursor, validated. */
export function parseTimelineCursor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "" || value.length > 40) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * One bounded page of a shipment's history, newest first.
 *
 * KEYSET, not offset — the opposite choice from the list, and for the
 * opposite reason. History is read strictly forward ("show older"), never
 * jumped into, and an event table is exactly where an offset gets expensive.
 * The cursor is a timestamp with `id` as the tiebreak in the ordering, so two
 * events recorded in the same millisecond cannot straddle a page boundary.
 *
 * The visibility band is filtered IN SQL as well as by 0019's policy, so the
 * query uses `idx_shipment_events_audience` rather than reading rows the
 * policy will then discard.
 */
export async function getShipmentTimelinePage(
  supabase: ServerSupabase,
  shipmentId: string,
  options: { before?: string | null; limit?: number } = {},
): Promise<TimelinePage> {
  const limit = resolveTimelineLimit(options.limit);
  let query = supabase
    .from("shipment_events")
    .select(SHIPMENT_EVENT_COLUMNS)
    .eq("shipment_id", shipmentId)
    .in("visibility", AUDIENCE_EVENT_VISIBILITY.shipper);
  if (options.before) query = query.lt("event_time", options.before);

  const { data, error } = await query
    .order("event_time", { ascending: false })
    .order("id", { ascending: false })
    // One extra row answers "is there more?" without a second query — the
    // §25 lesson M-73 applied to the public timeline.
    .limit(limit + 1);

  if (error) {
    console.error("[shipper-shipments] timeline read failed", error.message);
    return { events: [], hasMore: false, nextBefore: null, failed: true };
  }
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return {
    events,
    hasMore,
    nextBefore: hasMore
      ? (events[events.length - 1]?.event_time ?? null)
      : null,
    failed: false,
  };
}

/* ------------------------------------------------------------------ *
 * Invoice status (§11) — read from `invoices`, never from the shipment
 * ------------------------------------------------------------------ */

/**
 * §11 requires "invoice status" on the detail page. M-70's DTO doc is explicit
 * about where it must NOT come from: `gross_shipper_amount` is §18 staff-only,
 * and *"§11's 'invoice status' is a fact about an invoice, not a column on the
 * shipment — M-74 reads it from `invoices`, where amounts already live under
 * their own RLS."*
 *
 * That is what this does. `invoices` gained `shipment_id` + `shipper_id` in
 * migration 0021 and a `"member read shipper invoices"` policy; the amount a
 * shipper sees is the amount on their OWN invoice, which they are entitled to
 * and which never passes through `shipments`.
 */
export interface ShipmentInvoiceView {
  id: string;
  status: InvoiceStatus;
  amount_cents: number;
  currency: string;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  hosted_url: string | null;
}

/** Invoice statuses that still want the customer's attention. */
export const OUTSTANDING_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "open",
];

export async function getShipmentInvoices(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<{ invoices: ShipmentInvoiceView[]; failed: boolean }> {
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, status, amount_cents, currency, issued_at, due_at, paid_at, hosted_url",
    )
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[shipper-shipments] invoice read failed", error.message);
    return { invoices: [], failed: true };
  }
  return { invoices: data ?? [], failed: false };
}

/* ------------------------------------------------------------------ *
 * Contacts (§11) — `shipment_parties`, under M-71's visibility rules
 * ------------------------------------------------------------------ */

export type ShipmentContactRow = Pick<
  ShipmentPartyRow,
  | "id"
  | "party_role"
  | "company_name"
  | "contact_name"
  | "phone"
  | "email"
  | "public_contact"
>;

/** A party as the shipper's page renders it — channels may be withheld. */
export interface ShipmentContactView {
  id: string;
  party_role: ShipmentPartyRow["party_role"];
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  /** True when a channel was withheld, so the UI can say so honestly. */
  channels_withheld: boolean;
}

/**
 * Party roles whose personal contact channels are NOT the shipper's to have
 * unless dispatch marked the row shareable.
 *
 * M-71 shipped `shipment_parties.public_contact` defaulting to **false** with
 * a stated reason: *"§8 forbids exposing a driver's personal number by
 * default and §4 forbids private carrier contact on the public page
 * outright."* 0018 encodes that for the BROKER audience (brokers read
 * `public_contact` rows only); the shipper audience has no such policy,
 * because a shipper legitimately owns its own consignee, billing and
 * notify-party records — those are the shipper's own counterparties.
 *
 * The carrier party is different. A carrier dispatcher's direct line (and,
 * where M-75 records one, a driver's mobile) is the CARRIER's contact data
 * sitting on the shipper's shipment, and PickLoads is the party in the
 * middle — §12's model, where counterparties reach each other through the
 * broker unless somebody approves otherwise. So the carrier row's channels
 * are withheld unless `public_contact` is true, and the UI says a channel was
 * withheld rather than rendering a blank cell that looks like missing data.
 *
 * `driver` is deliberately NOT in this list: §18's `shipment_party_role` has
 * no such value (M-70's six are shipper · consignee · broker_partner ·
 * carrier · billing · third_party), and naming a role the enum does not have
 * would be a rule that never fires. M-76 reaches drivers through a scoped
 * token, not a party row.
 *
 * Pure and exported so the rule is a unit test rather than a paragraph.
 */
export const CARRIER_SIDE_ROLES: readonly ShipmentPartyRow["party_role"][] = [
  "carrier",
];

export function toShipmentContactViews(
  rows: readonly ShipmentContactRow[],
): ShipmentContactView[] {
  return rows.map((row) => {
    const restricted =
      CARRIER_SIDE_ROLES.includes(row.party_role) &&
      row.public_contact !== true;
    return {
      id: row.id,
      party_role: row.party_role,
      company_name: row.company_name,
      contact_name: restricted ? null : row.contact_name,
      phone: restricted ? null : row.phone,
      email: restricted ? null : row.email,
      channels_withheld:
        restricted && (row.phone !== null || row.email !== null),
    };
  });
}

export async function getShipmentContacts(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<{ contacts: ShipmentContactView[]; failed: boolean }> {
  const { data, error } = await supabase
    .from("shipment_parties")
    .select(
      "id, party_role, company_name, contact_name, phone, email, public_contact",
    )
    .eq("shipment_id", shipmentId)
    .order("party_role", { ascending: true })
    .limit(25);
  if (error) {
    console.error("[shipper-shipments] contacts read failed", error.message);
    return { contacts: [], failed: true };
  }
  return { contacts: toShipmentContactViews(data ?? []), failed: false };
}
