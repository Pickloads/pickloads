import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dispatcherMayActOn, getStaffScope } from "@/lib/staff-scope";
import {
  getAssignableCarriers,
  getCarrierFleet,
  getShipmentAssignments,
  getShipmentPartiesForStaff,
  getStaffOptions,
  getStaffShipment,
  getStaffTimelinePage,
  staffTransitionFacts,
} from "@/lib/shipments/staff-detail";
import { availableTransitions } from "@/lib/shipments/transitions";
import { listShipmentDocumentsForStaff } from "@/lib/shipments/document-store";
import { listStaffExceptions } from "@/lib/shipments/exceptions";
import { ShipmentStaffDetailView } from "@/components/portal/ShipmentStaffDetailView";
import { getDriverTokens } from "@/lib/shipments/carrier-shipments";
import { isDriverTokenConfigured } from "@/lib/shipments/driver-token";
import {
  listProviderConnections,
  listStaffLocations,
} from "@/lib/shipments/locations";
import { providerStatuses } from "@/lib/shipments/providers";
import { listVerifiedBrokerPartners } from "@/app/actions/broker-partners";
import type { BrokerGrantView } from "@/components/portal/BrokerShipmentShare";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shipment — PickLoads",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M-75 — the dispatcher shipment page: §14's fourteen actions and §15's
 * "view status history" / "audit who changed each status".
 *
 * ── §25's SPLIT, AND WHY THIS PAGE IS SIX QUERIES AND NOT SIXTY ───────────
 *
 * The summary is one indexed row read that touches no event table. The history
 * is one bounded keyset page. Assignments, parties, carriers, staff and the
 * selected carrier's fleet are five more bounded reads, all issued in ONE
 * `Promise.all` — §25's "no N+1" applied to a detail page. Whether the
 * shipment has four events or four thousand, this page costs the same.
 *
 * ── WHICH BUTTONS ARE DRAWN ───────────────────────────────────────────────
 *
 * `availableTransitions(status, actor, facts)` — M-72's own instruction to
 * M-75, verbatim: *"it must render `availableTransitions(...)` rather than the
 * raw graph"*, so a button that would be refused is never drawn. The facts are
 * derived from data this page already read, NOT from
 * `shipment_transition_facts()`, which is service-role-only and has no
 * business being called to decide a presentation question. The server action
 * re-resolves the real facts before writing, so this list decides what is
 * OFFERED and never what is ALLOWED.
 *
 * ── OUT OF SCOPE IS A 404 HERE, UNLIKE THE ACTIONS ────────────────────────
 *
 * A dispatcher who follows a stale link to another dispatcher's shipment gets
 * `notFound()`, matching every other portal detail route in the codebase. The
 * ACTIONS answer differently ("outside your assignment — ask an admin"),
 * because by then the operator has a specific intent and a specific next step.
 */
