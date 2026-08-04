import { Link } from "@/i18n/navigation";

export function NewAuthority() {
  return (
    <section id="new-authority" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="wrap">
        <span className="eyebrow">Start your trucking company</span>
        <h2 className="sec">No MC yet? We&apos;ll launch you — then dispatch you.</h2>
        <p className="sub">
          Our New Authority Program handles the filings, then rolls you straight
          into dispatch. One partner from paperwork to first load.
        </p>
        <div className="services-grid">
          <div className="svc dispatch">
            <span className="tag">New Authority Program</span>
            <h3>Everything filed. Then dispatched.</h3>
            <ul>
              <li>LLC formation &amp; EIN registration</li>
              <li>MC &amp; USDOT filing (FMCSA)</li>
              <li>BOC-3 process agent designation</li>
              <li>UCR registration</li>
              <li>Insurance guidance ($1M liability / $100K cargo)</li>
              <li>Straight into dispatch onboarding</li>
            </ul>
            <Link className="link" href="/#quote">
              Start My Trucking Company →
            </Link>
            <span className="soon">
              {"// Document filing assistance only — we are not a law firm and do not provide legal advice."}
            </span>
          </div>
          <div className="svc broker">
            <span className="tag">Why launch with us</span>
            <h3>Why launch with a dispatch company?</h3>
            <p>
              Formation services file your paperwork and disappear. We file it —
              and then keep your truck loaded.
            </p>
            <ul>
              <li>We know which brokers accept new authorities</li>
              <li>Lane planning built for your first 90 days</li>
              <li>Insurance guidance before you overpay</li>
              <li>One team from LLC to first load</li>
            </ul>
            <Link className="link" href="/#quote">
              Talk to us first — it&apos;s free →
            </Link>
          </div>
        </div>
        <div className="flow">
          <span className="flow-title">
            New authority path — from zero to first load
          </span>
          <div className="flow-track">
            <span className="flow-node">LLC + EIN</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">MC / USDOT</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">BOC-3 + UCR</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">INSURANCE</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node hot">DISPATCH ONBOARDING</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node hot">FIRST LOAD</span>
          </div>
        </div>
      </div>
    </section>
  );
}
