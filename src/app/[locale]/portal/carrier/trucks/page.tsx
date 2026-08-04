import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import { TrucksManager } from "@/components/portal/FleetManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trucks & Equipment — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-55 — trucks & equipment CRUD on the 0006 `trucks` table. Reads and
 * writes are RLS-scoped through the membership policies ("member manage
 * trucks"); equipment options mirror the 8 public equipment slugs.
 */
export default async function CarrierTrucksPage({
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
            <h1>{tv("Trucks & Equipment")}</h1>
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

  const { data: trucks } = await supabase
    .from("trucks")
    .select(
      "id, unit_number, equipment, year, make, model, vin, plate, plate_state, active",
    )
    .eq("carrier_id", carrierId)
    .order("created_at", { ascending: true })
    .limit(100);

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Carrier portal")}</span>
          <h1>{tv("Trucks & Equipment")}</h1>
        </div>
      </div>
      <TrucksManager trucks={trucks ?? []} />
    </main>
  );
}
