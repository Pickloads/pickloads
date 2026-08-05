import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getV4 } from "@/i18n/v4-server";
import { PageHero } from "@/components/ui/PageHero";
import { CtaBand } from "@/components/sections/CtaBand";
import { getBooleanSetting } from "@/lib/company-settings";
import { JsonLd } from "@/components/seo/JsonLd";
import { pageMetadata } from "@/lib/seo";
import { stateServiceJsonLd } from "@/lib/jsonld";
import {
  STATE_SLUGS,
  getStateContent,
  type StateContent,
} from "@/content/states";

/*
 * M-35 — /truck-dispatch/[state] (arch §8 SEO pages, Phase 3: 6 priority
 * states with real content, then 4–6/month). Template mirrors the M-16
 * equipment pages, composed 100% from V4 vocabulary: PageHero → about-grid
 * (story intro + .svc requirements card) → .flow lanes → light FAQ →
 * CtaBand. Content from the typed module src/content/states.ts.
 */
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    STATE_SLUGS.map((state) => ({ locale, state })),
  );
}

export const dynamicParams = false;

type Params = Promise<{ locale: string; state: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale, state } = await params;
  const content = getStateContent(state);
  if (!content) return {};
  return pageMetadata({
    locale,
    href: `/truck-dispatch/${content.slug}`,
    title: content.metaTitle,
    description: content.metaDescription,
  });
}

export default async function StatePage({ params }: { params: Params }) {
  const { locale, state } = await params;
  const content = getStateContent(state);
  if (!content) notFound();
  setRequestLocale(locale);
  // M-69/P-2: the CtaBand referral promise renders only when the
  // referral programme actually exists (company_settings gate).
  const referralActive = await getBooleanSetting("referral_program_active");
  const tv = await getV4(locale);

  return (
    <main id="main">
      <JsonLd
        data={stateServiceJsonLd({
          name: content.name,
          description: content.blurb,
          slug: content.slug,
          stateName: content.stateName,
          locale,
        })}
      />
      <PageHero
        eyebrow={`${tv("Truck dispatch by state")} · ${content.abbr} · ${content.code}`}
        title={tv(content.name)}
      >
        {content.heroLead}
      </PageHero>

      <section>
        <div className="wrap about-grid">
          <div className="story">
            <span className="eyebrow">{tv("Dispatch")}</span>
            <h2 className="sec" style={{ marginBottom: 24 }}>
              {content.introHeading}
            </h2>
            {content.intro.map((paragraph) => (
              <p key={paragraph.slice(0, 32)}>{paragraph}</p>
            ))}
            <p className="mono" style={{ fontSize: ".78rem", color: "var(--color-steel)" }}>
              {content.ratesNote}
            </p>
          </div>
          <div className="svc dispatch">
            <span className="tag">{tv("Requirements")}</span>
            <h3>{content.requirementsHeading}</h3>
            <ul>
              {content.requirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <span className="soon">
              {"// "}
              {tv(
                "Document filing assistance only — we are not a law firm and do not provide legal advice.",
              )}
            </span>
          </div>
        </div>

        <div className="wrap">
          <div className="flow">
            <span className="flow-title">{content.lanesTitle}</span>
            <div className="flow-track">
              {content.lanes.map((node, index) => (
                <FlowNode
                  key={node.label}
                  node={node}
                  isLast={index === content.lanes.length - 1}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="light">
        <div className="wrap">
          <span className="eyebrow">{tv("FAQ")}</span>
          <h2 className="sec">{tv("Straight answers. No fine print.")}</h2>
          <div className="faq-cols" style={{ gridTemplateColumns: "1fr" }}>
            <div className="faq-col" style={{ maxWidth: 760 }}>
              <h3>▸ {tv(content.name)}</h3>
              {content.faq.map(([question, answer]) => (
                <details key={question}>
                  <summary>{question}</summary>
                  <div className="a">{answer}</div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <CtaBand referralActive={referralActive} />
    </main>
  );
}

function FlowNode({
  node,
  isLast,
}: {
  node: StateContent["lanes"][number];
  isLast: boolean;
}) {
  return (
    <>
      <span className={`flow-node${node.hot ? " hot" : ""}`}>{node.label}</span>
      {!isLast ? <span className="flow-arrow">→</span> : null}
    </>
  );
}
