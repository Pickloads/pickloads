import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { FreightQuoteForm } from "@/components/forms/FreightQuoteForm";

export const metadata: Metadata = {
  title: "Freight Shipping for Shippers — PickLoads Logistics Group",
  description:
    "Full truckload and partial freight with vetted carriers, live tracking and one point of contact from pickup to proof of delivery. Request a quote — answered within one business hour.",
};

export default async function ShippersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main>
      <PageHero
        eyebrow="For shippers"
        title="Freight that moves on time. A partner you never have to chase."
      >
        Full truckload and partial solutions with vetted carriers, live
        tracking and one point of contact from pickup to proof of delivery.
      </PageHero>

      <section>
        <div className="wrap">
          <span className="eyebrow">Why shippers choose PickLoads</span>
          <h2 className="sec">
            Fewer surprises. Fewer phone calls. Freight covered.
          </h2>
          <div className="ship-why">
            <div className="ship-card">
              <span className="ic" aria-hidden="true">🛡</span>
              <h3>Vetted carriers only</h3>
              <p>
                Authority, insurance and safety scores verified before a carrier
                touches your freight.
              </p>
            </div>
            <div className="ship-card">
              <span className="ic" aria-hidden="true">📍</span>
              <h3>Live tracking</h3>
              <p>
                Check calls and location updates from pickup to delivery —
                proactively, not on request.
              </p>
            </div>
            <div className="ship-card">
              <span className="ic" aria-hidden="true">☎</span>
              <h3>One point of contact</h3>
              <p>
                One rep owns your shipment. No transfers, no ticket numbers, no
                runaround.
              </p>
            </div>
            <div className="ship-card">
              <span className="ic" aria-hidden="true">📄</span>
              <h3>Claims &amp; paperwork handled</h3>
              <p>
                BOLs, PODs and claims support managed for you, with documents
                delivered same day.
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
            <span className="flow-title">Shipper process — from quote to POD</span>
            <div className="flow-track">
              <span className="flow-node">QUOTE REQUEST</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node hot">RATE IN 1 HOUR</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node">CARRIER VETTING</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node">PICKUP SCHEDULED</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node hot">LIVE TRACKING</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node">DELIVERY + POD</span>
              <span className="flow-arrow">→</span>
              <span className="flow-node">SAME-DAY DOCS</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
