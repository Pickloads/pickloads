import type { Metadata } from "next";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

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
 */
export { PUBLIC_ROUTES } from "@/lib/public-routes";
import { PUBLIC_ROUTES } from "@/lib/public-routes";

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

export function pageMetadata({
  locale,
  href,
  title,
  description,
}: {
  locale: string;
  href: Href;
  title: string;
  description: string;
}): Metadata {
  const canonical = absoluteUrl(href, locale);
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: languageAlternates(href),
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      locale,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}
