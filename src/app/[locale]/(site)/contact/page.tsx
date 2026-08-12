import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";
import { ContactForm } from "@/components/forms/ContactForm";
import { useV4, useV4Rich } from "@/i18n/v4";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/contact",
    title: "Contact PickLoads — Talk to a Human Today",
    description:
      "Dispatch questions, freight quotes, partnerships — we answer fast. Call (908) 404-5373 or email support@pickloads.com. Office in Irvington, NJ.",
  });
}

/*
 * Map: keyless Google Maps embed (no API key required for the basic iframe;
 * frame-src for google.com is already in the CSP). Replaces the V4 map
 * placeholder per its own note "// Embed Google Maps here in the production build".
 * Social links stay inert until the profiles exist (same rule as U-09:
 * no dead outbound links at launch — URLs land via company_settings in M-14).
 */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContactContent />;
}

function ContactContent() {
  const tv = useV4();
  const t = useV4Rich();
  return (
    <main id="main">
      <PageHero eyebrow={tv("Contact")} title={tv("Talk to a human. Today.")}>
        {tv(
          "Dispatch questions, freight quotes, partnerships — we answer fast.",
        )}
      </PageHero>

      <section>
        <div className="wrap contact-grid">
          <div className="contact-cards">
            <div className="c-card">
              <span className="ic" aria-hidden="true">☎</span>
              <div>
                <b>{tv("Phone — 24/7 Dispatch Line")}</b>
                <a href="tel:+19084045373" className="mono">
                  (908) 404-5373
                </a>
              </div>
            </div>
            <div className="c-card">
              <span className="ic" aria-hidden="true">✉</span>
              <div>
                <b>{tv("Email")}</b>
                <a href="mailto:support@pickloads.com" className="mono">
                  support@pickloads.com
                </a>
              </div>
            </div>
            <div className="c-card">
              <span className="ic" aria-hidden="true">📍</span>
              <div>
                <b>{tv("Office")}</b>
                <span>
                  50 Union Ave, Suite 805-A
                  <br />
                  Irvington, NJ 07111
                </span>
              </div>
            </div>
            <div className="c-card">
              <span className="ic" aria-hidden="true">🕐</span>
              <div>
                <b>{tv("Office Hours")}</b>
                <span>{t.rich("rich_ct_hours", { br: () => <br /> })}</span>
              </div>
            </div>
            <div className="c-card">
              <span className="ic" aria-hidden="true">＠</span>
              <div>
                <b>{tv("Follow PickLoads")}</b>
                <div className="socials">
                  <a>FACEBOOK</a>
                  <a>INSTAGRAM</a>
                  <a>LINKEDIN</a>
                  <a>TIKTOK</a>
                </div>
              </div>
            </div>
          </div>
          <div className="map-embed">
            <iframe
              title="PickLoads office — 50 Union Ave, Irvington, NJ 07111"
              src="https://www.google.com/maps?q=50+Union+Ave+Suite+805-A,+Irvington,+NJ+07111&output=embed"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>

      {/* M-14: contact form section (audit F-08) — .bigform vocabulary */}
      <section className="light" style={{ paddingTop: 0, marginTop: -20 }}>
        <div className="wrap">
          {/* §Contact routing — seven inquiry types, each routed to the
              process that actually handles it.

              The hint is a LINK, not a redirect. A visitor who wants to send a
              message still can; the point is that a quote request is not
              captured as a contact message somebody must then re-key into the
              quote flow. One submission, one record, in the right system. */}
          <ContactForm
            inquiryTypes={[
              "Dispatch Services",
              "Freight / Quote",
              "Carrier Onboarding",
              "New Authority",
              "Partnerships",
              "Support",
              "General Inquiry",
            ]}
            routeHints={{
              "Dispatch Services": ["/dispatch-services", "Dispatch Services"],
              "Freight / Quote": ["/request-a-quote", "Request a Quote"],
              "Carrier Onboarding": ["/become-a-carrier", "Become a Carrier"],
              "New Authority": [
                "/start-your-trucking-company",
                "Start Your Trucking Company",
              ],
              Partnerships: ["/partners", "Partner with PickLoads"],
              Support: ["/knowledge-base", "Knowledge Base"],
            }}
          />
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>{tv("Prefer to just get started?")}</h2>
            <p>
              {tv(
                "Carrier setup takes 5 minutes. Shipper quotes answered within the hour.",
              )}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Link className="btn btn-dark" href="/#quote">
              {tv("Start Carrier Setup")}
            </Link>
            <Link
              className="btn btn-ghost"
              style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
              href="/shippers"
            >
              {tv("Request a Freight Quote")}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
