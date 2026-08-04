import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="page-hero">
        <div className="wrap">
          <span className="eyebrow">404 — Not found</span>
          <h1>This lane doesn&apos;t exist.</h1>
          <p>
            The page you&apos;re looking for moved or never got booked. Head
            back home, or call dispatch — a human answers 24/7.
          </p>
          <div className="hero-ctas" style={{ marginTop: 28 }}>
            <Link className="btn btn-amber" href="/">
              Back to Home
            </Link>
            <a className="btn btn-ghost" href="tel:+19084045373">
              Call (908) 404-5373
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
