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
  toShipmentContactViews,
  type ShipmentContactRow,
  type ShipmentContactView,
  type ShipmentTimelineEvent,
  type TimelinePage,
} from "@/lib/shipments/shipper-detail";
import { getMyBrokerPartnerId } from "@/lib/memberships";
import type { ShipmentRow } from "@/lib/shipments/types";

/**
 * M-81 — the broker partner's own reads (§12, §19, §25).
 *
 * ── WHAT IS REUSED, AND WHY THAT IS NOT LAZINESS ─────────────────────────
 *
 * `applyShipmentFilters`, `pageRange` and the timeline cursor helpers are
 * M-74's and are IMPORTED. M-76 recorded the reason and it is unchanged:
 * `MAX_PAGE_SIZE` is asserted to be the ceiling of every `shipments` read, and
 * a second module with its own constant would make that assertion true and
 * meaningless.
 *
 * What is NOT reused is the PROJECTION — and here that is the whole module.
 * The broker column list is generated from nothing; it is written out and
 * pinned, field for field, against `BROKER_FIELD_POLICY` by
 * `tests/unit/shipment-broker-permissions.test.ts`. §12's denied columns are
 * therefore absent from the SQL as well as from the DTO, so they never enter
 * process memory on a broker request at all. That is defence in depth behind
 * `toBrokerDto`'s allow-list, not a substitute for it.
 *
 * ── COOKIE-BOUND CLIENT ONLY ─────────────────────────────────────────────
 *
 * Every function takes the caller's `createClient()` server client, so every
 * read runs under 0018/0019/0024's `"broker member read …"` policies AND
 * 0029's `"broker shared read …"` policies. `tryCreateAdminClient` is never
 * imported here. Membership resolves through `getMyBrokerPartnerId`, never
 * from the request.
 *
 * ── WHY THERE IS NO `.eq("broker_partner_id", …)` PREDICATE ──────────────
 *
 * Every other portal list adds the tenant predicate alongside the policy, for
 * the index and for EXPLAIN legibility. This one CANNOT: §12 gives a broker
 * three ways to reach a shipment (party link, per-shipment grant, account
 * agreement) and only the first is a column on `shipments`. Adding
 * `.eq("broker_partner_id", id)` would silently hide every shipment shared by
 * grant or agreement — a filter that looks like defence in depth and is
 * actually a bug.
 *
 * So the predicate is `.in("id", …)` over the ids `broker_can_read_shipment()`
 * already authorized, resolved by `getBrokerShipmentIds()` below. Two bounded
 * reads instead of one, and the same two guarantees: the policy decides, and
 * the predicate keeps the plan on `shipments_pkey` rather than a sequential
 * scan filtered afterwards.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Membership (§12 "attached to a broker organization")
 * ------------------------------------------------------------------ */

/**
 * Re-exported from M-57's membership module, where its two siblings live.
 * Declaring a fourth membership lookup here would be the second doctrine
 * `docs/modules/M-57-membership-architecture.md` exists to prevent.
 */
export { getMyBrokerPartnerId } from "@/lib/memberships";

/**
 * What the broker portal needs to know about the caller's organization.
 *
 * `verified` is not read from a column and then trusted — it is the answer to
 * "does 0018's `"member read own broker partner"` policy return the row?",
 * and that policy is `id in (select my_broker_partner_ids())`, which is the
 * exact predicate every other broker policy uses. So a `verified: false`
 * here and a policy refusal downstream cannot disagree: they are the same
 * question asked once.
 */
export interface BrokerPartnerState {
  /** The membership exists (the user was invited and accepted). */
  memberOf: string | null;
  /** The organization is active AND verified — §12's gate. */
  verified: boolean;
  /** Present only when verified; the org row is unreadable otherwise. */
  companyName: string | null;
}

