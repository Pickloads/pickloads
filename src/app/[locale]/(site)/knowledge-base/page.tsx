import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { JsonLd } from "@/components/seo/JsonLd";
import { PageHero } from "@/components/ui/PageHero";
import {
  categoryBySlug,
  categoryEntries,
  KB_CATEGORIES,
} from "@/content/knowledge-base";
import { Link } from "@/i18n/navigation";
import { getV4 } from "@/i18n/v4-server";
import { faqPageJsonLd } from "@/lib/jsonld";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/**
 * Knowledge Base — the categorised home for the support answers.
 *
 * ── WHAT IT REUSES ───────────────────────────────────────────────────────
 *
 * Every answer comes from `CARRIER_FAQ` / `SHIPPER_FAQ` via
 * `src/content/knowledge-base.ts`. No answer text is authored here: final
 * answers are Cowork's, and several touch compliance directly.
 *
 * ── THE FILTER IS A GET FORM, NOT JAVASCRIPT ─────────────────────────────
 *
 * `?category=dispatch` is read on the server. That makes every filtered view a
 * real, linkable, crawlable URL; it works with JavaScript disabled; and it has
 * no keyboard behaviour to get wrong. The same reasoning as M-74's shipper
 * filters.
 *
 * ── FAQ STRUCTURED DATA MATCHES WHAT IS ON SCREEN ────────────────────────
 *
 * The directive is explicit that FAQ structured data must represent actual
 * visible content. So the JSON-LD is built from the entries THIS RENDER
 * produced — filtered views emit only their own questions, and a category with
 * no answers emits no FAQPage node at all. Emitting the full set on a filtered
 * page would be describing content the visitor cannot see.
 *
 * `/faq` keeps its own JSON-LD and its own URL; this page is organised by
 * topic rather than by audience, and links back to it.
 */

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const { category } = await searchParams;
  const active = categoryBySlug(category);

  // A filtered view is a variant, not a competitor: it canonicalises to the
  // unfiltered page so eight near-identical URLs do not compete with it.
  const meta = await pageMetadata({
    locale,
    href: "/knowledge-base",
    title: "Knowledge Base — PickLoads Logistics Group",
    description:
      "Answers for carriers and shippers: dispatch, freight, carrier onboarding, New Authority, tracking, documents, accounts and support.",
  });
  if (active) {
    return {
      ...meta,
      title: `${active.label} — Knowledge Base — PickLoads Logistics Group`,
      alternates: { canonical: absoluteUrl("/knowledge-base", locale) },
      robots: { index: false, follow: true },
    };
  }
  return meta;
}

export default async function KnowledgeBasePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  const { category } = await searchParams;
  setRequestLocale(locale);
  const tv = await getV4(locale);

  const active = categoryBySlug(category);
  const shown = active ? [active] : KB_CATEGORIES;

  // Only what this render actually shows. See the note above.
  const visible = shown.flatMap((c) =>
    categoryEntries(c).map(([q, a]) => [tv(q), tv(a)] as const),
  );

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: absoluteUrl("/", locale),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Knowledge Base",
        item: absoluteUrl("/knowledge-base", locale),
      },
    ],
  };

  return (
    <main id="main">
      <JsonLd data={breadcrumbs} />
      {visible.length > 0 ? <JsonLd data={faqPageJsonLd(visible)} /> : null}

      <PageHero
        eyebrow={tv("Knowledge Base")}
        title={tv("Straight answers. No fine print.")}
      >
        {tv(
          "The questions carriers and shippers actually ask us — answered the way we'd want them answered.",
        )}
      </PageHero>

      <section className="light">
        <div className="wrap">
          {/* A plain GET form: linkable, crawlable, works without JS, and has
              no keyboard behaviour to get wrong. */}
          <nav aria-label={tv("Knowledge Base categories")}>
            <ul className="kb-cats">
              <li>
                <Link
                  href="/knowledge-base"
                  aria-current={active ? undefined : "page"}
                  className={active ? undefined : "active"}
                >
                  {tv("All topics")}
                </Link>
              </li>
              {KB_CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/knowledge-base?category=${c.slug}`}
                    aria-current={active?.slug === c.slug ? "page" : undefined}
                    className={active?.slug === c.slug ? "active" : undefined}
                  >
                    {tv(c.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <p role="status" className="mono" style={{ fontSize: ".78rem" }}>
            {visible.length} {tv("answers")}
          </p>

          {shown.map((c) => {
            const entries = categoryEntries(c);
            return (
              <section key={c.slug} id={c.slug} aria-labelledby={`kb-${c.slug}`}>
                <h2 id={`kb-${c.slug}`} className="sec">
                  {tv(c.label)}
                </h2>
                {entries.length === 0 ? (
                  /* HONEST EMPTY STATE. The category is declared because the
                     topic is real; there is simply no approved answer for it
                     yet. Hiding it would make the gap invisible. */
                  <div className="state state--empty">
                    <h3>{tv("Nothing here yet")}</h3>
                    <p>
                      {tv(
                        "Call us — a human picks up. (908) 404-5373, or email support@pickloads.com.",
                      )}
                    </p>
                  </div>
                ) : (
                  entries.map(([q, a]) => (
                    <details key={q}>
                      <summary>{tv(q)}</summary>
                      <div className="a">{tv(a)}</div>
                    </details>
                  ))
                )}
              </section>
            );
          })}
        </div>
      </section>

      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("Related")}</h2>
          <p>
            <Link className="btn btn-ghost" href="/faq">
              {tv("FAQ")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/track">
              {tv("Track Shipment")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/dispatch-services">
              {tv("Dispatch Services")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/contact">
              {tv("Contact")}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