export default async function StaffShipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; shipmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, shipmentId } = await params;
  const session = await requireStaff(locale);
  if (!UUID.test(shipmentId)) notFound();
  const sp = await searchParams;

  const supabase = await createClient();
  const shipment = await getStaffShipment(supabase, shipmentId);
  if (!shipment) notFound();

  const scope = await getStaffScope(supabase, session);
  if (!dispatcherMayActOn(scope, session.userId, shipment)) notFound();

  // M-76 adds a SEVENTH concurrent read: this shipment's driver links, through
  // the COOKIE-BOUND client so 0023's `"staff manage driver tokens"` policy
  // applies. Still one round trip, still §25's "no N+1".
  // M-77 adds an EIGHTH concurrent read: this shipment's §16 documents with
  // their review trail, through the COOKIE-BOUND client so 0024's `"staff
  // manage shipment documents"` policy applies. Still one round trip, still
  // §25's "no N+1", and still bounded (`DOCUMENT_PAGE_SIZE` + 1).
  // M-78 adds a NINTH concurrent read: §21's exceptions with their full field
  // set, through the COOKIE-BOUND client so 0025's `"staff manage shipment
  // exceptions"` policy applies. Still one round trip, still §25's "no N+1",
  // still bounded (`EXCEPTION_PAGE_SIZE`).
  const [
    history,
    assignments,
    parties,
    carriers,
    staff,
    fleet,
    driverTokens,
    documents,
    exceptions,
    locationResult,
    connectionResult,
    grantResult,
    brokerPartners,
  ] = await Promise.all([
    getStaffTimelinePage(supabase, shipmentId, sp.before),
    getShipmentAssignments(supabase, shipmentId),
    getShipmentPartiesForStaff(supabase, shipmentId),
    getAssignableCarriers(supabase, scope.carrierIds),
    getStaffOptions(supabase),
    getCarrierFleet(supabase, shipment.carrier_id),
    getDriverTokens(supabase, shipmentId),
    listShipmentDocumentsForStaff(supabase, shipmentId),
    listStaffExceptions(supabase, shipmentId),
    // M-80 — §9's location history and Mode B links, both under 0027's staff
    // policy on the COOKIE-BOUND client. Joining the existing fan-out rather
    // than adding two more round trips (§25).
    listStaffLocations(supabase, shipmentId),
    listProviderConnections(supabase, shipmentId),
    /* M-81 — §12's per-shipment grants on this shipment, under 0029's "staff
       manage broker grants" policy on the COOKIE-BOUND client. Joining the
       existing fan-out rather than adding a round trip (§25).

       NO PostgREST EMBED. `broker_partners(company_name)` would be the
       obvious way to get the name, and `database.types.ts` is hand-authored
       with `Relationships: []` on every table — an embed would be the first
       one in the codebase and would need a foreign-key descriptor kept in
       step with the DDL by hand. The names come from one extra bounded read
       below, taken ONLY when this shipment has grants at all. */
    supabase
      .from("broker_shipment_grants")
      .select("id, broker_partner_id, granted_at, note")
      .eq("shipment_id", shipmentId)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false })
      .limit(25),
    /* Verified partners only. The action refuses an unverified one too; this
       list stops the mistake being offered. */
    listVerifiedBrokerPartners(),
  ]);

  const actorRole = session.role === "admin" ? "admin" : "dispatcher";
  /*
   * M-77 — §20's POD precondition, on the OFFER side. `pod_uploaded` appears
   * as a button the moment an approved POD exists on this shipment and not
   * before. The page's copy of the fact is the newest approved POD in the
   * bounded page it already read; the AUTHORITATIVE fact is 0024's
   * `shipment_transition_facts()`, which the server action re-resolves before
   * any write — so an approved POD that fell off the bounded page costs an
   * un-drawn button, never an accepted transition with no proof behind it.
   */
  const approvedPod =
    documents.documents.find(
      (d) => d.doc_type === "pod" && d.approved_at !== null,
    ) ?? null;
  const facts = staffTransitionFacts(
    shipment,
    assignments,
    history.events,
    approvedPod?.id ?? null,
  );

  /*
   * Partner NAMES for the grants above.
   *
   * Deliberately not resolved from `brokerPartners` (the dropdown list): that
   * list is verified partners only, and a shipment can hold a live grant to an
   * organization an admin has since SUSPENDED. Rendering that row as
   * "Partner organization" would hide exactly the case a dispatcher needs to
   * see. One extra read, only when there is something to name.
   */
  const grantRows = grantResult.data ?? [];
  const grantPartnerIds = [...new Set(grantRows.map((row) => row.broker_partner_id))];
  const { data: grantPartnerRows } =
    grantPartnerIds.length === 0
      ? { data: [] }
      : await supabase
          .from("broker_partners")
          .select("id, company_name")
          .in("id", grantPartnerIds)
          .limit(25);
  const grantPartnerNames = new Map(
    (grantPartnerRows ?? []).map((row) => [row.id, row.company_name] as const),
  );
  const brokerGrants: BrokerGrantView[] = grantRows.map((row) => ({
    id: row.id,
    broker_partner_id: row.broker_partner_id,
    company_name:
      grantPartnerNames.get(row.broker_partner_id) ?? "Partner organization",
    granted_at: row.granted_at,
    note: row.note,
  }));

  return (
    <main id="main" className="a-page">
      <ShipmentStaffDetailView
        shipment={shipment}
        events={history.events}
        nextCursor={history.nextCursor}
        historyFailed={history.failed}
        assignments={assignments}
        parties={parties}
        carriers={carriers.map((c) => ({ id: c.id, label: c.name }))}
        staff={staff.map((s) => ({ id: s.id, label: s.name }))}
        drivers={fleet.drivers.map((d) => ({ id: d.id, label: d.label }))}
        trucks={fleet.trucks.map((t) => ({ id: t.id, label: t.label }))}
        availableTransitions={availableTransitions(
          shipment.status,
          actorRole,
          facts,
        )}
        isAdmin={session.role === "admin"}
        carrierNames={Object.fromEntries(
          carriers.map((c) => [c.id, c.name] as const),
        )}
        driverTokens={driverTokens.tokens}
        driverTokensFailed={driverTokens.failed}
        documents={documents.documents}
        documentsFailed={documents.failed}
        documentsHasMore={documents.hasMore}
        driverLinksEnabled={isDriverTokenConfigured()}
        exceptions={exceptions.exceptions}
        exceptionsFailed={exceptions.failed}
        locations={locationResult.locations}
        locationsFailed={locationResult.failed}
        connections={connectionResult.connections}
        connectionsFailed={connectionResult.failed}
        /* The adapter contract table. Computed on the SERVER because
           `isConfigured()` reads `process.env`, which a client component
           cannot and must not. Every row is `connected: false`. */
        providers={providerStatuses()}
        brokerGrants={brokerGrants}
        brokerPartners={brokerPartners}
        brokerGrantsFailed={grantResult.error !== null}
      />
    </main>
  );
}
