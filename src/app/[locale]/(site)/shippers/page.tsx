import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { FreightQuoteForm } from "@/components/forms/FreightQuoteForm";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { getBooleanSetting } from "@/lib/company-settings";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/**
 * Freight Brokerage — the shipper-side service page.
 *
 * ── WHY THIS IS NOT A NEW ROUTE ──────────────────────────────────────────
 *
 * Dispatch needed a hub because its offering was scattered across fourteen SEO
 * pages with nothing describing the service. Brokerage is the opposite: this
 * page IS the brokerage page, it already ranks, and adding a second one would
 * create exactly the duplicate-content architecture §11 forbids. So this is
 * enhanced in place rather than replaced.
 *
 * ── THE GATE, WHICH THIS PAGE PREVIOUSLY IGNORED ─────────────────────────
 *
 * The footer label, ServicesSplit, the shipper portal and the quote form all
 * read `company_settings.brokerage_active`. **This page did not read it at
 * all** — the one page whose entire subject is brokerage described the service
 * with no reference to whether the company may legally perform it. The only
 * honest note came from inside the embedded quote form.
 *
 * It now reads the gate and, while it is closed:
 *   * carries the approved "Launching Soon" tag and the MC-activation state;
 *   * emits NO `Service` node in its structured data — see below.
 *
 * Nothing here can activate brokerage. `trg_shipments_brokerage_gate` refuses
 * shipment creation at the database regardless of what any page says, and this
 * change does not touch that. This is about not CLAIMING an authority the
 * business does not yet hold.
 *
 * ── ONE QUOTE FUNNEL ─────────────────────────────────────────────────────
 *
 * The embedded form is the same `FreightQuoteForm` component, the same
 * `submitFreightQuote` action and the same `freight_quotes` table that
 * `/request-a-quote` uses. It is one funnel rendered on two surfaces, not two
 * funnels — the `surface` prop is what keeps them distinguishable in
 * analytics. The form stays here because removing an approved conversion
 * element is a content decision, not an engineering one.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/shippers",
    title: "Freight Shipping for Shippers — PickLoads Logistics Group",
    description:
      "Full truckload and partial freight with vetted carriers, milestone tracking and one point of contact from pickup to proof of delivery. Request a quote and a PickLoads representative will follow up promptly.",
  });
}

export default async function ShippersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const brokerageActive = await getBooleanSetting("brokerage_active");
  return <ShippersContent brokerageActive={brokerageActive} locale={locale} />;
}

function ShippersContent({
  brokerageActive,
  locale,
}: {
  brokerageActive: boolean;
  locale: string;
}) {
  const tv = useV4();

  /**
   * Structured data that respects the gate.
   *
   * While `brokerage_active` is false the page emits Organization +
   * BreadcrumbList and **no `Service` node**. A `Service` entry saying
   * PickLoads provides freight brokerage is a machine-readable assertion that
   * the company brokes freight today — published to search engines, cached,
   * and far harder to walk back than a sentence on a page. The visible copy
   * already says "Launching Soon"; the structured data must not contradict it.
   *
   * The node returns automatically when the flag flips. No deploy, no edit.
   */
  const jsonLd: Record<string, unknown>[] = [
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
          name: "For Shippers",
          item: absoluteUrl("/shippers", locale),
        },
      ],
    },
  ];
  if (brokerageActive) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Freight Brokerage",
      serviceType: "Freight brokerage",
      provider: {
        "@type": "Organization",
        name: "PickLoads Logistics Group LLC",
        url: absoluteUrl("/", locale),
        telephone: "+1-908-404-5373",
      },
      areaServed: { "@type": "Country", name: "United States" },
      url: absoluteUrl("/shippers", locale),
    });
  }

  return (
    <main id="main">
      <script
        type="application/ld+json"
        // Structured data only — no user input reaches this string.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PageHero
        eyebrow={tv("For shippers")}
        title={tv(
          "Freight that moves on time. A partner you never have to chase.",
        )}
      >
        {tv(
          "Full truckload and partial solutions with vetted carriers, milestone tracking and one point of contact from pickup to proof of delivery.",
        )}
      </PageHero>

      <section>
        <div className="wrap">
          <span className="eyebrow">{tv("Why shippers choose PickLoads")}</span>
          <h2 className="sec">
            {tv("Fewer surprises. Fewer phone calls. Freight covered.")}
          </h2>
          <div className="ship-why">
            <div className="ship-card">
              <span className="ic" aria-hidden="true">🛡</span>
              <h3>{tv("Vetted carriers only")}</h3>
              <p>
                {tv(
                  "Authority, insurance and safety scores verified before a carrier touches your freight.",
                )}
              </p>
            </div>
            <div className="ship-card">
              <span className="ic" aria-hidden="true">📍</span>
              <h3>{tv("Milestone tracking")}</h3>
              <p>
                {tv(
                  "Check calls and location updates from pickup to delivery — proactively, not on request.",
                )}
              </p>
            </div>
            <div className="ship-card">
              <span className="ic" aria-hidden="true">☎</span>
              <h3>{tv("One point of contact")}</h3>
              <p>
                {tv(
                  "One rep owns your shipment. No transfers, no ticket numbers, no runaround.",
                )}
              </p>
            </div>
            <div className="ship-card">
              <span className="ic" aria-hidden="true">📄</span>
              <h3>{tv("Claims & paperwork handled")}</h3>
              <p>
                {tv(
                  "BOLs, PODs and claims support managed for you, with documents delivered same day.",
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {!brokerageActive ? (
        <section className="light" style={{ paddingBottom: 0 }}>
          <div className="wrap">
            <div className="state state--empty">
              <h3>{tv("For Shippers · Launching Soon")}</h3>
              <p>
                {tv(
                  "Brokerage operations open with our MC activation; early requests get priority onboarding.",
                )}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="light" style={{ paddingTop: 0, marginTop: -20 }}>
        <div className="wrap">
          {/* Same component, same action, same table as /request-a-quote.
              `surface` is what keeps the two distinguishable in the funnel. */}
          <FreightQuoteForm
            surface="shippers"
            brokerageActive={brokerageActive}
          />
          <p style={{ marginTop: 18 }}>
            <Link className="btn btn-ghost" href="/request-a-quote">
              {tv("Request a Quote")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/track">
              {tv("Track Shipment")}
            </Link>
          </p>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="flow" tabIndex={0} role="region" aria-label={tv("Process steps (scrollable)")}>
            <span className="flow-title">
              {tv("Shipper process — from quote to POD")}
            </span>
            <div className="flow-track">
              <span className="flow-node">{tv("QUOTE REQUEST")}</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node hot">{tv("RATE IN 1 HOUR")}</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node">{tv("CARRIER VETTING")}</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node">{tv("PICKUP SCHEDULED")}</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node hot">{tv("MILESTONE UPDATES")}</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node">{tv("DELIVERY + POD")}</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node">{tv("SAME-DAY DOCS")}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
