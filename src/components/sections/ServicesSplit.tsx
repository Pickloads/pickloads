import Link from "next/link";

export function ServicesSplit() {
  return (
    <section id="dispatch">
      <div className="wrap">
        <span className="eyebrow">Two divisions · One standard</span>
        <h2 className="sec">
          Dispatch for carriers. Brokerage for shippers. Kept separate — by
          design.
        </h2>
        <p className="sub">
          Clear roles, clear paperwork, full FMCSA compliance. No double
          brokering. Ever.
        </p>
        <div className="services-grid">
          <div className="svc dispatch">
            <span className="tag">For Carriers · Active Now</span>
            <h3>Truck Dispatching</h3>
            <p>
              We act as your back office: finding freight, negotiating rates and
              handling the paperwork under <b>your</b> operating authority.
            </p>
            <ul>
              <li>Load booking &amp; rate negotiation on top boards</li>
              <li>Broker verification before every booking</li>
              <li>Detention, lumper &amp; TONU support</li>
              <li>Invoicing &amp; factoring coordination</li>
              <li>No forced dispatch — you approve every load</li>
            </ul>
            <Link className="link" href="/#pricing">
              See dispatch plans →
            </Link>
          </div>
          <div className="svc broker" id="brokerage">
            <span className="tag">For Shippers · Launching Soon</span>
            <h3>Freight Brokerage</h3>
            <p>
              Full truckload and partial solutions with vetted carriers, real
              tracking and one point of contact from pickup to POD.
            </p>
            <ul>
              <li>FTL &amp; partial — dry, temp-controlled, open deck</li>
              <li>Vetted carrier network (insurance &amp; safety checked)</li>
              <li>Live shipment tracking &amp; proactive updates</li>
              <li>Claims support &amp; document management</li>
            </ul>
            <Link className="link" href="/shippers">
              Request a freight quote →
            </Link>
            <span className="soon">
              {"// Opens upon activation of MC authority + BMC-84 $75K surety bond"}
            </span>
          </div>
        </div>

        <div className="flow">
          <span className="flow-title">
            Our dispatch process — every load, same discipline
          </span>
          <div className="flow-track">
            <span className="flow-node">CARRIER</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node hot">DEDICATED DISPATCHER</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">LOAD SEARCH</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">BROKER CHECK</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">RATE NEGOTIATION</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node hot">CARRIER APPROVAL</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">BOOK LOAD</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">PAPERWORK</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">DRIVER SUPPORT 24/7</span>
          </div>
        </div>
      </div>
    </section>
  );
}
