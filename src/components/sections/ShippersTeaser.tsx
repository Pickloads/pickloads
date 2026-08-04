import { Link } from "@/i18n/navigation";

export function ShippersTeaser() {
  return (
    <section className="light" style={{ paddingTop: 70, paddingBottom: 70 }}>
      <div
        className="wrap"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 30,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="eyebrow">For shippers</span>
          <h2 className="sec" style={{ maxWidth: 560 }}>
            Freight that moves on time, with one point of contact.
          </h2>
          <p className="sub">
            Vetted carriers, live tracking and claims support — see why shippers
            choose PickLoads.
          </p>
        </div>
        <Link className="btn btn-green" href="/shippers">
          Why Shippers Choose PickLoads →
        </Link>
      </div>
    </section>
  );
}
