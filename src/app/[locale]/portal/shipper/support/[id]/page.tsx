import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import { SupportReplyForm } from "@/components/portal/SupportForms";
import {
  SUPPORT_STATUS_BADGE,
  SupportMessagesTimeline,
} from "@/components/portal/SupportViews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Support Thread — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** M-56 — one shipper support conversation (own-thread RLS; foreign → 404). */
export default async function ShipperSupportThreadPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  await requireShipper(locale);
  if (!UUID.test(id)) notFound();
  const tv = await getV4(locale);
  const supabase = await createClient();

  const { data: thread } = await supabase
    .from("support_threads")
    .select("id, subject, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!thread) notFound();

  const { data: messageRows } = await supabase
    .from("support_messages")
    .select("id, body, is_staff, created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true })
    .limit(200);

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">
            {tv("Shipper portal")} / {tv("Support")}
          </span>
          <h1>{thread.subject}</h1>
        </div>
        <span className={`pbadge ${SUPPORT_STATUS_BADGE[thread.status].cls}`}>
          {tv(SUPPORT_STATUS_BADGE[thread.status].label)}
        </span>
      </div>

      <div className="pgrid2">
        <div className="pcard">
          <SupportMessagesTimeline locale={locale} messages={messageRows ?? []} />
          <div style={{ marginTop: 18 }}>
            {thread.status === "closed" ? (
              <p className="pempty" style={{ padding: 0 }}>
                {tv(
                  "This conversation is closed. Start a new one any time — we keep the history here.",
                )}
              </p>
            ) : (
              <SupportReplyForm threadId={thread.id} />
            )}
          </div>
        </div>
        <div>
          <p>
            <Link className="btn btn-ghost btn-sm" href="/portal/shipper/support">
              ← {tv("All conversations")}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
