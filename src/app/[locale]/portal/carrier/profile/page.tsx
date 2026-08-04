import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import {
  ChangeRequestForm,
  ContactInfoForm,
  DispatchPreferencesForm,
} from "@/components/portal/CarrierProfileForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company Profile — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-55 — company profile, upgraded from the M-25 read-only page per decision
 * D5: contact info + dispatch preferences are self-serve; regulated fields
 * (MC/DOT/EIN/insurance/factoring) render read-only and change only through
 * the staff-reviewed change-request flow (tagged support thread + audit).
 */
export default async function CarrierProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const carrierId = await getMyCarrierId(supabase);
  const [{ data: profile }, { data: carrier }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, phone, company_name, preferred_language")
      .eq("id", session.userId)
      .maybeSingle(),
    carrierId
      ? supabase
          .from("carriers")
          .select(
            "company_name, mc_number, dot_number, home_state, factoring_company, insurance_expiry, dispatch_fee_pct, agreement_signed_at, active, ein, preferred_lanes, home_time_notes",
          )
          .eq("id", carrierId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
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
          <h1>{tv("Company Profile")}</h1>
        </div>
      </div>

      <div className="pgrid2">
        <div>
          <div className="pcard">
            <h2>{tv("Contact info")}</h2>
            <p className="mono" style={{ fontSize: ".72rem", color: "var(--steel)", marginBottom: 12 }}>
              {tv("Email")}: {session.email ?? "—"} ·{" "}
              {tv("Change it in Account Settings.")}
            </p>
            <ContactInfoForm
              fullName={profile?.full_name ?? null}
              phone={profile?.phone ?? null}
            />
          </div>

          <div className="pcard">
            <h2>{tv("Dispatch preferences")}</h2>
            <p className="mono" style={{ fontSize: ".72rem", color: "var(--steel)", marginBottom: 12 }}>
              {tv("Your dispatcher plans lanes around these — update them any time.")}
            </p>
            {carrier ? (
              <DispatchPreferencesForm
                preferredLanes={carrier.preferred_lanes}
                homeTimeNotes={carrier.home_time_notes}
              />
            ) : (
              <p className="pempty" style={{ padding: 0 }}>
                {tv(
                  "Your account isn't linked to a carrier record yet. If you just onboarded, our team activates the link during document review — or call (908) 404-5373.",
                )}
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="pcard">
            <h2>{tv("Regulated company data")}</h2>
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
                        <span className="pbadge green">{tv("on file (encrypted)")}</span>
                      ) : (
                        "—"
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
            <p className="mono" style={{ fontSize: ".72rem", color: "var(--steel)", marginTop: 10 }}>
              {"// "}
              {tv(
                "These fields are verified by our compliance team — request a change below and we'll apply it after review.",
              )}
            </p>
          </div>

          {carrier ? (
            <div className="pcard">
              <h2>{tv("Request a change")}</h2>
              <ChangeRequestForm />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
