# M-15 — SEO & Analytics

**Status:** ✅ Complete · **Phase:** 1 · **Date:** 2026-08-04

## What was built
- **Per-page metadata** — every public page (home, about, shippers, faq, blog,
  contact) exports `generateMetadata` built by `pageMetadata()`
  (`src/lib/seo.ts`): canonical URL from `NEXT_PUBLIC_SITE_URL`, hreflang
  alternates for all 5 locales + `x-default=en`, OpenGraph + Twitter cards.
  URLs come from next-intl's `getPathname`, so the `as-needed` prefix strategy
  lives in exactly one place. `metadataBase` set in the locale layout.
- **JSON-LD** (`src/lib/jsonld.ts` + `src/components/seo/JsonLd.tsx`):
  - Home: `LocalBusiness` (50 Union Ave Suite 805-A, Irvington NJ 07111,
    +19084045373, V4 opening hours) + two `Service` nodes (dispatch,
    brokerage) in one `@graph`.
  - /faq: `FAQPage` generated from the same typed arrays that render the page
    (`src/content/faq.ts`), localized per locale through the new **server-side
    V4 bridge** `getV4()` (`src/i18n/v4-server.ts` — usable in async RSC /
    generateMetadata where hooks are illegal).
  - `equipmentServiceJsonLd()` ready for M-16.
  - Injector escapes `<` → `<`; data is typed-literal-only.
- **`src/app/sitemap.ts`** — all locales × public routes with per-entry
  hreflang alternates. Excluded: `/legal/*` (noindex shells), `/portal`,
  sample blog posts. M-16 appends `/dispatch/[equipment]`.
- **`src/app/robots.ts`** — blocks `/portal` and `/api`, points at the sitemap.
- **Middleware fix** — the intl matcher now excludes `robots.txt`/`sitemap.xml`
  (they were being locale-rewritten into 404s).
- **Consent-gated GA4** (audit S-05) —
  `src/components/analytics/ConsentAnalytics.tsx` mounted in the `(site)`
  layout: V4-styled bottom consent bar (`.consentbar` in v4.css — U-03-style
  derivation from existing tokens only: asphalt2 surface, amber accents,
  `.btn` vocabulary). gtag loads **only after Accept** and only when
  `NEXT_PUBLIC_GA4_MEASUREMENT_ID` is set; choice persists in the `pl_consent`
  **cookie** (12 months, SameSite=Lax, Secure on https — cookie not
  localStorage so server code can read it for Meta Pixel/Phase 3). No GA id →
  no banner (no non-essential cookies exist to consent to). Decline → nothing
  ever loads. `anonymize_ip` on.

## DB changes
None.

## Endpoints
`/robots.txt`, `/sitemap.xml` (both static).

## Env vars
`NEXT_PUBLIC_SITE_URL` (canonical base — REQUIRED in production, falls back to
localhost), `NEXT_PUBLIC_GA4_MEASUREMENT_ID` (optional; absent = no analytics,
no banner).

## Deviations / judgment calls
- Meta titles/descriptions are English for all locales for now — the V4
  dictionary never contained meta copy, and RU/HT review is pending (arch §9).
  hreflang/canonicals are fully locale-correct; translated meta drops into the
  same `pageMetadata` calls later.
- No OG image yet (no approved brand asset exists); `twitter: summary`.
  Launch-checklist item: add `opengraph-image` after the photo shoot.

## Verification
typecheck ✓ · lint ✓ · build ✓ (62 routes incl. robots/sitemap) · smoke on
`next start`: robots.txt correct, sitemap has 5-locale alternates, /es/faq
serves FAQPage JSON-LD with Spanish Q/A, home serves LocalBusiness, /es/about
head carries 6 hreflang links ✓

## Extension points
- M-16: push equipment routes into `PUBLIC_ROUTES`-adjacent sitemap list + per
  page Service JSON-LD (builder ready).
- Search Console verification: DNS TXT (ops task, no code).
- Meta Pixel (Phase 3): read `pl_consent` cookie before injecting.
