import type { Metadata } from "next";
import { getPathname } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { getV4 } from "@/i18n/v4-server";
import { requireBroker } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBooleanSetting } from "@/lib/company-settings";
import {
  hasActiveFilters,
  parsePage,
  parseShipmentFilters,
} from "@/lib/shipments/shipper-list";
import {
  getBrokerPartnerState,
  getBrokerShipments,
} from "@/lib/shipments/broker-access";
import { BrokerShipmentListView } from "@/components/portal/BrokerShipmentListView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared Shipments — PickLoads Partner Portal",
  robots: { index: false, follow: false },
};

/**
 * M-81 — `/portal/broker`, §12's Broker Partner Portal (list half, and the
 * partner's portal HOME — `portalHomeFor('broker')` points here).
 *
 * ── THE READ PATH ────────────────────────────────────────────────────────
 *
 * `createClient()` — the COOKIE-BOUND server client — so every row comes back
 * under 0018's `"broker member read shipments"` policy and 0029's `"broker
 * shared read shipments"`. `tryCreateAdminClient` is not imported here or in
 * `src/lib/shipments/broker-access.ts`.
 *
 * THE POLICIES WERE NOT WIDENED. 0018's floor is untouched; 0029 ADDS a
 * policy whose predicate is `broker_can_read_shipment()`, which is M-71's own
 * link OR a live per-shipment grant OR a live account agreement — §12's two
 * sharing shapes and no third. §16 of the RLS suite proves broker A still
 * cannot read broker B and that a revoked grant stops working.
 *
 * ── THREE HONEST STATES, NOT ONE EMPTY TABLE ─────────────────────────────
 *
 * §12 makes partner access a two-step gate (invited, then verified), so
 * "nothing here" has three different meanings and each gets its own words:
 *
 *   no membership   → the account was never attached to an organization.
 *                     Says so, and says access is invitation-only (§3).
 *   unverified      → invited and accepted, awaiting a human decision. Says
 *                     that, rather than rendering an empty operational table
 *                     that reads as a bug.
 *   verified, empty → nothing has been shared yet. The ordinary state.
 *
 * ── §2 BROKERAGE GATE ────────────────────────────────────────────────────
 *
 * Same shape as M-74's and M-76's, for the same reason: with
 * `brokerage_active` false, 0017's trigger refuses every shipment INSERT, so
 * "no shipments" is the ordinary pre-launch state and an empty operational
 * table would imply a live brokerage. A partner who DOES have shared freight
 * still sees it, because M-71's gate is INSERT-only so in-flight shipments
 * stay operable.
 */
export default async function BrokerPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  await requireBroker(locale);
  const t = await getTranslations({ locale, namespace: "shipment" });
  const tv = await getV4(locale);
  const sp = await searchParams;
  const supabase = await createClient();

  const filters = parseShipmentFilters(sp);
  const page = parsePage(sp.page);

  const [state, brokerageActive] = await Promise.all([
    getBrokerPartnerState(supabase),
    getBooleanSetting("brokerage_active"),
  ]);

  const basePath = getPathname({ href: "/portal/broker", locale });
  const detailBase = getPathname({
    href: "/portal/broker/shipments",
    locale,
  });

  const header = (
    <div className="pbar">
      <div>
        <span className="crumb">{t("broker.crumb")}</span>
        <h1>{state.companyName ?? t("broker.title")}</h1>
      </div>
    </div>
  );

  if (state.memberOf === null) {
    return (
      <main id="main">
        {header}
        <div className="pcard" style={{ maxWidth: 720 }}>
          <p className="pempty" style={{ padding: 0 }}>
            {t("broker.no_org")}
          </p>
        </div>
      </main>
    );
  }

  if (!state.verified) {
    return (
      <main id="main">
        {header}
        <div className="pcard" style={{ maxWidth: 720 }}>
          <h2>{t("broker.unverified_title")}</h2>
          <p className="pempty" style={{ padding: "10px 0 0" }}>
            {t("broker.unverified_body")}
          </p>
        </div>
      </main>
    );
  }

  const result = await getBrokerShipments(
    supabase,
    state.memberOf,
    filters,
    page,
  );

  if (!brokerageActive && result.total === 0 && !result.failed) {
    return (
      <main id="main">
        {header}
        <div className="pcard" style={{ maxWidth: 720 }}>
          <h2>{t("broker.title")}</h2>
          <span className="pbadge amber">{tv("Launching soon")}</span>
          <p className="pempty" style={{ padding: "10px 0 0" }}>
            {t("broker.gate_notice")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main">
      {header}
      <p className="pempty" style={{ padding: "0 0 14px" }}>
        {t("broker.intro")}
      </p>
      <BrokerShipmentListView
        rows={result.rows}
        filters={filters}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        basePath={basePath}
        detailBase={detailBase}
        failed={result.failed}
        filtered={hasActiveFilters(filters)}
        truncated={result.truncated}
      />
    </main>
  );
}
