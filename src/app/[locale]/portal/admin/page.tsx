import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DocumentReviewRow } from "@/components/portal/DocumentReviewRow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Dashboard — PickLoads",
  robots: { index: false, follow: false },
};

const DAY = 24 * 60 * 60 * 1000;

const FUNNEL: ReadonlyArray<{ status: string; label: string }> = [
  { status: "new", label: "New" },
  { status: "call", label: "Call" },
  { status: "qualified", label: "Qualified" },
  { status: "appointment", label: "Appointment" },
  { status: "agreement", label: "Agreement" },
  { status: "waiting_documents", label: "Waiting docs" },
  { status: "active", label: "Active" },
  { status: "inactive", label: "Inactive" },
  { status: "lost", label: "Lost" },
];

/**
 * M-24 — admin dashboard, Sales + Operations modules (arch §7).
 * Aggregates are computed in the server component over RLS-scoped reads
 * (lead volume at this stage is hundreds, not millions — no SQL views yet).
 */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireStaff(locale);
  const supabase = await createClient();
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + DAY);

  const [
    { data: leads },
    { data: pendingDocs },
    { data: expiringCarriers },
    { data: unsignedCarriers },
  ] = await Promise.all([
    supabase
      .from("carrier_leads")
      .select(
        "id, lead_type, status, created_at, first_contacted_at, callback_at",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("documents")
      .select("id, carrier_id, type, file_name, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("carriers")
      .select("id, company_name, insurance_expiry, active")
      .not("insurance_expiry", "is", null)
      .lte(
        "insurance_expiry",
        new Date(now + 30 * DAY).toISOString().slice(0, 10),
      )
      .order("insurance_expiry", { ascending: true })
      .limit(50),
    supabase
      .from("carriers")
      .select("id, company_name, created_at")
      .is("agreement_signed_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const all = leads ?? [];
  const createdSince = (ms: number) =>
    all.filter((l) => new Date(l.created_at).getTime() >= now - ms).length;
  const funnel = new Map<string, number>();
  for (const l of all) funnel.set(l.status, (funnel.get(l.status) ?? 0) + 1);
  const active = funnel.get("active") ?? 0;
  const conversion = all.length > 0 ? Math.round((active / all.length) * 100) : 0;

  const contacted = all.filter((l) => l.first_contacted_at !== null);
  const avgFirstContactMin =
    contacted.length > 0
      ? Math.round(
          contacted.reduce(
            (sum, l) =>
              sum +
              (new Date(l.first_contacted_at ?? l.created_at).getTime() -
                new Date(l.created_at).getTime()) /
                60000,
            0,
          ) / contacted.length,
        )
      : null;

  const openStatuses = new Set(["inactive", "lost"]);
  const callbacksToday = all.filter(
    (l) =>
      l.callback_at !== null &&
      !openStatuses.has(l.status) &&
      new Date(l.callback_at).getTime() < endOfToday.getTime(),
  ).length;
  const appointments = all.filter(
    (l) =>
      l.status === "appointment" ||
      (l.callback_at !== null && new Date(l.callback_at).getTime() > now),
  ).length;
  const newAuthority = all.filter((l) => l.lead_type === "new_authority").length;

  // Resolve company names for the pending-docs queue (two-step to keep the
  // hand-authored types honest — no PostgREST embed metadata yet).
  const docCarrierIds = [...new Set((pendingDocs ?? []).map((d) => d.carrier_id))];
  const { data: docCarriers } = docCarrierIds.length
    ? await supabase
        .from("carriers")
        .select("id, company_name")
        .in("id", docCarrierIds)
    : { data: [] };
  const companyOf = (id: string) =>
    (docCarriers ?? []).find((c) => c.id === id)?.company_name ?? "Unknown";

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk</span>
          <h1>Dashboard</h1>
        </div>
        <Link className="btn btn-amber btn-sm" href="/portal/admin/leads">
          Open leads pipeline →
        </Link>
      </div>

      <span className="psec">Sales</span>
      <div className="ptiles">
        <div className="ptile">
          <b>{createdSince(DAY)}</b>
          <span>New leads · 24h</span>
        </div>
        <div className="ptile">
          <b>{createdSince(7 * DAY)}</b>
          <span>New leads · 7d</span>
        </div>
        <div className="ptile">
          <b>{createdSince(30 * DAY)}</b>
          <span>New leads · 30d</span>
        </div>
        <div className="ptile">
          <b>{conversion}%</b>
          <span>Lead → active conversion</span>
          <span className="sub">
            {active} active of {all.length} leads
          </span>
        </div>
        <div
          className={`ptile ${avgFirstContactMin !== null && avgFirstContactMin <= 15 ? "good" : avgFirstContactMin !== null ? "warn" : ""}`}
        >
          <b>{avgFirstContactMin === null ? "—" : `${avgFirstContactMin}m`}</b>
          <span>Avg first contact</span>
          <span className="sub">target ≤ 15 min</span>
        </div>
        <div className={`ptile ${callbacksToday > 0 ? "warn" : ""}`}>
          <b>{callbacksToday}</b>
          <span>Callbacks due today</span>
        </div>
        <div className="ptile">
          <b>{appointments}</b>
          <span>Appointments upcoming</span>
        </div>
        <div className="ptile">
          <b>
            {all.length - newAuthority} / {newAuthority}
          </b>
          <span>Dispatch / new authority</span>
        </div>
      </div>

      <span className="psec">Pipeline funnel</span>
      <div className="ptiles" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))" }}>
        {FUNNEL.map((f) => (
          <div className="ptile" key={f.status} style={{ padding: "12px 14px" }}>
            <b style={{ fontSize: "1.3rem" }}>{funnel.get(f.status) ?? 0}</b>
            <span>{f.label}</span>
          </div>
        ))}
      </div>

      <span className="psec">Operations — documents pending review</span>
      <div className="ptable-wrap">
        {pendingDocs && pendingDocs.length > 0 ? (
          <table className="ptable">
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Type</th>
                <th>File</th>
                <th>Uploaded</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {pendingDocs.map((d) => (
                <DocumentReviewRow
                  key={d.id}
                  documentId={d.id}
                  companyName={companyOf(d.carrier_id)}
                  docType={d.type}
                  fileName={d.file_name}
                  uploadedAt={d.created_at}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pempty">Queue clear — no documents awaiting review.</p>
        )}
      </div>

      <span className="psec">Operations — insurance expiring ≤ 30 days</span>
      <div className="ptable-wrap">
        {expiringCarriers && expiringCarriers.length > 0 ? (
          <table className="ptable">
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Expiry</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {expiringCarriers.map((c) => {
                const expired =
                  c.insurance_expiry !== null &&
                  new Date(c.insurance_expiry).getTime() < now;
                return (
                  <tr key={c.id}>
                    <td>{c.company_name}</td>
                    <td>{c.insurance_expiry}</td>
                    <td>
                      <span className={`pbadge ${expired ? "red" : "amber"}`}>
                        {expired ? "expired" : "expiring"}
                      </span>{" "}
                      {c.active ? <span className="pbadge green">active</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="pempty">No certificates expiring in the next 30 days.</p>
        )}
      </div>

      <span className="psec">Operations — unsigned agreements</span>
      <div className="ptable-wrap">
        {unsignedCarriers && unsignedCarriers.length > 0 ? (
          <table className="ptable">
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Onboarded</th>
              </tr>
            </thead>
            <tbody>
              {unsignedCarriers.map((c) => (
                <tr key={c.id}>
                  <td>{c.company_name}</td>
                  <td>
                    {new Date(c.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pempty">Every carrier has a signed agreement.</p>
        )}
      </div>
    </main>
  );
}
