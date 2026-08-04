import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import {
  LOAD_STATUS_BADGE,
  LOAD_STATUS_LABELS,
  formatLane,
  formatMoney,
  formatRpm,
} from "@/lib/loads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Loads — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-30 — carrier portal "My Loads": read-only view of dispatched loads with
 * status and the dispatch fee (fee transparency is the brand promise). All
 * reads are RLS-scoped ("member read loads") through the cookie-bound
 * client — the carrier id resolves via the membership helper (M-57), never
 * from the request.
 */
export default async function CarrierLoadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const carrierId = await getMyCarrierId(supabase);
  const { data: carrier } = carrierId
    ? await supabase
        .from("carriers")
        .select("id, company_name, dispatch_fee_pct")
        .eq("id", carrierId)
        .maybeSingle()
    : { data: null };

  const { data: loadRows } = carrier
    ? await supabase
        .from("loads")
        .select(
          "id, broker_name, origin_city, origin_state, dest_city, dest_state, pickup_date, delivery_date, equipment, gross_rate, miles, fee_pct_applied, dispatch_fee, status, created_at",
        )
        .eq("carrier_id", carrier.id)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };
  const loads = loadRows ?? [];

  const delivered = loads.filter(
    (l) => l.status === "delivered" || l.status === "invoiced" || l.status === "paid",
  );
  const grossTotal = delivered.reduce((sum, l) => sum + (l.gross_rate ?? 0), 0);
  const feeTotal = delivered.reduce((sum, l) => sum + l.dispatch_fee, 0);

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">
            {tv("Carrier portal")}
            {carrier ? ` / ${carrier.company_name}` : ""}
          </span>
          <h1>{tv("My Loads")}</h1>
        </div>
      </div>

      {!carrier ? (
        <p className="pempty">
          {tv(
            "Your account isn't linked to a carrier record yet. If you just onboarded, our team activates the link during document review — or call (908) 404-5373.",
          )}
        </p>
      ) : (
        <>
          <div className="ptiles">
            <div className="ptile">
              <b>{loads.length}</b>
              <span>{tv("Loads dispatched")}</span>
            </div>
            <div className="ptile">
              <b>{formatMoney(grossTotal)}</b>
              <span>{tv("Gross hauled (delivered)")}</span>
            </div>
            <div className="ptile">
              <b>{formatMoney(feeTotal)}</b>
              <span>{tv("Dispatch fees (delivered)")}</span>
              <span className="sub">
                {tv("Your rate")}: {carrier.dispatch_fee_pct}%
              </span>
            </div>
          </div>

          <div className="ptable-wrap">
            {loads.length === 0 ? (
              <p className="pempty">
                {tv(
                  "No loads yet — your dispatcher books them here as soon as you're rolling.",
                )}
              </p>
            ) : (
              <table className="ptable ptable--cards">
                <thead>
                  <tr>
                    <th>{tv("Lane")}</th>
                    <th>{tv("Pickup")}</th>
                    <th>{tv("Broker")}</th>
                    <th>{tv("Equipment")}</th>
                    <th>{tv("Gross")}</th>
                    <th>{tv("RPM")}</th>
                    <th>{tv("Dispatch fee")}</th>
                    <th>{tv("Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loads.map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: "nowrap" }} data-th={tv("Lane")}>{formatLane(l)}</td>
                      <td data-th={tv("Pickup")}>{l.pickup_date ?? "—"}</td>
                      <td data-th={tv("Broker")}>{l.broker_name ?? "—"}</td>
                      <td data-th={tv("Equipment")}>{l.equipment ?? "—"}</td>
                      <td data-th={tv("Gross")}>{formatMoney(l.gross_rate)}</td>
                      <td data-th={tv("RPM")}>{formatRpm(l.gross_rate, l.miles)}</td>
                      <td data-th={tv("Dispatch fee")}>
                        {formatMoney(l.dispatch_fee)}{" "}
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: ".62rem",
                            color: "var(--color-steel)",
                          }}
                        >
                          ({l.fee_pct_applied ?? "—"}%)
                        </span>
                      </td>
                      <td data-th={tv("Status")}>
                        <span className={`pbadge ${LOAD_STATUS_BADGE[l.status]}`}>
                          {tv(LOAD_STATUS_LABELS[l.status])}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="pempty" style={{ paddingLeft: 0 }}>
            {tv(
              "Fees are the percentage agreed in your dispatch agreement, snapshotted per load at booking — a later rate change never touches past loads.",
            )}
          </p>
        </>
      )}
    </main>
  );
}
