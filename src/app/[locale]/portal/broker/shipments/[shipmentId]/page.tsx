import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, getPathname } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { requireBroker } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toBrokerDto } from "@/lib/shipments/dto";
import { parseTimelineCursor } from "@/lib/shipments/shipper-detail";
import {
  getBrokerAccessBasis,
  getBrokerPartnerState,
  getBrokerShipmentContacts,
  getBrokerShipmentSummary,
  getBrokerTimelinePage,
} from "@/lib/shipments/broker-access";
import { listShipmentDocuments } from "@/lib/shipments/document-store";
import { BrokerShipmentDetailView } from "@/components/portal/BrokerShipmentDetailView";
import type { ShipmentEventRow, ShipmentRow } from "@/lib/shipments/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shipment — PickLoads Partner Portal",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M-81 — `/portal/broker/shipments/[shipmentId]` (§12's detail half).
 *
 * ── EVERY "NOT YOURS" IS A 404, NEVER A 403 ──────────────────────────────
 *
 * §3: *"No role may access another company's shipment through URL
 * manipulation, API calls or direct database requests."* A 403 answers the
 * question the URL manipulator is asking, so a malformed id, a nonexistent
 * id, another partner's shipment AND a shipment whose grant was revoked all
 * produce the SAME `notFound()`. M-73's one-indistinguishable-refusal rule,
 * on the partner side.
 *
 * Two independent mechanisms produce it: 0029's `"broker shared read
 * shipments"` policy returns no row unless `broker_can_read_shipment()` says
 * so, AND `getBrokerShipmentSummary` checks the id against the reachable set
 * it resolved from the same three sources. The policy is the guarantee.
 *
 * ── §25's SUMMARY-vs-HISTORY SPLIT ───────────────────────────────────────
 *
 * Four concurrent reads, none of them a join: the shipment row, a BOUNDED
 * page of broker-band history, the approved contacts, and the §16 broker
 * document band. Everything above the fold costs one indexed lookup whether
 * the shipment has four events or four thousand, and `?before=` walks older
 * history without ever fetching all of it.
 *
 * ── NO WRITE SURFACE ─────────────────────────────────────────────────────
 *
 * There is no server action on this page except M-77's broker document-URL
 * minter. §19 gives a broker SELECT and nothing else; 0018/0029 grant no
 * customer write policy on any shipment table, so a control here would have
 * nothing to call.
 */
export default async function BrokerShipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; shipmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, shipmentId } = await params;
  await requireBroker(locale);
  const t = await getTranslations({ locale, namespace: "shipment" });
  const sp = await searchParams;
  const supabase = await createClient();

  // A non-UUID cannot be a shipment id. Refusing before the query keeps a
  // scripted scan out of the database entirely, and produces the same 404.
  if (!UUID.test(shipmentId)) notFound();

  const state = await getBrokerPartnerState(supabase);
  // Unverified or unattached: `my_broker_partner_ids()` returns nothing, so
  // every read below would come back empty anyway. Refusing here makes that a
  // 404 rather than a page of blanks.
  if (state.memberOf === null || !state.verified) notFound();

  const before = parseTimelineCursor(
    Array.isArray(sp.before) ? sp.before[0] : sp.before,
  );

  const summary = await getBrokerShipmentSummary(
    supabase,
    state.memberOf,
    shipmentId,
  );
  if (summary === null) notFound();

  const [history, contactResult, documentResult, basis] = await Promise.all([
    getBrokerTimelinePage(supabase, shipmentId, { before }),
    getBrokerShipmentContacts(supabase, shipmentId),
    // M-77 — the §16 BROKER band, bounded, in the same fan-out. 0024's
    // "broker member read shipment documents" and 0029's "broker shared read
    // shipment documents" are what decide; the audience argument is the
    // second opinion, and it cannot widen the first.
    listShipmentDocuments(supabase, shipmentId, "broker"),
    getBrokerAccessBasis(supabase, state.memberOf, shipmentId),
  ]);

  /*
   * `toBrokerDto` takes a full `ShipmentRow`; `BROKER_DETAIL_COLUMNS`
   * deliberately omits the eleven columns `BROKER_FIELD_POLICY` denies, so
   * they are supplied as the nulls they are on the wire. This is NOT a
   * widening: the broker serializer names none of them in its output, which
   * `tests/unit/shipment-broker-permissions.test.ts` pins by key-set
   * equality. Writing them out is what makes the omission a visible decision
   * rather than a `Partial<>` that quietly stops being checked.
   */
  const row: ShipmentRow = {
    ...summary,
    shipper_id: "",
    dispatcher_id: null,
    quote_id: null,
    broker_partner_id: null,
    load_id: null,
    gross_shipper_amount: null,
    carrier_pay: null,
    margin: null,
    public_tracking_enabled: false,
    public_access_hash: null,
    delay_reason_internal: null,
  };

  /*
   * The event projection omits seven columns for M-74's reason: `metadata` is
   * §9 raw provider payload, `internal_message` is §7's staff note, and
   * `created_by`/coordinates/provider ids are not a partner's business.
   * Restated as the nulls the query did not fetch, with no `as` — an added
   * `ShipmentEventRow` field is a compile error here, which is the point.
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

  const shipment = toBrokerDto({ shipment: row, events });

  const detailPath = `${getPathname({ href: "/portal/broker/shipments", locale })}/${shipmentId}`;

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">
            {t("broker.crumb")} / {t("broker.title")}
          </span>
          <h1 className="mono">{summary.tracking_number}</h1>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/portal/broker">
          ← {t("broker.back")}
        </Link>
      </div>

      <BrokerShipmentDetailView
        shipment={shipment}
        contacts={contactResult.contacts}
        contactsFailed={contactResult.failed}
        documents={documentResult.documents}
        documentsFailed={documentResult.failed}
        documentsHasMore={documentResult.hasMore}
        basis={basis}
        historyHasMore={history.hasMore}
        historyMoreHref={
          history.nextBefore === null
            ? null
            : `${detailPath}?before=${encodeURIComponent(history.nextBefore)}`
        }
        historyPaged={before !== null}
        historyResetHref={detailPath}
      />
    </main>
  );
}
