import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPathname, Link } from "@/i18n/navigation";
import { requireProfile, portalHomeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getV4 } from "@/i18n/v4-server";
import type { LeadStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Quotes — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-32 shipper portal, upgraded in M-53 with the M-50 data model:
 *
 * SELF-SIGNUP PATH (shipper_memberships row exists): quotes are read through
 * the cookie-bound server client under the 0009 "member read own quotes" RLS
 * policy (`shipper_id in my_shipper_ids()`). Before reading, un-owned
 * historical quotes whose email equals the **Supabase-verified session
 * email** are claimed one-shot (service role) — never signup input, so an
 * attacker registering someone else's address can't read anything until that
 * address itself is verified (audit §6.3).
 *
 * LEGACY PATH (staff-invited account, no membership): the documented M-32
 * email-matching read stays — admin client strictly scoped to
 * `.eq("email", session.email)` after the role gate.
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

  const QUOTE_COLUMNS =
    "id, pickup_zip, delivery_zip, pickup_date, commodity, weight_lbs, equipment, frequency, status, quoted_rate, created_at";

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("shipper_memberships")
    .select("shipper_id")
    .limit(1)
    .maybeSingle();

  let quoteRows: Array<{
    id: string;
    pickup_zip: string | null;
    delivery_zip: string | null;
    pickup_date: string | null;
    commodity: string | null;
    weight_lbs: number | null;
    equipment: string | null;
    frequency: string | null;
    status: LeadStatus;
    quoted_rate: number | null;
    created_at: string;
  }> = [];

  if (membership) {
    // Post-verification claim: link legacy un-owned quotes submitted under
    // the verified session email (one-shot; % and _ escaped for ilike).
    const admin = session.email ? tryCreateAdminClient() : null;
    if (admin && session.email) {
      const { error: claimError } = await admin
        .from("freight_quotes")
        .update({ shipper_id: membership.shipper_id })
        .is("shipper_id", null)
        .ilike("email", session.email.replace(/[%_]/g, "\\$&"));
      if (claimError) {
        console.error("[shipper-portal] quote claim failed", claimError.message);
      }
    }
    // Cookie-bound read under the "member read own quotes" RLS policy.
    const { data } = await supabase
      .from("freight_quotes")
      .select(QUOTE_COLUMNS)
      .eq("shipper_id", membership.shipper_id)
      .order("created_at", { ascending: false })
      .limit(100);
    quoteRows = data ?? [];
  } else {
    // Legacy staff-invited account: documented M-32 email-matching read.
    const admin = session.email ? tryCreateAdminClient() : null;
    if (admin && session.email) {
      const { data } = await admin
        .from("freight_quotes")
        .select(QUOTE_COLUMNS)
        .eq("email", session.email)
        .order("created_at", { ascending: false })
        .limit(100);
      quoteRows = data ?? [];
    }
  }
  const quotes = quoteRows;

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
          membership ? (
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
