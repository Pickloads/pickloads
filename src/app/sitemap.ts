import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { absoluteUrl, languageAlternates, PUBLIC_ROUTES } from "@/lib/seo";
import { EQUIPMENT_SLUGS } from "@/content/equipment";
import { fetchPublishedPostRefs } from "@/lib/posts";

/**
 * M-15 sitemap: all locales × public routes, with hreflang alternates per
 * entry. Excluded by design: /legal/* (noindex until counsel-approved
 * content), /portal (auth-gated).
 * M-16: the eight /dispatch/[equipment] pages are included.
 * M-33: published blog posts, per their own locale only (posts are per-locale
 * documents — no hreflang alternates fabricated for missing translations).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes: string[] = [
    ...PUBLIC_ROUTES,
    ...EQUIPMENT_SLUGS.map((slug) => `/dispatch/${slug}`),
  ];

  const entries: MetadataRoute.Sitemap = [];
  for (const route of routes) {
    for (const locale of routing.locales) {
      entries.push({
        url: absoluteUrl(route, locale),
        lastModified: new Date(),
        changeFrequency: route === "/" ? "weekly" : "monthly",
        priority: route === "/" ? 1 : 0.7,
        alternates: { languages: languageAlternates(route) },
      });
    }
  }

  const posts = await fetchPublishedPostRefs();
  const locales = new Set<string>(routing.locales);
  for (const post of posts) {
    if (!locales.has(post.locale)) continue;
    entries.push({
      url: absoluteUrl(`/blog/${post.slug}`, post.locale),
      lastModified: new Date(post.updated_at),
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }
  return entries;
}
