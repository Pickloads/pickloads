import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import {
  StaffReplyForm,
  ThreadStatusButtons,
} from "@/components/portal/SupportForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Support Thread — PickLoads",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** M-55 — staff view of one support thread: full history + staff reply. */
export default async function AdminSupportThreadPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  await requireStaff(locale);
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const { data: thread } = await supabase
    .from("support_threads")
    .select("id, profile_id, carrier_id, shipper_id, subject, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!thread) notFound();

  const [{ data: messages }, { data: author }] = await Promise.all([
    supabase
      .from("support_messages")
      .select("id, body, is_staff, created_at")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("profiles")
      .select("full_name, company_name, phone, role")
      .eq("id", thread.profile_id)
      .maybeSingle(),
  ]);

  // Author's login email lives in auth.users → admin auth API (display only).
  let authorEmail: string | null = null;
  const admin = tryCreateAdminClient();
  if (admin) {
    const { data } = await admin.auth.admin.getUserById(thread.profile_id);
    authorEmail = data?.user?.email ?? null;
  }

  const isChangeRequest = thread.subject.startsWith("[CHANGE REQUEST]");

  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Support</span>
          <h1>{thread.subject}</h1>
        </div>
        <div className="a-inline is-tight">
          <span className={`pbadge ${thread.status === "open" ? "amber" : thread.status === "answered" ? "green" : ""}`}>
            {thread.status}
          </span>
          <ThreadStatusButtons threadId={thread.id} status={thread.status} />
        </div>
      </div>

      {isChangeRequest ? (
        <p className="pempty flush-left">
          Regulated-field change request (D5): verify the underlying document /
          FMCSA record, apply the change in the carrier record, then answer here
          and close the thread. The request is journaled in audit_events.
        </p>
      ) : null}

      <div className="pgrid2">
        <div className="pcard">
          <ul className="timeline">
            {(messages ?? []).map((m) => (
              <li className="tl" key={m.id}>
                <span className="tlt">
                  {new Date(m.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  ·{" "}
                  {m.is_staff ? (
                    <span className="pbadge amber">STAFF</span>
                  ) : (
                    <span className="pbadge">CUSTOMER</span>
                  )}
                </span>
                <p className="a-prewrap">{m.body}</p>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 18 }}>
            <StaffReplyForm threadId={thread.id} />
          </div>
        </div>

        <div>
          <div className="pcard">
            <h2>Customer</h2>
            <p style={{ fontWeight: 700 }}>{author?.full_name ?? "—"}</p>
            <p className="mono" style={{ fontSize: ".78rem", color: "var(--steel)" }}>
              {author?.company_name ?? "—"} · {author?.role ?? "—"}
              <br />
              {author?.phone ?? "—"}
              <br />
              {authorEmail ?? "email: needs service credentials"}
            </p>
          </div>
          <p>
            <Link className="btn btn-ghost btn-sm" href="/portal/admin/support">
              ← Inbox
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
