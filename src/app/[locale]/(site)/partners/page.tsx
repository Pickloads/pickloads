import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { ContactForm } from "@/components/forms/ContactForm";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageHero } from "@/components/ui/PageHero";
import { getV4 } from "@/i18n/v4-server";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/**
 * Partner Program.
 *
 * ── ARCHITECTURE ONLY, BECAUSE THERE IS NO PROGRAMME YET ─────────────────
 *
 * No partner is named, no logo is shown, and no commission, discount,
 * affiliate term or payout appears anywhere. None of that has been agreed, and
 * a partnership page is the classic place for invented terms to arrive because
 * they read as harmless. They are not: a published commission is an offer.
 *
 * The page describes the KINDS of partnership PickLoads would consider and
 * gives a real way to start a conversation. That is everything engineering can
 * honestly ship before the business has terms.
 *
 * The enquiry reuses `ContactForm` — no second lead system.
 */

const PARTNER_TYPES = [
  ["Logistics partners", "Carrier or brokerage capacity, lane by lane."],
  [
    "Technology partners",
    "Systems that connect to how freight actually moves.",
  ],
  [
    "Insurance & compliance partners",
    "Coverage and authority support for carriers.",
  ],
  ["Factoring partners", "Invoicing & factoring coordination"],
  ["Service partners", "Anything that keeps a truck loaded and legal."],
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/partners",
    title: "Partner Program — PickLoads Logistics Group",
    description:
      "Partnership enquiries for logistics, technology, insurance, compliance and factoring partners.",
  });
}

export default async function PartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);

  const breadcrumbs = {
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
        name: "Partners",
        item: absoluteUrl("/partners", locale),
      },
    ],
  };

  return (
    <main id="main">
      <JsonLd data={breadcrumbs} />

      <PageHero eyebrow={tv("Partners")} title={tv("Partner with PickLoads")}>
        {tv("Carrier or shipper — start the conversation today.")}
      </PageHero>

      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("Partnership types")}</h2>
          <div className="values">
            {PARTNER_TYPES.map(([label, note]) => (
              <div key={label}>
                <h3>{tv(label)}</h3>
                <p>{tv(note)}</p>
              </div>
            ))}
          </div>

          {/* Terms are a business decision, not a marketing line. Until they
              exist the page says so rather than implying a rate card. */}
          <div className="state state--empty" style={{ marginTop: 22 }}>
            <h3>{tv("Terms are agreed case by case")}</h3>
            <p>
              {tv(
                "Tell us what you do and we will keep your details on file for when something opens.",
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="light" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <ContactForm
            defaultSubject="Partnership enquiry"
            surface="partners"
            startedEvent="partner_inquiry_started"
            submittedEvent="partner_inquiry_submitted"
          />
        </div>
      </section>
    </main>
  );
}