export async function getBrokerPartnerState(
  supabase: ServerSupabase,
): Promise<BrokerPartnerState> {
  const memberOf = await getMyBrokerPartnerId(supabase);
  if (memberOf === null) {
    return { memberOf: null, verified: false, companyName: null };
  }
  const { data, error } = await supabase
    .from("broker_partners")
    .select("id, company_name")
    .eq("id", memberOf)
    .maybeSingle();
  if (error) {
    console.error("[broker-access] partner read failed", error.message);
    return { memberOf, verified: false, companyName: null };
  }
  return {
    memberOf,
    verified: data !== null,
    companyName: data?.company_name ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Reachable shipment ids (§12's three grant shapes, resolved once)
 * ------------------------------------------------------------------ */

/**
 * §25: a broker organization's reachable set is bounded like everything else.
 *
 * Deliberately larger than a page — the id read feeds a filtered, paginated
 * query, so it has to cover more than one page's worth or page 2 would be
 * built from a truncated universe. Ten pages of headroom at
 * `MAX_PAGE_SIZE = 50`.
 */
export const BROKER_REACHABLE_LIMIT = 500;

export interface BrokerShipmentIds {
  ids: string[];
  /** True when the organization has more reachable shipments than the bound. */
  truncated: boolean;
  failed: boolean;
}

/**
 * Every shipment id this session's broker organization may read, from all
 * three §12 shapes, deduplicated.
 *
 * The three reads are issued CONCURRENTLY and every one of them runs under a
 * policy: `shipments` under M-71's floor policy, `broker_shipment_grants`
 * under 0029's `"member read own broker grants"`, `broker_account_agreements`
 * under `"member read own broker agreements"`. Nothing here trusts a
 * parameter — `partnerId` is used as a predicate for the index, and the
 * policies are what make the answer correct.
 *
 * The agreement branch resolves to shipment ids through a second bounded read
 * on `shipments` by `shipper_id`. That read is ALSO policy-gated: 0029's
 * `"broker shared read shipments"` is what returns those rows, so a bug in
 * this function's shipper list cannot produce a row the database would not
 * have released anyway.
 */
export async function getBrokerShipmentIds(
  supabase: ServerSupabase,
  partnerId: string,
): Promise<BrokerShipmentIds> {
  const [linked, grants, agreements] = await Promise.all([
    supabase
      .from("shipments")
      .select("id")
      .eq("broker_partner_id", partnerId)
      .order("created_at", { ascending: false })
      .limit(BROKER_REACHABLE_LIMIT + 1),
    supabase
      .from("broker_shipment_grants")
      .select("shipment_id")
      .eq("broker_partner_id", partnerId)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false })
      .limit(BROKER_REACHABLE_LIMIT + 1),
    supabase
      .from("broker_account_agreements")
      .select("shipper_id")
      .eq("broker_partner_id", partnerId)
      .is("revoked_at", null)
      .limit(50),
  ]);

  if (linked.error || grants.error || agreements.error) {
    console.error(
      "[broker-access] reachable id read failed",
      linked.error?.message ?? grants.error?.message ?? agreements.error?.message,
    );
    return { ids: [], truncated: false, failed: true };
  }

  const ids = new Set<string>();
  for (const row of linked.data ?? []) ids.add(row.id);
  for (const row of grants.data ?? []) ids.add(row.shipment_id);

  // The agreement window is evaluated by the DATABASE (0029's function has the
  // `now()` comparison), not here: a window check written twice is a window
  // check that eventually disagrees with itself. This read simply asks for the
  // shipper's shipments and lets `"broker shared read shipments"` decide.
  const shipperIds = [
    ...new Set((agreements.data ?? []).map((row) => row.shipper_id)),
  ];
  if (shipperIds.length > 0) {
    const { data, error } = await supabase
      .from("shipments")
      .select("id")
      .in("shipper_id", shipperIds)
      .order("created_at", { ascending: false })
      .limit(BROKER_REACHABLE_LIMIT + 1);
    if (error) {
      console.error("[broker-access] agreement id read failed", error.message);
      return { ids: [], truncated: false, failed: true };
    }
    for (const row of data ?? []) ids.add(row.id);
  }

  const all = [...ids];
  return {
    ids: all.slice(0, BROKER_REACHABLE_LIMIT),
    truncated: all.length > BROKER_REACHABLE_LIMIT,
    failed: false,
  };
}

/* ------------------------------------------------------------------ *
 * List (§12 "assigned shipments", §25 bounded)
 * ------------------------------------------------------------------ */

/**
 * Explicit projection for the LIST.
 *
 * No financial column of any kind — §12 forbids all three, and unlike the
 * carrier there is no "their own contract" exception to make. Every name here
 * is `decision: "allow"` in `BROKER_FIELD_POLICY`, asserted by test.
 */
export const BROKER_LIST_COLUMNS =
  "id, tracking_number, status, origin_city, origin_state, destination_city, destination_state, pickup_appointment_at, delivery_appointment_at, estimated_delivery_at, delay_minutes, equipment, shipper_reference, po_number, created_at, updated_at";

export type BrokerListRow = Pick<
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
  | "created_at"
  | "updated_at"
>;

export interface BrokerListResult {
  rows: BrokerListRow[];
  total: number | null;
  page: number;
  pageSize: number;
  pageCount: number;
  /** True when the read failed — an honest error beats a fake zero. */
  failed: boolean;
  /** True when the organization reaches more shipments than the id bound. */
  truncated: boolean;
}

/** One page of the shipments this broker organization may read. */
export async function getBrokerShipments(
  supabase: ServerSupabase,
  partnerId: string,
  filters: ShipmentListFilters,
  page: number,
  pageSize?: number,
): Promise<BrokerListResult> {
  const range = pageRange(page, pageSize);
  const reachable = await getBrokerShipmentIds(supabase, partnerId);
  if (reachable.failed) {
    return {
      rows: [],
      total: null,
      page: range.page,
      pageSize: range.pageSize,
      pageCount: 1,
      failed: true,
      truncated: false,
    };
  }
  if (reachable.ids.length === 0) {
    return {
      rows: [],
      total: 0,
      page: range.page,
      pageSize: range.pageSize,
      pageCount: 1,
      failed: false,
      truncated: false,
    };
  }

  const base = supabase
    .from("shipments")
    .select(BROKER_LIST_COLUMNS, { count: "exact" })
    .in("id", reachable.ids);

  const { data, count, error } = await applyShipmentFilters(base, filters)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(range.from, range.to);

  if (error) {
    console.error("[broker-access] list read failed", error.message);
    return {
      rows: [],
      total: null,
      page: range.page,
      pageSize: range.pageSize,
      pageCount: 1,
      failed: true,
      truncated: reachable.truncated,
    };
  }

  const total = count ?? null;
  return {
    rows: data ?? [],
    total,
    page: range.page,
    pageSize: range.pageSize,
    pageCount:
      total === null
        ? range.page
        : Math.max(1, Math.ceil(total / range.pageSize)),
    failed: false,
    truncated: reachable.truncated,
  };
}

/** Does this broker organization reach ANY shipment? (§2's gate question.) */
export async function brokerHasAnyShipment(
  supabase: ServerSupabase,
  partnerId: string,
): Promise<boolean> {
  const reachable = await getBrokerShipmentIds(supabase, partnerId);
  return reachable.ids.length > 0;
}

/* ------------------------------------------------------------------ *
 * Detail (§25 summary-vs-history split)
 * ------------------------------------------------------------------ */

/**
 * Explicit projection for the DETAIL page — every `allow` cell of
 * `BROKER_FIELD_POLICY` and `carrier_id`, which becomes the
 * `carrier_assigned` boolean and is never serialized itself.
 *
 * `gross_shipper_amount`, `carrier_pay`, `margin`, `delay_reason_internal`,
 * `public_access_hash`, `shipper_id`, `dispatcher_id`, `quote_id`, `load_id`,
 * `broker_partner_id` and `public_tracking_enabled` are named NOWHERE in this
 * projection, so §12's prohibitions hold at the query layer too and not only
 * in the serializer.
 */
export const BROKER_DETAIL_COLUMNS =
  "id, tracking_number, carrier_id, status, origin_company, origin_address, origin_city, origin_state, origin_zip, destination_company, destination_address, destination_city, destination_state, destination_zip, pickup_appointment_at, delivery_appointment_at, equipment, commodity_category, weight_lbs, pallets, distance_miles, shipper_reference, po_number, tracking_mode, location_visibility, current_latitude, current_longitude, current_city, current_state, last_location_at, estimated_pickup_at, estimated_delivery_at, eta_source, eta_confidence, eta_updated_at, delay_minutes, delay_reason_public, cancellation_reason, completed_at, cancelled_at, created_at, updated_at";

/**
 * The shipment row as the broker detail page sees it.
 *
 * `Omit` rather than `Pick`, for M-74's reason restated: a NEW column on
 * `ShipmentRow` becomes a compile error here until somebody decides whether a
 * broker partner may see it — the same forcing function
 * `BROKER_FIELD_POLICY`'s full `Record` applies one layer up.
 */
export type BrokerDetailRow = Omit<
  ShipmentRow,
  | "shipper_id"
  | "dispatcher_id"
  | "quote_id"
  | "broker_partner_id"
  | "load_id"
  | "gross_shipper_amount"
  | "carrier_pay"
  | "margin"
  | "public_tracking_enabled"
  | "public_access_hash"
  | "delay_reason_internal"
>;

/**
 * One shipment, by id, for one broker organization.
 *
 * `null` when it does not exist OR this organization has no link, grant or
 * agreement for it — the page turns both into a 404, the only answer that
 * does not confirm another partner's freight exists (§3's URL-manipulation
 * rule, M-73's one-indistinguishable-refusal idiom).
 *
 * NOTE: there is no `.eq(…)` tenant predicate, for the reason in this file's
 * header — the tenant test is `broker_can_read_shipment()` inside 0029's
 * policy, and it is three-branched. `partnerId` is still required, because a
 * caller that cannot name its organization has no business reading a
 * shipment, and the id set is what the caller used to reach this row.
 */
export async function getBrokerShipmentSummary(
  supabase: ServerSupabase,
  partnerId: string,
  shipmentId: string,
): Promise<BrokerDetailRow | null> {
  const reachable = await getBrokerShipmentIds(supabase, partnerId);
  if (reachable.failed || !reachable.ids.includes(shipmentId)) return null;

  const { data, error } = await supabase
    .from("shipments")
    .select(BROKER_DETAIL_COLUMNS)
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) {
    console.error("[broker-access] summary read failed", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * One bounded page of the broker-visible timeline, newest first.
 *
 * The band list is `AUDIENCE_EVENT_VISIBILITY.broker` — `public` + `broker`,
 * M-70's table, applied IN SQL as well as by 0019's and 0029's policies so the
 * query uses `idx_shipment_events_audience` rather than fetching rows the
 * policy will then discard.
 */
export async function getBrokerTimelinePage(
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
    .in("visibility", AUDIENCE_EVENT_VISIBILITY.broker);
  if (options.before) query = query.lt("event_time", options.before);

  const { data, error } = await query
    .order("event_time", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (error) {
    console.error("[broker-access] timeline read failed", error.message);
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
 * Contacts (§12 "approved contact channels")
 * ------------------------------------------------------------------ */

/**
 * The party rows a broker may read — and the `.eq("public_contact", true)`
 * predicate IS repeated here even though 0018 and 0029 both carry it, because
 * unlike the shipment predicate this one is not three-branched and a query
 * that fetched private rows only to have RLS drop them would be a query
 * one policy edit away from leaking.
 *
 * The view mapper is M-74's `toShipmentContactViews`, unchanged: it withholds
 * the carrier row's personal channels unless dispatch approved them, which is
 * a SECOND narrowing on top of `public_contact` and costs a broker nothing
 * they were entitled to.
 */
export async function getBrokerShipmentContacts(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<{ contacts: ShipmentContactView[]; failed: boolean }> {
  const { data, error } = await supabase
    .from("shipment_parties")
    // Literal, not `BROKER_CONTACT_COLUMNS.join()`: supabase-js infers the row
    // type from the string, and a computed one collapses it to `any`. The
    // constant is still the source of truth — a unit test asserts this string
    // equals it plus the `public_contact` predicate column.
    .select(
      "id, party_role, company_name, contact_name, phone, email, public_contact",
    )
    .eq("shipment_id", shipmentId)
    .eq("public_contact", true)
    .order("party_role", { ascending: true })
    .limit(25);
  if (error) {
    console.error("[broker-access] contacts read failed", error.message);
    return { contacts: [], failed: true };
  }
  return {
    contacts: toShipmentContactViews((data ?? []) as ShipmentContactRow[]),
    failed: false,
  };
}

/* ------------------------------------------------------------------ *
 * How this shipment became visible (§15's access history, customer side)
 * ------------------------------------------------------------------ */

export interface BrokerAccessBasis {
  /** `link` · `grant` · `agreement` — §12's three shapes. */
  kind: "link" | "grant" | "agreement";
  since: string | null;
  reference: string | null;
}

/**
 * Why this partner can see this shipment.
 *
 * Rendered in the portal because a partner who cannot tell a per-shipment
 * share from a standing agreement cannot tell when their access is about to
 * end — and §30's honest-states rule applies to permissions as much as to
 * tracking.
 *
 * ── THE ONE PLACE `shipper_id` IS READ ON A BROKER PATH, AND WHY ─────────
 *
 * The third branch needs to know which shipper the shipment belongs to in
 * order to match it against the partner's own agreements. `BROKER_FIELD_POLICY`
 * denies `shipper_id` — and that policy governs what reaches a broker PAYLOAD.
 * This value never does: it is compared against agreement rows inside this
 * function and discarded, and `BrokerAccessBasis` has no field that could
 * carry it. The alternative was one query per live agreement, which is §25's
 * N+1 in exchange for a distinction that does not exist.
 *
 * All three reads are policy-gated: the shipment row comes back only because
 * 0029's `"broker shared read shipments"` already released it, and both
 * broker tables are scoped by `my_broker_partner_ids()`.
 */
export async function getBrokerAccessBasis(
  supabase: ServerSupabase,
  partnerId: string,
  shipmentId: string,
): Promise<BrokerAccessBasis | null> {
  const { data: grant } = await supabase
    .from("broker_shipment_grants")
    .select("granted_at, note")
    .eq("shipment_id", shipmentId)
    .eq("broker_partner_id", partnerId)
    .is("revoked_at", null)
    .maybeSingle();
  if (grant) {
    return { kind: "grant", since: grant.granted_at, reference: grant.note };
  }

  const { data: shipment } = await supabase
    .from("shipments")
    .select("shipper_id, broker_partner_id")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!shipment) return null;
  if (shipment.broker_partner_id === partnerId) {
    return { kind: "link", since: null, reference: null };
  }

  const { data: agreement } = await supabase
    .from("broker_account_agreements")
    .select("starts_at, agreement_reference")
    .eq("broker_partner_id", partnerId)
    .eq("shipper_id", shipment.shipper_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (agreement) {
    return {
      kind: "agreement",
      since: agreement.starts_at,
      reference: agreement.agreement_reference,
    };
  }
  return null;
}
