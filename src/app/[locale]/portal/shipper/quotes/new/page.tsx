import type { Metadata } from "next";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import { PortalQuoteForm } from "@/components/portal/PortalQuoteForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request a Quote — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-56 — the professional in-portal quote form (all directive fields).
 * The insert carries the membership-verified shipper_id + verified session
 * email; the public zip-to-zip form stays untouched for anonymous visitors.
 */
export default async function ShipperNewQuotePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireShipper(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", session.userId)
    .maybeSingle();

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Shipper portal")}</span>
          <h1>{tv("Request a Quote")}</h1>
        </div>
      </div>
      <p className="pempty" style={{ paddingLeft: 0, paddingTop: 0 }}>
        {tv(
          "The more detail you give, the faster the firm rate — a dispatcher reviews every request personally.",
        )}
      </p>
      <PortalQuoteForm
        contactName={profile?.full_name ?? null}
        phone={profile?.phone ?? null}
      />
    </main>
  );
}
