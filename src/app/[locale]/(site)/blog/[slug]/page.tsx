import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { CtaBand } from "@/components/sections/CtaBand";
import { getV4 } from "@/i18n/v4-server";
import { absoluteUrl, SITE_NAME } from "@/lib/seo";
import { articleJsonLd } from "@/lib/jsonld";
import { fetchPublishedPost } from "@/lib/posts";
import { readingMinutes, renderMarkdown } from "@/lib/markdown";

/**
 * M-33 — /blog/[slug] article page. Published posts only (anon-key read under
 * the public RLS policy) — drafts and unknown slugs 404. ISR 10 min, matching
 * the index. Cover hero reuses the V4 .post cover gradient vocabulary
 * (.article-cover.c1–c4); prose styles are token-only (v4.css).
 *
 * SEO: canonical only, no hreflang alternates — posts are per-locale
 * documents (unique (slug, locale)); a translation may not exist, and a
 * wrong alternate is worse than none. Article JSON-LD per locale.
 */
export const revalidate = 600;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COVER_STYLES = new Set(["c1", "c2", "c3", "c4"]);

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!SLUG.test(slug)) return {};
  const post = await fetchPublishedPost(locale, slug);
  if (!post) return {};
  const canonical = absoluteUrl(`/blog/${post.slug}`, locale);
  const description = post.excerpt ?? undefined;
  return {
    title: `${post.title} | PickLoads`,
    description,
    alternates: { canonical },
    openGraph: {
      title: post.title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      locale,
      type: "article",
      ...(post.published_at ? { publishedTime: post.published_at } : {}),
      modifiedTime: post.updated_at,
    },
    twitter: { card: "summary", title: post.title, description },
  };
}

export default async function BlogPostPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const post = await fetchPublishedPost(locale, slug);
  if (!post) notFound();
  setRequestLocale(locale);
  const tv = await getV4(locale);

  const cover =
    post.cover_style && COVER_STYLES.has(post.cover_style)
      ? post.cover_style
      : "c3";
  const published = post.published_at
    ? new Date(post.published_at).toLocaleDateString(
        locale === "en" ? "en-US" : locale,
        { month: "long", day: "numeric", year: "numeric" },
      )
    : null;

  return (
    <main id="main">
      <JsonLd
        data={articleJsonLd({
          title: post.title,
          description: post.excerpt,
          slug: post.slug,
          locale,
          publishedAt: post.published_at,
          modifiedAt: post.updated_at,
        })}
      />
      <section style={{ paddingTop: 140 }}>
        <div className="wrap">
          <article className="article-wrap">
            <div className={`article-cover ${cover}`}>
              {post.category ?? tv("Freight Insights")}
            </div>
            <h1 className="article-title">{post.title}</h1>
            <p className="article-meta">
              {published ? `${published} · ` : ""}
              {readingMinutes(post.body_md)} {tv("MIN READ")} ·{" "}
              {tv("PickLoads dispatch desk")}
            </p>
            {post.excerpt ? (
              <p
                style={{
                  marginTop: 18,
                  fontSize: "1.12rem",
                  color: "#c4ccd1",
                  lineHeight: 1.6,
                }}
              >
                {post.excerpt}
              </p>
            ) : null}
            <div
              className="article-body"
              // Safe by construction: renderMarkdown escapes ALL input before
              // rebuilding its allow-list of tags (src/lib/markdown.ts).
              dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_md) }}
            />
            <p style={{ marginTop: 36 }}>
              <Link className="btn btn-ghost btn-sm" href="/blog">
                ← {tv("All articles")}
              </Link>
            </p>
          </article>
        </div>
      </section>
      <CtaBand />
    </main>
  );
}
