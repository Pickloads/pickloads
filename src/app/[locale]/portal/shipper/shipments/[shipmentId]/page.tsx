import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, getPathname } from "@/i18n/navigation";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import { getMyShipperId } from "@/lib/memberships";
import { toShipperDto } from "@/lib/shipments/dto";
import {
  getShipmentContacts,
  getShipmentInvoices,
  getShipmentSummary,
  getShipmentTimelinePage,
  parseTimelineCursor,
} from "@/lib/shipments/shipper-detail";
import { listShipmentDocuments } from "@/lib/shipments/document-store";
import {
  listCustomerExceptions,
  toCustomerExceptionRows,
} from "@/lib/shipments/exceptions";
import { listCustomerLocations } from "@/lib/shipments/locations";
import { ShipmentDetailView } from "@/components/portal/ShipmentDetailView";
import type { ShipmentEventRow, ShipmentRow } from "@/lib/shipments/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shipment — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M-74 — `/portal/shipper/shipments/[shipmentId]` (§11's shipment detail).
 *
 * ── EVERY "NOT YOURS" IS A 404, NEVER A 403 ───────────────────────────────
 *
 * §3: *"No role may access another company's shipment through URL
 * manipulation, API calls or direct database requests."* A 403 would answer
 * the question the URL manipulator is asking — *does this id exist?* — so a
 * malformed id, a nonexistent id and another shipper's id all produce the
 * SAME `notFound()`. That is M-73's one-indistinguishable-refusal rule
 * applied to an authenticated surface.
 *
 * Two independent mechanisms produce it: 0018's policy returns no row to a
 * session outside the owning organization, AND `getShipmentSummary` also
 * filters `.eq("shipper_id", …)`. The policy is the guarantee; the predicate
 * makes the query use `idx_shipments_shipper` and makes a mistake visible in
 * an EXPLAIN rather than only in a penetration test. `tests/integration/
 * shipper-shipments.test.ts` proves the policy half by DISABLING the
 * predicate — non-vacuity by injection, not by assertion.
 *
 * ── §25's SUMMARY-vs-HISTORY SPLIT ────────────────────────────────────────
 *
 * Two queries, not one join: `getShipmentSummary` reads the shipment row and
 * touches `shipment_events` not at all, and `getShipmentTimelinePage` reads a
 * BOUNDED page of history. Everything above the fold therefore costs one
 * indexed lookup whether the shipment has four events or four thousand, and
 * `?before=` walks older history without ever fetching all of it. The four
 * reads run concurrently — one round trip, not four (§25 "no N+1").
 */
