import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { SupportStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Support Inbox — PickLoads",
  robots: { index: false, follow: false },
};

const STATUSES: readonly SupportStatus[] = ["open", "answered", "closed"];
const BADGE: Record<SupportStatus, string> = {
  open: "amber",
  answered: "green",
  closed: "",
};

/**
 * M-55 — staff support inbox (decision D2). Reads run cookie-bound under
 * "staff manage support threads"; author emails resolve via the admin auth
 * API (profiles carry no email column).
 */
export default async function AdminSupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  await requireStaff(locale);
  const sp = await searchParams;
  const filterStatus =
    STATUSES.find((s) => s === (typeof sp.status === "string" ? sp.status : "")) ??
    null;

  const supabase = await createClient();
  let query = supabase
    .from("support_threads")
    .select("id, profile_id, carrier_id, shipper_id, subject, status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (filterStatus) query = query.eq("status", filterStatus);
  const { data: threadRows } = await query;
  const threads = threadRows ?? [];

  // Author names (profiles readable by staff RLS).
  const profileIds = [...new Set(threads.map((t) => t.profile_id))];
  const { data: authorRows } = profileIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, company_name, role")
        .in("id", profileIds)
    : { data: [] };
  const authorOf = (id: string) => {
    const p = (authorRows ?? []).find((a) => a.id === id);
    if (!p) return "Unknown";
    return `${p.full_name ?? "—"}${p.company_name ? ` · ${p.company_name}` : ""} (${p.role})`;
  };

  const openCount = threads.filter((t) => t.status === "open").length;
  const changeRequests = threads.filter((t) =>
    t.subject.startsWith("[CHANGE REQUEST]"),
  ).length;

  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Operations</span>
          <h1>Support inbox</h1>
        </div>
      </div>

      <div className="ptiles">
        <div className={`ptile ${openCount > 0 ? "warn" : "good"}`}>
          <b>{openCount}</b>
          <span>Awaiting answer</span>
        </div>
        <div className={`ptile ${changeRequests > 0 ? "warn" : ""}`}>
          <b>{changeRequests}</b>
          <span>Change requests</span>
          <span className="sub">regulated-field changes (D5) — verify first</span>
        </div>
        <div className="ptile">
          <b>{threads.length}</b>
          <span>Threads shown</span>
        </div>
      </div>

      <form method="get" className="kfilters">
        <div className="field">
          <label htmlFor="sf-status">Status</label>
          <select id="sf-status" name="status" defaultValue={filterStatus ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-ghost btn-sm" type="submit">
          Filter
        </button>
      </form>

      <div className="ptable-wrap">
        {threads.length === 0 ? (
          <p className="pempty">No support threads match.</p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>Subject</th>
                <th>From</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/portal/admin/support/${t.id}`}>{t.subject}</Link>
                  </td>
                  <td>{authorOf(t.profile_id)}</td>
                  <td>
                    <span className={`pbadge ${BADGE[t.status]}`}>{t.status}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(t.updated_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
