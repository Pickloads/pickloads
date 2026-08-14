import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { CtaBand } from "@/components/sections/CtaBand";
import { EquipmentGrid } from "@/components/sections/EquipmentGrid";
import { PageHero } from "@/components/ui/PageHero";
import { Link } from "@/i18n/navigation";
import { getV4 } from "@/i18n/v4-server";
import { getBooleanSetting } from "@/lib/company-settings";
import { absoluteUrl, pageMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

/**
 * Dispatch Services — the central conversion hub for the dispatch pillar.
 *
 * ── WHAT THIS PAGE IS FOR ────────────────────────────────────────────────
 *
 * The dispatch offering was spread across eight equipment pages and six state
 * pages with no page that simply says what the service IS. Those pages are
 * strong acquisition surfaces and are untouched — this is the hub they feed
 * into, and what the nav's "Dispatch Services" entry now resolves to.
 *
 * ── CONTENT OWNERSHIP ────────────────────────────────────────────────────
 *
 * Every heading and paragraph is an EXISTING APPROVED V4 dictionary string,
 * reused from `ServicesSplit`, `HowAndCompare` and the equipment pages.
 * Nothing is newly authored: final marketing copy belongs to Cowork. The
 * structure is built so a rewrite is a string swap, not a rebuild — the open
 * items are listed in `docs/COWORK-CONTENT-REVIEW.md`.
 *
 * Deliberately ABSENT until Cowork rules:
 *   * a pricing block — inventing a percentage, weekly fee or setup fee is
 *     forbidden, and the approved tiers are still under review. The layout
 *     takes one without restructuring;
 *   * every earnings claim — no guaranteed loads, RPM, weekly gross or broker
 *     acceptance appears anywhere on this page, and an e2e test asserts it.
 *
 * ── THE FUNNEL IS REAL ───────────────────────────────────────────────────
 *
 * START DISPATCHING → `/become-a-carrier`, which hosts the actual
 * `CarrierWizard`: company info → documents → agreement → portal. No second
 * onboarding system, no second application, no dead-end CTA.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/dispatch-services",
    title:
      "Truck Dispatch Services for Owner-Operators & Small Fleets — PickLoads",
    description:
      "Dispatch under your own authority: load booking and rate negotiation on the top boards, broker verification before every booking, paperwork, invoicing and factoring coordination. No forced dispatch — you approve every load.",
  });
}

export default async function DispatchServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);
  const referralActive = await getBooleanSetting("referral_program_active");

  /**
   * Service + BreadcrumbList structured data.
   *
   * `Service` carries NO `offers` node. There is no approved price, and
   * putting one in structured data is the same fabrication as printing it on
   * the page — only harder for a human to notice.
   */
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Truck Dispatch Services",
      serviceType: "Truck dispatching",
      provider: {
        "@type": "Organization",
        name: "PickLoads Logistics Group LLC",
        url: absoluteUrl("/", locale),
        telephone: "+1-908-404-5373",
      },
      areaServed: { "@type": "Country", name: "United States" },
      audience: {
        "@type": "Audience",
        audienceType: "Owner-operators and small fleets",
      },
      url: absoluteUrl("/dispatch-services", locale),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: absoluteUrl("/", locale),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Dispatch Services",
          item: absoluteUrl("/dispatch-services", locale),
        },
      ],
    },
  ];

  return (
    <main id="main">
      {/* SEC-P3-02: through the shared component, which escapes `<`. */}
      <JsonLd data={jsonLd} />

      <PageHero
        eyebrow={tv("For Carriers · Active Now")}
        title={tv("Dispatch for owner-operators and small fleets")}
      >
        {tv(
          "We act as your back office: finding freight, negotiating rates and handling the paperwork under your operating authority.",
        )}
      </PageHero>

      {/* WHAT THE DISPATCHER ACTUALLY DOES — the approved capability list,
          reused verbatim from ServicesSplit rather than re-worded. */}
      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("What your dispatcher handles")}</h2>
          <div className="services-grid">
            <div className="svc dispatch">
              <span className="tag">{tv("For Carriers · Active Now")}</span>
              <ul>
                <li>{tv("Load booking & rate negotiation on top boards")}</li>
                <li>{tv("Broker verification before every booking")}</li>
                <li>{tv("Detention, lumper & TONU support")}</li>
                <li>{tv("Invoicing & factoring coordination")}</li>
                <li>{tv("No forced dispatch — you approve every load")}</li>
                <li>{tv("One dedicated dispatcher who knows your truck")}</li>
                <li>
                  {tv("Broker credit & authority verified before booking")}
                </li>
              </ul>
              <p className="sub">
                {tv(
                  "Clear roles, clear paperwork, full FMCSA compliance. No double brokering. Ever.",
                )}
              </p>
              <Link className="btn btn-amber" href="/become-a-carrier">
                {tv("Start Dispatching")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* EQUIPMENT — the eight the application actually supports, rendered by
          the same component the home page uses. Each card links to its
          existing SEO page, so this hub feeds those pages rather than
          competing with them for the same query. */}
      <EquipmentGrid />

      {/* HOW IT WORKS — the real onboarding steps, in the order the wizard
          actually asks for them. */}
      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("How it works")}</h2>
          <div className="values">
            <div>
              <h3>{tv("You create your account")}</h3>
              <p>
                {tv(
                  "MC/DOT, W-9, certificate of insurance and a voided check — uploaded in one secure form.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("You sign the agreement")}</h3>
              <p>
                {tv(
                  "Review the dispatch agreement and sign from your phone. No printer, no fax.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("We book your first load")}</h3>
              <p>
                {tv(
                  "Your dispatcher learns your lanes, your rate floor and your home-time needs — then gets to work.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("You drive. You get paid.")}</h3>
              <p>
                {tv(
                  "We handle rate cons, BOLs and invoicing. You focus on miles.",
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* RELATED SURFACES — the internal linking this hub exists to provide,
          into the SEO pages and the adjacent funnels. */}
      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("Carrier resources")}</h2>
          <p>
            <Link className="btn btn-ghost" href="/truck-dispatch">
              {tv("Dispatch by State")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/start-your-trucking-company">
              {tv("Start Your Trucking Company")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/faq">
              {tv("Carrier FAQ")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/become-a-carrier">
              {tv("Become a Carrier")}
            </Link>
          </p>
        </div>
      </section>

      {/* Final conversion band. Reused, and its referral line stays gated on
          `referral_program_active` exactly as M-69/P-2 established — this page
          must not become the one surface that promises a bonus. */}
      <CtaBand referralActive={referralActive} />
    </main>
  );
}
