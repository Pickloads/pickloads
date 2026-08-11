# M-82 — Responsive + Accessibility QA for the Tracking Surfaces

**Status:** ✅ Complete · **Phase:** C (tracking completion) · **Date:** 2026-08-09
**Spec:** `docs/DIRECTIVE-tracking.md` §22 (responsive) + §23 (accessibility)
**Plan:** `docs/FINAL-IMPLEMENTATION-PLAN.md` §7 M-82, and §4's restored row
*"§22 — 12 breakpoints (audit reused the existing 7) — UNJUSTIFIED, unstated"*

---

## 1. What this module is

A **QA and remediation** module, not a feature module. No route, no table, no
migration, no environment variable, no new customer-visible capability. What
it adds is a measurement apparatus and the twelve defects that apparatus
found in M-73 → M-81's already-"green" work.

The restored plan row is the reason it exists. §22 names twelve widths;
`tests/e2e/responsive.spec.ts` used seven, and the plan records that reduction
as an **unstated downgrade**. Closing it turned out to matter less for the five
extra pixel counts than for what auditing *at all twelve, in a browser, over
the real stylesheets* exposed.

### 1.1 The root cause of every defect below

M-73 → M-81 each scanned their surfaces with **axe-core inside jsdom**. That
was a reasonable choice — those routes sit behind a Supabase session the
secretless e2e lane cannot mint — and it proved a great deal: roles, names,
labels, headings, landmark structure, five-locale catalogues.

**jsdom applies no stylesheet.** Nothing has a width, nothing scrolls, nothing
has a computed colour. So for a module whose entire brief is *twelve viewport
widths, horizontal overflow, clipped content, touch-target geometry,
date-input intrinsic width, oversized maps* — none of it was observable, and
six consecutive modules shipped an honest note saying layout was unproven.

M-82's central move is a **browser harness**: the a11y suites already render
every surface in every state from the real components; they now also write
that DOM to disk, and a Playwright suite loads each file into Chromium behind
the stylesheets the running server actually links, at all twelve widths.

Same markup. Same CSS. Real layout engine. Twelve of the defects in §3 were
invisible before that and obvious after it.

---

## 2. What was audited

### 2.1 Breakpoint × surface matrix

§22's twelve widths, verbatim: **320 · 360 · 375 · 390 · 414 · 480 · 768 ·
820 · 1024 · 1280 · 1440 · 1920**.

`L` = full layout probe (all eleven §22 prohibitions + priority order) at all
twelve widths. `A` = axe WCAG 2.2 A/AA at 320 / 768 / 1440.

| Surface (module) | Fixture states | 320–480 | 768–820 | 1024–1920 | axe |
|---|---|---|---|---|---|
| **`/track` lookup** (M-73) — *live route* | en + es | L | L | L | A ×5 locales |
| **`/track` result** (M-73) | populated · exception · cancelled · delayed · empty | L | L | L | A |
| **`/track` error state** (M-73) | failed lookup, driven by a real submit | — | — | — | A |
| **Shipper dashboard tiles** (M-74) | populated | L | L | L | A |
| **Shipper list** (M-74) | populated · empty · failed | L | L | L | A |
| **Shipper detail** (M-74/77/78/80) | populated · exception · degraded | L | L | L | A |
| **Dispatcher board** (M-75) | populated · empty · failed | L | L | L | A |
| **Dispatcher search** (M-75, §5) | exact hit, scoped dispatcher | L | L | L | A |
| **Dispatcher column** (M-75) | paginated | L | L | L | A |
| **Dispatcher create / quote convert** (M-75, §14) | open brokerage | L | L | L | A |
| **Dispatcher detail** (M-75, admin tracking screen) | full action set | L | L | L | A |
| **Carrier list** (M-76) | populated | L | L | L | A |
| **Carrier detail** (M-76/77) | full · no offered actions | L | L | L | A |
| **`/driver/update/[token]`** (M-76) — *live route* | granted · expired | L | L | L | A ×5 locales |
| **Broker list** (M-81) | populated | L | L | L | A |
| **Broker detail** (M-81) | populated | L | L | L | A |
| **Map + accessible alternative** (M-80) | mounted · text-only | L | L | L | A |

