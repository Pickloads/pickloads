import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";

export function NewAuthority() {
  const tv = useV4();
  return (
    <section id="new-authority" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="wrap">
        <span className="eyebrow">{tv("Start your trucking company")}</span>
        <h2 className="sec">
          {tv("No MC yet? We'll launch you — then dispatch you.")}
        </h2>
        <p className="sub">
          {tv(
            "Our New Authority Program handles the filings, then rolls you straight into dispatch. One partner from paperwork to first load.",
          )}
        </p>
        <div className="services-grid">
          <div className="svc dispatch">
            <span className="tag">{tv("New Authority Program")}</span>
            <h3>{tv("Everything filed. Then dispatched.")}</h3>
            <ul>
              <li>{tv("LLC formation & EIN registration")}</li>
              <li>{tv("MC & USDOT filing (FMCSA)")}</li>
              <li>{tv("BOC-3 process agent designation")}</li>
              <li>{tv("UCR registration")}</li>
              <li>{tv("Insurance guidance ($1M liability / $100K cargo)")}</li>
              <li>{tv("Straight into dispatch onboarding")}</li>
            </ul>
            <Link className="link" href="/#quote">
              {tv("Start My Trucking Company →")}
            </Link>
            <span className="soon">
              {"// "}
              {tv(
                "Document filing assistance only — we are not a law firm and do not provide legal advice.",
              )}
            </span>
          </div>
          <div className="svc broker">
            <span className="tag">{tv("Why launch with us")}</span>
            <h3>{tv("Why launch with a dispatch company?")}</h3>
            <p>
              {tv(
                "Formation services file your paperwork and disappear. We file it — and then keep your truck loaded.",
              )}
            </p>
            <ul>
              <li>{tv("We know which brokers accept new authorities")}</li>
              <li>{tv("Lane planning built for your first 90 days")}</li>
              <li>{tv("Insurance guidance before you overpay")}</li>
              <li>{tv("One team from LLC to first load")}</li>
            </ul>
            <Link className="link" href="/#quote">
              {tv("Talk to us first — it's free →")}
            </Link>
          </div>
        </div>
        <div className="flow">
          <span className="flow-title">
            {tv("New authority path — from zero to first load")}
          </span>
          <div className="flow-track">
            <span className="flow-node">{tv("LLC + EIN")}</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">{tv("MC / USDOT")}</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">{tv("BOC-3 + UCR")}</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node">{tv("INSURANCE")}</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node hot">{tv("DISPATCH ONBOARDING")}</span>
            <span className="flow-arrow">→</span>
            <span className="flow-node hot">{tv("FIRST LOAD")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
