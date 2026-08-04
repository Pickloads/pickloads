import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getPathname, Link } from "@/i18n/navigation";
import { getSessionProfile, portalHomeFor } from "@/lib/auth";
import { PageHero } from "@/components/ui/PageHero";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create Account — PickLoads Logistics Group",
  robots: { index: false, follow: false },
};

/**
 * M-52 — /create-account chooser (directive role choice). Carrier and
 * shipper branches; the shipper door is gated by the `shipper_signup_enabled`
 * company_settings flag (decision D1 — legal can flip it without a deploy).
 * Copy is quote-request-only wording: no brokerage claims pre-activation.
 */
async function shipperSignupEnabled(): Promise<boolean> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder")
  ) {
    return true; // D1 default; the flag only exists to turn the door OFF
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

export default async function CreateAccountPage({
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
  const shipperOpen = await shipperSignupEnabled();

  return (
    <main id="main">
      <PageHero eyebrow={tv("Portal")} title={tv("Get started with PickLoads")}>
        {tv("Pick the account that matches how you move freight — it takes about two minutes.")}
      </PageHero>
      <section>
        <div className="wrap">
          <div className="services-grid">
            <div className="svc dispatch">
              <span className="tag">{tv("Carrier Account")}</span>
              <h3>{tv("I run trucks")}</h3>
              <p>
                {tv(
                  "Owner-operators and small fleets — with authority active, pending, or not started yet. We route you to the right next step.",
                )}
              </p>
              <ul>
                <li>{tv("Authority active? Straight to onboarding.")}</li>
                <li>{tv("Application pending? We track it with you.")}</li>
                <li>{tv("No authority yet? We help you launch.")}</li>
              </ul>
              <Link className="btn btn-amber" href="/create-account/carrier">
                {tv("Create Carrier Account →")}
              </Link>
              <span className="soon">
                <Link href="/login">{tv("Already have an account? Sign in →")}</Link>
              </span>
            </div>
            <div className="svc broker">
              <span className="tag">{tv("Shipper Account")}</span>
              <h3>{tv("I ship freight")}</h3>
              {shipperOpen ? (
                <>
                  <p>
                    {tv(
                      "Get quotes and coordinate freight with vetted carriers — track every request and rate in your own portal.",
                    )}
                  </p>
                  <ul>
                    <li>{tv("Track your quote requests and statuses")}</li>
                    <li>{tv("See quoted rates as they come in")}</li>
                    <li>{tv("A dispatcher calls back within one business hour")}</li>
                  </ul>
                  <Link className="btn btn-green" href="/create-account/shipper">
                    {tv("Create Shipper Account →")}
                  </Link>
                  <span className="soon">
                    <Link href="/login">{tv("Already have an account? Sign in →")}</Link>
                  </span>
                </>
              ) : (
                <>
                  {/* D1 flag off: honest invite-only state, no dead door. */}
                  <p>
                    {tv(
                      "Shipper accounts are invite-only right now. Request a quote and we'll set you up personally.",
                    )}
                  </p>
                  <Link className="btn btn-green" href="/shippers">
                    {tv("Request a Freight Quote →")}
                  </Link>
                </>
              )}
            </div>
          </div>
          <p className="mono" style={{ fontSize: ".72rem", marginTop: 26, color: "var(--steel)" }}>
            {"// "}
            {tv("Prefer a human? Call (908) 404-5373 and we'll set your account up over the phone.")}
          </p>
        </div>
      </section>
    </main>
  );
}
