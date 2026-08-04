# M-13b — i18n String Migration (completion)

**Status:** ✅ Complete · **Phase:** 1 · **Date:** 2026-08-04

## What was built
Finished the `useV4()` migration started in M-13 — every user-visible string in
the public site now resolves through the V4 dictionary bridge (audit U-08),
falling back to the English literal when a string was never in the prototype's
dictionary.

### Migrated in this module
- **Home sections:** HowAndCompare, EquipmentGrid, Industries, NewAuthority,
  Compliance, Packet (incl. both toast title/body pairs), ShippersTeaser.
- **Chrome:** Footer (headings, all link labels, brand line, legal links,
  copyright).
- **Interior pages:** about (rich paragraph via `useV4Rich` + `t.rich("rich_ab_p2")`),
  shippers, faq, blog, contact (office hours via `rich_ct_hours` with `<br>` tag),
  plus `not-found`.
- **Forms:** FreightQuoteForm (labels, placeholders that are prose, option
  labels — option **values** stay English so DB rows are locale-independent),
  NewsletterForm.

## How (patterns)
- **Async page + sync content component.** `useTranslations` (and therefore
  `useV4`) is illegal in *async* server components; each interior page keeps its
  async default export (`await params` → `setRequestLocale`) and renders a sync
  `XxxContent()` sibling where the hook is legal. No `"use client"` added.
- **`<select>` options** now carry explicit English `value` attributes with
  translated display text, so M-14's inserts store canonical English enums.
- **FAQ arrays moved** to `src/content/faq.ts` — Next.js forbids extra exports
  from `page.tsx`, and M-15's `FAQPage` JSON-LD needs the same arrays.
  Questions/answers still translate at render time through `tv()`.
- Prototype `// comment`-styled UI notes keep their literal `"// "` prefix
  outside the translated string (slugs strip punctuation, so the dictionary key
  is unaffected).

## DB changes
None.

## Endpoints
None.

## Env vars
None.

## Deployment
No new steps. All 59 static pages still prerender.

## Verification
typecheck ✓ · lint ✓ · build ✓ (59 static pages) · ES dictionary spot-check of
newly-wrapped keys (`carrier_onboarding`, `rich_ab_p2`, `rich_ct_hours`,
`verify_us_before_you_sign_we_insist`, …) ✓

## Extension points
- New UI strings: wrap the English literal in `tv()`; add the slugged key to
  `messages/*.json` (or extend `scripts/extract-i18n.mjs`) for translations —
  untranslated strings render English, never raw keys.
- RU/HT native review remains an external dependency (arch §9).
