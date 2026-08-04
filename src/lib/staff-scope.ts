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
