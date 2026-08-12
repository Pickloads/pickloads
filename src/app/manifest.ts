import type { MetadataRoute } from "next";

/**
 * PWA manifest.
 *
 * ── ROUTING ──────────────────────────────────────────────────────────────
 *
 * `src/app/manifest.ts` serves `/manifest.webmanifest` at the ROOT, outside
 * `[locale]`. That matters here: this app has no `src/app/layout.tsx` — the
 * locale layout is the root layout — so every other page lives under a locale
 * segment. The manifest must not, because an installed app has one identity,
 * not five.
 *
 * The next-intl middleware rewrites unmatched paths into `/[locale]/…`, which
 * would turn this into `/en/manifest.webmanifest` and 404. `robots.txt` and
 * `sitemap.xml` were already excluded from the matcher for exactly that reason
 * (M-15); the manifest joins them.
 *
 * ── NO SERVICE WORKER, DELIBERATELY ──────────────────────────────────────
 *
 * The directive is explicit that a valid installable manifest plus safe public
 * behaviour beats an over-engineered cache, and on this platform that is not a
 * close call. Every screen worth caching is one that must not be cached:
 * shipment detail, the driver-token page, documents, invoices, carrier and
 * shipper records, the tracking result. A worker caching "the app" would put
 * freight and identity data in a store that outlives the session, survives
 * sign-out, and is readable by anything with the device profile.
 *
 * The only safe alternative — an allow-list narrow enough to cover the
 * marketing shell and nothing else — duplicates what the CDN already does,
 * while adding a cache-invalidation problem and an offline surface to audit.
 *
 * If one is ever wanted the rule is: PUBLIC routes by explicit allow-list
 * only, never a runtime-caching default, and never `/portal/*`, `/api/*`,
 * `/driver/*` or a tracking result.
 *
 * ── ICONS ────────────────────────────────────────────────────────────────
 *
 * `public/` holds only the Next.js starter SVGs — no PickLoads mark in any
 * raster size. Referencing files that do not exist produces a manifest that
 * fails installation and shows a broken tile in the OS app list, so **no
 * `icons` array is declared**. A manifest without icons is degraded but valid;
 * one pointing at 404s is worse than none, and inventing a logo is not
 * engineering's call. Recorded as EXTERNAL/BRAND ASSET REQUIRED.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PickLoads Logistics Group",
    short_name: "PickLoads",
    description:
      "Truck dispatching and freight brokerage for owner-operators, small fleets and shippers.",
    // Public entry point, never a portal route: an installed app must not open
    // on a page that immediately bounces to /login.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // V4's asphalt, so the OS splash and task-switcher card match the site
    // instead of flashing white. This is where the dark identity belongs —
    // a global CSS `color-scheme` was measured and breaks the light sections.
    background_color: "#12161a",
    theme_color: "#12161a",
    lang: "en",
    dir: "ltr",
    categories: ["business", "productivity"],
  };
}
