import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getV4 } from "@/i18n/v4-server";
import { PageHero } from "@/components/ui/PageHero";
import { Link } from "@/i18n/navigation";
import { NewAuthority } from "@/components/sections/NewAuthority";
import { NewAuthorityLeadForm } from "@/components/forms/NewAuthorityLeadForm";
import { JsonLd } from "@/components/seo/JsonLd";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/*
 * M-26 — /start-your-trucking-company (arch New Authority funnel, audit
 * F-10 route mapping). Composed 100% from V4 vocabulary: PageHero → the
 * home NewAuthority section reused verbatim → light .steps launch timeline →
 * .bigform lead capture (lead_type='new_authority'). The not-a-law-firm
 * disclaimer (legal checklist item) appears three times: hero, panel above
 * the form, and inside the form footer.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/start-your-trucking-company",
    title: "Start Your Trucking Company — New Authority Program | PickLoads",
    description:
      "LLC, EIN, MC & USDOT filing, BOC-3, UCR and insurance guidance — then straight into dispatch. One partner from paperwork to first load. Document filing assistance only — not a law firm.",
  });
}

export default async function StartTruckingCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);

  const serviceJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "New Authority Program",
    serviceType: "Trucking authority filing assistance",
    url: absoluteUrl("/start-your-trucking-company", locale),
    areaServed: { "@type": "Country", name: "United States" },
    description:
      "Document filing assistance for new trucking companies: LLC formation, EIN, MC/USDOT, BOC-3, UCR and insurance guidance, followed by dispatch onboarding. Not a law firm; no legal advice.",
  };

  return (
    <main id="main">
      <JsonLd data={serviceJsonLd} />
      <PageHero
        eyebrow={tv("Start your trucking company")}
        title={tv("No MC yet? We'll launch you — then dispatch you.")}
      >
        {tv(
          "Our New Authority Program handles the filings, then rolls you straight into dispatch. One partner from paperwork to first load.",
        )}
      </PageHero>

      {/* Prominent disclaimer band — legal checklist item */}
      <div
        className="boards-strip"
        role="note"
        aria-label={tv("Service disclaimer")}
      >
        <div className="wrap">
          <p>
            <b>{tv("Straight talk:")}</b>{" "}
            {/* Owner decision D4 (2026-08-12): the New Authority Program is
                operated by PickLoads Logistics Group LLC. Naming the provider
                on the page itself matters because this is the one service
                where a customer could reasonably wonder whether they are
                dealing with a filing agency, a law firm or a government
                portal — and the answer has to be on the page, not inferred
                from the domain. */}
            {tv(
              "The New Authority Program is operated by PickLoads Logistics Group LLC.",
            )}{" "}
            {tv(
              "Document filing assistance only — we are not a law firm and do not provide legal advice.",
            )}{" "}
            {tv(
              "We are not FMCSA, USDOT or any government agency, and we cannot guarantee approval of any application.",
            )}{" "}
            {tv(
              "For legal questions about your business structure, consult a licensed attorney.",
            )}
          </p>
        </div>
      </div>

      {/* Reused home section: program details + comparison + flow */}
      <NewAuthority />

      {/* Launch timeline — V4 .steps on light */}
      <section className="light">
        <div className="wrap">
          <span className="eyebrow">{tv("Your launch checklist")}</span>
          <h2 className="sec">{tv("From paperwork to first load.")}</h2>
          <div className="steps">
            <div className="step">
              <span className="n">{tv("STEP 1")}</span>
              <h3>{tv("Form the company")}</h3>
              <p>
                {tv(
                  "LLC formation in your home state and EIN registration with the IRS — the legal shell your authority attaches to.",
                )}
              </p>
              <span className="t">{tv("Days 1–5")}</span>
            </div>
            <div className="step">
              <span className="n">{tv("STEP 2")}</span>
              <h3>{tv("File your authority")}</h3>
              <p>
                {tv(
                  "MC & USDOT filing with the FMCSA, BOC-3 process agent designation and UCR registration — submitted correctly the first time.",
                )}
              </p>
              <span className="t">{tv("FMCSA vetting ≈ 21 days")}</span>
            </div>
            <div className="step">
              <span className="n">{tv("STEP 3")}</span>
              <h3>{tv("Get insured")}</h3>
              <p>
                {tv(
                  "Insurance guidance before you overpay — $1M auto liability and $100K cargo minimums, filed to your MC by your insurer.",
                )}
              </p>
              <span className="t">{tv("Runs in parallel")}</span>
            </div>
            <div className="step">
              <span className="n">{tv("STEP 4")}</span>
              <h3>{tv("Activate & dispatch")}</h3>
              <p>
                {tv(
                  "Authority activates — and you roll straight into our carrier onboarding: documents, agreement, dedicated dispatcher, first load.",
                )}
              </p>
              <span className="t">{tv("Same-week handoff")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Lead capture */}
      <section className="light" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="esign-panel" style={{ marginTop: 0 }}>
            <b>{tv("Before you start")}</b>
            <p>
              {tv(
                "Document filing assistance only — we are not a law firm and do not provide legal advice.",
              )}{" "}
              {tv(
                "State filing fees, FMCSA fees and insurance premiums are paid to those parties directly and are not included in our service fee.",
              )}
            </p>
          </div>
          <NewAuthorityLeadForm />
        </div>
      </section>

      {/* THE PROGRAMME LEADS SOMEWHERE. Filing is the start of the funnel, not
          the end of it: authority today, dispatched freight after. A page that
          stops at the paperwork has not described the business. Approved
          strings only. */}
      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("Once you are operational")}</h2>
          <p>
            <Link className="btn btn-amber" href="/dispatch-services">
              {tv("Dispatch Services")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/become-a-carrier">
              {tv("Become a Carrier")}
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
