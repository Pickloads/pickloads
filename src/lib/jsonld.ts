import { absoluteUrl, SITE_URL } from "./seo";

/**
 * M-15 structured-data builders. All values are typed literals authored here —
 * no user input flows in (see JsonLd component note).
 */
const BUSINESS_ID = `${SITE_URL}/#business`;

export function localBusinessJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "LocalBusiness",
        "@id": BUSINESS_ID,
        name: "PickLoads Logistics Group LLC",
        url: SITE_URL,
        telephone: "+19084045373",
        email: "support@pickloads.com",
        address: {
          "@type": "PostalAddress",
          streetAddress: "50 Union Ave Suite 805-A",
          addressLocality: "Irvington",
          addressRegion: "NJ",
          postalCode: "07111",
          addressCountry: "US",
        },
        areaServed: { "@type": "Country", name: "United States" },
        openingHoursSpecification: [
          {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: [
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
            ],
            opens: "08:00",
            closes: "18:00",
          },
          {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: "Saturday",
            opens: "09:00",
            closes: "14:00",
          },
        ],
      },
      {
        "@type": "Service",
        name: "Truck Dispatching",
        serviceType: "Truck dispatch service",
        provider: { "@id": BUSINESS_ID },
        areaServed: { "@type": "Country", name: "United States" },
        description:
          "Nationwide truck dispatching for owner-operators and small fleets: load booking, rate negotiation, broker verification, paperwork and invoicing.",
      },
      {
        "@type": "Service",
        name: "Freight Brokerage",
        serviceType: "Freight brokerage",
        provider: { "@id": BUSINESS_ID },
        areaServed: { "@type": "Country", name: "United States" },
        description:
          "Full truckload and partial freight with vetted carriers, live tracking and one point of contact from pickup to proof of delivery.",
      },
    ],
  };
}

/** Per-equipment Service JSON-LD (M-16). */
export function equipmentServiceJsonLd({
  name,
  description,
  slug,
  locale,
}: {
  name: string;
  description: string;
  slug: string;
  locale: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name,
    serviceType: "Truck dispatch service",
    url: absoluteUrl(`/dispatch/${slug}`, locale),
    provider: { "@id": BUSINESS_ID },
    areaServed: { "@type": "Country", name: "United States" },
    description,
  };
}

/** Article JSON-LD for published blog posts (M-33). */
export function articleJsonLd({
  title,
  description,
  slug,
  locale,
  publishedAt,
  modifiedAt,
}: {
  title: string;
  description: string | null;
  slug: string;
  locale: string;
  publishedAt: string | null;
  modifiedAt: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    ...(description ? { description } : {}),
    url: absoluteUrl(`/blog/${slug}`, locale),
    inLanguage: locale,
    ...(publishedAt ? { datePublished: publishedAt } : {}),
    dateModified: modifiedAt,
    author: { "@id": BUSINESS_ID },
    publisher: { "@id": BUSINESS_ID },
  };
}

export function faqPageJsonLd(
  entries: ReadonlyArray<readonly [string, string]>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
