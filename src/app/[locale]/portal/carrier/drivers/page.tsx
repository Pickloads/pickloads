import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import { DriversManager } from "@/components/portal/FleetManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Drivers — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-55 — drivers CRUD on the 0006 `drivers` table (directive fields: CDL,
 * medical card, contact). RLS "member manage drivers" scopes everything.
 */
export default async function CarrierDriversPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const carrierId = await getMyCarrierId(supabase);
  if (!carrierId) {
    return (
      <main id="main">
        <div className="pbar">
          <div>
            <span className="crumb">{tv("Carrier portal")}</span>
            <h1>{tv("Drivers")}</h1>
          </div>
        </div>
        <p className="pempty">
          {tv(
            "Your account isn't linked to a carrier record yet. If you just onboarded, our team activates the link during document review — or call (908) 404-5373.",
          )}
        </p>
      </main>
    );
  }

  const { data: drivers } = await supabase
    .from("drivers")
    .select(
      "id, full_name, phone, email, cdl_number, cdl_state, cdl_expiry, medical_card_expiry, active",
    )
    .eq("carrier_id", carrierId)
    .order("created_at", { ascending: true })
    .limit(100);

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Carrier portal")}</span>
          <h1>{tv("Drivers")}</h1>
        </div>
      </div>
      <DriversManager drivers={drivers ?? []} />
    </main>
  );
}
