import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { SessionProfile } from "@/lib/auth";

/**
 * M-58 — dispatcher least-privilege (query-level).
 *
 * Admins see everything; dispatchers see only their ASSIGNED carriers' data
 * (carriers.assigned_dispatcher_id, set on /portal/admin/users) across the
 * desk: loads board, dashboard operations queues, carrier lists. CRM leads
 * aren't carrier-linked, so their scope is assignment-based too: a
 * dispatcher sees leads assigned to them plus the unassigned queue
 * (someone has to work new leads — documented judgment).
 *
 * This is QUERY-LEVEL scoping on top of the staff RLS policies. A DB-level
 * restrictive policy would require editing the frozen 0002 "staff manage"
 * policies (or adding RESTRICTIVE policies that also constrain admins), so
 * the M-50a audit's "where feasible" call lands here; the audit_events
 * ledger records every staff mutation regardless.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export interface StaffScope {
  /** null = unrestricted (admin); array = only these carrier ids. */
  carrierIds: string[] | null;
  /** True when the session is a dispatcher (leads scoped to self+unassigned). */
  restricted: boolean;
}

export async function getStaffScope(
  supabase: ServerSupabase,
  session: SessionProfile,
): Promise<StaffScope> {
  if (session.role !== "dispatcher") {
    return { carrierIds: null, restricted: false };
  }
  const { data } = await supabase
    .from("carriers")
    .select("id")
    .eq("assigned_dispatcher_id", session.userId)
    .limit(1000);
  return { carrierIds: (data ?? []).map((c) => c.id), restricted: true };
}

/* ------------------------------------------------------------------ *
 * M-75 — the same doctrine, applied to `shipments` (§3, §14, §19)
 * ------------------------------------------------------------------ */

/**
 * A dispatcher's shipment scope: their OWN shipments, plus the shipments of
 * the carriers an admin assigned them.
 *
 * WHY TWO ARMS AND NOT ONE. `carriers.assigned_dispatcher_id` (M-58) is the
 * existing least-privilege key and it is the right one for freight already
 * covered — but §6's first four statuses have NO CARRIER AT ALL, so a
 * carrier-only rule would make every shipment a dispatcher is sourcing a
 * truck for invisible to them, including the ones they created. The
 * `dispatcher_id` arm is what makes "Needs Carrier" a workable column rather
 * than an empty one; M-71 built `idx_shipments_dispatcher` for exactly this
 * predicate.
 *
 * WHY IT IS AN EXPRESSION AND NOT A POLICY. M-71 recorded this as residual
 * risk **R-2** and M-72 inherited it verbatim: `"staff manage shipments"`
 * does not distinguish dispatcher from admin, exactly as `loads`, `carriers`
 * and `documents` have not since 0002, and the database-level version
 * (RESTRICTIVE policies that would also constrain admins) is **M-83's**. This
 * function does not widen that risk and does not pretend to close it — it is
 * the query-level control the plan says it is, and every write path pairs it
 * with `dispatcherMayActOn` below plus an `audit_events` row.
 *
 * Returns `null` for an unrestricted (admin) scope — the caller applies
 * nothing. A dispatcher with zero assigned carriers still gets the
 * `dispatcher_id` arm, so the expression is never empty and never degrades
 * into "no filter".
 */
export function shipmentScopeExpression(
  scope: StaffScope,
  userId: string,
): string | null {
  if (scope.carrierIds === null) return null;
  const arms = [`dispatcher_id.eq.${userId}`];
  if (scope.carrierIds.length > 0) {
    arms.push(`carrier_id.in.(${scope.carrierIds.join(",")})`);
  }
  return arms.join(",");
}

/** The two columns `shipmentScopeExpression` reads — nothing wider. */
export interface ScopedShipmentFacts {
  dispatcher_id: string | null;
  carrier_id: string | null;
}

/**
 * May this staff session ACT on this shipment?
 *
 * Pure, and deliberately the same rule the read expression encodes: a
 * dispatcher who cannot see a shipment must not be able to move it by typing
 * its id into a form. §19's *"dispatcher permissions are limited"* is a claim
 * about writes at least as much as about reads, and a scoped board with an
 * unscoped action is not a control.
 */
export function dispatcherMayActOn(
  scope: StaffScope,
  userId: string,
  shipment: ScopedShipmentFacts,
): boolean {
  if (scope.carrierIds === null) return true;
  if (shipment.dispatcher_id === userId) return true;
  return (
    shipment.carrier_id !== null &&
    scope.carrierIds.includes(shipment.carrier_id)
  );
}
