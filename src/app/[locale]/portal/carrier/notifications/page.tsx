import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import { MarkNotificationsReadButton } from "@/components/portal/MarkNotificationsRead";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-55 — notifications feed (0007 table, own-rows RLS). Rows are written by
 * server-side flows (service role) — document reviews, load status changes,
 * invoices, account changes. Honest empty state until those flows fire.
 */
export default async function CarrierNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("notifications")
    .select("id, kind, title, body, href, read_at, created_at")
    .eq("profile_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  const notifications = rows ?? [];
  const unread = notifications.filter((n) => n.read_at === null).length;

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Carrier portal")}</span>
          <h1>{tv("Notifications")}</h1>
        </div>
        {unread > 0 ? <MarkNotificationsReadButton /> : null}
      </div>

      <div className="pcard">
        {notifications.length === 0 ? (
          <p className="pempty" style={{ padding: 0 }}>
            {tv(
              "Nothing yet — document reviews, load updates and invoices show up here.",
            )}
          </p>
        ) : (
          <ul className="timeline">
            {notifications.map((n) => (
              <li className="tl" key={n.id}>
                <span className="tlt">
                  {new Date(n.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {n.read_at === null ? (
                    <>
                      {" "}
                      <span className="pbadge amber">{tv("New")}</span>
                    </>
                  ) : null}
                </span>
                <p>
                  <b>{n.title}</b>
                  {n.body ? (
                    <>
                      <br />
                      {n.body}
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
