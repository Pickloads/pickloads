import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import { NewSupportThreadForm } from "@/components/portal/SupportForms";
import { SupportThreadsTable } from "@/components/portal/SupportViews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Support — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-55 — carrier support home (decision D2: simple threads). Thread reads
 * are cookie-bound under "own support threads read"; the assigned-dispatcher
 * card resolves the staff name via the admin client (display only).
 */
export default async function CarrierSupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const [{ data: threadRows }, carrierId] = await Promise.all([
    supabase
      .from("support_threads")
      .select("id, subject, status, updated_at")
      .eq("profile_id", session.userId)
      .order("updated_at", { ascending: false })
      .limit(50),
    getMyCarrierId(supabase),
  ]);

  let dispatcher: { name: string; phone: string | null } | null = null;
  if (carrierId) {
    const { data: carrier } = await supabase
      .from("carriers")
      .select("assigned_dispatcher_id")
      .eq("id", carrierId)
      .maybeSingle();
    if (carrier?.assigned_dispatcher_id) {
      const admin = tryCreateAdminClient();
      if (admin) {
        const { data } = await admin
          .from("profiles")
          .select("full_name, phone")
          .eq("id", carrier.assigned_dispatcher_id)
          .maybeSingle();
        if (data) {
          dispatcher = {
            name: data.full_name ?? "PickLoads dispatcher",
            phone: data.phone,
          };
        }
      }
    }
  }

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Carrier portal")}</span>
          <h1>{tv("Support")}</h1>
        </div>
      </div>

      <div className="pgrid2">
        <div className="pcard">
          <h2>{tv("Send us a message")}</h2>
          <NewSupportThreadForm />
        </div>
        <div className="pcard">
          <h2>{tv("Your dispatcher")}</h2>
          {dispatcher ? (
            <>
              <p style={{ fontWeight: 700 }}>{dispatcher.name}</p>
              <p className="mono" style={{ fontSize: ".8rem", color: "var(--steel)" }}>
                {dispatcher.phone ?? "(908) 404-5373"}
              </p>
            </>
          ) : (
            <p className="pempty" style={{ padding: 0 }}>
              {tv(
                "No dispatcher assigned yet — you'll see yours here once dispatch starts. Meanwhile: (908) 404-5373.",
              )}
            </p>
          )}
          <p className="mono" style={{ fontSize: ".72rem", color: "var(--steel)", marginTop: 10 }}>
            {"// "}
            {tv("Dispatch support: 24/7 · Office Mon–Fri 8am–6pm ET")}
          </p>
        </div>
      </div>

      <span className="psec">{tv("Your conversations")}</span>
      <SupportThreadsTable
        locale={locale}
        threads={threadRows ?? []}
        basePath="/portal/carrier/support"
      />
    </main>
  );
}
