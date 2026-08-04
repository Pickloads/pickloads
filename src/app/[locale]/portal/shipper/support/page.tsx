import type { Metadata } from "next";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import { NewSupportThreadForm } from "@/components/portal/SupportForms";
import { SupportThreadsTable } from "@/components/portal/SupportViews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Support — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/** M-56 — shipper support (M-55 thread machinery, decision D2). */
export default async function ShipperSupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireShipper(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const { data: threadRows } = await supabase
    .from("support_threads")
    .select("id, subject, status, updated_at")
    .eq("profile_id", session.userId)
    .order("updated_at", { ascending: false })
    .limit(50);

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Shipper portal")}</span>
          <h1>{tv("Support")}</h1>
        </div>
      </div>

      <div className="pgrid2">
        <div className="pcard">
          <h2>{tv("Send us a message")}</h2>
          <NewSupportThreadForm />
        </div>
        <div className="pcard">
          <h2>{tv("Prefer the phone?")}</h2>
          <p className="mono" style={{ fontSize: ".8rem", color: "var(--steel)" }}>
            (908) 404-5373
            <br />
            {tv("Dispatch support: 24/7 · Office Mon–Fri 8am–6pm ET")}
          </p>
        </div>
      </div>

      <span className="psec">{tv("Your conversations")}</span>
      <SupportThreadsTable
        locale={locale}
        threads={threadRows ?? []}
        basePath="/portal/shipper/support"
      />
    </main>
  );
}
