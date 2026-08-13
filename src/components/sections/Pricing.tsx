import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { tierRate } from "@/lib/pricing";

/*
 * Reconstructed section (audit F-01, decision Q2): the V4 file lost this
 * markup; content restored verbatim from the V4 i18n dictionary + FAQ fee
 * structure. Preview approved by owner before integration.
 */
export function Pricing() {
  const tv = useV4();
  return (
    <section className="light" id="pricing">
      <div className="wrap">
        <span className="eyebrow">{tv("Pricing")}</span>
        <h2 className="sec">{tv("One flat percentage. Nothing hidden.")}</h2>
        <p className="sub">
          {tv(
            "No setup fees. No monthly minimums. No charge on loads you don't take. You only pay when you get paid.",
          )}
        </p>
        <div className="pricing-grid">
          <div className="plan">
            {/* M-90: these two plan names were the only plain-text headings
                in the section — the middle plan already went through tv().
                A pricing table with one translated tier name and two English
                ones is the kind of half-state that reads as a rendering bug. */}
            <h3>{tv("Owner-Operator")}</h3>
            <span className="for">{tv("1 truck · your authority")}</span>
            <span className="price">
              {tierRate("owner_operator")}
              <small>%</small>
            </span>
            <span className="per">{tv("of gross per load")}</span>
            <ul>
              <li>{tv("Dedicated dispatcher")}</li>
              <li>{tv("Load booking & rate negotiation")}</li>
              <li>{tv("Broker verification on every load")}</li>
              <li>{tv("Rate cons, BOLs & paperwork")}</li>
              <li>{tv("Detention & TONU support")}</li>
              <li>{tv("Driver support 7 days a week")}</li>
            </ul>
            <Link
              className="btn btn-ghost"
              style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
              href="/#quote"
            >
              {tv("Start setup")}
            </Link>
          </div>
          <div className="plan featured">
            <span className="badge">{tv("Most popular")}</span>
            <h3>{tv("Small Fleet")}</h3>
            <span className="for">{tv("2–10 trucks")}</span>
            <span className="price">
              {tierRate("small_fleet")}
              <small>%</small>
            </span>
            <span className="per">{tv("of gross per load")}</span>
            <ul>
              <li>{tv("Everything in Owner-Operator")}</li>
              <li>{tv("One dispatcher for your whole fleet")}</li>
              <li>{tv("Strategic lane planning per truck")}</li>
              <li>{tv("Weekly fleet performance recap")}</li>
              <li>{tv("Factoring coordination")}</li>
            </ul>
            <Link className="btn btn-amber" href="/#quote">
              {tv("Start setup")}
            </Link>
          </div>
          <div className="plan">
            <h3>{tv("Box Truck & Hot Shot")}</h3>
            <span className="for">{tv("Non-CDL & expedited")}</span>
            <span className="price">
              {tierRate("box_truck_hot_shot")}
              <small>%</small>
            </span>
            <span className="per">{tv("of gross per load")}</span>
            <ul>
              <li>{tv("Expedited & partial load sourcing")}</li>
              <li>{tv("Higher-touch booking (smaller loads)")}</li>
              <li>{tv("Paperwork & invoicing")}</li>
              <li>{tv("Detention & TONU support")}</li>
              <li>{tv("Driver support 7 days a week")}</li>
            </ul>
            <Link
              className="btn btn-ghost"
              style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
              href="/#quote"
            >
              {tv("Start setup")}
            </Link>
          </div>
        </div>
        <p className="pricing-note">
          {tv(
            "Percentages apply to load gross. Month to month — cancel anytime. You see every rate confirmation before we book.",
          )}
        </p>
      </div>
    </section>
  );
}
