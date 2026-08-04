import { Hero } from "@/components/sections/Hero";
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
import { Packet } from "@/components/sections/Packet";
import { CtaBand } from "@/components/sections/CtaBand";

/*
 * Home page — V4 section order preserved exactly; the reconstructed Pricing
 * section (F-01/Q2) sits between WhyStats and the shippers teaser per the V4
 * stylesheet order. Testimonials are omitted at launch per the prototype's own
 * note + arch §9 (audit F-13) — the component returns with M-14's
 * company_settings gate once verified reviews exist.
 * NOTE: moves to src/app/[locale]/page.tsx in M-13.
 */
export default function HomePage() {
  return (
    <main>
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
        <Packet />
        <CtaBand />
    </main>
  );
}
