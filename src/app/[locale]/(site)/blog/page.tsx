import type { Metadata } from "next";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";
import { NewsletterForm } from "@/components/forms/NewsletterForm";
import { getV4 } from "@/i18n/v4-server";
import { pageMetadata } from "@/lib/seo";
import { fetchPublishedPosts } from "@/lib/posts";
import { readingMinutes } from "@/lib/markdown";

/**
 * M-33 — /blog now reads published posts from Supabase (anon client under
 * the "public read published posts" RLS policy; the V4 SAMPLE_POSTS array is
 * gone per audit F-13). Empty locale → honest empty state + newsletter.
 * ISR (10 min): fresh enough for a blog, no DB hit per request.
 */
export const revalidate = 600;

const COVER_STYLES = new Set(["c1", "c2", "c3", "c4"]);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/blog",
    title: "Freight Insights — Market Updates & Dispatch Strategy | PickLoads",
    description:
      "Market updates, dispatch strategy and FMCSA news — written for the people actually running trucks.",
  });
}

export default async function BlogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);
  const posts = await fetchPublishedPosts(locale);

  return (
    <main>
      <PageHero
        eyebrow={tv("Freight Insights")}
        title={tv("The road, the rates, the rules.")}
      >
        {tv(
          "Market updates, dispatch strategy and FMCSA news — written for the people actually running trucks.",
        )}
      </PageHero>

      <section>
        <div className="wrap">
          {posts.length === 0 ? (
            <p
              className="mono"
              style={{
                fontSize: ".82rem",
                color: "var(--color-dim)",
                marginTop: 44,
                maxWidth: 620,
              }}
            >
              {"// "}
              {tv(
                "First articles are on the way. Join the dispatch list below and we'll send them straight to your inbox.",
              )}
            </p>
          ) : (
            <div className="blog-grid">
              {posts.map((post) => {
                const cover =
                  post.cover_style && COVER_STYLES.has(post.cover_style)
                    ? post.cover_style
                    : "c3";
                const published = post.published_at
                  ? new Date(post.published_at).toLocaleDateString(
                      locale === "en" ? "en-US" : locale,
                      { month: "short", day: "numeric", year: "numeric" },
                    )
                  : "";
                return (
                  <Link className="post" href={`/blog/${post.slug}`} key={post.id}>
                    <div className={`cover ${cover}`}>
                      {post.category ?? tv("Freight Insights")}
                    </div>
                    <div className="body">
                      <h3>{post.title}</h3>
                      {post.excerpt ? <p>{post.excerpt}</p> : null}
                      <span className="meta">
                        {published ? `${published} · ` : ""}
                        {readingMinutes(post.body_md)} {tv("MIN READ")}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          {/* Suspense: NewsletterForm reads useSearchParams (confirm redirect) */}
          <Suspense fallback={null}>
            <NewsletterForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
