import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { QuoteStatusForm } from "@/components/portal/QuoteAdminForms";
import { QUOTE_STATUS } from "@/lib/shipper-quotes";
import type { LeadStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Freight quotes — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-60 — staff freight-quote desk. Until this page, quote statuses were
 * DB-only; now dispatchers work requests here and every stage change
 * notifies the shipper (localized email + portal feed via updateFreightQuote).
 * Reads run cookie-bound under the "staff read quotes" policy.
 */
export default async function AdminQuotesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireStaff(locale);

  const supabase = await createClient();
  const { data: quotes } = await supabase
    .from("freight_quotes")
    .select(
      "id, created_at, company_name, contact_name, email, phone, pickup_city, pickup_state, pickup_zip, delivery_city, delivery_state, delivery_zip, pickup_date, delivery_deadline, commodity, weight_lbs, equipment, hazmat, temp_controlled, status, quoted_rate, shipper_id",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = quotes ?? [];
  const stageBadge = (status: LeadStatus) => QUOTE_STATUS[status];

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">DISPATCH / FREIGHT QUOTES</span>
          <h1>Freight quotes</h1>
        </div>
      </div>

      <div className="ptable-wrap">
        {rows.length === 0 ? (
          <p className="pempty">
            No quote requests yet — portal and website requests land here.
          </p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Shipper</th>
                <th>Lane</th>
                <th>Freight</th>
                <th>Dates</th>
                <th>Stage</th>
                <th>Status / rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => {
                const lane =
                  q.pickup_city && q.delivery_city
                    ? `${q.pickup_city}, ${q.pickup_state ?? "?"} → ${q.delivery_city}, ${q.delivery_state ?? "?"}`
                    : `${q.pickup_zip ?? "?"} → ${q.delivery_zip ?? "?"}`;
                const badge = stageBadge(q.status);
                return (
                  <tr key={q.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(q.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td>
                      {q.company_name ?? "—"}
                      <span
                        className="mono"
                        style={{
                          display: "block",
                          fontSize: ".62rem",
                          color: "var(--color-steel)",
                        }}
                      >
                        {q.contact_name ? `${q.contact_name} · ` : ""}
                        {q.email ?? q.phone ?? ""}
                        {q.shipper_id ? " · PORTAL" : " · WEB"}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{lane}</td>
                    <td>
                      {q.commodity ?? "—"}
                      <span
                        className="mono"
                        style={{
                          display: "block",
                          fontSize: ".62rem",
                          color: "var(--color-steel)",
                        }}
                      >
                        {[
                          q.equipment,
                          q.weight_lbs
                            ? `${q.weight_lbs.toLocaleString("en-US")} lbs`
                            : null,
                          q.temp_controlled ? "temp" : null,
                          q.hazmat ? "HAZMAT" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {q.pickup_date ?? "TBD"}
                      {q.delivery_deadline ? ` → ${q.delivery_deadline}` : ""}
                    </td>
                    <td>
                      <span className={`pbadge ${badge?.badge ?? ""}`}>
                        {badge?.label ?? q.status}
                      </span>
                    </td>
                    <td>
                      <QuoteStatusForm
                        quoteId={q.id}
                        status={q.status}
                        quotedRate={q.quoted_rate}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="pempty" style={{ paddingLeft: 0 }}>
        Moving a quote to a new shipper-visible stage (Received → In review →
        Quoted → Booked / Closed) or changing the rate emails the shipper in
        their language and drops a portal notification. Same-stage pipeline
        moves stay silent.
      </p>
    </main>
  );
}
