import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AUDIT_PAGE_SIZE, parsePage } from "@/lib/validation/staff";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security Log — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-58 — the admin security log: the `audit_events` ledger (signups, status
 * changes, dispatcher assignments, change requests, invites, agreement
 * re-sends…), paginated, newest first. Admin-only; reads run cookie-bound
 * under "staff read audit events".
 */
export default async function AdminSecurityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  await requireAdmin(locale);
  const sp = await searchParams;
  const page = parsePage(typeof sp.page === "string" ? sp.page : undefined);
  const filterAction =
    typeof sp.action === "string" && /^[a-z_.]{1,60}$/.test(sp.action)
      ? sp.action
      : null;

  const supabase = await createClient();
  let query = supabase
    .from("audit_events")
    .select("id, actor_id, action, target_table, target_id, detail, ip, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE - 1);
  if (filterAction) query = query.eq("action", filterAction);
  const { data: eventRows, count } = await query;
  const events = eventRows ?? [];
  const total = count ?? events.length;
  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  // Actor names (staff-readable profiles).
  const actorIds = [...new Set(events.map((e) => e.actor_id).filter((v): v is string => v !== null))];
  const { data: actorRows } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, role").in("id", actorIds)
    : { data: [] };
  const actorOf = (id: string | null) => {
    if (!id) return "system / service";
    const a = (actorRows ?? []).find((r) => r.id === id);
    return a ? `${a.full_name ?? id.slice(0, 8)} (${a.role})` : id.slice(0, 8);
  };

  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (filterAction) q.set("action", filterAction);
    q.set("page", String(p));
    return `/portal/admin/security?${q.toString()}`;
  };

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Security</span>
          <h1>Security log</h1>
        </div>
        <span className="pbadge amber">
          {total} event{total === 1 ? "" : "s"}
        </span>
      </div>

      <form method="get" className="kfilters">
        <div className="field">
          <label htmlFor="af-action">Action</label>
          <input
            id="af-action"
            name="action"
            type="text"
            defaultValue={filterAction ?? ""}
            placeholder="e.g. user.suspend"
          />
        </div>
        <button className="btn btn-ghost btn-sm" type="submit">
          Filter
        </button>
      </form>

      <div className="ptable-wrap">
        {events.length === 0 ? (
          <p className="pempty">
            No audit events{filterAction ? " match this filter" : " yet"} —
            signups, account changes and staff actions land here.
          </p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(e.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>{actorOf(e.actor_id)}</td>
                  <td>
                    <span className="pbadge amber">{e.action}</span>
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: ".72rem" }}>
                    {e.target_table ?? "—"}
                    {e.target_id ? ` · ${e.target_id.slice(0, 8)}…` : ""}
                  </td>
                  <td
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: ".7rem",
                      maxWidth: 340,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {e.detail !== null ? JSON.stringify(e.detail) : "—"}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: ".72rem" }}>
                    {e.ip ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 ? (
        <p style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
          {page > 1 ? (
            <Link className="btn btn-ghost btn-sm" href={pageHref(page - 1)}>
              ← Prev
            </Link>
          ) : null}
          <span className="mono" style={{ fontSize: ".7rem", color: "var(--steel)" }}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link className="btn btn-ghost btn-sm" href={pageHref(page + 1)}>
              Next →
            </Link>
          ) : null}
        </p>
      ) : null}
    </main>
  );
}
