import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";

export const metadata: Metadata = {
  title: "FAQ — Truck Dispatch & Freight Questions Answered | PickLoads",
  description:
    "How much does dispatch cost? Is it forced dispatch? How do carriers get paid? Straight answers to the questions carriers and shippers actually ask.",
};

const CARRIER_FAQ = [
  ["How much does dispatch cost?", "A flat percentage of gross per load — 5% for owner-operators, 4.5% for small fleets, 8% for box trucks and hot shots. No setup fees, no monthly minimums, no charge on loads you decline. You see every rate confirmation."],
  ["Is this forced dispatch?", "No. You approve every load before we book it. You set your rate floor, your lanes and your home time — we work inside them. Month to month, cancel anytime."],
  ["What do I need to get started?", "Your MC/DOT authority, a W-9, a certificate of insurance ($1M auto liability / $100K cargo) and a voided check or factoring notice. Setup takes about 5 minutes; most carriers get their first load within 24 hours."],
  ["Do you work with new authorities?", "Yes. New MCs face broker restrictions in the first months — we know which brokers work with new authorities and plan lanes accordingly to keep you moving while your authority ages."],
  ["How do I get paid?", "You're paid directly by the broker or through your factoring company — money never passes through us. We prepare and submit the invoices and paperwork so nothing delays your settlement."],
  ["I don't have my MC yet — can you help me start my trucking company?", "Yes. Our New Authority Program handles LLC formation, EIN, MC/USDOT filing, BOC-3 and UCR, plus insurance guidance — then rolls you straight into dispatch onboarding so you're loaded as soon as your authority activates. Document filing assistance only; we are not a law firm."],
  ["Do you verify brokers?", "Every broker is checked for active authority, bond status and credit before we book. If a broker looks shaky, we skip the load — no exceptions."],
] as const;

const SHIPPER_FAQ = [
  ["Are you a licensed freight broker?", "Our brokerage division launches with our FMCSA MC authority and BMC-84 $75,000 surety bond, currently in process. Our registration numbers will be published on this site the day they're active, with direct FMCSA verification links. Early quote requests get priority onboarding."],
  ["How fast can you quote a shipment?", "Within one business hour for standard FTL lanes (Mon–Sat). Complex or specialized freight may take a little longer — we'll tell you upfront."],
  ["How do you vet carriers?", "Active authority, insurance certificates, FMCSA safety data and inspection history — verified before assignment, not after. We don't re-broker freight."],
  ["Can I track my shipment?", "Yes — check calls and location updates through delivery, with proactive alerts if anything changes. A live shipper portal is on the roadmap."],
  ["What happens if there's a claim?", "We manage the claims process end to end: documentation, carrier insurance filing and follow-up until resolution. One contact, start to finish."],
] as const;

/* M-15 adds FAQPage JSON-LD generated from these arrays (single source). */
export default async function FaqPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main>
      <PageHero eyebrow="FAQ" title="Straight answers. No fine print.">
        The questions carriers and shippers actually ask us — answered the way
        we&apos;d want them answered.
      </PageHero>

      <section className="light">
        <div className="wrap">
          <div className="faq-cols">
            <div className="faq-col">
              <h3>▸ For Carriers</h3>
              {CARRIER_FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <div className="a">{a}</div>
                </details>
              ))}
            </div>
            <div className="faq-col">
              <h3>▸ For Shippers</h3>
              {SHIPPER_FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <div className="a">{a}</div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Didn&apos;t find your answer?</h2>
            <p>
              Call us — a human picks up. (908) 404-5373, or email
              support@pickloads.com.
            </p>
          </div>
          <Link className="btn btn-dark" href="/contact">
            Contact Us
          </Link>
        </div>
      </section>
    </main>
  );
}