export default async function ShipperShipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; shipmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, shipmentId } = await params;
  await requireShipper(locale);
  const tv = await getV4(locale);
  const sp = await searchParams;
  const supabase = await createClient();

  // A non-UUID cannot be a shipment id. Refusing before the query keeps a
  // scripted scan out of the database entirely, and produces the same 404.
  if (!UUID.test(shipmentId)) notFound();

  const shipperId = await getMyShipperId(supabase);
  if (shipperId === null) notFound();

  const before = parseTimelineCursor(
    Array.isArray(sp.before) ? sp.before[0] : sp.before,
  );

  // M-77 joins the fan-out rather than adding a fifth round trip: §25's "no
  // N+1" is about the number of round trips, and five concurrent reads is one.
  // The document read is BOUNDED (`DOCUMENT_PAGE_SIZE` + 1 to answer "is there
  // more?"), so a shipment with four hundred documents costs what one with
  // four costs.
  // M-78 adds a SIXTH concurrent read on the same principle: §21's exceptions,
  // through 0025's `my_shipment_exceptions()` under the caller's own session,
  // which resolves the audience from their memberships and whose return type
  // carries neither `internal_description` nor `resolution`.
  // M-80 adds a SEVENTH, same principle: §9's location history through
  // 0027's `my_shipment_locations()` under the caller's own session, which
  // resolves the audience from their memberships and applies the four privacy
  // levels IN SQL — so a `hidden` shipment returns zero rows rather than rows
  // this process then has to remember to redact.
  const [
    summary,
    history,
    invoiceResult,
    contactResult,
    documentResult,
    exceptionResult,
    locationResult,
  ] = await Promise.all([
    getShipmentSummary(supabase, shipperId, shipmentId),
    getShipmentTimelinePage(supabase, shipmentId, { before }),
    getShipmentInvoices(supabase, shipmentId),
    getShipmentContacts(supabase, shipmentId),
    listShipmentDocuments(supabase, shipmentId, "shipper"),
    listCustomerExceptions(supabase, shipmentId),
    listCustomerLocations(supabase, shipmentId),
  ]);

  if (summary === null) notFound();

  /*
   * `toShipperDto` takes a full `ShipmentRow`; the projection deliberately
   * omits §18's three financial columns plus `delay_reason_internal` and
   * `public_access_hash`, so they are supplied as the nulls they are on the
   * wire. This is NOT a widening: the shipper serializer names none of those
   * five fields in its output, which `tests/unit/shipment-dto.test.ts` pins
   * by key-set equality and `tests/unit/shipment-shipper-detail.test.ts`
   * re-proves at THIS call site. Writing them out is what makes the omission
   * a visible decision rather than a `Partial<>` that quietly stops being
   * checked.
   */
  const row: ShipmentRow = {
    ...summary,
    gross_shipper_amount: null,
    carrier_pay: null,
    margin: null,
    delay_reason_internal: null,
    public_access_hash: null,
  };

  /*
   * The event projection omits seven columns for the same reason: `metadata`
   * is §9 raw provider payload (staff surfaces only), `internal_message` is
   * §7's staff note, and `created_by`/coordinates/provider ids are not a
   * customer's business. They are restated as the nulls the query did not
   * fetch. No `as` — an added `ShipmentEventRow` field is a compile error
   * here, which is the point.
   */
  const events: ShipmentEventRow[] = history.events.map((event) => ({
    id: event.id,
    shipment_id: event.shipment_id,
    event_type: event.event_type,
    status: event.status,
    event_time: event.event_time,
    recorded_at: event.recorded_at,
    source: event.source,
    created_by: null,
    city: event.city,
    state: event.state,
    latitude: null,
    longitude: null,
    public_message: event.public_message,
    internal_message: null,
    visibility: event.visibility,
    metadata: null,
    external_event_id: null,
    idempotency_key: null,
  }));

  const shipment = toShipperDto({
    shipment: row,
    events,
    // M-78 — §21's banner on the shipper's own detail page. `toShipperDto`
    // already drops any exception with no public description, so an internal
    // exception the shipper has not been told about renders nothing.
    exceptions: toCustomerExceptionRows(exceptionResult.exceptions),
    locations: locationResult.locations,
  });

  const listPath = getPathname({ href: "/portal/shipper/shipments", locale });
  const supportPath = getPathname({ href: "/portal/shipper/support", locale });
  const detailPath = `${listPath}/${shipmentId}`;

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">
            {tv("Shipper portal")} / {tv("Shipments")}
          </span>
          <h1 className="mono">{summary.tracking_number}</h1>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/portal/shipper/shipments">
          ← {tv("All shipments")}
        </Link>
      </div>

      <ShipmentDetailView
        shipment={shipment}
        locationsFailed={locationResult.failed}
        invoices={invoiceResult.invoices}
        invoicesFailed={invoiceResult.failed}
        contacts={contactResult.contacts}
        documents={documentResult.documents}
        documentsFailed={documentResult.failed}
        documentsHasMore={documentResult.hasMore}
        historyHasMore={history.hasMore}
        historyMoreHref={
          history.nextBefore === null
            ? null
            : `${detailPath}?before=${encodeURIComponent(history.nextBefore)}`
        }
        historyPaged={before !== null}
        historyResetHref={detailPath}
        supportHref={supportPath}
      />
    </main>
  );
}
