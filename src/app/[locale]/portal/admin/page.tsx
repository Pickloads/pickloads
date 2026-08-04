import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DocumentReviewRow } from "@/components/portal/DocumentReviewRow";
import { formatMoney } from "@/lib/loads";

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
 * M-34 — Dispatch (loads/revenue/RPM/per-dispatcher), Marketing (lead
 * sources, subscribers, honest GA4/GSC placeholders per O-07) and
 * Notifications (email_log + failed webhook_events) modules.
 * Aggregates are computed in the server component over RLS-scoped reads
 * (volume at this stage is hundreds of rows, not millions — no SQL views yet).
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
        "id, lead_type, source, status, created_at, first_contacted_at, callback_at",
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

  // ---- M-34 datasets (second batch to keep each Promise.all readable) ----
  const [
    { data: loadRows },
    { data: activeCarriers },
    { data: staffRows },
    { data: subscriberRows },
    { data: emailRows },
    { data: failedWebhooks },
    { data: postRows },
  ] = await Promise.all([
    supabase
      .from("loads")
      .select(
        "id, carrier_id, dispatcher_id, equipment, gross_rate, miles, dispatch_fee, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("carriers")
      .select("id, home_state")
      .eq("active", true)
      .limit(1000),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["admin", "dispatcher"]),
    supabase
      .from("subscribers")
      .select("id, confirmed_at, unsubscribed_at")
      .limit(5000),
    supabase
      .from("email_log")
      .select("id, to_email, template, subject, status, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("webhook_events")
      .select("id, provider, event_type, error, created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.from("posts").select("id, published").limit(1000),
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

  /* ---- M-34 Dispatch aggregates ---- */
  const loads = loadRows ?? [];
  const working = loads.filter((l) => l.status !== "cancelled");
  const loadsToday = loads.filter(
    (l) => new Date(l.created_at).getTime() >= startOfToday.getTime(),
  ).length;
  const loadsWeek = loads.filter(
    (l) => new Date(l.created_at).getTime() >= now - 7 * DAY,
  );
  const weekByStatus = new Map<string, number>();
  for (const l of loadsWeek) {
    weekByStatus.set(l.status, (weekByStatus.get(l.status) ?? 0) + 1);
  }
  const revenueInvoiced = loads
    .filter((l) => l.status === "invoiced")
    .reduce((sum, l) => sum + l.dispatch_fee, 0);
  const revenueCollected = loads
    .filter((l) => l.status === "paid")
    .reduce((sum, l) => sum + l.dispatch_fee, 0);
  const rpmLoads = working.filter(
    (l) => l.gross_rate !== null && l.miles !== null && l.miles > 0,
  );
  const rpmGross = rpmLoads.reduce((sum, l) => sum + (l.gross_rate ?? 0), 0);
  const rpmMiles = rpmLoads.reduce((sum, l) => sum + (l.miles ?? 0), 0);
  const avgRpm = rpmMiles > 0 ? rpmGross / rpmMiles : null;

  // Active carriers by home state (carriers carry no equipment column —
  // equipment mix is derived from booked loads instead, documented in M-34).
  const carriersByState = new Map<string, number>();
  for (const c of activeCarriers ?? []) {
    const key = c.home_state ?? "—";
    carriersByState.set(key, (carriersByState.get(key) ?? 0) + 1);
  }
  const loadsByEquipment = new Map<string, number>();
  for (const l of working) {
    const key = l.equipment ?? "Unspecified";
    loadsByEquipment.set(key, (loadsByEquipment.get(key) ?? 0) + 1);
  }

  // Per-dispatcher performance (F-09)
  const staff = staffRows ?? [];
  const byDispatcher = new Map<
    string,
    { loads: number; gross: number; fees: number; miles: number; rpmGross: number }
  >();
  for (const l of working) {
    const key = l.dispatcher_id ?? "unassigned";
    const entry =
      byDispatcher.get(key) ??
      { loads: 0, gross: 0, fees: 0, miles: 0, rpmGross: 0 };
    entry.loads += 1;
    entry.gross += l.gross_rate ?? 0;
    entry.fees += l.dispatch_fee;
    if (l.gross_rate !== null && l.miles !== null && l.miles > 0) {
      entry.miles += l.miles;
      entry.rpmGross += l.gross_rate;
    }
    byDispatcher.set(key, entry);
  }
  const dispatcherName = (id: string) =>
    id === "unassigned"
      ? "Unassigned"
      : (staff.find((s) => s.id === id)?.full_name ?? "Staff");

  /* ---- M-34 Marketing aggregates ---- */
  const bySource = new Map<string, number>();
  for (const l of all) {
    // carrier_leads.source drives attribution ("website", "referral", …)
    bySource.set(l.source ?? "website", (bySource.get(l.source ?? "website") ?? 0) + 1);
  }
  const subs = subscriberRows ?? [];
  const confirmedSubs = subs.filter(
    (s) => s.confirmed_at !== null && s.unsubscribed_at === null,
  ).length;
  const posts = postRows ?? [];
  const publishedPosts = posts.filter((p) => p.published).length;

  /* ---- M-34 Notifications feed ---- */
  type FeedItem = {
    id: string;
    kind: "email" | "webhook";
    title: string;
    detail: string;
    failed: boolean;
    at: string;
  };
  const feed: FeedItem[] = [
    ...(emailRows ?? []).map((e): FeedItem => ({
      id: `e-${e.id}`,
      kind: "email",
      title: `${e.template} → ${e.to_email}`,
      detail: e.subject,
      failed: e.status === "failed",
      at: e.created_at,
    })),
    ...(failedWebhooks ?? []).map((w): FeedItem => ({
      id: `w-${w.id}`,
      kind: "webhook",
      title: `${w.provider} · ${w.event_type} FAILED`,
      detail: w.error ?? "processing failure",
      failed: true,
      at: w.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 15);

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

      <span className="psec">Dispatch</span>
      <div className="ptiles">
        <div className="ptile">
          <b>{(activeCarriers ?? []).length}</b>
          <span>Active carriers</span>
        </div>
        <div className="ptile">
          <b>{loadsToday}</b>
          <span>Loads booked today</span>
        </div>
        <div className="ptile">
          <b>{loadsWeek.length}</b>
          <span>Loads · 7d</span>
          <span className="sub">
            {["booked", "in_transit", "delivered", "invoiced", "paid", "cancelled"]
              .filter((s) => (weekByStatus.get(s) ?? 0) > 0)
              .map((s) => `${weekByStatus.get(s)} ${s.replace("_", " ")}`)
              .join(" · ") || "none yet"}
          </span>
        </div>
        <div className="ptile">
          <b>{formatMoney(revenueInvoiced)}</b>
          <span>Fees invoiced (open)</span>
        </div>
        <div className="ptile good">
          <b>{formatMoney(revenueCollected)}</b>
          <span>Fees collected</span>
        </div>
        <div className="ptile">
          <b>{avgRpm === null ? "—" : `$${avgRpm.toFixed(2)}`}</b>
          <span>Avg RPM (all loads)</span>
          <span className="sub">gross ÷ miles, cancelled excluded</span>
        </div>
      </div>

      <div className="pgrid2">
        <div className="pcard">
          <h2>Active carriers by home state</h2>
          {carriersByState.size === 0 ? (
            <p className="pempty" style={{ padding: 0 }}>
              No active carriers yet.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[...carriersByState.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([state, count]) => (
                  <span className="pbadge amber" key={state}>
                    {state} · {count}
                  </span>
                ))}
            </div>
          )}
          <h2 style={{ marginTop: 22 }}>Load mix by equipment</h2>
          {loadsByEquipment.size === 0 ? (
            <p className="pempty" style={{ padding: 0 }}>
              No loads booked yet.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[...loadsByEquipment.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([equipment, count]) => (
                  <span className="pbadge" key={equipment}>
                    {equipment} · {count}
                  </span>
                ))}
            </div>
          )}
          <p className="pempty" style={{ padding: "14px 0 0" }}>
            Equipment mix comes from booked loads — the carriers table
            deliberately has no equipment column (a fleet can run several).
          </p>
        </div>
        <div className="pcard">
          <h2>Per-dispatcher performance</h2>
          {byDispatcher.size === 0 ? (
            <p className="pempty" style={{ padding: 0 }}>
              Appears with the first booked load.
            </p>
          ) : (
            <table className="ptable">
              <thead>
                <tr>
                  <th>Dispatcher</th>
                  <th>Loads</th>
                  <th>Gross</th>
                  <th>Fees</th>
                  <th>Avg RPM</th>
                </tr>
              </thead>
              <tbody>
                {[...byDispatcher.entries()]
                  .sort((a, b) => b[1].gross - a[1].gross)
                  .map(([id, d]) => (
                    <tr key={id}>
                      <td>{dispatcherName(id)}</td>
                      <td>{d.loads}</td>
                      <td>{formatMoney(d.gross)}</td>
                      <td>{formatMoney(d.fees)}</td>
                      <td>
                        {d.miles > 0
                          ? `$${(d.rpmGross / d.miles).toFixed(2)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <span className="psec">Marketing</span>
      <div className="ptiles">
        <div className="ptile">
          <b>{confirmedSubs}</b>
          <span>Newsletter subscribers</span>
          <span className="sub">double opt-in confirmed (S-05)</span>
        </div>
        <div className="ptile">
          <b>{publishedPosts}</b>
          <span>Blog posts live</span>
          <span className="sub">{posts.length - publishedPosts} drafts</span>
        </div>
        {/* O-07: GA4/GSC need a Google Cloud service account + API consent —
            honest placeholders until that ops task lands. */}
        <div className="ptile">
          <b>—</b>
          <span>GA4 sessions · 28d</span>
          <span className="sub">connect Google Analytics Data API (O-07)</span>
        </div>
        <div className="ptile">
          <b>—</b>
          <span>GSC clicks · 28d</span>
          <span className="sub">connect Search Console API (O-07)</span>
        </div>
      </div>
      <div className="pcard" style={{ maxWidth: 620 }}>
        <h2>Lead sources</h2>
        {bySource.size === 0 ? (
          <p className="pempty" style={{ padding: 0 }}>
            No leads yet.
          </p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>Source</th>
                <th>Leads</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {[...bySource.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([source, count]) => (
                  <tr key={source}>
                    <td>{source}</td>
                    <td>{count}</td>
                    <td>
                      {all.length > 0
                        ? `${Math.round((count / all.length) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
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

      <span className="psec">Notifications — recent email &amp; webhook activity</span>
      <div className="pcard">
        {feed.length === 0 ? (
          <p className="pempty" style={{ padding: 0 }}>
            Quiet — no emails logged and no failed webhooks.
          </p>
        ) : (
          <ul className="timeline">
            {feed.map((item) => (
              <li className="tl" key={item.id}>
                <span className="tlt">
                  {new Date(item.at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · {item.kind}{" "}
                  {item.failed ? <span className="pbadge red">failed</span> : null}
                </span>
                <p>
                  <b>{item.title}</b>
                  <br />
                  {item.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
