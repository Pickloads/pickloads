import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { requireProfile, isStaffRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Profile — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-25 — carrier profile & company info (read-only v1; changes go through
 * the dispatch desk so MC/insurance data stays verified — judgment call
 * documented in docs/modules/M-25-carrier-portal.md).
 */
export default async function CarrierProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireProfile(locale);
  if (isStaffRole(session.role)) {
    redirect(getPathname({ href: "/portal/admin", locale }));
  }
  const tv = await getV4(locale);
  const supabase = await createClient();

  const [{ data: profile }, { data: carrier }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, phone, company_name, preferred_language")
      .eq("id", session.userId)
      .maybeSingle(),
    supabase
      .from("carriers")
      .select(
        "company_name, mc_number, dot_number, home_state, factoring_company, insurance_expiry, dispatch_fee_pct, agreement_signed_at, active, ein",
      )
      .eq("profile_id", session.userId)
      .maybeSingle(),
  ]);

  const row = (label: string, value: React.ReactNode) => (
    <tr>
      <th scope="row" style={{ width: "40%" }}>
        {label}
      </th>
      <td>{value}</td>
    </tr>
  );

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Carrier portal")}</span>
          <h1>{tv("My Profile")}</h1>
        </div>
      </div>

      <div className="pgrid2">
        <div className="pcard">
          <h2>{tv("Account")}</h2>
          <div className="ptable-wrap" style={{ border: "none" }}>
            <table className="ptable">
              <tbody>
                {row(tv("Name"), profile?.full_name ?? "—")}
                {row(tv("Email"), session.email ?? "—")}
                {row(tv("Phone"), profile?.phone ?? "—")}
                {row(
                  tv("Language"),
                  (profile?.preferred_language ?? "en").toUpperCase(),
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pcard">
          <h2>{tv("Company")}</h2>
          {carrier ? (
            <div className="ptable-wrap" style={{ border: "none" }}>
              <table className="ptable">
                <tbody>
                  {row(tv("Company Name"), carrier.company_name)}
                  {row(tv("MC #"), carrier.mc_number ?? "—")}
                  {row(tv("USDOT #"), carrier.dot_number ?? "—")}
                  {row(tv("Home State"), carrier.home_state ?? "—")}
                  {row(tv("Factoring"), carrier.factoring_company ?? "—")}
                  {row(tv("Insurance expiry"), carrier.insurance_expiry ?? "—")}
                  {row(
                    tv("Dispatch fee"),
                    `${carrier.dispatch_fee_pct}% ${tv("of gross per load")}`,
                  )}
                  {row(
                    tv("EIN"),
                    carrier.ein !== null ? (
                      <span className="pbadge green">
                        {tv("on file (encrypted)")}
                      </span>
                    ) : (
                      "—"
                    ),
                  )}
                  {row(
                    tv("Dispatch agreement"),
                    carrier.agreement_signed_at !== null ? (
                      <span className="pbadge green">
                        {tv("Signed")}{" "}
                        {new Date(
                          carrier.agreement_signed_at,
                        ).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    ) : (
                      <span className="pbadge amber">
                        {tv("Awaiting signature")}
                      </span>
                    ),
                  )}
                  {row(
                    tv("Status"),
                    carrier.active ? (
                      <span className="pbadge green">{tv("Active carrier")}</span>
                    ) : (
                      <span className="pbadge amber">
                        {tv("Onboarding in progress")}
                      </span>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pempty" style={{ padding: 0 }}>
              {tv(
                "Your account isn't linked to a carrier record yet. If you just onboarded, our team activates the link during document review — or call (908) 404-5373.",
              )}
            </p>
          )}
        </div>
      </div>

      <p
        className="mono"
        style={{ fontSize: ".72rem", color: "var(--steel)", marginTop: 6 }}
      >
        {"// "}
        {tv(
          "Need to update company details? Call (908) 404-5373 or email support@pickloads.com — changes to MC, insurance and banking data are verified by our team.",
        )}
      </p>
    </main>
  );
}
