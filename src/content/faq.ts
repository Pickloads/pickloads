/*
 * FAQ source arrays (English, exact V4 copy) — single source for the /faq
 * page render AND the M-15 FAQPage JSON-LD. Translations resolve through the
 * useV4 bridge at render time; JSON-LD stays English per locale-canonical
 * strategy (JSON-LD is regenerated per locale in M-15 via getV4 slugs).
 */
export const CARRIER_FAQ = [
  ["How much does dispatch cost?", "A flat percentage of gross per load — 5% for owner-operators, 4.5% for small fleets, 8% for box trucks and hot shots. No setup fees, no monthly minimums, no charge on loads you decline. You see every rate confirmation."],
  ["Is this forced dispatch?", "No. You approve every load before we book it. You set your rate floor, your lanes and your home time — we work inside them. Month to month, cancel anytime."],
  ["What do I need to get started?", "Your MC/DOT authority, a W-9, a certificate of insurance ($1M auto liability / $100K cargo) and a voided check or factoring notice. Setup takes about 5 minutes, and most carriers are rolling within 24–48 hours after completed paperwork. Timing depends on completed onboarding, documentation, equipment, location and market availability."],
  ["Do you work with new authorities?", "Yes. New MCs face broker restrictions in the first months — we know which brokers work with new authorities and plan lanes accordingly to keep you moving while your authority ages."],
  ["How do I get paid?", "You're paid directly by the broker or through your factoring company — money never passes through us. We prepare and submit the invoices and paperwork so nothing delays your settlement."],
  ["I don't have my MC yet — can you help me start my trucking company?", "Yes. Our New Authority Program handles LLC formation, EIN, MC/USDOT filing, BOC-3 and UCR, plus insurance guidance — then rolls you straight into dispatch onboarding so you're loaded as soon as your authority activates. Document filing assistance only; we are not a law firm."],
  ["Do you verify brokers?", "Every broker is checked for active authority, bond status and credit before we book. If a broker looks shaky, we skip the load — no exceptions."],
] as const;

export const SHIPPER_FAQ = [
  ["Are you a licensed freight broker?", "Our brokerage division launches with our FMCSA MC authority and BMC-84 $75,000 surety bond, currently in process. Our registration numbers will be published on this site the day they're active, with direct FMCSA verification links. Early quote requests get priority onboarding."],
  ["How fast can you quote a shipment?", "Within one business hour for standard FTL lanes (Mon–Sat). Complex or specialized freight may take a little longer — we'll tell you upfront."],
  ["How do you vet carriers?", "Active authority, insurance certificates, FMCSA safety data and inspection history — verified before assignment, not after. We don't re-broker freight."],
  ["Can I track my shipment?", "Yes — check calls and location updates through delivery, with proactive alerts if anything changes. Sign in to the shipper portal for the full timeline, or track a single shipment at /track with your tracking number and delivery ZIP."],
  ["What happens if there's a claim?", "We manage the claims process end to end: documentation, carrier insurance filing and follow-up until resolution. One contact, start to finish."],
] as const;

export type FaqEntry = readonly [question: string, answer: string];
