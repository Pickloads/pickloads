import type { Metadata } from "next";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Documents — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-56 — shipper documents. HONEST state: no shipper-facing document flow
 * exists yet (BOLs/PODs live on loads, which aren't shipper-linked until
 * brokerage operations begin) — the page says exactly that, gated on the
 * brokerage_active flag, instead of showing an empty fake library.
 */
export default async function ShipperDocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireShipper(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const { data: brokerageSetting } = await supabase
    .from("company_settings")
    .select("value")
    .eq("key", "brokerage_active")
    .maybeSingle();
  const brokerageActive = brokerageSetting?.value === true;

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Shipper portal")}</span>
          <h1>{tv("Documents")}</h1>
        </div>
      </div>
      <div className="pcard" style={{ maxWidth: 640 }}>
        {brokerageActive ? (
          <p className="pempty" style={{ padding: 0 }}>
            {tv(
              "Shipment paperwork — rate confirmations, BOLs and PODs — appears here as your shipments run. Nothing on file yet.",
            )}
          </p>
        ) : (
          <>
            <span className="pbadge amber">{tv("Launching soon")}</span>
            <p className="pempty" style={{ padding: "10px 0 0" }}>
              {tv(
                "Shipment paperwork (rate confirmations, BOLs, PODs) lands here once our brokerage division is live. Need a document from a quoted shipment today? Message support and we'll email it.",
              )}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
