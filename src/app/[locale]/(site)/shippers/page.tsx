import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { FreightQuoteForm } from "@/components/forms/FreightQuoteForm";
import { useV4 } from "@/i18n/v4";
import { pageMetadata } from "@/lib/seo";

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
      "Full truckload and partial freight with vetted carriers, live tracking and one point of contact from pickup to proof of delivery. Request a quote — answered within one business hour.",
  });
}

export default async function ShippersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ShippersContent />;
}

function ShippersContent() {
  const tv = useV4();
  return (
    <main>
      <PageHero
        eyebrow={tv("For shippers")}
        title={tv(
          "Freight that moves on time. A partner you never have to chase.",
        )}
      >
        {tv(
          "Full truckload and partial solutions with vetted carriers, live tracking and one point of contact from pickup to proof of delivery.",
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
              <h3>{tv("Live tracking")}</h3>
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

      <section className="light" style={{ paddingTop: 0, marginTop: -20 }}>
        <div className="wrap">
          <FreightQuoteForm />
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="flow">
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
              <span className="flow-node hot">{tv("LIVE TRACKING")}</span>
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
