import type { Metadata } from "next";
import { Link, getPathname } from "@/i18n/navigation";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import { getTranslations } from "next-intl/server";
import { getMyCarrierId } from "@/lib/memberships";
import { getBooleanSetting } from "@/lib/company-settings";
import {
  hasActiveFilters,
  parsePage,
  parseShipmentFilters,
} from "@/lib/shipments/shipper-list";
import {
  carrierHasAnyShipment,
  getCarrierShipments,
} from "@/lib/shipments/carrier-shipments";
import { CarrierShipmentListView } from "@/components/portal/CarrierShipmentListView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shipments — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-76 — `/portal/carrier/shipments` (§13's carrier portal, list half).
 *
 * ── THE READ PATH ────────────────────────────────────────────────────────
 *
 * `createClient()` — the COOKIE-BOUND server client — so every row comes back
 * under 0018's `"carrier member read shipments"` policy. `tryCreateAdminClient`
 * is not imported here or in `src/lib/shipments/carrier-shipments.ts`. The
 * carrier is resolved through `getMyCarrierId` (M-57's membership helper), the
 * same way every other carrier surface resolves it, so adding a teammate stays
 * an INSERT rather than a page rewrite.
 *
 * THE POLICY WAS NOT WIDENED. M-71's doc is explicit that M-76 must not turn
 * `"carrier member read shipments"` into a `FOR ALL`; it did not, and §12 of
 * the RLS suite asserts the `cmd` is still `SELECT` as a catalog fact. Every
 * write on this surface is a server action holding the service role behind
 * `resolveCarrierShipmentAccess`.
 *
 * ── §2 BROKERAGE GATE, BOTH DIRECTIONS ───────────────────────────────────
 *
 * Identical to M-74's, and for the identical reason: with `brokerage_active`
 * false, 0017's trigger refuses every shipment INSERT, so "no shipments" is
 * the ordinary pre-launch state and an empty operational table would imply a
 * live brokerage. A carrier that DOES have freight still sees it, because
 * M-71's gate is INSERT-only so in-flight shipments stay operable.
 *
 * The notice also does the thing carriers most need it to do: it says their
 * DISPATCH loads are on `/portal/carrier/loads`, not here. Two products, one
 * portal, one sentence that stops a support call.
 */
export default async function CarrierShipmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  await requireCarrier(locale);
  const tv = await getV4(locale);
  const t = await getTranslations({ locale, namespace: "shipment" });
  const sp = await searchParams;
  const supabase = await createClient();

  const filters = parseShipmentFilters(sp);
  const page = parsePage(sp.page);

  const [carrierId, brokerageActive] = await Promise.all([
    getMyCarrierId(supabase),
    getBooleanSetting("brokerage_active"),
  ]);

  const basePath = getPathname({ href: "/portal/carrier/shipments", locale });

  const header = (
    <div className="pbar">
      <div>
        <span className="crumb">{t("carrier.crumb")}</span>
        <h1>{t("carrier.title")}</h1>
      </div>
      <Link className="btn btn-ghost btn-sm" href="/portal/carrier/loads">
        {tv("My Loads")} →
      </Link>
    </div>
  );

  if (carrierId === null) {
    return (
      <main id="main">
        {header}
        <div className="pcard" style={{ maxWidth: 720 }}>
          <p className="pempty" style={{ padding: 0 }}>
            {t("carrier.no_record")}
          </p>
        </div>
      </main>
    );
  }

  const anyShipment = await carrierHasAnyShipment(supabase, carrierId);

  if (!brokerageActive && !anyShipment) {
    return (
      <main id="main">
        {header}
        <div className="pcard" style={{ maxWidth: 720 }}>
          <h2>{t("carrier.title")}</h2>
          <span className="pbadge amber">{tv("Launching soon")}</span>
          <p className="pempty" style={{ padding: "10px 0 0" }}>
            {t("carrier.gate_notice")}
          </p>
        </div>
      </main>
    );
  }

  const result = await getCarrierShipments(supabase, carrierId, filters, page);

  return (
    <main id="main">
      {header}
      <p className="pempty" style={{ padding: "0 0 14px" }}>
        {t("carrier.intro")}
      </p>
      <CarrierShipmentListView
        rows={result.rows}
        filters={filters}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        basePath={basePath}
        failed={result.failed}
        filtered={hasActiveFilters(filters)}
      />
    </main>
  );
}
