import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getPathname, Link } from "@/i18n/navigation";
import { getSessionProfile, portalHomeFor } from "@/lib/auth";
import { PageHero } from "@/components/ui/PageHero";
import { CreateShipperForm } from "@/components/auth/CreateShipperForm";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create Shipper Account — PickLoads Logistics Group",
  robots: { index: false, follow: false },
};

/**
 * M-53 — shipper registration (directive fields: industry / frequency /
 * regions). Gated by the D1 `shipper_signup_enabled` flag exactly like the
 * chooser card; wording is quote-request only — no brokerage claims before
 * authority activation.
 */
async function shipperSignupEnabled(): Promise<boolean> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder")
  ) {
    return true;
  }
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("company_settings")
      .select("value")
      .eq("key", "shipper_signup_enabled")
      .maybeSingle();
    return data ? data.value === true : true;
  } catch {
    return true;
  }
}

export default async function CreateShipperAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // M-54: signed-in visitors are role-routed to their portal home.
  const session = await getSessionProfile();
  if (session && session.status !== "suspended") {
    redirect(getPathname({ href: portalHomeFor(session.role), locale }));
  }
  const tv = await getV4(locale);
  const open = await shipperSignupEnabled();

  return (
    <main id="main">
      <PageHero eyebrow={tv("Portal")} title={tv("Create your shipper account")}>
        {tv(
          "Request quotes, see rates as they land, and coordinate freight with vetted carriers — from your own portal.",
        )}
      </PageHero>
      <section className="light" style={{ padding: "56px 0 88px" }}>
        <div className="wrap">
          {open ? (
            <CreateShipperForm />
          ) : (
            /* D1 flag off: honest invite-only state (no dead form). */
            <div className="bigform" style={{ maxWidth: 640, margin: "44px auto 0" }}>
              <h2>{tv("Your shipper account")}</h2>
              <div className="form-err show" role="alert">
                {tv(
                  "Shipper accounts are invite-only right now. Request a quote and we'll set you up personally.",
                )}
              </div>
              <div style={{ marginTop: 22 }}>
                <Link className="btn btn-green" href="/shippers">
                  {tv("Request a Freight Quote →")}
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
