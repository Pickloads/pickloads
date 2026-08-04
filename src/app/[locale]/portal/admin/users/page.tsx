import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import {
  AccountStatusActions,
  AssignDispatcherSelect,
  StaffInviteForm,
  type DispatcherOption,
} from "@/components/portal/UserAdminForms";
import { parsePage, USERS_PAGE_SIZE } from "@/lib/validation/staff";
import type {
  AccountStatus,
  DocType,
  UserRole,
} from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Users — PickLoads",
  robots: { index: false, follow: false },
};

const ROLES: readonly UserRole[] = ["carrier", "shipper", "dispatcher", "admin"];
const STATUSES: readonly AccountStatus[] = ["pending", "active", "suspended"];
const STATUS_BADGE: Record<AccountStatus, string> = {
  pending: "amber",
  active: "green",
  suspended: "red",
};
const REQUIRED_DOCS: readonly DocType[] = [
  "mc_authority",
  "coi",
  "w9",
  "voided_check",
];

/**
 * M-58 — admin account management: list/filter/paginate every account,
 * approve/suspend with reason (history + audit + email + notification),
 * per-carrier onboarding progress, dispatcher assignment, staff invites.
 * Admin-only (dispatchers never manage accounts — least privilege).
 */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const session = await requireAdmin(locale);
  const sp = await searchParams;
  const filterRole =
    ROLES.find((r) => r === (typeof sp.role === "string" ? sp.role : "")) ?? null;
  const filterStatus =
    STATUSES.find((s) => s === (typeof sp.status === "string" ? sp.status : "")) ??
    null;
  const page = parsePage(typeof sp.page === "string" ? sp.page : undefined);

  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, role, full_name, phone, company_name, status, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * USERS_PAGE_SIZE, page * USERS_PAGE_SIZE - 1);
  if (filterRole) query = query.eq("role", filterRole);
  if (filterStatus) query = query.eq("status", filterStatus);

  const [{ data: userRows, count }, { data: staffRows }, { data: inviteRows }] =
    await Promise.all([
      query,
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("role", ["admin", "dispatcher"])
        .limit(100),
      supabase
        .from("staff_invites")
        .select("id, email, role, expires_at, accepted_at, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
  const users = userRows ?? [];
  const total = count ?? users.length;
  const totalPages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const dispatchers: DispatcherOption[] = (staffRows ?? []).map((s) => ({
    id: s.id,
    name: `${s.full_name ?? "Staff"}${s.role === "admin" ? " (admin)" : ""}`,
  }));

  // Carrier context for the listed page: memberships → carriers → docs.
  const profileIds = users.map((u) => u.id);
  const { data: membershipRows } = profileIds.length
    ? await supabase
        .from("carrier_memberships")
        .select("carrier_id, profile_id")
        .in("profile_id", profileIds)
    : { data: [] };
  const carrierIds = [...new Set((membershipRows ?? []).map((m) => m.carrier_id))];
  const [{ data: carrierRows }, { data: docRows }] = await Promise.all([
    carrierIds.length
      ? supabase
          .from("carriers")
          .select(
            "id, company_name, mc_number, dot_number, agreement_signed_at, active, assigned_dispatcher_id",
          )
          .in("id", carrierIds)
      : Promise.resolve({ data: [] }),
    carrierIds.length
      ? supabase
          .from("documents")
          .select("carrier_id, type, status")
          .in("carrier_id", carrierIds)
          .limit(1000)
      : Promise.resolve({ data: [] }),
  ]);
  const carrierOf = (profileId: string) => {
    const membership = (membershipRows ?? []).find((m) => m.profile_id === profileId);
    if (!membership) return null;
    return (carrierRows ?? []).find((c) => c.id === membership.carrier_id) ?? null;
  };
  const onboardingProgress = (carrier: NonNullable<ReturnType<typeof carrierOf>>) => {
    const docs = (docRows ?? []).filter((d) => d.carrier_id === carrier.id);
    const docsComplete = REQUIRED_DOCS.every((t) =>
      docs.some((d) => d.type === t && d.status !== "rejected"),
    );
    const steps = [
      true, // account exists
      carrier.mc_number !== null || carrier.dot_number !== null,
      docsComplete,
      carrier.agreement_signed_at !== null,
      carrier.active,
    ];
    return { done: steps.filter(Boolean).length, total: steps.length };
  };

  // Login emails (auth.users) — display-only, graceful without service key.
  const admin = tryCreateAdminClient();
  const emailById = new Map<string, string>();
  if (admin && users.length > 0) {
    const { data: listed, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (!error) {
      for (const u of listed.users) {
        if (u.email) emailById.set(u.id, u.email);
      }
    }
  }

  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (filterRole) q.set("role", filterRole);
    if (filterStatus) q.set("status", filterStatus);
    q.set("page", String(p));
    return `/portal/admin/users?${q.toString()}`;
  };

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Accounts</span>
          <h1>Users</h1>
        </div>
        <span className="pbadge amber">
          {total} account{total === 1 ? "" : "s"}
        </span>
      </div>

      <form method="get" className="kfilters">
        <div className="field">
          <label htmlFor="uf-role">Role</label>
          <select id="uf-role" name="role" defaultValue={filterRole ?? ""}>
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="uf-status">Status</label>
          <select id="uf-status" name="status" defaultValue={filterStatus ?? ""}>
            <option value="">All statuses</option>
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
        {users.length === 0 ? (
          <p className="pempty">No accounts match this filter.</p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Company / onboarding</th>
                <th>Dispatcher</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const carrier = u.role === "carrier" ? carrierOf(u.id) : null;
                const progress = carrier ? onboardingProgress(carrier) : null;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.full_name ?? "—"}
                      <span className="mono" style={{ display: "block", fontSize: ".62rem", color: "var(--color-steel)" }}>
                        {emailById.get(u.id) ??
                          (admin ? "—" : "email: needs service credentials")}
                        {u.phone ? ` · ${u.phone}` : ""}
                      </span>
                      <span className="mono" style={{ display: "block", fontSize: ".62rem", color: "var(--color-steel)" }}>
                        joined{" "}
                        {new Date(u.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </td>
                    <td>
                      <span className="pbadge">{u.role}</span>
                    </td>
                    <td>
                      {carrier ? (
                        <>
                          {carrier.company_name}
                          <span className="mono" style={{ display: "block", fontSize: ".62rem", color: "var(--color-steel)" }}>
                            {carrier.mc_number ? `MC ${carrier.mc_number} · ` : ""}
                            onboarding {progress?.done}/{progress?.total}
                            {carrier.active ? " · ACTIVE" : ""}
                          </span>
                        </>
                      ) : (
                        (u.company_name ?? "—")
                      )}
                    </td>
                    <td>
                      {carrier ? (
                        <AssignDispatcherSelect
                          carrierId={carrier.id}
                          current={carrier.assigned_dispatcher_id}
                          dispatchers={dispatchers}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={`pbadge ${STATUS_BADGE[u.status]}`}>
                        {u.status}
                      </span>
                    </td>
                    <td>
                      {u.id === session.userId ? (
                        <span className="mono" style={{ fontSize: ".62rem", color: "var(--color-steel)" }}>
                          (you)
                        </span>
                      ) : u.role === "admin" ? (
                        <span className="mono" style={{ fontSize: ".62rem", color: "var(--color-steel)" }}>
                          admin — protected
                        </span>
                      ) : (
                        <AccountStatusActions profileId={u.id} status={u.status} />
                      )}
                    </td>
                  </tr>
                );
              })}
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

      <div className="pgrid2" style={{ marginTop: 26 }}>
        <div className="pcard">
          <h2>Invite staff</h2>
          <p className="pempty" style={{ padding: "0 0 10px" }}>
            Staff access is invite-only (S-04): a single-use, 7-day tokenized
            link — the role is assigned server-side on accept.
          </p>
          <StaffInviteForm />
        </div>
        <div className="pcard">
          <h2>Recent invites</h2>
          {(inviteRows ?? []).length === 0 ? (
            <p className="pempty" style={{ padding: 0 }}>
              No invites yet.
            </p>
          ) : (
            <table className="ptable">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {(inviteRows ?? []).map((i) => {
                  const expired =
                    i.accepted_at === null &&
                    new Date(i.expires_at).getTime() < Date.now();
                  return (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{i.role}</td>
                      <td>
                        {i.accepted_at ? (
                          <span className="pbadge green">accepted</span>
                        ) : expired ? (
                          <span className="pbadge red">expired</span>
                        ) : (
                          <span className="pbadge amber">pending</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
