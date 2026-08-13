import type { Metadata } from "next";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getV4 } from "@/i18n/v4-server";

/**
 * M-15 SEO helpers — canonical + hreflang alternates for every public page.
 * URLs come from next-intl's getPathname so the locale-prefix strategy
 * ("as-needed": en at /, others at /es/...) is encoded in exactly one place.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const SITE_NAME = "PickLoads Logistics Group";

/**
 * Public, indexable routes (per locale). M-16 appends /dispatch/[equipment];
 * M-35 appends /truck-dispatch/[state].
 *
 * The list itself moved to `@/lib/public-routes` so that pure data — which the
 * search index and the link-QA crawl both need — no longer drags the next-intl
 * navigation runtime in with it. Re-exported here because callers have
 * imported it from `@/lib/seo` since M-15.
 */
export { PUBLIC_ROUTES } from "@/lib/public-routes";

type Href = Parameters<typeof getPathname>[0]["href"];

export function absoluteUrl(href: Href, locale: string): string {
  return `${SITE_URL}${getPathname({ href, locale })}`;
}

/** hreflang map for one route: all 5 locales + x-default=en (arch §2). */
export function languageAlternates(href: Href): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of routing.locales) {
    languages[locale] = absoluteUrl(href, locale);
  }
  languages["x-default"] = absoluteUrl(href, routing.defaultLocale);
  return languages;
}

/**
 * M-90 — page metadata, localized.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────
 *
 * `canonical` and the hreflang set were per-locale from the start; `title`
 * and `description` were not. Every call site passed an English literal
 * straight through, so /fr/dispatch-services shipped a French page inside an
 * English `<title>`, an English `<meta name="description">` and English
 * Open Graph tags — the three fields a search engine and a shared link
 * actually display. The page told Google it had a French alternate and then
 * described that alternate in English.
 *
 * ── WHY THE BRIDGE AND NOT A NEW NAMESPACE ───────────────────────────────
 *
 * The strings resolve through `getV4()`, the same slug bridge the page bodies
 * use. Two reasons. The catalogue is where translators already work, so a
 * title lands in the same file as the H1 it echoes. And the bridge's fallback
 * is the English literal — which means the equipment and state pages, whose
 * `metaTitle`/`metaDescription` are long-form English from `src/content/*`
 * and are NOT translated yet (the O-03 workstream), keep working and keep
 * telling the truth about it. Nothing here fabricates a translation; it uses
 * one when the catalogue has one.
 *
 * ASYNC because `getTranslations` is. Call sites are already inside
 * `generateMetadata`, so this costs them an `await`.
 */
export async function pageMetadata({
  locale,
  href,
  title,
  description,
}: {
  locale: string;
  href: Href;
  title: string;
  description: string;
}): Promise<Metadata> {
  const canonical = absoluteUrl(href, locale);
  const tv = await getV4(locale);
  const localizedTitle = tv(title);
  const localizedDescription = tv(description);
  return {
    title: localizedTitle,
    description: localizedDescription,
    alternates: {
      canonical,
      languages: languageAlternates(href),
    },
    openGraph: {
      title: localizedTitle,
      description: localizedDescription,
      url: canonical,
      siteName: SITE_NAME,
      locale,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: localizedTitle,
      description: localizedDescription,
    },
  };
}
