const INDUSTRIES = [
  "Food & Beverage", "Retail & E-commerce", "Construction", "Medical & Pharma",
  "Automotive", "Manufacturing", "Agriculture", "Energy",
];

export function Industries() {
  return (
    <section id="industries" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <span className="eyebrow">Industries served</span>
        <h2 className="sec">Freight expertise where it counts.</h2>
        <div className="chips">
          {INDUSTRIES.map((name) => (
            <span className="chip" key={name}>
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
