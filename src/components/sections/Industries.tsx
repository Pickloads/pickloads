import { useV4 } from "@/i18n/v4";

const INDUSTRIES = [
  "Food & Beverage", "Retail & E-commerce", "Construction", "Medical & Pharma",
  "Automotive", "Manufacturing", "Agriculture", "Energy",
];

export function Industries() {
  const tv = useV4();
  return (
    <section id="industries" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <span className="eyebrow">{tv("Industries served")}</span>
        <h2 className="sec">{tv("Freight expertise where it counts.")}</h2>
        <div className="chips">
          {INDUSTRIES.map((name) => (
            <span className="chip" key={name}>
              {tv(name)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
