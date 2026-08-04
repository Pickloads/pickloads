import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";

export const metadata: Metadata = {
  title: "About PickLoads — A Logistics Company Built for Carriers",
  description:
    "PickLoads Logistics Group LLC — truck dispatching and freight brokerage headquartered in Irvington, New Jersey. Founded on one standard: treat every truck like it's our own.",
};

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main>
      <PageHero
        eyebrow="About PickLoads"
        title="A logistics company built the way carriers wish they all were."
      >
        PickLoads Logistics Group LLC — truck dispatching and freight
        brokerage, headquartered in Irvington, New Jersey.
      </PageHero>

      <section>
        <div className="wrap about-grid">
          <div className="story">
            <span className="eyebrow">Our story</span>
            <h2 className="sec" style={{ marginBottom: 24 }}>
              Why PickLoads exists.
            </h2>
            <p>
              PickLoads was founded in 2026 in New Jersey after watching too
              many owner-operators lose money to the same problems: dispatch
              services that book cheap freight and disappear after 5pm, brokers
              that can&apos;t be reached when a driver is sitting at a dock, and
              fee structures nobody can explain.
            </p>
            <p>
              We started with a simple standard:{" "}
              <b style={{ color: "var(--paper)" }}>
                treat every truck like it&apos;s our own.
              </b>{" "}
              That means verifying the broker before booking, negotiating like
              the margin is ours, planning lanes around a driver&apos;s home
              time — and answering the phone at 2am when something goes wrong.
            </p>
            <p>
              Dispatch is where we start. Freight brokerage is where we&apos;re
              headed — with full FMCSA authority, a bonded operation and a
              vetted carrier network. And the same discipline on both sides of
              the load.
            </p>
          </div>
          <div className="founder">
            <div className="avatar" aria-hidden="true">
              EL
            </div>
            <b>Emmanuel Larocque</b>
            <span className="role">Founder &amp; CEO</span>
            <p>
              Entrepreneur and founder of a multi-division business group based
              in New Jersey. Emmanuel leads PickLoads with one obsession:
              building the dispatch company he&apos;d want behind his own truck.
            </p>
            {/* U-09/arch §9: founder photo replaces the monogram before launch — photo shoot pending */}
          </div>
        </div>
      </section>

      <div className="mission-band">
        <div className="wrap">
          <span className="mono">Our mission</span>
          <h2>
            &ldquo;Keep every carrier loaded, paid and respected — and give
            every shipper a partner they never have to chase.&rdquo;
          </h2>
        </div>
      </div>

      <section className="light">
        <div className="wrap">
          <span className="eyebrow">Our values</span>
          <h2 className="sec">What we don&apos;t compromise on.</h2>
          <div className="values">
            <div className="value">
              <span className="v-mark">V-01</span>
              <h3>Transparency</h3>
              <p>
                Every rate con visible. Every fee explained. No surprises on
                settlement day.
              </p>
            </div>
            <div className="value">
              <span className="v-mark">V-02</span>
              <h3>Compliance first</h3>
              <p>
                FMCSA rules aren&apos;t red tape — they&apos;re what protects
                carriers, shippers and us.
              </p>
            </div>
            <div className="value">
              <span className="v-mark">V-03</span>
              <h3>Availability</h3>
              <p>
                Freight doesn&apos;t sleep. When a driver calls at 2am, a human
                answers.
              </p>
            </div>
            <div className="value">
              <span className="v-mark">V-04</span>
              <h3>Long game</h3>
              <p>
                We&apos;d rather lose a load than book a bad one. Relationships
                outlast rate spikes.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Want to work with us?</h2>
            <p>Carrier or shipper — start the conversation today.</p>
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
