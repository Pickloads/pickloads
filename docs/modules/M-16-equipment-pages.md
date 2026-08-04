# M-16 — Equipment Pages (/dispatch/[equipment])

**Status:** ✅ Complete (all 8 written) · **Phase:** 1 · **Date:** 2026-08-04

## What was built
Eight statically-generated equipment landing pages (arch §8 SEO plan; audit
F-10 route mapping) for the slugs already linked from EquipmentGrid and the
footer: `dry-van`, `reefer`, `flatbed`, `step-deck`, `power-only`, `hot-shot`,
`box-truck`, `sprinter-van`. The arch's minimum was template + 2 exemplars;
all 8 shipped with real content (625–668 words each, measured on rendered
main content).

## Content model — typed TS module (decision)
`src/content/equipment.ts`, **chosen over MDX**: the template needs structured
fields (lane nodes, requirements list, FAQ tuples) that a typed object gives
for free; JSON-LD, sitemap and the page import from the same source; and no
MDX pipeline enters the bundle. Interface: slug/code/name, metaTitle/
metaDescription, heroLead, introHeading, intro[] (3 paragraphs), ratesNote
(mono, explicitly labeled estimates), lanesTitle + lanes[] (flow nodes),
requirementsHeading + requirements[], faq (4 Q/A), blurb (JSON-LD).

Content notes: original trucking-accurate copy — equipment specs (53' van
payload/pallet math, reefer setpoints + FSMA, flatbed 393 securement + tarp
pay, step-deck ~10' legal height, power-only interchange/non-owned coverage,
hot-shot 26,001-lb GCWR/CDL line, box-truck 26K GVWR non-CDL ceiling, sprinter
expedite response times) and 2026-realistic spot ranges, hedged as estimates.
Fees match the published FAQ tiers (5% / 4.5% fleet / 8% box truck & hot shot).

## Template (V4 vocabulary only)
`src/app/[locale]/(site)/dispatch/[equipment]/page.tsx`:
PageHero (eyebrow = tv("Equipment we dispatch") · EQ-0X, H1 = tv(card title —
in the V4 dictionary, so it localizes) → dark section with `.about-grid`
(`.story` intro paragraphs + `.svc dispatch` requirements card with the "›"
list and `.soon` disclaimer) → `.flow` typical-lanes track (hot nodes amber) →
`.light` FAQ section reusing the global `details/summary` accordion →
`CtaBand`. Zero new CSS.

- `generateStaticParams`: 5 locales × 8 slugs (40 pages), `dynamicParams =
  false` → unknown slugs 404.
- Per-page `generateMetadata` via M-15's `pageMetadata` (canonical + hreflang).
- Per-page `Service` JSON-LD via `equipmentServiceJsonLd()` (provider →
  LocalBusiness @id).
- Sitemap now includes all 8 routes × 5 locales.

## DB changes / Endpoints / Env vars
None / none / none.

## Deviations / judgment calls
- Long-form body content is English on all locales for now — it never existed
  in the V4 dictionary and RU/HT translation is the O-03 content workstream
  (arch §9). Chrome (H1, eyebrows, FAQ heading, CTA band) localizes via the
  V4 bridge. Translations slot into the same module (or a per-locale variant)
  without touching the template.
- Lane examples are Northeast-based plans consistent with the NJ home base —
  presented as "typical flow", not live data (no S-07-style fabricated rates;
  the only numbers are hedged market ranges in a `// estimates` mono note).

## Verification
typecheck ✓ · lint ✓ · build ✓ (102 static pages) · smoke on `next start`:
all 8 pages HTTP 200 with 625–668 words, /es variant 200 with localized H1,
Service JSON-LD present, `/dispatch/unknown` → 404, sitemap contains the
equipment URLs ✓

## Extension points
- M-35 state pages: same pattern (typed content module + template).
- Translated content: extend `EQUIPMENT_CONTENT` per locale and select by
  `params.locale` in the page — the template already receives locale.
- Real lane data (Phase 3): swap the static lanes array for anonymized booked
  loads per equipment type.
