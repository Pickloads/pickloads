import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  SHIPMENT_EVENT_COLUMNS,
  TIMELINE_PAGE_SIZE,
  parseTimelineCursor,
  resolveTimelineLimit,
} from "@/lib/shipments/shipper-detail";
import {
  NO_TRANSITION_FACTS,
  type TransitionFacts,
} from "@/lib/shipments/transitions";
import { getShipmentRestrictedFields } from "@/lib/shipments/restricted-fields";
import type {
  ShipmentAssignmentRow,
  ShipmentEventRow,
  ShipmentPartyRow,
  ShipmentRow,
} from "@/lib/shipments/types";

/**
 * M-75 — the STAFF read of one shipment: summary, update history, assignment
 * history, parties, and the option lists the §14 forms need.
 *
 * ── §25's SUMMARY-VS-HISTORY SPLIT, AGAIN AND FOR THE SAME REASON ─────────
 *
 * §25: *"query current summary separately from full history when needed"* and
 * *"do not load all events or documents by default when a shipment has a large
 * history."* M-74 proved the split for the shipper detail page; a dispatcher
 * page is where it matters MORE, not less — a dispatcher opens dozens of
 * shipments a day and the ones they open are the ones with the most events.
 *
 * `getStaffShipment` touches `shipments` and nothing else.
 * `getStaffTimelinePage` is keyset-paginated with a lookahead row, exactly as
 * M-74's is, and reuses M-74's cursor parser and bound rather than declaring a
 * second pair.
 *
 * ── WHAT A STAFF READ INCLUDES THAT A CUSTOMER READ DOES NOT ──────────────
 *
 * Everything in the §7 timeline: all five visibility bands, `internal_message`
 * and `metadata`. That is the point of a staff surface, it is what 0019's
 * `"staff manage shipment events"` policy already permits, and §14's "view
 * update history" is unanswerable without it.
 *
 * ONE COLUMN IS STILL WITHHELD, from staff too: `public_access_hash`. M-70 is
 * unambiguous — *"It is a CREDENTIAL, not data: no DTO in this module
 * serializes it at any audience, including staff."* A staff page that renders
 * it turns a §4 second factor into something that leaks through a screen
 * share. The financial trio IS selected here, because §18 marks it staff-only
 * rather than nobody-only and a dispatcher cannot quote a rate they cannot
 * see.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every `shipments` column except `public_access_hash`. Written out rather
 * than `select("*")` so the exclusion is visible in the diff that would
 * remove it, and so a future column is a decision rather than an inheritance.
 */
export const SHIPMENT_STAFF_COLUMNS =
  "id, tracking_number, shipper_id, carrier_id, dispatcher_id, quote_id, broker_partner_id, load_id, status, " +
  "origin_company, origin_address, origin_city, origin_state, origin_zip, " +
  "destination_company, destination_address, destination_city, destination_state, destination_zip, " +
  "pickup_appointment_at, delivery_appointment_at, " +
  "equipment, commodity_category, weight_lbs, pallets, distance_miles, " +
  "shipper_reference, po_number, " +
  "public_tracking_enabled, tracking_mode, location_visibility, " +
  "current_latitude, current_longitude, current_city, current_state, last_location_at, " +
  "estimated_pickup_at, estimated_delivery_at, eta_source, eta_confidence, eta_updated_at, " +
  "delay_minutes, delay_reason_public, " +
  "created_at, updated_at, completed_at, cancelled_at, cancellation_reason";

/** The staff projection as a type. `public_access_hash` is absent BY TYPE, so
 *  rendering it is a compile error rather than a review miss. */
export type StaffShipmentRow = Omit<ShipmentRow, "public_access_hash">;

/**
 * The columns a browser session — staff sessions included — may no longer
 * name on `shipments` at all (M-83, migration 0030 §4). They are re-joined
 * onto the staff row below from `shipment_restricted_fields()`, which applies
 * the audience rule in SQL. Exported so the unit lane can assert the staff
 * projection does not contain them.
 */
export const SHIPMENT_RESTRICTED_COLUMNS = [
  "gross_shipper_amount",
  "carrier_pay",
  "margin",
  "delay_reason_internal",
] as const;

/**
 * ── WHY THIS IS NOW TWO QUERIES (M-83) ───────────────────────────────────
 *
 * Until M-83 the four columns above came back in this projection, and M-71's
 * residual risk R-1 was the price: RLS is row-level, so a customer's own row
 * carried them too. 0030 revokes them from every browser role and returns
 * them through a SECURITY DEFINER accessor. A dispatcher out of scope now
 * gets `null` financials from a shipment they can no longer open anyway; an
 * admin gets the same values as before. The second round trip is on the
 * DETAIL page only — no list projection names these columns.
 */
