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
import { ShipmentStaffDetailView } from "@/components/portal/ShipmentStaffDetailView";

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

  const [history, assignments, parties, carriers, staff, fleet] =
    await Promise.all([
      getStaffTimelinePage(supabase, shipmentId, sp.before),
      getShipmentAssignments(supabase, shipmentId),
      getShipmentPartiesForStaff(supabase, shipmentId),
      getAssignableCarriers(supabase, scope.carrierIds),
      getStaffOptions(supabase),
      getCarrierFleet(supabase, shipment.carrier_id),
    ]);

  const actorRole = session.role === "admin" ? "admin" : "dispatcher";
  const facts = staffTransitionFacts(shipment, assignments, history.events);

  return (
    <main id="main">
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
      />
    </main>
  );
}
