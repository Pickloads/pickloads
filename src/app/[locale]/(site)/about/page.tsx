import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";
import { useV4, useV4Rich } from "@/i18n/v4";

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
  return <AboutContent />;
}

/* Sync inner component: useV4/useTranslations are legal in non-async RSC. */
function AboutContent() {
  const tv = useV4();
  const t = useV4Rich();
  return (
    <main>
      <PageHero
        eyebrow={tv("About PickLoads")}
        title={tv(
          "A logistics company built the way carriers wish they all were.",
        )}
      >
        {tv(
          "PickLoads Logistics Group LLC — truck dispatching and freight brokerage, headquartered in Irvington, New Jersey.",
        )}
      </PageHero>

      <section>
        <div className="wrap about-grid">
          <div className="story">
            <span className="eyebrow">{tv("Our story")}</span>
            <h2 className="sec" style={{ marginBottom: 24 }}>
              {tv("Why PickLoads exists.")}
            </h2>
            <p>
              {tv(
                "PickLoads was founded in 2026 in New Jersey after watching too many owner-operators lose money to the same problems: dispatch services that book cheap freight and disappear after 5pm, brokers that can't be reached when a driver is sitting at a dock, and fee structures nobody can explain.",
              )}
            </p>
            <p>
              {t.rich("rich_ab_p2", {
                b: (chunks) => (
                  <b style={{ color: "var(--paper)" }}>{chunks}</b>
                ),
              })}
            </p>
            <p>
              {tv(
                "Dispatch is where we start. Freight brokerage is where we're headed — with full FMCSA authority, a bonded operation and a vetted carrier network. And the same discipline on both sides of the load.",
              )}
            </p>
          </div>
          <div className="founder">
            <div className="avatar" aria-hidden="true">
              EL
            </div>
            <b>Emmanuel Larocque</b>
            <span className="role">{tv("Founder & CEO")}</span>
            <p>
              {tv(
                "Entrepreneur and founder of a multi-division business group based in New Jersey. Emmanuel leads PickLoads with one obsession: building the dispatch company he'd want behind his own truck.",
              )}
            </p>
            {/* U-09/arch §9: founder photo replaces the monogram before launch — photo shoot pending */}
          </div>
        </div>
      </section>

      <div className="mission-band">
        <div className="wrap">
          <span className="mono">{tv("Our mission")}</span>
          <h2>
            {tv(
              "“Keep every carrier loaded, paid and respected — and give every shipper a partner they never have to chase.”",
            )}
          </h2>
        </div>
      </div>

      <section className="light">
        <div className="wrap">
          <span className="eyebrow">{tv("Our values")}</span>
          <h2 className="sec">{tv("What we don't compromise on.")}</h2>
          <div className="values">
            <div className="value">
              <span className="v-mark">V-01</span>
              <h3>{tv("Transparency")}</h3>
              <p>
                {tv(
                  "Every rate con visible. Every fee explained. No surprises on settlement day.",
                )}
              </p>
            </div>
            <div className="value">
              <span className="v-mark">V-02</span>
              <h3>{tv("Compliance first")}</h3>
              <p>
                {tv(
                  "FMCSA rules aren't red tape — they're what protects carriers, shippers and us.",
                )}
              </p>
            </div>
            <div className="value">
              <span className="v-mark">V-03</span>
              <h3>{tv("Availability")}</h3>
              <p>
                {tv(
                  "Freight doesn't sleep. When a driver calls at 2am, a human answers.",
                )}
              </p>
            </div>
            <div className="value">
              <span className="v-mark">V-04</span>
              <h3>{tv("Long game")}</h3>
              <p>
                {tv(
                  "We'd rather lose a load than book a bad one. Relationships outlast rate spikes.",
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>{tv("Want to work with us?")}</h2>
            <p>{tv("Carrier or shipper — start the conversation today.")}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Link className="btn btn-dark" href="/#quote">
              {tv("Start Carrier Setup")}
            </Link>
            <Link
              className="btn btn-ghost"
              style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
              href="/shippers"
            >
              {tv("Request a Freight Quote")}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
