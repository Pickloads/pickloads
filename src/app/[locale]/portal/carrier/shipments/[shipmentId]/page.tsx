import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, getPathname } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { toCarrierDto } from "@/lib/shipments/dto";
import { parseTimelineCursor } from "@/lib/shipments/shipper-detail";
import {
  getCarrierShipmentSummary,
  getCarrierTimelinePage,
  getDriverTokens,
} from "@/lib/shipments/carrier-shipments";
import { offeredCarrierActions } from "@/lib/shipments/carrier-updates";
import { isDriverTokenConfigured } from "@/lib/shipments/driver-token";
import { listShipmentDocuments } from "@/lib/shipments/document-store";
import { CarrierShipmentDetailView } from "@/components/portal/CarrierShipmentDetailView";
import type { ShipmentEventRow, ShipmentRow } from "@/lib/shipments/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shipment — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M-76 — `/portal/carrier/shipments/[shipmentId]` (§13's carrier portal,
 * detail half).
 *
 * ── EVERY "NOT YOURS" IS A 404, NEVER A 403 ──────────────────────────────
 *
 * §3: *"No role may access another company's shipment through URL
 * manipulation, API calls or direct database requests."* A 403 answers the
 * question the URL manipulator is asking, so a malformed id, a nonexistent id
 * and carrier B's id all produce the SAME `notFound()`. That is M-73's
 * one-indistinguishable-refusal rule and M-74's application of it, on the
 * carrier side.
 *
 * Two independent mechanisms produce it: 0018's policy returns no row to a
 * session outside the assigned carrier, AND `getCarrierShipmentSummary` also
 * filters `.eq("carrier_id", …)`. The policy is the guarantee; the predicate
 * makes the query use `idx_shipments_carrier` and makes a mistake visible in
 * an EXPLAIN rather than only in a penetration test.
 *
 * ── §25's SUMMARY-vs-HISTORY SPLIT ───────────────────────────────────────
 *
 * Three concurrent reads, none of them a join: the shipment row, a BOUNDED
 * page of carrier-band history, and the shipment's driver links. Everything
 * above the fold costs one indexed lookup whether the shipment has four
 * events or four thousand, and `?before=` walks older history without ever
 * fetching all of it.
 *
 * ── WHICH BUTTONS ────────────────────────────────────────────────────────
 *
 * `offeredCarrierActions("carrier", status, facts)` — §13's list intersected
 * with M-72's graph, actor gate and preconditions. The facts are derived from
 * data this page already read rather than from
 * `shipment_transition_facts()`, which is service-role-only; M-75 recorded the
 * same trade as its residual risk R-4, and the mitigation is identical: the
 * server action re-resolves the real facts through the RPC before writing, so
 * the worst outcome is a control that returns a typed refusal into a
 * `role="alert"` region.
 */
export default async function CarrierShipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; shipmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, shipmentId } = await params;
  await requireCarrier(locale);
  const t = await getTranslations({ locale, namespace: "shipment" });
  const sp = await searchParams;
  const supabase = await createClient();

  // A non-UUID cannot be a shipment id. Refusing before the query keeps a
  // scripted scan out of the database entirely, and produces the same 404.
  if (!UUID.test(shipmentId)) notFound();

  const carrierId = await getMyCarrierId(supabase);
  if (carrierId === null) notFound();

  const before = parseTimelineCursor(
    Array.isArray(sp.before) ? sp.before[0] : sp.before,
  );

  const [summary, history, tokenResult, documentResult] = await Promise.all([
    getCarrierShipmentSummary(supabase, carrierId, shipmentId),
    getCarrierTimelinePage(supabase, shipmentId, { before }),
    getDriverTokens(supabase, shipmentId),
    // M-77 — the §16 CARRIER band, bounded, in the same fan-out. 0024's
    // "carrier member read shipment documents" policy is what decides; the
    // audience argument is the second opinion, and it cannot widen the first.
    listShipmentDocuments(supabase, shipmentId, "carrier"),
  ]);

  if (summary === null) notFound();

  /*
   * `toCarrierDto` takes a full `ShipmentRow`; the projection deliberately
   * omits `gross_shipper_amount`, `margin`, `delay_reason_internal` and
   * `public_access_hash`, so they are supplied as the nulls they are on the
   * wire. This is NOT a widening: the carrier serializer names none of those
   * four in its output, which `tests/unit/shipment-dto.test.ts` pins by
   * key-set equality. Writing them out is what makes the omission a visible
   * decision rather than a `Partial<>` that quietly stops being checked.
   */
  const row: ShipmentRow = {
    ...summary,
    gross_shipper_amount: null,
    margin: null,
    delay_reason_internal: null,
    public_access_hash: null,
  };

  /*
   * The event projection omits seven columns for the same reason M-74's does:
   * `metadata` is §9 raw provider payload, `internal_message` is §7's staff
   * note, and `created_by`/coordinates/provider ids are not a carrier's
   * business. Restated as the nulls the query did not fetch, with no `as` — an
   * added `ShipmentEventRow` field is a compile error here, which is the point.
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

  const shipment = toCarrierDto({ shipment: row, events });

  /*
   * §20's facts, derived from what this page already holds. See the header for
   * why this is advisory and where the authoritative check lives.
   *
   * `approvedPodDocumentId` stays null because `pod_uploaded` is not a
   * CARRIER action: `ACTOR_PERMITTED_TARGETS.carrier` excludes it, so the
   * offered-action list would drop it whatever the fact said. M-77 made the
   * fact real in `shipment_transition_facts()` (0024) for the staff path,
   * where the transition actually lives — this page reads nothing from it.
   * `closeoutCompletedAt` stays null because closeout is a brokerage
   * assertion a carrier does not make.
   */
  const facts = {
    activeAssignmentId: summary.carrier_id,
    pickupConfirmedAt: events.some(
      (e) => e.status === "arrived_at_pickup" || e.status === "loading",
    )
      ? (events.find(
          (e) => e.status === "arrived_at_pickup" || e.status === "loading",
        )?.event_time ?? null)
      : null,
    deliveryTimestamp: new Date().toISOString(),
    deliveredAt: events.find((e) => e.status === "delivered")?.event_time ?? null,
    approvedPodDocumentId: null,
    closeoutCompletedAt: null,
    cancellationReason: null,
  };

  const offeredActions = offeredCarrierActions("carrier", summary.status, facts);

  const listPath = getPathname({ href: "/portal/carrier/shipments", locale });
  const detailPath = `${listPath}/${shipmentId}`;

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">
            {t("carrier.crumb")} / {t("carrier.title")}
          </span>
          <h1 className="mono">{summary.tracking_number}</h1>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/portal/carrier/shipments">
          ← {t("carrier.back")}
        </Link>
      </div>

      <CarrierShipmentDetailView
        shipment={shipment}
        offeredActions={offeredActions}
        tokens={tokenResult.tokens}
        tokensFailed={tokenResult.failed}
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
        driverLinksEnabled={isDriverTokenConfigured()}
      />
    </main>
  );
}
