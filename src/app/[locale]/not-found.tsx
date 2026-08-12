import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";

export default function NotFound() {
  const tv = useV4();
  return (
    <main id="main">
      <div className="page-hero">
        <div className="wrap">
          <span className="eyebrow">{tv("404 — Not found")}</span>
          <h1>{tv("This lane doesn't exist.")}</h1>
          <p>
            {tv(
              "The page you're looking for moved or never got booked. Head back home, or call dispatch — a human answers 7 days a week.",
            )}
          </p>
          <div className="hero-ctas" style={{ marginTop: 28 }}>
            <Link className="btn btn-amber" href="/">
              {tv("Back to Home")}
            </Link>
            <a className="btn btn-ghost" href="tel:+19084045373">
              {tv("Call (908) 404-5373")}
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
