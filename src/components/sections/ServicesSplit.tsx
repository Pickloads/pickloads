import { Link } from "@/i18n/navigation";
import { useV4, useV4Rich } from "@/i18n/v4";

export function ServicesSplit() {
  const tv = useV4();
  const t = useV4Rich();
  return (
    <section id="dispatch">
      <div className="wrap">
        <span className="eyebrow">{tv("Two divisions · One standard")}</span>
        <h2 className="sec">
{tv("Dispatch for carriers. Brokerage for shippers. Kept separate — by design.")}
        </h2>
        <p className="sub">
{tv("Clear roles, clear paperwork, full FMCSA compliance. No double brokering. Ever.")}
        </p>
        <div className="services-grid">
          <div className="svc dispatch">
            <span className="tag">{tv("For Carriers · Active Now")}</span>
            <h3>{tv("Truck Dispatching")}</h3>
<p>{t.rich("rich_svc_d_p", { b: (c) => <b>{c}</b> })}</p>
            <ul>
              <li>{tv("Load booking & rate negotiation on top boards")}</li>
              <li>{tv("Broker verification before every booking")}</li>
              <li>{tv("Detention, lumper & TONU support")}</li>
              <li>{tv("Invoicing & factoring coordination")}</li>
              <li>{tv("No forced dispatch — you approve every load")}</li>
            </ul>
            <Link className="link" href="/#pricing">
              {tv("See dispatch plans →")}
            </Link>
          </div>
          <div className="svc broker" id="brokerage">
            <span className="tag">{tv("For Shippers · Launching Soon")}</span>
            <h3>{tv("Freight Brokerage")}</h3>
<p>{tv("Full truckload and partial solutions with vetted carriers, real tracking and one point of contact from pickup to POD.")}</p>
            <ul>
              <li>{tv("FTL & partial — dry, temp-controlled, open deck")}</li>
              <li>{tv("Vetted carrier network (insurance & safety checked)")}</li>
              <li>{tv("Milestone shipment tracking & proactive updates")}</li>
              <li>{tv("Claims support & document management")}</li>
            </ul>
            <Link className="link" href="/shippers">
              {tv("Request a freight quote →")}
            </Link>
            <span className="soon">
              {"// Opens upon activation of MC authority + BMC-84 $75K surety bond"}
            </span>
          </div>
        </div>

        <div className="flow" tabIndex={0} role="region" aria-label={tv("Process steps (scrollable)")}>
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
            <span className="flow-node">DRIVER SUPPORT 7 DAYS</span>
          </div>
        </div>
      </div>
    </section>
  );
}
