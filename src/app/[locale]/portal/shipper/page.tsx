import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPathname, Link } from "@/i18n/navigation";
import { requireProfile, portalHomeFor } from "@/lib/auth";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getV4 } from "@/i18n/v4-server";
import type { LeadStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Quotes — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-32 — shipper portal v1: my quote requests + statuses + request-new-quote.
 *
 * DATA-LINK LIMITATION (documented, deliberate): the schema has NO FK from
 * freight_quotes to auth users — quotes come from the public form (Q3:
 * service-role inserts, email is the only identity captured). So this page
 * matches quotes on the signed-in user's VERIFIED auth email. Because no
 * "shipper reads own quotes" RLS policy exists (schema is FINAL this phase),
 * the read uses the admin client strictly scoped to `.eq("email", session
 * email)` AFTER the server-side role gate — the filter value comes from the
 * Supabase-verified session, never from request input. Quotes submitted
 * under a different email address won't appear; the empty state says so.
 * A proper shipper_id FK + RLS policy is the Phase 4 migration.
 */

/** Shipper-facing labels for the internal lead_status pipeline. */
const QUOTE_STATUS: Partial<Record<LeadStatus, { label: string; badge: string }>> = {
  new: { label: "Received", badge: "amber" },
  call: { label: "In review", badge: "amber" },
  qualified: { label: "In review", badge: "amber" },
  appointment: { label: "In review", badge: "amber" },
  agreement: { label: "Quoted", badge: "green" },
  waiting_documents: { label: "Quoted", badge: "green" },
  active: { label: "Booked", badge: "green" },
  inactive: { label: "Closed", badge: "" },
  lost: { label: "Closed", badge: "" },
};

export default async function ShipperPortalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireProfile(locale);
  if (session.role !== "shipper") {
    redirect(getPathname({ href: portalHomeFor(session.role), locale }));
  }
  const tv = await getV4(locale);

  const admin = session.email ? tryCreateAdminClient() : null;
  const { data: quoteRows } = admin && session.email
    ? await admin
        .from("freight_quotes")
        .select(
          "id, pickup_zip, delivery_zip, pickup_date, commodity, weight_lbs, equipment, frequency, status, quoted_rate, created_at",
        )
        .eq("email", session.email)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] };
  const quotes = quoteRows ?? [];

  const open = quotes.filter(
    (q) => q.status !== "inactive" && q.status !== "lost",
  ).length;
  const quoted = quotes.filter((q) => q.quoted_rate !== null).length;

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Shipper portal")}</span>
          <h1>{tv("My Quotes")}</h1>
        </div>
        <Link className="btn btn-amber btn-sm" href="/shippers">
          {tv("Request a new quote")} →
        </Link>
      </div>

      <div className="ptiles">
        <div className="ptile">
          <b>{quotes.length}</b>
          <span>{tv("Quote requests")}</span>
        </div>
        <div className="ptile">
          <b>{open}</b>
          <span>{tv("Open")}</span>
        </div>
        <div className="ptile">
          <b>{quoted}</b>
          <span>{tv("Rates quoted")}</span>
        </div>
      </div>

      <div className="ptable-wrap">
        {quotes.length === 0 ? (
          <p className="pempty">
            {tv(
              "No quote requests found for this email address. Quotes are matched to your sign-in email",
            )}
            {session.email ? ` (${session.email})` : ""} —{" "}
            {tv(
              "if you requested one under a different address, call (908) 404-5373 and we'll link it.",
            )}
          </p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>{tv("Requested")}</th>
                <th>{tv("Lane")}</th>
                <th>{tv("Pickup")}</th>
                <th>{tv("Commodity")}</th>
                <th>{tv("Weight")}</th>
                <th>{tv("Equipment")}</th>
                <th>{tv("Frequency")}</th>
                <th>{tv("Quoted rate")}</th>
                <th>{tv("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const s = QUOTE_STATUS[q.status] ?? {
                  label: q.status,
                  badge: "",
                };
                return (
                  <tr key={q.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(q.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {q.pickup_zip ?? "—"} → {q.delivery_zip ?? "—"}
                    </td>
                    <td>{q.pickup_date ?? "—"}</td>
                    <td>{q.commodity ?? "—"}</td>
                    <td>
                      {q.weight_lbs !== null
                        ? `${q.weight_lbs.toLocaleString("en-US")} lbs`
                        : "—"}
                    </td>
                    <td>{q.equipment ?? "—"}</td>
                    <td>{q.frequency ?? "—"}</td>
                    <td>
                      {q.quoted_rate !== null
                        ? q.quoted_rate.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                          })
                        : "—"}
                    </td>
                    <td>
                      <span className={`pbadge ${s.badge}`}>{tv(s.label)}</span>
                    </td>
                  </tr>
                );
              })}
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
