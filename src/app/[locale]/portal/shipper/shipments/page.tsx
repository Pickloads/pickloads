import type { Metadata } from "next";
import { Link, getPathname } from "@/i18n/navigation";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import { getMyShipperId } from "@/lib/memberships";
import { getBooleanSetting } from "@/lib/company-settings";
import {
  getShipperShipments,
  hasActiveFilters,
  parsePage,
  parseShipmentFilters,
  shipperHasAnyShipment,
} from "@/lib/shipments/shipper-list";
import { ShipmentListView } from "@/components/portal/ShipmentListView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shipments — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-74 — `/portal/shipper/shipments` (§11's shipment list).
 *
 * ── THE READ PATH ─────────────────────────────────────────────────────────
 *
 * `createClient()` — the COOKIE-BOUND server client — so the list runs under
 * 0018's `"shipper member read shipments"` policy. `tryCreateAdminClient` is
 * not imported here or in `src/lib/shipments/shipper-list.ts`. The company is
 * resolved through `getMyShipperId` (M-57's membership helper), the same way
 * every other shipper surface resolves it, so adding a teammate stays an
 * INSERT rather than a page rewrite.
 *
 * There is deliberately NO analogue of M-56's legacy email-matching fallback.
 * A quote can arrive before an account exists and be claimed by a verified
 * email; a shipment is created by dispatch WITH a `shipper_id`, so an
 * unlinked account has no shipments by construction and is told so plainly.
 *
 * ── §2 BROKERAGE GATE, BOTH DIRECTIONS ────────────────────────────────────
 *
 * `brokerage_active` is false today and 0017's trigger refuses every shipment
 * INSERT while it is. So the honest pre-launch state is not an empty
 * operational table — that would imply live brokerage with no freight — it is
 * the M-56 waitlist card this portal already uses on the overview.
 *
 * The gate is checked TOGETHER with "does this shipper actually have
 * shipments". If the flag is off and the answer is no, the waitlist renders.
 * If the flag is off and the answer is YES — brokerage ran, freight is in
 * flight, an admin switched the flag back — the list renders, because M-71
 * made its gate INSERT-only for exactly this reason: *"shipments already in
 * flight must stay operable — refusing their status updates would strand real
 * freight."* Hiding them would be the presentational version of the same
 * mistake.
 */
export default async function ShipperShipmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  await requireShipper(locale);
  const tv = await getV4(locale);
  const sp = await searchParams;
  const supabase = await createClient();

  const filters = parseShipmentFilters(sp);
  const page = parsePage(sp.page);

  const [shipperId, brokerageActive] = await Promise.all([
    getMyShipperId(supabase),
    getBooleanSetting("brokerage_active"),
  ]);

  const basePath = getPathname({ href: "/portal/shipper/shipments", locale });

  const header = (
    <div className="pbar">
      <div>
        <span className="crumb">{tv("Shipper portal")}</span>
        <h1>{tv("Shipments")}</h1>
      </div>
      <Link className="btn btn-ghost btn-sm" href="/portal/shipper/quotes">
        {tv("My Quotes")} →
      </Link>
    </div>
  );

  // No company record: quotes are matched by email (M-56), shipments never
  // are. Say that instead of rendering an empty table.
  if (shipperId === null) {
    return (
      <main id="main">
        {header}
        <div className="pcard" style={{ maxWidth: 720 }}>
          <p className="pempty" style={{ padding: 0 }}>
            {tv(
              "Your account isn't linked to a company record yet, so there are no shipments to show. Call (908) 404-5373 and we'll link it — your quotes are already matched by your sign-in email.",
            )}
          </p>
        </div>
      </main>
    );
  }

  const anyShipment = await shipperHasAnyShipment(supabase, shipperId);

  if (!brokerageActive && !anyShipment) {
    return (
      <main id="main">
        {header}
        <div className="pcard" style={{ maxWidth: 720 }}>
          <h2>{tv("Shipments & tracking")}</h2>
          <span className="pbadge amber">{tv("Launching soon")}</span>
          <p className="pempty" style={{ padding: "10px 0 0" }}>
            {tv(
              "Our brokerage division launches once our FMCSA authority and BMC-84 bond are active — you're on the early list, and shipment tracking appears right here. Until then we quote and coordinate every request personally.",
            )}
          </p>
          <p className="pempty" style={{ padding: "10px 0 0" }}>
            {tv(
              "Dispatch customers: your loads are tracked inside the Carrier Portal, not here.",
            )}
          </p>
        </div>
      </main>
    );
  }

  const result = await getShipperShipments(supabase, shipperId, filters, page);

  return (
    <main id="main">
      {header}
      {!brokerageActive ? (
        <p className="pempty" style={{ padding: "0 0 14px" }}>
          {tv(
            "New brokerage bookings are paused. Shipments already in progress are shown below and continue to be dispatched normally.",
          )}
        </p>
      ) : null}
      <ShipmentListView
        rows={result.rows}
        filters={filters}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        basePath={basePath}
        detailBase={basePath}
        failed={result.failed}
        filtered={hasActiveFilters(filters)}
      />
    </main>
  );
}
