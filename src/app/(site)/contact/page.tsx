import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/ui/PageHero";

export const metadata: Metadata = {
  title: "Contact PickLoads — Talk to a Human Today",
  description:
    "Dispatch questions, freight quotes, partnerships — we answer fast. Call (908) 404-5373 or email support@pickloads.com. Office in Irvington, NJ.",
};

/*
 * Map: keyless Google Maps embed (no API key required for the basic iframe;
 * frame-src for google.com is already in the CSP). Replaces the V4 map
 * placeholder per its own note "// Embed Google Maps here in the production build".
 * Social links stay inert until the profiles exist (same rule as U-09:
 * no dead outbound links at launch — URLs land via company_settings in M-14).
 */
export default function ContactPage() {
  return (
    <main>
      <PageHero eyebrow="Contact" title="Talk to a human. Today.">
        Dispatch questions, freight quotes, partnerships — we answer fast.
      </PageHero>

      <section>
        <div className="wrap contact-grid">
          <div className="contact-cards">
            <div className="c-card">
              <span className="ic" aria-hidden="true">☎</span>
              <div>
                <b>Phone — 24/7 Dispatch Line</b>
                <a href="tel:+19084045373" className="mono">
                  (908) 404-5373
                </a>
              </div>
            </div>
            <div className="c-card">
              <span className="ic" aria-hidden="true">✉</span>
              <div>
                <b>Email</b>
                <a href="mailto:support@pickloads.com" className="mono">
                  support@pickloads.com
                </a>
              </div>
            </div>
            <div className="c-card">
              <span className="ic" aria-hidden="true">📍</span>
              <div>
                <b>Office</b>
                <span>
                  50 Union Ave, Suite 805-A
                  <br />
                  Irvington, NJ 07111
                </span>
              </div>
            </div>
            <div className="c-card">
              <span className="ic" aria-hidden="true">🕐</span>
              <div>
                <b>Office Hours</b>
                <span>
                  Mon–Fri 8am–6pm ET · Sat 9am–2pm ET
                  <br />
                  Dispatch support: 24/7, including holidays
                </span>
              </div>
            </div>
            <div className="c-card">
              <span className="ic" aria-hidden="true">＠</span>
              <div>
                <b>Follow PickLoads</b>
                <div className="socials">
                  <a>FACEBOOK</a>
                  <a>INSTAGRAM</a>
                  <a>LINKEDIN</a>
                  <a>TIKTOK</a>
                </div>
              </div>
            </div>
          </div>
          <div className="map-embed">
            <iframe
              title="PickLoads office — 50 Union Ave, Irvington, NJ 07111"
              src="https://www.google.com/maps?q=50+Union+Ave+Suite+805-A,+Irvington,+NJ+07111&output=embed"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Prefer to just get started?</h2>
            <p>
              Carrier setup takes 5 minutes. Shipper quotes answered within the
              hour.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Link className="btn btn-dark" href="/#quote">
              Start Carrier Setup
            </Link>
            <Link
              className="btn btn-ghost"
              style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
              href="/shippers"
            >
              Request a Freight Quote
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
