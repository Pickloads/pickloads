import Link from "next/link";

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="wrap">
        <span className="eyebrow">
          Truck Dispatching · Freight Brokerage · Nationwide
        </span>
        <h1>
          Your truck stays <em>loaded</em>.
          <br />
          We handle everything else.
        </h1>
        <p className="lead">
          Dedicated dispatch for owner-operators and small fleets — load
          booking, rate negotiation, paperwork and 24/7 support. You drive. We
          keep the freight coming.
        </p>
        <div className="hero-ctas">
          <Link className="btn btn-amber" href="/#quote">
            Get Started in 60 Seconds
          </Link>
          <a className="btn btn-ghost" href="tel:+19084045373">
            Call (908) 404-5373
          </a>
        </div>
        <p className="hero-note">
          <b>■ DISPATCH ACTIVE NOW</b> &nbsp;·&nbsp; Brokerage division launches
          with FMCSA MC authority &amp; BMC-84 bond — in process.
        </p>
      </div>
    </header>
  );
}
