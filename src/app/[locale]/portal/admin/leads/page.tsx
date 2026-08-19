import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  KanbanBoard,
  type KanbanLead,
  type StaffOption,
} from "@/components/portal/KanbanBoard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leads CRM — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-23 — staff-only Kanban CRM over carrier_leads. Reads run under the
 * user's RLS (staff select policies); internal tool, English only.
 */
export default async function LeadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireStaff(locale);
  const supabase = await createClient();

  // M-58 least privilege: dispatchers see their own + unassigned leads
  // (someone must work the new-lead queue); admins see everything.
  let leadsQuery = supabase
    .from("carrier_leads")
    .select(
      "id, full_name, phone, truck_type, trailer_type, lead_type, source, status, priority, tags, assigned_to, callback_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (session.role === "dispatcher") {
    leadsQuery = leadsQuery.or(
      `assigned_to.eq.${session.userId},assigned_to.is.null`,
    );
  }

  const [{ data: leadRows, error }, { data: staffRows }] = await Promise.all([
    leadsQuery,
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["admin", "dispatcher"]),
  ]);

  const leads: KanbanLead[] = leadRows ?? [];
  const staff: StaffOption[] = (staffRows ?? []).map((s) => ({
    id: s.id,
    name: s.full_name ?? "Staff",
  }));

  return (
    <main id="main" className="a-page is-board">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / CRM</span>
          <h1>Leads pipeline</h1>
        </div>
        <span className="pbadge amber">{leads.length} leads</span>
      </div>
      {error ? (
        <p className="pempty">
          Couldn&apos;t load leads ({error.message}). Check the Supabase
          connection.
        </p>
      ) : (
        <KanbanBoard leads={leads} staff={staff} />
      )}
    </main>
  );
}