export async function getStaffShipment(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<StaffShipmentRow | null> {
  const [{ data, error }, restricted] = await Promise.all([
    supabase
      .from("shipments")
      .select(SHIPMENT_STAFF_COLUMNS)
      .eq("id", shipmentId)
      .maybeSingle(),
    getShipmentRestrictedFields(supabase, shipmentId),
  ]);
  if (error) {
    console.error("[shipment-staff] summary read failed", error.message);
    return null;
  }
  const base = (data as StaffShipmentRow | null) ?? null;
  if (base === null) return null;
  // `restricted` is spread LAST: the four keys are absent from `base` at
  // runtime (the projection no longer names them) and the accessor is the
  // only thing entitled to fill them.
  return { ...base, ...restricted };
}

/* ------------------------------------------------------------------ *
 * §14 "view update history"
 * ------------------------------------------------------------------ */

/**
 * The staff event projection: M-74's customer columns PLUS the two a customer
 * never sees. `SHIPMENT_EVENT_COLUMNS` is reused verbatim as the base so the
 * two projections cannot drift into disagreeing about what an event is.
 */
export const SHIPMENT_STAFF_EVENT_COLUMNS = `${SHIPMENT_EVENT_COLUMNS}, internal_message, metadata, created_by, idempotency_key, external_event_id`;

export type StaffTimelineEvent = Pick<
  ShipmentEventRow,
  | "id"
  | "shipment_id"
  | "event_type"
  | "status"
  | "event_time"
  | "recorded_at"
  | "source"
  | "created_by"
  | "city"
  | "state"
  | "public_message"
  | "internal_message"
  | "visibility"
  | "metadata"
  | "idempotency_key"
  | "external_event_id"
>;

export interface StaffTimelinePage {
  events: StaffTimelineEvent[];
  /** Cursor for "show older", or null at the end of history. */
  nextCursor: string | null;
  failed: boolean;
}

/**
 * One page of the full timeline, newest first.
 *
 * Keyset on `(event_time desc, id desc)` with ONE lookahead row, so "is there
 * more?" costs no second count query — the technique M-73 and M-74 both use,
 * against the `idx_shipment_events_timeline` index M-72 built for it.
 */
export async function getStaffTimelinePage(
  supabase: ServerSupabase,
  shipmentId: string,
  cursor?: unknown,
  limit?: number,
): Promise<StaffTimelinePage> {
  const size = resolveTimelineLimit(limit);
  const before = parseTimelineCursor(cursor);

  let query = supabase
    .from("shipment_events")
    .select(SHIPMENT_STAFF_EVENT_COLUMNS)
    .eq("shipment_id", shipmentId);
  if (before !== null) query = query.lt("event_time", before);

  const { data, error } = await query
    .order("event_time", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);

  if (error) {
    console.error("[shipment-staff] timeline read failed", error.message);
    return { events: [], nextCursor: null, failed: true };
  }

  const rows = (data ?? []) as StaffTimelineEvent[];
  const hasMore = rows.length > size;
  const events = hasMore ? rows.slice(0, size) : rows;
  return {
    events,
    nextCursor: hasMore ? (events[events.length - 1]?.event_time ?? null) : null,
    failed: false,
  };
}

export { TIMELINE_PAGE_SIZE };

/* ------------------------------------------------------------------ *
 * Assignments and parties
 * ------------------------------------------------------------------ */

/** Bound on assignment history. A shipment with 20 reassignments is a crisis,
 *  not a pagination problem. */
export const ASSIGNMENT_HISTORY_LIMIT = 20;

export type StaffAssignmentRow = ShipmentAssignmentRow;

export async function getShipmentAssignments(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<StaffAssignmentRow[]> {
  const { data, error } = await supabase
    .from("shipment_assignments")
    .select(
      "id, shipment_id, carrier_id, driver_id, truck_id, dispatcher_id, assigned_by, assigned_at, released_at, release_reason",
    )
    .eq("shipment_id", shipmentId)
    .order("assigned_at", { ascending: false })
    .limit(ASSIGNMENT_HISTORY_LIMIT);
  if (error) {
    console.error("[shipment-staff] assignment read failed", error.message);
    return [];
  }
  return (data ?? []) as StaffAssignmentRow[];
}

export const PARTY_LIMIT = 20;

export async function getShipmentPartiesForStaff(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<ShipmentPartyRow[]> {
  const { data, error } = await supabase
    .from("shipment_parties")
    .select(
      "id, shipment_id, party_role, organization_id, company_name, contact_name, phone, email, public_contact, created_at",
    )
    .eq("shipment_id", shipmentId)
    .order("party_role", { ascending: true })
    .limit(PARTY_LIMIT);
  if (error) {
    console.error("[shipment-staff] party read failed", error.message);
    return [];
  }
  return (data ?? []) as ShipmentPartyRow[];
}

/* ------------------------------------------------------------------ *
 * Option lists for the §14 forms
 * ------------------------------------------------------------------ */

export interface CarrierOption {
  id: string;
  name: string;
}
export interface StaffOption {
  id: string;
  name: string;
}
export interface FleetOption {
  id: string;
  carrierId: string;
  label: string;
}

export const OPTION_LIMIT = 500;

/**
 * Carriers a dispatcher may assign.
 *
 * SCOPED, and this is the least obvious place the §19 rule matters: an
 * unscoped carrier dropdown lets a dispatcher assign a carrier they do not
 * manage, which creates a shipment they then CAN see (the `carrier_id` arm of
 * the scope expression) — a privilege escalation through a `<select>`. Admins
 * get the full list.
 */
export async function getAssignableCarriers(
  supabase: ServerSupabase,
  carrierIds: string[] | null,
): Promise<CarrierOption[]> {
  let query = supabase
    .from("carriers")
    .select("id, company_name")
    .order("company_name")
    .limit(OPTION_LIMIT);
  if (carrierIds !== null) {
    if (carrierIds.length === 0) return [];
    query = query.in("id", carrierIds);
  }
  const { data } = await query;
  return (data ?? []).map((c) => ({ id: c.id, name: c.company_name }));
}

export async function getStaffOptions(
  supabase: ServerSupabase,
): Promise<StaffOption[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("role", ["admin", "dispatcher"])
    .limit(OPTION_LIMIT);
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name ?? "Staff" }));
}

