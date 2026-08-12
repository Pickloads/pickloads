import { Link } from "@/i18n/navigation";
import { useV4, useV4Rich } from "@/i18n/v4";

export function Hero() {
  const tv = useV4();
  const t = useV4Rich();
  return (
    <header className="hero" id="top">
      <div className="wrap">
        <span className="eyebrow">
          {tv("Truck Dispatching · Freight Brokerage · Nationwide")}
        </span>
        <h1>
          {t.rich("rich_hero_title", {
            em: (c) => <em>{c}</em>,
            br: () => <br />,
          })}
        </h1>
        <p className="lead">
          {tv(
            "Dedicated dispatch for owner-operators and small fleets — load booking, rate negotiation, paperwork and support 7 days a week. You drive. We keep the freight coming.",
          )}
        </p>
        <div className="hero-ctas">
          <Link className="btn btn-amber" href="/#quote">
            {tv("Get Started in 60 Seconds")}
          </Link>
          <a className="btn btn-ghost" href="tel:+19084045373">
            {tv("Call (908) 404-5373")}
          </a>
        </div>
        <p className="hero-note">
          {t.rich("rich_hero_note", {
            b: (c) => <b>{c}</b>,
            br: () => <br />,
          })}
        </p>
      </div>
    </header>
  );
}
