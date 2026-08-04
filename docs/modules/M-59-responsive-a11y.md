# M-59 — Responsive + Accessibility Overhaul

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

Full-surface audit (public site, auth pages, all three portals) at
320/360/375/390/414/480/768/820/1024/1280/1440/1920 px using headless-Chromium
screenshots + a DOM overflow detector against the production build, plus an
axe-core WCAG 2.2 A/AA scan wired into the e2e suite. Everything found was
fixed; the suite now enforces it.

## What the audit found (and fixed)

| Finding | Fix |
|---|---|
| **The V4 responsive blocks were dead.** `@media(max-width:960px)`/`520px` sat mid-file in `v4.css`, *before* the section vocabularies they override (`.foot-grid`, `.about-grid`, `.contact-grid`, `.faq-cols`, `.blog-grid`, `.ship-why`, `.values`, `.bigform` grids). Equal specificity + later position → desktop rules always won; every public page overflowed 187–347 px at ≤480 px. | Blocks moved **verbatim** to the end of `v4.css` (values untouched — still pixel-faithful; only cascade position changed). |
| Topbar right cluster (email + 2 login links + lang select) was ~410 px wide — horizontal scroll on every page at ≤414 px. | ≤700 px the mail/login links hide (`.tb-hide`; all three remain reachable via mobile menu/footer/nav) and the bar wraps. Specificity note: the rule is `.topbar .tb-hide` so it beats the new `.topbar a{display:inline-block}` tap-target rule. |
| `.socials` row (contact page) had no `flex-wrap` → forced `.c-card` min-content ≈ 480 px. | `flex-wrap:wrap` added. |
| Portal sidebar ≤860 px collapsed to a wrapped row — unusable with the 11-item customer navs. | **Off-canvas drawer**: sticky `.pmobilebar` (logo + `☰ Menu` toggle), `.pside` becomes a fixed 300 px drawer with backdrop. Focus management: open → focus moves into the drawer; Escape/backdrop/close-button → closes and returns focus to the toggle; route change closes. `aria-expanded`/`aria-controls`, `aria-label`, `aria-current="page"` on the active item. |
| `.ptable` had no <640 px strategy. | **Selective table→card transform** (`.ptable--cards` + per-cell `data-th` labels, CSS-only) on the customer-facing tables: carrier loads, invoices, documents, trucks, drivers, shipper quotes. Staff tables (admin loads/users/security/support) keep the controlled `.ptable-wrap` local horizontal scroll — dense scan-across data staff use on desktop. |
| Tap targets <24–44 px (topbar links, portal nav, `.btn-sm`, table links). | Topbar links get ≥24 px hit areas everywhere; `@media(pointer:coarse)` bumps portal nav items, mobile-menu links, `.langsel`, `.menu-btn`, `.btn-sm`, table links to ≥44 px. |
| Forms: `.pform-row`/`.bigform` grids single-column ≤640/520 px — re-verified after the cascade fix (the `.bigform .grid2/.grid3` overrides were among the dead rules). | Works as designed now. |

## WCAG 2.2 AA

- **Skip link (2.4.1):** `SkipLink` component (first focusable, `.skip-link`
  amber-on-ink, visible on focus) in all three layouts; every `page.tsx`
  `<main>` now carries `id="main"`.
- **Contrast (1.4.3) — Q7 completed.** M-00 promised `*-aa` token variants
  and never created them; axe flagged real failures. New tokens in
  `globals.css`: `--color-amber-aa: #8a5a00` (5.5:1 on paper — replaces
  amber-deep for *text* on light: `.light .eyebrow`, `.step .t`, `.plan .per`,
  `.value .v-mark`, `.faq-col h3`, auth-form links; decorative bars keep
  amber-deep) and `--color-slate-aa: #5f6a71` (5.1:1 — replaces `#8a949b`
  text on light: `.compare th.them`, `.plan .price small`, `.pricing-note`,
  light upload notes). Dim mono text on dark (`#5c666d`/`--color-dim`, 3.1:1)
  → `--color-steel` (6.9:1) in `v4.css`, `portal.css` and inline styles.
  `.foot-bottom` `#6a747b` (4.05:1) → steel. Wizard's dimmed future steps
  `opacity:.45` (blended ≈2.1–2.7:1) → `.85` (all blends ≥5:1; current/done
  emphasis stays via border + badge color).
- **Keyboard (2.1.1):** `.flow` scrollable process strips get
  `tabIndex={0} role="region" aria-label` (axe `scrollable-region-focusable`).
- **Focus management (2.4.3):** wizard step changes move focus to the new
  panel's heading; drawer as above.
- **Status messages (4.1.3):** verified — every async form renders
  `role="status"` / `role="alert"` on `.form-ok`/`.form-err` (38 portal +
  all auth/public instances, pre-existing).
- **Reduced motion (2.3.3):** ticker was done (M-10); added coverage for
  `.btn`/`.eq-card`/`.post` hover transforms, the pulse dot, smooth scroll,
  and the portal drawer transition.
- **Decorative glyphs:** remaining unwrapped ☎/✉ (footer, call FAB, kanban,
  lead detail) wrapped in `aria-hidden` spans. The topbar phone glyph lives
  inside a dictionary string (key change would orphan 4 translations) — left,
  it reads as "phone" which is the link's meaning.
- **Heading hierarchy:** verified per page — exactly one `h1`, first heading
  is the `h1`. Footer nav uses `h4` and cards use `h3` inside labelled
  regions (level skips are an axe *best-practice* note, not a WCAG A/AA
  failure; the AA-tagged scan is clean).
- **Modals:** none exist app-wide (verified); `PortalToast` is
  `role="status"` with `max-width:90vw`.

## Enforcement (new e2e)

`tests/e2e/axe.spec.ts` (+ dev-dep `@axe-core/playwright`):
- axe scan (`wcag2a/2aa/21a/21aa/22aa` tags) over 16 public/auth pages +
  `/portal` selection — **zero violations allowed**;
- skip-link-is-first-focusable assertion;
- no-horizontal-overflow assertion at 320 px on 5 representative pages.

Portal-internal pages sit behind a real Supabase session and can't be scanned
in the secretless lane; they were audited via a static harness (real built
CSS + representative portal DOM: drawer, card tables, forms at 320–1440 px,
zero overflow) and share the scanned vocabulary. Documented limitation.

## Files

- `src/app/v4.css` (blocks moved + M-59 token-only additions),
  `src/app/globals.css` (2 `*-aa` tokens), `src/app/portal.css` (drawer,
  card tables, tap targets, steel sweep)
- `src/components/ui/SkipLink.tsx` (new), layouts ×3, `PortalSidebar.tsx`
  (drawer rewrite), `Topbar.tsx`, `CarrierWizard.tsx` (step focus),
  `NewAuthority/ServicesSplit/shippers` (`.flow` focusable), table pages/
  components (`data-th`), auth forms + legal (amber-aa), emoji wraps
- `scripts/extract-i18n.mjs` +5 supplemental strings (es/fr authored; ru/ht
  mirror en per M-42 precedent) → 683×5 messages
- `tests/e2e/axe.spec.ts` (new, 18 tests)

No DB or env changes. Gate: typecheck · lint · build · 131 unit · 37 e2e ✓.

## Extension points

- New portal tables: add `.ptable--cards` + `data-th` for customer surfaces,
  plain `.ptable` (wrap-scroll) for staff density.
- New text colors: check contrast first; use `--color-amber-aa` /
  `--color-slate-aa` / `--color-steel` on the failing side.
- Add new pages to the axe + overflow lists in `tests/e2e/axe.spec.ts`.
