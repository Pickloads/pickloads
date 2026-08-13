import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { PageHero } from "@/components/ui/PageHero";
import { Link } from "@/i18n/navigation";
import { getV4 } from "@/i18n/v4-server";
import { searchPublic } from "@/lib/search/public-index";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/**
 * Site search — public content only.
 *
 * ── A GET FORM, SERVER-RENDERED ──────────────────────────────────────────
 *
 * `?q=` is read on the server. Every result page is a real, linkable URL that
 * works with JavaScript disabled, and there is no client-side index shipped to
 * the browser — which also means no copy of the corpus to keep in sync.
 *
 * ── IT CANNOT LEAK, BY CONSTRUCTION ──────────────────────────────────────
 *
 * `searchPublic` reads from `public-index.ts`, which derives from the same
 * sources as the sitemap. There is no database query on this path, no session,
 * no RLS to respect and no storage client — so there is no portal page,
 * shipment, document or carrier record for a query to reach. The security
 * property is the absence of a code path, not a filter somebody could remove.
 *
 * ── NOINDEX ──────────────────────────────────────────────────────────────
 *
 * Result pages are `noindex, follow`: they are navigation, not content, and an
 * indexed `?q=` page is duplicate content that competes with the page it
 * points at. `follow` keeps the links useful to a crawler that arrives anyway.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    ...(await pageMetadata({
      locale,
      href: "/search",
      title: "Search — PickLoads Logistics Group",
      description: "Search PickLoads services, resources and answers.",
    })),
    alternates: { canonical: absoluteUrl("/search", locale) },
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);
  const tv = await getV4(locale);

  const query = (q ?? "").slice(0, 100).trim();
  const results = query ? searchPublic(query) : [];

  return (
    <main id="main">
      <PageHero eyebrow={tv("Search")} title={tv("Search PickLoads")}>
        {tv("The questions carriers and shippers actually ask us — answered the way we'd want them answered.")}
      </PageHero>

      <section className="light">
        <div className="wrap">
          {/* role="search" is the landmark assistive technology looks for. */}
          <form role="search" method="get" action="/search" className="kb-search">
            <div className="field">
              <label htmlFor="site-q">{tv("Search")}</label>
              <input
                id="site-q"
                name="q"
                type="search"
                defaultValue={query}
                maxLength={100}
                autoComplete="off"
                placeholder={tv("e.g. reefer dispatch")}
              />
            </div>
            <button className="btn btn-amber" type="submit">
              {tv("Search")}
            </button>
          </form>

          {query === "" ? (
            /* EMPTY STATE — nothing searched yet. Not a no-result state: the
               two mean different things and must not look the same. */
            <div className="state state--empty" style={{ marginTop: 20 }}>
              <h3>{tv("What are you looking for?")}</h3>
              <p>
                {tv(
                  "The questions carriers and shippers actually ask us — answered the way we'd want them answered.",
                )}
              </p>
            </div>
          ) : (
            <>
              <p role="status" className="mono" style={{ fontSize: ".78rem" }}>
                {results.length} {tv("results")}
              </p>

              {results.length === 0 ? (
                /* NO-RESULT STATE — searched, found nothing. Offers a way on
                   rather than a dead end. */
                <div className="state state--empty">
                  <h3>{tv("Nothing here yet")}</h3>
                  <p>
                    {tv(
                      "Call us — a human picks up. (908) 404-5373, or email support@pickloads.com.",
                    )}
                  </p>
                  <p>
                    <Link className="btn btn-ghost" href="/knowledge-base">
                      {tv("Knowledge Base")}
                    </Link>{" "}
                    <Link className="btn btn-ghost" href="/contact">
                      {tv("Contact")}
                    </Link>
                  </p>
                </div>
              ) : (
                <ol className="search-results">
                  {results.map((result) => (
                    <li key={`${result.type}-${result.href}-${result.title}`}>
                      <span className="rtype mono">{tv(result.type)}</span>
                      <h2>
                        <Link href={result.href}>{tv(result.title)}</Link>
                      </h2>
                      <p>{tv(result.summary)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
