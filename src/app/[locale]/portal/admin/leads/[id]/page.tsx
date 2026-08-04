import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ActivityForm,
  LeadMetaForm,
} from "@/components/portal/LeadDetailForms";
import type { StaffOption } from "@/components/portal/KanbanBoard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lead — PickLoads CRM",
  robots: { index: false, follow: false },
};

const ACTIVITY_LABEL: Record<string, string> = {
  note: "Note",
  call: "Call",
  sms: "SMS",
  email: "Email",
  status_change: "Status change",
  callback: "Callback scheduled",
  appointment: "Appointment scheduled",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** M-23 — lead detail: full record, meta editing, activity timeline. */
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  await requireStaff(locale);
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [{ data: lead }, { data: activities }, { data: staffRows }] =
    await Promise.all([
      supabase.from("carrier_leads").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("lead_activities")
        .select("id, type, body, old_status, new_status, created_by, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("role", ["admin", "dispatcher"]),
    ]);
  if (!lead) notFound();

  const staff: StaffOption[] = (staffRows ?? []).map((s) => ({
    id: s.id,
    name: s.full_name ?? "Staff",
  }));
  const staffName = (uid: string | null) =>
    staff.find((s) => s.id === uid)?.name ?? null;

  const minutesToFirstContact =
    lead.first_contacted_at !== null
      ? Math.round(
          (new Date(lead.first_contacted_at).getTime() -
            new Date(lead.created_at).getTime()) /
            60000,
        )
      : null;

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">
            <Link href="/portal/admin/leads">← Leads pipeline</Link>
          </span>
          <h1>{lead.full_name ?? "Unknown carrier"}</h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a
            className="btn btn-amber btn-sm"
            href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}
          >
            ☎ Call {lead.phone}
          </a>
          {lead.email ? (
            <a className="btn btn-ghost btn-sm" href={`mailto:${lead.email}`}>
              ✉ Email
            </a>
          ) : null}
        </div>
      </div>

      <div className="pgrid2">
        <div>
          <div className="pcard">
            <h2>Lead</h2>
            <div className="ptable-wrap" style={{ border: "none" }}>
              <table className="ptable">
                <tbody>
                  <tr>
                    <th scope="row">Phone</th>
                    <td>
                      <a href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}>
                        {lead.phone}
                      </a>
                    </td>
                    <th scope="row">Email</th>
                    <td>{lead.email ?? "—"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Type</th>
                    <td>
                      {lead.lead_type === "new_authority" ? (
                        <span className="pbadge green">new authority</span>
                      ) : (
                        "dispatch"
                      )}
                    </td>
                    <th scope="row">Source</th>
                    <td>{lead.source}</td>
                  </tr>
                  <tr>
                    <th scope="row">Equipment</th>
                    <td>
                      {[lead.truck_type, lead.trailer_type]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <th scope="row">Trucks</th>
                    <td>{lead.truck_count ?? "—"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Home state</th>
                    <td>{lead.home_state ?? "—"}</td>
                    <th scope="row">MC #</th>
                    <td>{lead.mc_number ?? "—"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Language</th>
                    <td>{lead.locale.toUpperCase()}</td>
                    <th scope="row">Created</th>
                    <td>{fmt(lead.created_at)}</td>
                  </tr>
                  <tr>
                    <th scope="row">First contact</th>
                    <td colSpan={3}>
                      {minutesToFirstContact === null ? (
                        <span className="pbadge red">
                          not contacted yet — 15-min target
                        </span>
                      ) : (
                        <span
                          className={`pbadge ${minutesToFirstContact <= 15 ? "green" : "amber"}`}
                        >
                          {minutesToFirstContact} min after creation
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="pcard">
            <h2>Manage</h2>
            <LeadMetaForm
              leadId={lead.id}
              status={lead.status}
              assignedTo={lead.assigned_to}
              priority={lead.priority}
              tags={lead.tags}
              callbackAt={lead.callback_at}
              staff={staff}
            />
          </div>
        </div>

        <div>
          <div className="pcard">
            <h2>Log activity</h2>
            <ActivityForm leadId={lead.id} />
          </div>
          <div className="pcard">
            <h2>Timeline</h2>
            {activities && activities.length > 0 ? (
              <ul className="timeline">
                {activities.map((a) => (
                  <li className="tl" key={a.id}>
                    <span className="tlt">
                      {ACTIVITY_LABEL[a.type] ?? a.type} · {fmt(a.created_at)}
                      {staffName(a.created_by)
                        ? ` · ${staffName(a.created_by)}`
                        : ""}
                    </span>
                    {a.type === "status_change" ? (
                      <p>
                        {(a.old_status ?? "—").replace(/_/g, " ")} →{" "}
                        <b>{(a.new_status ?? "—").replace(/_/g, " ")}</b>
                      </p>
                    ) : (
                      <p>{a.body ?? "—"}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pempty" style={{ padding: 0 }}>
                No activity yet — the journal starts with the first status
                change or logged touch.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
