import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { JsonLd } from "@/components/seo/JsonLd";
import { PageHero } from "@/components/ui/PageHero";
import { Link } from "@/i18n/navigation";
import { getV4 } from "@/i18n/v4-server";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/**
 * Carrier Resources — a hub, and deliberately nothing more.
 *
 * ── WHAT THIS PAGE IS ────────────────────────────────────────────────────
 *
 * Organisation and discoverability over routes that already exist. A carrier
 * arriving here should find the thing they need in one hop; nothing here
 * performs work of its own.
 *
 * ── WHAT IT DELIBERATELY IS NOT ──────────────────────────────────────────
 *
 * There is no form on this page. Not a lead capture, not a "quick start", not
 * an email field. That is the single most important property of the file and
 * it is asserted by a test, because the pressure to add one is constant and
 * the cost is not obvious: a second capture point creates carrier records
 * outside `CarrierWizard`, and therefore outside the document, agreement and
 * audit architecture M-20/M-21/M-22 built. Every action here terminates in an
 * existing workflow.
 *
 * ── IT IS PUBLIC, SO IT KNOWS NOTHING ────────────────────────────────────
 *
 * No rating, score, ranking, on-time percentage, compliance note, insurance
 * review, payment detail or packet content. The page performs no database read
 * at all — it has no carrier to read about. Negative assertions cover the
 * vocabulary anyway, because the realistic failure is a future edit that adds
 * "your carrier score" to look sophisticated.
 *
 * ── DOWNLOADS ────────────────────────────────────────────────────────────
 *
 * Linked, never copied. The three-tier visibility model lives in `/downloads`
 * and stays there; duplicating any part of it here would be a second place to
 * get document exposure wrong.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/carrier-resources",
    title: "Carrier Resources — PickLoads Logistics Group",
    description:
      "Everything a carrier needs in one place: dispatch services, onboarding, New Authority, the knowledge base, documents and support.",
  });
}

/** Section → the real routes it points at. Labels are approved V4 strings. */
const SECTIONS = [
  {
    slug: "start-here",
    heading: "Start Here",
    note: "Dispatch for owner-operators and small fleets",
    links: [
      ["/dispatch-services", "Dispatch Services"],
      ["/become-a-carrier", "Become a Carrier"],
      ["/start-your-trucking-company", "Start Your Trucking Company"],
    ],
  },
  {
    slug: "learn",
    heading: "Learn",
    note: "The questions carriers and shippers actually ask us — answered the way we'd want them answered.",
    links: [
      ["/knowledge-base", "Knowledge Base"],
      ["/faq", "Carrier FAQ"],
    ],
  },
  {
    slug: "documents",
    heading: "Documents",
    note: "Documents, agreements, loads and invoices in one place — yours, not a shared inbox.",
    links: [["/downloads", "Downloads"]],
  },
  {
    slug: "account",
    heading: "Account",
    note: "Sign in to your portal to see your documents.",
    links: [["/portal", "Carrier Login"]],
  },
  {
    slug: "support",
    heading: "Support",
    note: "Call us — a human picks up. (908) 404-5373, or email support@pickloads.com.",
    links: [["/contact", "Contact"]],
  },
] as const;

export default async function CarrierResourcesPage({
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
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/", locale) },
      {
        "@type": "ListItem",
        position: 2,
        name: "Carrier Resources",
        item: absoluteUrl("/carrier-resources", locale),
      },
    ],
  };

  return (
    <main id="main">
      <JsonLd data={breadcrumbs} />

      <PageHero eyebrow={tv("Carrier resources")} title={tv("Carrier resources")}>
        {tv(
          "We act as your back office: finding freight, negotiating rates and handling the paperwork under your operating authority.",
        )}
      </PageHero>

      {SECTIONS.map((section) => (
        <section className="light" key={section.slug} id={section.slug}>
          <div className="wrap">
            <h2 className="sec">{tv(section.heading)}</h2>
            <p className="sub">{tv(section.note)}</p>
            <p>
              {section.links.map(([href, label]) => (
                <span key={href}>
                  <Link className="btn btn-ghost" href={href}>
                    {tv(label)}
                  </Link>{" "}
                </span>
              ))}
            </p>
            {section.slug === "documents" ? (
              /* The boundary, said plainly rather than assumed. Private files
                 stay in the portal; this page never lists or links one. */
              <div className="state state--empty">
                <p>
                  {tv(
                    "Shipment and account documents are private to your company and are never published on this site.",
                  )}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ))}
    </main>
  );
}
