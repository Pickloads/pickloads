import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";

export function ShippersTeaser() {
  const tv = useV4();
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
          <span className="eyebrow">{tv("For shippers")}</span>
          <h2 className="sec" style={{ maxWidth: 560 }}>
            {tv("Freight that moves on time, with one point of contact.")}
          </h2>
          <p className="sub">
            {tv(
              "Vetted carriers, live tracking and claims support — see why shippers choose PickLoads.",
            )}
          </p>
        </div>
        <Link className="btn btn-green" href="/shippers">
          {tv("Why Shippers Choose PickLoads →")}
        </Link>
      </div>
    </section>
  );
}
