import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing, type AppLocale } from "./routing";

/**
 * ── WHY THE CATALOGUES ARE LISTED AND NOT INTERPOLATED ───────────────────
 *
 * This was:
 *
 *     messages: (await import(`../../messages/${locale}.json`)).default
 *
 * which reads as five files and is not. A dynamic import whose specifier is a
 * template literal makes webpack build a CONTEXT MODULE: it cannot know which
 * locale will be requested, so it bundles **every** file matching
 * `../../messages/*.json` and picks one at runtime.
 *
 * `messages/` also holds `_key-index.json` — a 56 KB generated slug→English
 * map that `scripts/extract-i18n.mjs` writes and no application code reads.
 * It went into the server bundle with the rest, carrying the full pre-2026-08-12
 * wording: "24/7 Dispatch", "RATE IN 1 HOUR", "a dispatcher calls you back
 * within 15 minutes", "most carriers get their first load within 24 hours".
 *
 * None of it was reachable — the context module can only resolve a key the
 * runtime asks for, and `_key-index` is not a locale — so nothing rendered it.
 * That is the part worth being careful about: it was invisible on every page
 * and present in every deployment, which is the failure mode where "we removed
 * that claim" and "that claim is not in the artefact we ship" quietly stop
 * being the same statement. Anyone scanning the build for retired claims found
 * them.
 *
 * An explicit record fixes the class, not the instance. There is no context
 * module now, so a future file dropped into `messages/` cannot be swept into
 * the bundle by existing code, and `AppLocale` makes a missing locale a
 * compile error rather than a runtime 500.
 */
const CATALOGUES: Record<AppLocale, () => Promise<{ default: unknown }>> = {
  en: () => import("../../messages/en.json"),
  es: () => import("../../messages/es.json"),
  fr: () => import("../../messages/fr.json"),
  ru: () => import("../../messages/ru.json"),
  ht: () => import("../../messages/ht.json"),
};

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await CATALOGUES[locale]()).default as Record<string, unknown>,
  };
});
