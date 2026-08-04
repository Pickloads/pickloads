import Link from "next/link";

/*
 * Reconstructed section (audit F-01, decision Q2): the V4 file lost this
 * markup; content restored verbatim from the V4 i18n dictionary + FAQ fee
 * structure. Preview approved by owner before integration.
 */
export function Pricing() {
  return (
    <section className="light" id="pricing">
      <div className="wrap">
        <span className="eyebrow">Pricing</span>
        <h2 className="sec">One flat percentage. Nothing hidden.</h2>
        <p className="sub">
          No setup fees. No monthly minimums. No charge on loads you don&apos;t
          take. You only pay when you get paid.
        </p>
        <div className="pricing-grid">
          <div className="plan">
            <h3>Owner-Operator</h3>
            <span className="for">1 truck · your authority</span>
            <span className="price">
              5<small>%</small>
            </span>
            <span className="per">of gross per load</span>
            <ul>
              <li>Dedicated dispatcher</li>
              <li>Load booking &amp; rate negotiation</li>
              <li>Broker verification on every load</li>
              <li>Rate cons, BOLs &amp; paperwork</li>
              <li>Detention &amp; TONU support</li>
              <li>24/7 driver support</li>
            </ul>
            <Link
              className="btn btn-ghost"
              style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
              href="/#quote"
            >
              Start setup
            </Link>
          </div>
          <div className="plan featured">
            <span className="badge">Most popular</span>
            <h3>Small Fleet</h3>
            <span className="for">2–10 trucks</span>
            <span className="price">
              4.5<small>%</small>
            </span>
            <span className="per">of gross per load</span>
            <ul>
              <li>Everything in Owner-Operator</li>
              <li>One dispatcher for your whole fleet</li>
              <li>Strategic lane planning per truck</li>
              <li>Weekly fleet performance recap</li>
              <li>Factoring coordination</li>
            </ul>
            <Link className="btn btn-amber" href="/#quote">
              Start setup
            </Link>
          </div>
          <div className="plan">
            <h3>Box Truck &amp; Hot Shot</h3>
            <span className="for">Non-CDL &amp; expedited</span>
            <span className="price">
              8<small>%</small>
            </span>
            <span className="per">of gross per load</span>
            <ul>
              <li>Expedited &amp; partial load sourcing</li>
              <li>Higher-touch booking (smaller loads)</li>
              <li>Paperwork &amp; invoicing</li>
              <li>Detention &amp; TONU support</li>
              <li>24/7 driver support</li>
            </ul>
            <Link
              className="btn btn-ghost"
              style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
              href="/#quote"
            >
              Start setup
            </Link>
          </div>
        </div>
        <p className="pricing-note">
          Percentages apply to load gross. Month to month — cancel anytime. You
          see every rate confirmation before we book.
        </p>
      </div>
    </section>
  );
}
