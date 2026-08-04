import Link from "next/link";

export function CtaBand() {
  return (
    <section className="cta-band" id="setup">
      <div className="wrap">
        <div>
          <h2>Ready to stop hunting loads?</h2>
          <p>
            Carrier setup takes 5 minutes: docs, e-signature, done. Your
            dispatcher starts working your lanes today.
          </p>
          <p className="mono-note">
            {"// Refer a carrier who signs up → earn a referral bonus."}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link className="btn btn-dark" href="/#quote">
            Start Carrier Setup
          </Link>
          <a
            className="btn btn-ghost"
            style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
            href="tel:+19084045373"
          >
            Or call (908) 404-5373
          </a>
        </div>
      </div>
    </section>
  );
}
