import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { absoluteUrl, languageAlternates, PUBLIC_ROUTES } from "@/lib/seo";
import { EQUIPMENT_SLUGS } from "@/content/equipment";

/**
 * M-15 sitemap: all locales × public routes, with hreflang alternates per
 * entry. Excluded by design: /legal/* (noindex until counsel-approved
 * content), /portal (auth-gated), sample-content blog posts (none routed).
 * M-16: the eight /dispatch/[equipment] pages are included.
 */
export default function sitemap(): MetadataRoute.Sitemap {
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
  return entries;
}
