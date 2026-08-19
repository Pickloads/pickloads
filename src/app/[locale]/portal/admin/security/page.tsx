import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AUDIT_PAGE_SIZE, parsePage } from "@/lib/validation/staff";
import { SecurityLogView } from "@/components/portal/SecurityLogView";
import { resolveActionFilter } from "@/lib/audit/format";

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
 *
 * M-101 — the page fetches and the View renders. The queries below are the
 * M-58 queries: same table, same columns, same ordering, same page size, same
 * cookie-bound client under the same policy. What changed is that the rows are
 * handed to a presentational component instead of being stringified into a
 * table cell.
 *
 * The one behavioural difference is the filter, and it is a widening rather
 * than a change of contract: the box used to accept only an exact stored
 * constant, so typing what the table actually showed you matched nothing.
 * `resolveActionFilter` maps human wording back to constants, and the query
 * uses `.in()` when a term resolves to several. An exact constant still
 * resolves to itself.
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

  // Bounded before it reaches the resolver: a filter box is still input.
  const rawFilter =
    typeof sp.action === "string" && sp.action.length <= 60 ? sp.action : "";
  const resolved = rawFilter ? resolveActionFilter(rawFilter) : [];

  const supabase = await createClient();
  let query = supabase
    .from("audit_events")
    .select("id, actor_id, action, target_table, target_id, detail, ip, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE - 1);
  if (resolved.length === 1) query = query.eq("action", resolved[0]!);
  else if (resolved.length > 1) query = query.in("action", [...resolved]);
  const { data: eventRows, count } = await query;
  const events = eventRows ?? [];
  const total = count ?? events.length;
  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  // Actor names (staff-readable profiles).
  const actorIds = [
    ...new Set(events.map((e) => e.actor_id).filter((v): v is string => v !== null)),
  ];
  const { data: actorRows } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, role").in("id", actorIds)
    : { data: [] };

  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (rawFilter) q.set("action", rawFilter);
    q.set("page", String(p));
    return `/portal/admin/security?${q.toString()}`;
  };

  return (
    // The View brings its own `AdminPage` wrapper; a second `.a-page` here
    // would nest the gutter inside itself.
    <main id="main">
      <SecurityLogView
        events={events}
        actors={actorRows ?? []}
        total={total}
        page={page}
        totalPages={totalPages}
        filter={rawFilter}
        resolved={resolved}
        pageHref={pageHref}
      />
    </main>
  );
}
