# M-10/M-11 — V4 Component Library & Home Page

**Status:** ✅ Complete (visual diff vs prototype: pass) · **Phase:** 1 · **Date:** 2026-08-04

## What was built
- `src/app/v4.css` — the prototype's component stylesheet ported verbatim, with V4 variable names aliased to the `@theme` tokens (single source). Additions beyond V4 are tagged inline: U-03 error/loading form states, footer port, reconstructed pricing styles (F-01/Q2).
- Fonts vendored (`src/fonts/*.woff2`, SIL OFL) + `next/font/local` — Google Fonts was unreachable at build time; vendoring gives identical rendering with zero network dependency at build or runtime.
- Layout: `Topbar`, `SiteNav` (client: mobile menu, active states, real `<Link>` routes — fixes audit U-01), `Footer`, `CallFab`, `PortalToast` + `ComingSoonLink` (V4's intentional "coming soon" behavior for portal links, F-02).
- Sections (V4 order preserved): Hero, LoadTicker (sample lanes, `aria` marked, S-07 note), QuickQuote (U-02 label association; submit wiring lands in M-14), ServicesSplit, HowAndCompare, EquipmentGrid (links to M-16 routes), Industries, BoardsStrip, WhyStats, **Pricing (reconstructed, Q2)**, ShippersTeaser, NewAuthority, Compliance, Packet (inert downloads with honest toast until legal PDFs exist — U-09), CtaBand.
- `src/app/page.tsx` — home assembly. Moves to `[locale]/page.tsx` in M-13.

## Two content deviations from V4 — flagged for owner sign-off
1. **Stats tile:** V4's `$2.90 Avg rate/mile*` carried the prototype's own note "Placeholder figures — replace with verifiable numbers before production launch" (F-13). Replaced with the verifiable `15min · Callback promise` tile. Revert = one line in `WhyStats.tsx`; becomes `company_settings`-driven in M-14.
2. **Testimonials:** omitted at launch per the prototype's embedded note + arch §9 ("removed, not replaced by fake"). Component returns behind the `testimonials_visible` setting once 5+ verified reviews exist.

## Verification
typecheck ✓ · lint ✓ · build ✓ (home static, 109 kB first load) · full-page screenshot diff vs `pickloadssitev4.html` at 1440px & 390px ✓ · npm audit 0 ✓

## Extension points
Every section is a server component except QuickQuote/Packet (interactivity). M-14 wires forms + settings; M-13 replaces hardcoded strings with next-intl messages extracted from the V4 dictionary.
