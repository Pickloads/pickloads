import { Link } from "@/i18n/navigation";

/* Slugs match /dispatch/[equipment] (M-16) and content/equipment/*.mdx */
const EQUIPMENT = [
  ["EQ-01", "dry-van", "Dry Van Dispatch", "53' general freight, the backbone of the network."],
  ["EQ-02", "reefer", "Reefer Dispatch", "Temp-controlled produce, food & pharma loads."],
  ["EQ-03", "flatbed", "Flatbed Dispatch", "Steel, lumber, machinery — tarps & securement."],
  ["EQ-04", "step-deck", "Step Deck Dispatch", "Over-height freight and heavy equipment."],
  ["EQ-05", "power-only", "Power Only Dispatch", "Drop & hook trailer pools nationwide."],
  ["EQ-06", "hot-shot", "Hot Shot Dispatch", "Expedited partial loads, 40' gooseneck."],
  ["EQ-07", "box-truck", "Box Truck Dispatch", "26' straight truck & final-mile freight."],
  ["EQ-08", "sprinter-van", "Sprinter Van Dispatch", "Expedited small freight & medical runs."],
] as const;

export function EquipmentGrid() {
  return (
    <section id="equipment">
      <div className="wrap">
        <span className="eyebrow">Equipment we dispatch</span>
        <h2 className="sec">Every trailer. Every lane.</h2>
        <p className="sub">
          Each equipment type has its own dedicated dispatch page — lanes, rates
          and requirements. Built for drivers searching Google.
        </p>
        <div className="eq-grid">
          {EQUIPMENT.map(([mm, slug, title, blurb]) => (
            <Link className="eq-card" key={slug} href={`/dispatch/${slug}`}>
              <span className="mm">{mm}</span>
              <h3>{title}</h3>
              <p>{blurb}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
