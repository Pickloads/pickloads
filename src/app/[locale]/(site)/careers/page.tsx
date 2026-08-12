import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { ContactForm } from "@/components/forms/ContactForm";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageHero } from "@/components/ui/PageHero";
import { getV4 } from "@/i18n/v4-server";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/**
 * Careers.
 *
 * ── THERE ARE NO OPEN ROLES, AND THE PAGE SAYS SO ────────────────────────
 *
 * No approved vacancy exists. Inventing one — even a plausible "Dispatcher,
 * Irvington NJ" — would be fabricating a business fact, and it would waste the
 * time of the first person who applied. So the page carries a general-interest
 * state and a real way to get in touch.
 *
 * ── NO SECOND RECRUITING SYSTEM ──────────────────────────────────────────
 *
 * The enquiry reuses `ContactForm`: the same Zod schema, the same rate limit,
 * the same Turnstile, the same destination. A dedicated applicant model, CV
 * storage and a review workflow are a real project, and they would need a
 * retention and privacy position of their own — CVs are personal data, and
 * storing them is not something to acquire as a side effect of a marketing
 * page.
 *
 * `JobPosting` structured data is deliberately absent: it describes a vacancy,
 * and there is none.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/careers",
    title: "Careers — PickLoads Logistics Group",
    description:
      "Interested in working with PickLoads? Tell us what you do and we will keep your details on file.",
  });
}

export default async function CareersPage({
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
        name: "Careers",
        item: absoluteUrl("/careers", locale),
      },
    ],
  };

  return (
    <main id="main">
      <JsonLd data={breadcrumbs} />

      <PageHero eyebrow={tv("Careers")} title={tv("Work with PickLoads")}>
        {tv("Carrier or shipper — start the conversation today.")}
      </PageHero>

      <section className="light">
        <div className="wrap">
          {/* The honest state. No invented vacancy, and no "we are always
              hiring" implying a pipeline that does not exist. */}
          <div className="state state--empty">
            <h3>{tv("No open roles right now")}</h3>
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
            defaultSubject="Careers enquiry"
            surface="careers"
            startedEvent="career_interest"
            submittedEvent="contact_submitted"
          />
        </div>
      </section>
    </main>
  );
}
