import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { Link } from "@/i18n/navigation";
import { CarrierWizard } from "@/components/onboarding/CarrierWizard";
import { isEsignConfigured } from "@/lib/esign";
import { getV4 } from "@/i18n/v4-server";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/become-a-carrier",
    title: "Become a Carrier — PickLoads Logistics Group",
    description:
      "Onboard with PickLoads in about 10 minutes: company info, secure document upload, plain-English dispatch agreement and your own carrier portal. No forced dispatch, no exit fees.",
  });
}

export default async function BecomeACarrierPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);
  const esignLive = isEsignConfigured();

  return (
    <main id="main">
      <PageHero
        eyebrow={tv("Carrier onboarding")}
        title={tv("On the road with us in 24 hours.")}
      >
        {tv(
          "Four steps, about 10 minutes: your company info, your documents, a plain-English agreement and your own portal. A dispatcher calls you the same day.",
        )}
      </PageHero>
      <section className="light" style={{ paddingTop: 48 }}>
        <div className="wrap">
          <CarrierWizard esignLive={esignLive} />
          <p
            className="mono"
            style={{
              fontSize: ".72rem",
              color: "var(--color-slate-aa)",
              marginTop: 26,
            }}
          >
            {"// "}
            {tv(
              "Prefer a human? Call (908) 404-5373 and we'll complete onboarding with you over the phone.",
            )}
          </p>
        </div>
      </section>

      {/* §17 — WHO, WHAT IS NEEDED, WHAT HAPPENS NEXT.
          Every string below already exists in the approved V4 dictionary or
          restates a documented fact about the onboarding the wizard actually
          performs. Nothing is newly authored: final marketing copy is Cowork's.

          DELIBERATELY ABSENT: any earnings figure, any guaranteed-loads claim,
          and any carrier rating. Internal carrier performance data is
          §25/§C internal-only — it has no public surface and must never get
          one. An e2e test asserts this page exposes none. */}
      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("What you need to get started")}</h2>
          <div className="values">
            <div>
              <h3>{tv("Your operating authority")}</h3>
              <p>
                {tv(
                  "MC/DOT, W-9, certificate of insurance and a voided check — uploaded in one secure form.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("A signed dispatch agreement")}</h3>
              <p>
                {tv(
                  "Review the dispatch agreement and sign from your phone. No printer, no fax.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("Your own portal")}</h3>
              <p>
                {tv(
                  "Documents, agreements, loads and invoices in one place — yours, not a shared inbox.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("No forced dispatch")}</h3>
              <p>{tv("No forced dispatch — you approve every load")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("Carrier resources")}</h2>
          <p>
            <Link className="btn btn-ghost" href="/dispatch-services">
              {tv("Dispatch Services")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/start-your-trucking-company">
              {tv("Start Your Trucking Company")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/faq">
              {tv("Carrier FAQ")}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