/** M-50's fleet, for the optional driver/truck legs of an assignment. */
export async function getCarrierFleet(
  supabase: ServerSupabase,
  carrierId: string | null,
): Promise<{ drivers: FleetOption[]; trucks: FleetOption[] }> {
  if (carrierId === null) return { drivers: [], trucks: [] };
  const [{ data: drivers }, { data: trucks }] = await Promise.all([
    supabase
      .from("drivers")
      .select("id, carrier_id, full_name, active")
      .eq("carrier_id", carrierId)
      .eq("active", true)
      .limit(OPTION_LIMIT),
    supabase
      .from("trucks")
      .select("id, carrier_id, unit_number, equipment, active")
      .eq("carrier_id", carrierId)
      .eq("active", true)
      .limit(OPTION_LIMIT),
  ]);
  return {
    drivers: (drivers ?? []).map((d) => ({
      id: d.id,
      carrierId: d.carrier_id,
      label: d.full_name,
    })),
    trucks: (trucks ?? []).map((t) => ({
      id: t.id,
      carrierId: t.carrier_id,
      label: `${t.unit_number ?? "Unit"} · ${t.equipment}`,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * §20 facts, for rendering only the transitions that would succeed
 * ------------------------------------------------------------------ */

/**
 * The §20 facts, derived from data a STAFF PAGE can already read.
 *
 * WHY NOT `shipment_transition_facts()`: that function is EXECUTE-granted to
 * `service_role` alone (0019), and a page that reached for the admin client to
 * decide which BUTTONS to draw would be holding a service-role key for a
 * presentation decision. The server action re-resolves the real facts through
 * the RPC before writing, so this read is advisory — it decides what is
 * OFFERED, never what is ALLOWED.
 *
 * M-77 supplies `approvedPodDocumentId` from the document list the page has
 * already read — so `pod_uploaded` is OFFERED once an approved POD exists and
 * not before. Passing it here rather than defaulting it to null is what makes
 * the button appear at the same moment the engine would start accepting the
 * transition; the authoritative check is still 0024's
 * `shipment_transition_facts()`, re-resolved by the action before any write.
 *
 * `closeoutCompletedAt` stays null on purpose: it is the human assertion the
 * completion form makes, which is exactly what M-72 said M-75 must do.
 */
export function staffTransitionFacts(
  shipment: Pick<StaffShipmentRow, "cancellation_reason">,
  assignments: readonly StaffAssignmentRow[],
  events: readonly StaffTimelineEvent[],
  approvedPodDocumentId: string | null = null,
): TransitionFacts {
  const open = assignments.find((a) => a.released_at === null) ?? null;
  const pickupConfirmed =
    events.find(
      (e) =>
        e.status === "arrived_at_pickup" ||
        e.status === "loading" ||
        e.status === "picked_up",
    ) ?? null;
  const delivered = events.find((e) => e.status === "delivered") ?? null;
  return {
    ...NO_TRANSITION_FACTS,
    activeAssignmentId: open?.id ?? null,
    pickupConfirmedAt: pickupConfirmed?.event_time ?? null,
    deliveredAt: delivered?.event_time ?? null,
    approvedPodDocumentId,
    cancellationReason: shipment.cancellation_reason,
  };
}
