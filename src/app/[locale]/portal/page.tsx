import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getPathname, Link } from "@/i18n/navigation";
import { getSessionProfile, portalHomeFor } from "@/lib/auth";
import { getV4 } from "@/i18n/v4-server";
import { Topbar } from "@/components/layout/Topbar";
import { SiteNav } from "@/components/layout/SiteNav";
import { Footer } from "@/components/layout/Footer";
import { PageHero } from "@/components/ui/PageHero";
import { getBooleanSetting } from "@/lib/company-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portal — PickLoads Logistics Group",
  // Deliberately noindex (robots.txt already disallows /portal): this is a
  // utility door, not a landing page — SEO surface stays the public site.
  robots: { index: false, follow: false },
};

/**
 * M-51 — /portal selection page. Pre-auth (the middleware now protects only
 * /portal/* subpaths): signed-in users are role-routed exactly as before;
 * visitors get the directive's two-door chooser (carrier / shipper cards with
 * described actions), composed from V4 vocabulary (.services-grid/.svc).
 */
export default async function PortalSelectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionProfile();
  if (session) {
    redirect(getPathname({ href: portalHomeFor(session.role), locale }));
  }
  const tv = await getV4(locale);
  // M-69/P-3: same brokerage-gated footer label as the public site.
  const brokerageActive = await getBooleanSetting("brokerage_active");

  return (
    <>
      <Topbar />
      <SiteNav brokerageActive={brokerageActive} />
      <main id="main">
        <PageHero eyebrow={tv("Portal")} title={tv("Choose your portal")}>
          {tv(
            "Carriers and shippers each have their own workspace — pick yours to sign in or create an account.",
          )}
        </PageHero>
        <section>
          <div className="wrap">
            <div className="services-grid">
              <div className="svc dispatch">
                <span className="tag">{tv("Carrier Portal")}</span>
                <h3>{tv("Carriers")}</h3>
                <p>
                  {tv(
                    "Your dispatch back office: document review, agreement status and your loads — in one place.",
                  )}
                </p>
                <ul>
                  <li>{tv("Track document review and insurance status")}</li>
                  <li>{tv("See your dispatch agreement status")}</li>
                  <li>{tv("Follow your loads and dispatch fees")}</li>
                  <li>{tv("Upload replacement documents any time")}</li>
                </ul>
                <Link className="btn btn-amber" href="/login">
                  {tv("Carrier Sign In →")}
                </Link>
                <span className="soon">
                  {/* M-52: account-first door replaces the wizard shortcut. */}
                  <Link href="/create-account/carrier">
                    {tv("New to PickLoads? Create your carrier account →")}
                  </Link>
                </span>
              </div>
              <div className="svc broker">
                <span className="tag">{tv("Shipper Portal")}</span>
                <h3>{tv("Shippers")}</h3>
                <p>
                  {tv(
                    "Request quotes and coordinate freight with vetted carriers — and follow every request in one place.",
                  )}
                </p>
                <ul>
                  <li>{tv("Track your quote requests and statuses")}</li>
                  <li>{tv("See quoted rates as they come in")}</li>
                  <li>{tv("Request new quotes in minutes")}</li>
                  <li>{tv("Talk to a dispatcher about any shipment")}</li>
                </ul>
                <Link className="btn btn-green" href="/login">
                  {tv("Shipper Sign In →")}
                </Link>
                <span className="soon">
                  {/* M-53: shipper self-signup door (decision D1). */}
                  <Link href="/create-account/shipper">
                    {tv("New here? Create your shipper account →")}
                  </Link>
                </span>
              </div>
            </div>
            <p className="mono" style={{ fontSize: ".72rem", marginTop: 26, color: "var(--steel)" }}>
              {"// "}
              {tv(
                "PickLoads staff sign in through the same door — your account's role routes you to the right desk.",
              )}
            </p>
          </div>
        </section>
      </main>
      <Footer brokerageActive={brokerageActive} />
    </>
  );
}
