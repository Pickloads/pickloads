import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import { getShipperQuotes, QUOTE_STATUS } from "@/lib/shipper-quotes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Overview — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-56 — shipper portal overview. Quote aggregates via the shared dual-path
 * read (membership RLS / documented legacy email match). The shipments &
 * tracking card is gated by `company_settings.brokerage_active` (decision
 * D1/D6): pre-brokerage it's an HONEST waitlist state, never fake tracking.
 */
export default async function ShipperOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireShipper(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const [{ quotes, shipperId }, { data: brokerageSetting }] = await Promise.all([
    getShipperQuotes(supabase, session, 100),
    supabase
      .from("company_settings")
      .select("value")
      .eq("key", "brokerage_active")
      .maybeSingle(),
  ]);
  const brokerageActive = brokerageSetting?.value === true;

  const pending = quotes.filter((q) => {
    const s = QUOTE_STATUS[q.status];
    return s !== undefined && (s.stage === 0 || s.stage === 1);
  }).length;
  const quoted = quotes.filter((q) => QUOTE_STATUS[q.status]?.stage === 2).length;
  const booked = quotes.filter((q) => QUOTE_STATUS[q.status]?.stage === 3).length;

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Shipper portal")}</span>
          <h1>{tv("Overview")}</h1>
        </div>
        <Link className="btn btn-amber btn-sm" href="/portal/shipper/quotes/new">
          {tv("Request a Quote")} →
        </Link>
      </div>

      <div className="ptiles">
        <div className="ptile">
          <b>{quotes.length}</b>
          <span>{tv("Quote requests")}</span>
        </div>
        <div className={`ptile ${pending > 0 ? "warn" : ""}`}>
          <b>{pending}</b>
          <span>{tv("Pending review")}</span>
        </div>
        <div className={`ptile ${quoted > 0 ? "good" : ""}`}>
          <b>{quoted}</b>
          <span>{tv("Rates quoted")}</span>
        </div>
        <div className={`ptile ${booked > 0 ? "good" : ""}`}>
          <b>{booked}</b>
          <span>{tv("Booked")}</span>
        </div>
      </div>

      <div className="pgrid2">
        <div className="pcard">
          <h2>{tv("Shipments & tracking")}</h2>
          {brokerageActive ? (
            <p className="pempty" style={{ padding: 0 }}>
              {tv(
                "Tracking activates with your first booked shipment — your dispatcher shares live status here.",
              )}
            </p>
          ) : (
            <>
              <span className="pbadge amber">{tv("Launching soon")}</span>
              <p className="pempty" style={{ padding: "10px 0 0" }}>
                {tv(
                  "Our brokerage division launches once our FMCSA authority and BMC-84 bond are active — you're on the early list, and shipment tracking appears right here. Until then we quote and coordinate every request personally.",
                )}
              </p>
            </>
          )}
        </div>

        <div className="pcard">
          <h2>{tv("Quick links")}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <Link className="btn btn-ghost btn-sm" href="/portal/shipper/quotes">
              {tv("My Quotes")} →
            </Link>
            <Link className="btn btn-ghost btn-sm" href="/portal/shipper/support">
              {tv("Support")} →
            </Link>
            <Link className="btn btn-ghost btn-sm" href="/portal/shipper/company">
              {tv("Company Settings")} →
            </Link>
          </div>
          {!shipperId ? (
            <p className="pempty" style={{ padding: "12px 0 0" }}>
              {tv(
                "Your account was set up by our team and isn't linked to a company record yet — quotes are matched by your sign-in email. Call (908) 404-5373 to link it.",
              )}
            </p>
          ) : null}
        </div>
      </div>

      <p className="pempty" style={{ paddingLeft: 0 }}>
        {tv(
          "A dispatcher reviews every request and calls back with a firm rate — usually within one business hour (8am–6pm ET).",
        )}
      </p>
    </main>
  );
}
