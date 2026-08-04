import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import {
  getShipperQuotes,
  QUOTE_STAGES,
  QUOTE_STATUS,
} from "@/lib/shipper-quotes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Quotes — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-56 — My Quotes with a per-request status timeline (Received → In review
 * → Quoted → Booked; Closed marked separately). Same dual-path read as the
 * overview (membership RLS / documented legacy email match, audit §6.3).
 */
export default async function ShipperQuotesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireShipper(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const { quotes, shipperId } = await getShipperQuotes(supabase, session, 100);

  const lane = (q: (typeof quotes)[number]) => {
    const side = (city: string | null, state: string | null, zip: string | null) =>
      [city, state].filter(Boolean).join(", ") || zip || "—";
    return `${side(q.pickup_city, q.pickup_state, q.pickup_zip)} → ${side(q.delivery_city, q.delivery_state, q.delivery_zip)}`;
  };

  const timeline = (status: (typeof quotes)[number]["status"]) => {
    const s = QUOTE_STATUS[status];
    if (!s) return null;
    if (s.stage === -1) {
      return <span className="pbadge">{tv("Closed")}</span>;
    }
    return (
      <span
        className="mono"
        style={{ fontSize: ".62rem", letterSpacing: ".04em", whiteSpace: "nowrap" }}
        title={QUOTE_STAGES.map((st, i) => `${i <= s.stage ? "●" : "○"} ${st}`).join("  ")}
      >
        {QUOTE_STAGES.map((stage, i) => (
          <span
            key={stage}
            style={{ color: i <= s.stage ? "var(--amber)" : "var(--color-steel)" }}
          >
            {i <= s.stage ? "●" : "○"}
          </span>
        ))}{" "}
        <span style={{ color: "var(--steel)" }}>{tv(s.label)}</span>
      </span>
    );
  };

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Shipper portal")}</span>
          <h1>{tv("My Quotes")}</h1>
        </div>
        <Link className="btn btn-amber btn-sm" href="/portal/shipper/quotes/new">
          {tv("Request a Quote")} →
        </Link>
      </div>

      <div className="ptable-wrap">
        {quotes.length === 0 ? (
          shipperId ? (
            <p className="pempty">
              {tv(
                "No quote requests yet. Request your first quote and it shows up here — along with any past requests made under your verified email.",
              )}
            </p>
          ) : (
            <p className="pempty">
              {tv(
                "No quote requests found for this email address. Quotes are matched to your sign-in email",
              )}
              {session.email ? ` (${session.email})` : ""} —{" "}
              {tv(
                "if you requested one under a different address, call (908) 404-5373 and we'll link it.",
              )}
            </p>
          )
        ) : (
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th>{tv("Requested")}</th>
                <th>{tv("Lane")}</th>
                <th>{tv("Pickup")}</th>
                <th>{tv("Deadline")}</th>
                <th>{tv("Commodity")}</th>
                <th>{tv("Equipment")}</th>
                <th>{tv("Quoted rate")}</th>
                <th>{tv("Progress")}</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td style={{ whiteSpace: "nowrap" }} data-th={tv("Requested")}>
                    {new Date(q.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }} data-th={tv("Lane")}>{lane(q)}</td>
                  <td data-th={tv("Pickup")}>{q.pickup_date ?? "—"}</td>
                  <td data-th={tv("Deadline")}>{q.delivery_deadline ?? "—"}</td>
                  <td data-th={tv("Commodity")}>{q.commodity ?? "—"}</td>
                  <td data-th={tv("Equipment")}>{q.equipment ?? "—"}</td>
                  <td data-th={tv("Quoted rate")}>
                    {q.quoted_rate !== null
                      ? q.quoted_rate.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })
                      : "—"}
                  </td>
                  <td data-th={tv("Progress")}>{timeline(q.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="pempty" style={{ paddingLeft: 0 }}>
        {tv(
          "A dispatcher reviews every request and calls back with a firm rate — usually within one business hour (8am–6pm ET).",
        )}
      </p>
    </main>
  );
}