**29 surface-states.** `tests/e2e/tracking-responsive-a11y.spec.ts`, 70 tests.

### 2.2 Documented sampling — what was NOT run everywhere, and why

12 widths × 29 states × (probe + axe) is ≈ 700 axe runs and about half an
hour. The split is stated rather than silently taken:

* **Layout probes run at all twelve widths on every state.** That is §22's
  actual subject and it is not sampled.
* **axe runs at 320 / 768 / 1440.** Those are the three *arrangements* the
  stylesheets produce — below `640px` the card-table transform is on and the
  portal drawer is off-canvas; `641–860px` is the drawer-without-cards tier;
  above that is desktop. The other nine widths render one of those three, and
  axe's only viewport-sensitive rules (`target-size`, `color-contrast`) depend
  on the arrangement, not the pixel count. **The layout probe, which does run
  at all twelve, is what proves no fourth arrangement exists** — if a width
  produced a new layout, its overflow/clip/target geometry would differ and
  the probe would say so.

Runtime: **1.9 min** for the tracking suite (plus ~28 s of fixture
regeneration in `globalSetup`); **5.9 min** for the whole Playwright run.

### 2.3 The eleven §22 prohibitions, each as an assertion

| §22 prohibition | How it is measured |
|---|---|
| no horizontal page overflow | `documentElement.scrollWidth − clientWidth ≤ 1`, with the widest offenders named in the failure message |
| no clipped timeline | every visible box with `overflow:hidden/clip` whose `scrollHeight/Width` exceeds its client box |
| no unreadable shipment table | every `<table>` must be either `.ptable--cards` with a `data-th` on **every** body cell, or inside a scroll container that is keyboard reachable |
| no oversized map | `.shipmap` ≤ its container's width, ≤ 320 px tall, ≤ 60 % of viewport height |
| no form control outside viewport | no visible element's right edge past the viewport unless a scrolling **or clipping** ancestor contains it |
| no hidden actions | the multiset of reachable controls at 1920 px must survive every narrower width (fixtures); on live routes, the **set of destinations**, with the mobile drawer opened |
| no hover-only interactions | a CSS audit: every `:hover` rule that *reveals* (`display`/`visibility`/`opacity ≥ 1`/`content`) must have a `:focus`/`:focus-visible`/`:focus-within` twin |
| no tiny touch targets | ≥ 24×24 (WCAG 2.2 AA 2.5.8) for every control and block-level link; checkbox/radio may take their label's box, whether the label wraps or uses `for=` |
| no fixed-height card cutting content | same probe as "clipped timeline" |
| no mobile modal exceeding screen | every `dialog`/`role=dialog`/`role=alertdialog` inside the viewport |
| no iOS date-input overflow | every date/time input: `border-box`, ≥ 16 px font (Safari's zoom trigger), inside its container, not narrower than its own control content |

### 2.4 §22's mobile priority order

**status → ETA → origin/destination → timeline → support → documents → map.**

Each slot carries a `data-prio` marker in the markup, and the suite asserts
the DOM order of those markers matches §22's list at **all twelve widths** on
the public result and the shipper detail. Two of them were in the wrong place
(D-12 below).

`data-prio` is a marker, not a mechanism — the layout is unchanged; the
attribute exists so the requirement is *checkable* instead of inferred from
reading the file, which is what let the map drift above support unnoticed.

### 2.5 §23, requirement by requirement

| §23 requirement | Where it is proved |
|---|---|
| semantic timeline markup | `TrackingTimeline` `<ol>` + `<time datetime>`, pinned by M-73's suite and re-scanned here under real CSS |
| **text equivalent for the visual timeline** | M-73's `role="status"` textual summary — asserted present on the public result, the shipper detail, the carrier detail and the broker detail, i.e. *every* surface that renders a timeline |
| text labels in addition to status colours | no `.track-status` / `.pbadge` / `.track-step .st` / `[class*=kprio-]` may be empty of text — checked on 7 states |
| keyboard-accessible filters | every control in every `<form>` on the shipper list (§11's nine filters), the dispatcher board, the carrier list and the broker list: `tabIndex ≥ 0` and labelled |
| accessible map alternative | mounted: `role="img"` + resolvable `aria-labelledby`; unmounted: a **visible** `<ol class="shipmap-list">` with `<time datetime>` and a place per reading, plus a live summary |
| focus-visible controls | a focused control must compute a non-`none` outline of non-zero width |
| correct headings | ≤ one `<h1>` per surface and no skipped level, on all 29 states |
| accessible date/time formatting | `<time datetime>` machine-readable + localized text (M-73/M-78; re-asserted in the map alternative) |
| `aria-live` where status changes | live region required on the result, the list count, the location summary, the board, the failed board, the failed list and the driver form |
| no critical info on hover only | the CSS `:hover`/`:focus` audit above |
| reduced motion | under `prefers-reduced-motion: reduce`, **no** visible element may have a running animation or a non-zero transition duration |
| meaningful document labels | every document row carries `data-doc-type` and a label longer than a bare file name, on shipper / carrier / broker detail |
| accessible error and empty states | six degraded states must each contain a non-empty `role="status"`/`role="alert"` |

---

## 3. Defects found and fixed

Twelve. Each was measured, not inferred; each failure message is reproducible
by reverting the fix.

| # | §/WCAG | Surface | Defect | Fix |
|---|---|---|---|---|
| **D-1** | §22 *"no iOS date-input overflow"* | shipper list, dispatcher board, dispatcher create, carrier detail | `.field` controls render at `.94rem` = **15.04 px**. iOS Safari zooms the page when a focused field's text is under 16 px, and a zoomed page scrolls sideways — which is precisely the named prohibition. M-76 set 16 px on the driver page (`.driver-field`) for exactly this reason; the shared vocabulary never did. | `v4.css`: 16 px for all `.field` controls ≤ 820 px, and **unconditionally** for `date`/`datetime-local`/`time`/`month` |
| **D-2** | §22 *"no horizontal page overflow"* | dispatcher detail, shipper/carrier/broker detail | M-59's card transform turned `tr` into a block and `td` into a flex row but left `table` and `tbody` as table boxes, so the table kept **table min-content sizing**: the widest `label + gap + unbreakable cell` set a floor no viewport could push below — 371 px on the documents table, 395 px on the dispatcher detail, i.e. **36–75 px of page overflow at 320 px**. The transform never actually shrank the table. | `portal.css`: `display:block` on the table and tbody inside the `≤640px` block, `min-width:0` + `overflow-wrap:anywhere` on cells and labels |
| **D-3** | §22 *"no form controls outside viewport"* · 2.5.8 | carrier / broker / staff document upload | `.pform-row` lays out a grid but styles **no controls**, so the upload inputs are user-agent defaults: `input[type=file]` takes its intrinsic ~356 px and pushes the page 36 px wide at 320 px; the `Document type` select renders **22 px** tall. | `portal.css`: `max-width:100%; min-width:0; box-sizing:border-box` on `.pform-row` controls, 16 px font, `min-height:32px`, `width:100%` on file inputs |
| **D-4** | §22 *"no horizontal page overflow"* | broker detail, and any surface with operator free text | `.track-events .msg` carries §24's dispatcher-authored text, which is not guaranteed to contain a space. 335 px of it overflowed by 15 px. | `v4.css`: `overflow-wrap:anywhere`, the treatment `.track-summary dd` already had |
| **D-5** | WCAG 2.2 AA **2.5.8** | dispatcher column, carrier list, every card-table pager | `.psh-pager` links measure **46×19 / 42×19** — under the 24×24 minimum at *every* viewport, not only on touch devices. Same class of miss as M-80's `.langsel` finding. | `portal.css`: `.psh-pager a{display:inline-flex;align-items:center;min-height:24px}` |
| **D-6** | §23 *"keyboard-accessible"* · WCAG **2.1.1** | dispatcher detail (provider + exception tables), dispatcher board when empty/failed | `.ptable-wrap` and `.kanban` scroll horizontally. When their contents hold no focusable element — the provider-adapter table is four rows of env-var names, the exception table likewise, an empty board has no cards — **a keyboard user cannot scroll them at all**. axe: `scrollable-region-focusable`, *serious*. Invisible in jsdom because nothing there ever scrolls. | New `ScrollRegion` component (`tabIndex={0}` + `role="region"` + `aria-label`, M-59's `.flow` pattern) at all 12 tracking scroll containers; `:focus-visible` ring in `portal.css` |
| **D-7** | §23 *"correct headings"* | dispatcher board | Column headings were `<h3>` directly under the page `<h1>` — a skipped level — while the **expanded single-column view rendered the same thing as an `<h2>`**. axe's `heading-order` is tagged best-practice, not WCAG A/AA, which is why six modules of scanning never reported it. | `<h2>` in `ShipmentBoardView`, matching `.kcol h2` rule; the unit assertion updated with the reason |
| **D-8** | §22 *"no horizontal page overflow"* | dispatcher detail (driver-link + provider tables) | `.sr-only` is `position:absolute`; `.ptable-wrap` is `overflow-x:auto` but was **not positioned**, so it never became a containing block. The hidden "Revoke" / "Action" column labels resolved against the *initial* containing block, landed at x = 346 on a 320 px screen and pushed the document **27 px** wide — a real scrollbar produced entirely by text nobody can see. `overflow` clips in-flow content; it does not clip an absolutely positioned descendant whose containing block sits outside the scroller. | `portal.css`: `.ptable-wrap,.kanban{position:relative}` |
| **D-9** | §23 *"status changes announced with aria-live"* | `/driver/update/[token]` | The `role="alert"` / `role="status"` paragraphs were **mounted at the same moment their text arrived**. A live region must be in the accessibility tree *before* its contents change; a region and its text inserted in one mutation is the commonest way an announcement is silently dropped, and it fails differently on each screen reader. M-73's public forms already had the correct shape (region always present, `.show` toggles) — the driver page was the outlier, on the one surface whose entire purpose is a confirmation to someone who cannot look at the screen. | Permanent `role="alert"` / `role="status"` wrappers; only the inner paragraph is conditional |
| **D-10** | §22 *"no hidden actions"* | every page ≤ 960 px, tracking pages included | `Start Carrier Setup` → `/#quote` lives in `.nav-cta`, which v4.css hides at ≤ 960 px. Every other collapsing control has a drawer or footer equivalent **by destination**; this one had neither, so on every phone-width page the primary carrier call to action was simply unreachable. | One `MOBILE_LINKS` entry in `SiteNav`, reusing the label already in the v4 dictionary — no new string, no translation debt |
| **D-11** | WCAG 2.2 AA **2.5.8** / rendering | dispatcher update + exception forms, location-visibility radios, staff document upload | Two mechanisms, one symptom. (a) `.field input{width:100%}` — a checkbox *is* an input, so it was drawn as a **242×13 bar**; M-74 wrote the correct override but scoped it to `.psh-filters .psh-toggle`, so identical markup outside the filter bar never matched. (b) a grid item stretches to its track, so bare `.pform-row` checkboxes did the same. | `v4.css`: `.field input[type=checkbox|radio]{width:auto;min-width:20px;min-height:20px}`; `portal.css`: `justify-self:start` for the `.pform-row` case, and `.psh-toggle label` widened off `.psh-filters` |
| **D-12** | §22 mobile priority order | `/track` result, shipper detail | The **map sat above support and documents**. M-74 placed the slot between the summary and the contact block and M-80 filled it, which put §22's *last* priority above its *fifth* and *sixth* — on a 320 px screen, roughly two thumb-scrolls of route diagram between "where is my freight" and "how do I ask a human". | `LocationPanel` moved to the end in `TrackingResult` and `ShipmentDetailView`; `data-prio` markers on all seven slots; order asserted at all twelve widths |

### 3.1 Surfaces where the audit found nothing

Stated rather than padded:

* **`/driver/update/[token]` layout.** M-76 designed it at 320 px on purpose —
  one column, 56 px controls, no table, `overflow-wrap` on the tracking
  number — and it passed every §22 probe at every width unchanged. Its only
  defect was D-9, which is a §23 announcement issue, not a layout one.
* **`ShipmentMap` and its accessible alternative (M-80).** Mounted and
  text-only, at every width: within its container, under the 320 px height
  cap, `role="img"` with a resolvable name and description, and a visible
  `<ol>` carrying the same facts with machine-readable timestamps. Nothing to
  fix.
* **Hover-only interactions.** The CSS audit found **zero** rules that reveal
  content on `:hover` without a focus equivalent, across every stylesheet the
  tracking surfaces load. The `:hover` rules that exist recolour borders and
  text, which is decoration, not disclosure.
* **Reduced motion.** Under `prefers-reduced-motion: reduce`, no visible
  element on any of the 29 states has a running animation or transition —
  including M-80's map pulse, which is already inside a
  `prefers-reduced-motion: no-preference` block.
* **Colour contrast.** axe reported no `color-contrast` violation on any
  surface at any of the three arrangements. This is the first time that claim
  has been *measured* on the portal tracking surfaces at all — jsdom cannot
  compute a colour — and M-74/M-80's dark-surface override blocks are why it
  holds.
* **Modals.** There are still none, app-wide (M-59's finding, re-verified):
  zero `dialog` / `role="dialog"` elements. §22's "no mobile modal exceeding
  screen" is satisfied structurally. M-73's support form is a `<details>`
  disclosure precisely so it cannot become one.
* **`.ptable--cards` coverage.** Every table on a customer-facing tracking
  surface — public result, shipper list/detail, carrier list/detail, broker
  list/detail — carries the card transform *and* a `data-th` on every body
  cell *and* actually stacks at 320 px, now asserted as a standing test. §22's
  *"do not force desktop tables onto mobile"* holds. The dispatcher board and
  detail deliberately keep the scroll strategy: staff scanning sixty shipments
  want the columns, which is M-59's stated division of labour.

---

## 4. What is NOT covered, and why

This section is the point of the module's honesty, not a disclaimer.

1. **No session-gated route is driven as a live route.** `/portal/**` needs a
   real Supabase session (and, for staff, M-61's MFA step-up); the secretless
   lane cannot mint one. `tests/e2e/responsive.spec.ts` **asserts** that every
   one of those paths 307s to `/login`, so the limitation is proved rather
   than assumed. What is measured instead is the DOM those routes' components
   produce, behind the stylesheets the running server links — the M-59 static
   harness precedent, mechanised. **What that does not include:** server data
   shapes, hydration, client navigation, focus behaviour across a route
   change. Those live in each module's own e2e spec.
2. **One browser engine.** Chromium only, as the whole suite has been since
   M-41. The iOS-zoom defect (D-1) is fixed by the rule Safari documents, not
   by observing Safari — no WebKit runner exists in this lane.
3. **No real device.** Touch-target sizes are CSS pixels measured by a layout
   engine. `@media(pointer:coarse)` rules do not apply under Playwright's
   Desktop Chrome, which is *why* D-5 and D-11 were found: they are failures
   at `pointer:fine` too, and fixing them at every pointer type is stricter
   than the coarse-only rules M-59 wrote.
4. **axe is sampled by arrangement, not by width** (§2.2). Three of twelve.
5. **axe is not an accessibility audit.** It catches roughly a third of WCAG
   failures by most counts. Everything in §2.5 that axe cannot decide —
   priority order, timeline text equivalence, hover-only disclosure, live
   region *timing* — is a hand-written assertion here precisely because the
   scanner has nothing to say about it. None of it substitutes for a screen
   reader in the hands of a person.
6. **`/track`'s success state is not a live route render.** A real result
   needs a shipment in a database. It is scanned as a fixture in five states.
   The **error** state *is* driven live, by a real submit.
7. **Non-tracking staff tables are untouched.** `/portal/admin/loads`,
   `/users`, `/security`, `/support` and the rest use the same `.ptable-wrap`
   and will have the same D-6 keyboard defect wherever their contents hold no
   link. They are outside §22/§23's tracking scope and outside this module's;
   `ScrollRegion` is the ready-made fix and this is the note that says so.
8. **Locales.** The live-route scans cover all five for `/track` and the
   driver refusal. The fixture matrix is scanned in English; the five-locale
   catalogue coverage stays where M-73…M-81 put it, in the unit lane.

---

## 5. Files

**Product (twelve defects):**
`src/app/v4.css` (D-1, D-4, D-11) · `src/app/portal.css` (D-2, D-3, D-5,
D-6 focus ring, D-7 selector, D-8, D-11) ·
`src/components/portal/ScrollRegion.tsx` (new, D-6) ·
`src/components/portal/ShipmentStaffDetailView.tsx` (D-6 ×7) ·
`src/components/portal/ShipmentBoardView.tsx` (D-6 ×3, D-7) ·
`src/components/portal/ShipmentListView.tsx` (D-6) ·
`src/app/[locale]/portal/admin/shipments/new/page.tsx` (D-6) ·
`src/components/driver/DriverUpdateView.tsx` (D-9) ·
`src/components/layout/SiteNav.tsx` (D-10) ·
`src/components/tracking/TrackingResult.tsx` (D-12) ·
`src/components/portal/ShipmentDetailView.tsx` (D-12) ·
`src/components/portal/ShipmentDocuments.tsx` (§23 document-label markers) ·
`src/app/[locale]/(site)/track/page.tsx` (heading level)

**Test apparatus:**
`tests/harness/emit.ts` (new — the jsdom→browser bridge) ·
`tests/e2e/global-setup.ts` (new — regenerates fixtures before every
Playwright run, no skip switch) · `playwright.config.ts` (wires it) ·
`tests/e2e/tracking-responsive-a11y.spec.ts` (new, 70 tests) ·
`tests/e2e/axe.spec.ts` (+7: `/track` ×5 locales, the live error state, the
expired-token refusal ×5 locales) · the six a11y suites emit fixtures.

**No** DB change, **no** migration, **no** env var, **no** new dependency.

---

## 6. Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | **388 pages** (unchanged) |
| `npm test` | **1468** unit (was 1462; +6 fixture-emission assertions) |
| `npm run test:rls` | **742** (unchanged — no schema or policy touched) |
| `npm run test:integration` | **329** (unchanged) |
| `npx playwright test` | **359** (was 283; +70 tracking responsive/a11y, +7 axe) in **5.9 min**; the tracking suite alone **1.9 min** |

---

## 7. Extension points

* **A new tracking surface** gets a fixture: emit it from its a11y suite with
  `emitHarness(id, shell, container)` and add the id to `FIXTURES`. The suite
  asserts the fixture list against the directory, so a fixture that stops
  being written **fails the run** rather than quietly shrinking the matrix.
* **A new customer table** needs `.ptable--cards` + a `data-th` on every cell.
  The standing assertion in §2.5 will fail if it does not.
* **A new scrolling region** uses `ScrollRegion`, not a bare `.ptable-wrap`.
* **A new `[data-prio]` slot** must be inserted in §22's order; the assertion
  runs at all twelve widths.
* **`.pform-row` is now a styled vocabulary** for width and font size. Forms
  that want the full control treatment should use `.field`.
* **Non-tracking staff tables** (§4 item 7) are the obvious next sweep; the
  fix is mechanical and already written.
