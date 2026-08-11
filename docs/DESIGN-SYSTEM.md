# Design system

**Status:** audited and normalised in Phase B of the final website production
phase · **Source of visual truth:** `reference/pickloadssitev4.html` (the
approved V4 prototype, vendored byte-identical).

---

## 1 · The one rule

**The V4 prototype is the design. This document describes it; it does not
replace it.** Conversion, never redesign — the standing instruction in
`CLAUDE.md` and the reason the prototype is vendored into the repository rather
than referenced from a designer's machine.

Everything below is either a token extracted from V4, or an addition that had
to exist because V4 had no example of it (the five UI states) — never a
restyling of something V4 already answered.

## 2 · Where the styles live, and why it is three files

| File | Contents | Rule |
|---|---|---|
| `globals.css` | `@theme` tokens + the three imports | Tokens only |
| `v4.css` | The converted prototype | **Its two responsive blocks must stay LAST** |
| `website.css` | Phase B: grouped nav, footer columns, UI states | Imported after v4.css |
| `portal.css` | Authenticated surfaces | Restates colours for the dark surface |

**The ordering rule is load-bearing, not stylistic.** M-59 found that V4's two
`@media` blocks sat mid-file, before the section vocabularies they override. At
equal specificity the later rule wins, so every mobile rule was dead and every
page overflowed below 480px. They were moved verbatim to the end. Anything
appended to `v4.css` after them silently inherits that trap, which is why Phase
B additions live in their own file instead.

## 3 · Tokens

**Colour** — the V4 palette, unchanged: `asphalt`, `asphalt-2`, `paper`,
`amber`, `amber-deep`, `green`, `green-bright`, `steel`, `ink`, plus the named
secondaries (`night`, `mint`, `fog`, `fog-2`, `fog-3`, `cloud`, `slate-body`,
`slate-mid`, `slate-soft`, `gray-cool`, `gray-mid`, `dim`).

Two tokens exist **only** to fix contrast: `--color-amber-aa` (#8a5a00, 5.5:1
on paper) and `--color-slate-aa` (#5f6a71, 5.1:1). They are used where the V4
value fails WCAG AA **for text**, and nowhere else — the prototype's decorative
use of amber is untouched.

> **A Phase B lesson worth keeping.** The footer's staff link was first styled
> with `--color-dim` to make it secondary. axe caught a serious contrast
> failure on every page. **Low contrast is never the way to de-emphasise
> something** — it fails 1.4.3 whatever the intent, and it fails hardest for
> the people who most need the text readable. The link now carries the
> column's own colour and is set apart by a rule, a smaller size and being
> last. De-emphasise with hierarchy, position and weight; never with contrast.

**Type** — `--font-display` Overpass, `--font-sans` Barlow, `--font-mono` IBM
Plex Mono. Display for headings and nav, mono for eyebrows, labels, figures and
legal footnotes.

**Spacing and containers** — `.wrap` is the single container; sections use the
V4 rhythm (96px desktop → 64px ≤860px). No page defines its own container.

## 4 · Components

**Navigation** (Phase B). Five groups — Services, Carriers, Shippers,
Resources, Company — plus two utilities (Track Shipment, Login) and one primary
CTA (Request a Quote).

- Every **group header is a real link**, never a dead `<button>`. The nav works
  with JavaScript off and for anyone who tabs straight past the panel.
- Panels are **`display: none` when closed — both the panel and its anchors**.
  Hiding only the container leaves each anchor computing `display: block` with
  a 0×0 rect: a link that exists for assistive technology and for any
  measurement pass, but has no size. The certified responsive suite caught
  exactly that.
- Escape closes; outside click closes; route change closes.
- The **mobile drawer is flat with group headings**, not a nested accordion. On
  a 320px screen a two-level accordion costs a tap per destination and hides
  the thing the visitor came for.

**Footer** (Phase B). Seven columns from the shared IA, plus the brand block
and the SEO rows (13 equipment/state links kept — they point at real pages that
rank; dropping them for tidiness would trade acquisition for neatness).

**The five states** (`.state`, `website.css`). Loading, empty, error, success
and their light-surface variants, defined once. Before this each page invented
its own, which is how "no data" and "the query failed" end up looking
identical — a distinction M-74 went to real trouble to preserve
(`null` ≠ `0` on a dashboard tile).

## 5 · Information architecture

One definition: **`src/lib/site-nav.ts`**. The desktop bar, the mobile drawer
and the footer all read it. Three hard-coded lists were three chances to rename
a destination in two of them.

`tests/unit/site-nav.test.ts` (60 assertions) proves against the real app
directory that **every rendered link resolves to a route that exists** — and,
by its own non-vacuity case, that the check can fail. That case caught a bug in
the checker itself: the `[...rest]` catch-all made every conceivable href
"resolve", which would have made the whole file a test that could not fail.

Destinations that are scheduled but unbuilt (`carrier-resources`,
`knowledge-base`, `downloads`, `careers`, `partners`) are declared with
`ships: false` and **never rendered**. A nav entry pointing at a 404 advertises
a capability the business does not have — the same class of dishonesty as a
fabricated statistic. Each ships by flipping one boolean.

## 6 · Rules for every new component

1. **No new colours.** An existing token, or a literal already in `v4.css`.
2. **No page-local styling.** If two pages need it, it belongs in the system.
3. **Five states or it is not finished** — loading, empty, error, success,
   mobile.
4. **Keyboard first.** Focus visible, Escape dismisses, focus never trapped.
5. **State is text, never colour alone.**
6. **Every link goes in `site-nav.ts`** if it is navigation, so the
   link-integrity test covers it.
7. **12 breakpoints**: 320, 360, 375, 390, 414, 480, 768, 820, 1024, 1280,
   1440, 1920. No horizontal overflow at any of them — enforced in a real
   browser, not asserted in jsdom.
