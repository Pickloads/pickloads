import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";
import { useV4 } from "@/i18n/v4";
import { getV4 } from "@/i18n/v4-server";
import { CARRIER_FAQ, SHIPPER_FAQ } from "@/content/faq";
import { pageMetadata } from "@/lib/seo";
import { faqPageJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/seo/JsonLd";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/faq",
    title: "FAQ — Truck Dispatch & Freight Questions Answered | PickLoads",
    description:
      "How much does dispatch cost? Is it forced dispatch? How do carriers get paid? Straight answers to the questions carriers and shippers actually ask.",
  });
}

export default async function FaqPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  /* M-15: FAQPage JSON-LD from the same typed arrays that render the page,
     localized through the server-side V4 bridge (falls back to English). */
  const tv = await getV4(locale);
  const jsonLd = faqPageJsonLd(
    [...CARRIER_FAQ, ...SHIPPER_FAQ].map(([q, a]) => [tv(q), tv(a)] as const),
  );

  return (
    <>
      <JsonLd data={jsonLd} />
      <FaqContent />
    </>
  );
}

function FaqContent() {
  const tv = useV4();
  return (
    <main id="main">
      <PageHero
        eyebrow={tv("FAQ")}
        title={tv("Straight answers. No fine print.")}
      >
        {tv(
          "The questions carriers and shippers actually ask us — answered the way we'd want them answered.",
        )}
      </PageHero>

      <section className="light">
        <div className="wrap">
          <div className="faq-cols">
            <div className="faq-col">
              <h3>{tv("▸ For Carriers")}</h3>
              {CARRIER_FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{tv(q)}</summary>
                  <div className="a">{tv(a)}</div>
                </details>
              ))}
            </div>
            <div className="faq-col">
              <h3>{tv("▸ For Shippers")}</h3>
              {SHIPPER_FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{tv(q)}</summary>
                  <div className="a">{tv(a)}</div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>{tv("Didn't find your answer?")}</h2>
            <p>
              {tv(
                "Call us — a human picks up. (908) 404-5373, or email support@pickloads.com.",
              )}
            </p>
          </div>
          <Link className="btn btn-dark" href="/contact">
            {tv("Contact Us")}
          </Link>
        </div>
      </section>
    </main>
  );
}
