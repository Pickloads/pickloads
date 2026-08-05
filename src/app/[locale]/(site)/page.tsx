import type { Metadata } from "next";
import { Hero } from "@/components/sections/Hero";
import { setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";
import { localBusinessJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/seo/JsonLd";
import { LoadTicker } from "@/components/sections/LoadTicker";
import { QuickQuote } from "@/components/sections/QuickQuote";
import { ServicesSplit } from "@/components/sections/ServicesSplit";
import { HowAndCompare } from "@/components/sections/HowAndCompare";
import { EquipmentGrid } from "@/components/sections/EquipmentGrid";
import { Industries } from "@/components/sections/Industries";
import { BoardsStrip } from "@/components/sections/BoardsStrip";
import { WhyStats } from "@/components/sections/WhyStats";
import { ShippersTeaser } from "@/components/sections/ShippersTeaser";
import { Pricing } from "@/components/sections/Pricing";
import { NewAuthority } from "@/components/sections/NewAuthority";
import { Compliance } from "@/components/sections/Compliance";
import { PacketSection } from "@/components/sections/PacketSection";
import { TestimonialsSection } from "@/components/sections/TestimonialsSection";
import { CtaBand } from "@/components/sections/CtaBand";
import { getBooleanSetting } from "@/lib/company-settings";

/*
 * Home page — V4 section order preserved exactly; the reconstructed Pricing
 * section (F-01/Q2) sits between WhyStats and the shippers teaser per the V4
 * stylesheet order.
 *
 * M-69/P-6: the testimonials band is back in its V4 position (between the
 * carrier packet and the CTA band), now behind the REAL
 * company_settings.testimonials_visible gate the arch §9 / audit F-13 note
 * always promised. It renders nothing until that flag is on and M-87
 * supplies approved reviews — never the prototype's sample quotes.
 * NOTE: moves to src/app/[locale]/page.tsx in M-13.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/",
    title: "PickLoads Logistics Group — Truck Dispatching & Freight Brokerage",
    description:
      "Nationwide truck dispatching for owner-operators and small fleets. Dry van, reefer, flatbed, power only and more. Carrier setup in 5 minutes. Call (908) 404-5373.",
  });
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // M-69/P-2: the CtaBand referral promise renders only when the
  // referral programme actually exists (company_settings gate).
  const referralActive = await getBooleanSetting("referral_program_active");

  return (
    <main id="main">
        {/* M-15: LocalBusiness + Service structured data */}
        <JsonLd data={localBusinessJsonLd()} />
        <Hero />
        <LoadTicker />
        <QuickQuote />
        <ServicesSplit />
        <HowAndCompare />
        <EquipmentGrid />
        <Industries />
        <BoardsStrip />
        <WhyStats />
        <Pricing />
        <ShippersTeaser />
        <NewAuthority />
        <Compliance />
        <PacketSection />
        {/* M-69/P-6: testimonials_visible is a real gate again. Renders
            nothing until the flag is on AND M-87 supplies approved rows. */}
        <TestimonialsSection />
        <CtaBand referralActive={referralActive} />
    </main>
  );
}
