import type { Metadata } from "next";
import { requireShipper } from "@/lib/auth";
import { getV4 } from "@/i18n/v4-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Billing — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-56 — shipper billing, decision D6: HONEST placeholder. Nothing is
 * invoiced to shippers today (Stripe bills carriers' dispatch fees only);
 * no invoicing flow is faked here.
 */
export default async function ShipperBillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireShipper(locale);
  const tv = await getV4(locale);

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Shipper portal")}</span>
          <h1>{tv("Billing")}</h1>
        </div>
      </div>
      <div className="pcard" style={{ maxWidth: 640 }}>
        <p className="pempty" style={{ padding: 0 }}>
          {tv(
            "Invoices appear here once your first shipment is booked — nothing has been billed to your account. Rate quotes are always free.",
          )}
        </p>
      </div>
    </main>
  );
}
