# M-100 — admin design system

A UI/UX refactor of the admin portal. No business logic changed: no Supabase
query, migration, RLS policy, RBAC rule, MFA path, Stripe flow, FMCSA rule,
onboarding state, audit event or API contract was touched, and no information
was removed from any screen.

Before/after screenshots: `test-results/admin-shots/{before,after}/`.

---

## 1. Root cause

The screenshots are the evidence, and they show one structural defect behind
most of the report.

### 1.1 The dividers — why they never lined up

```css
.pdl        { display:grid; align-items:baseline }
.pdl > dt   { border-top: 1px solid var(--line) }
.pdl > dd   { border-top: 1px solid var(--line) }
```

Two boxes, two borders, one row. `align-items:baseline` aligns the TEXT
baselines of `dt` and `dd`, which means their BOX tops differ by whatever the
difference in their font metrics and padding happens to be. So every row drew
**two rules a few pixels apart**, with a visible seam where the label column
met the value column — worse on any row whose value wrapped, because the two
boxes then had different heights as well.

No amount of adjusting padding fixes that. The row has to own its divider:

```css
.drow + .drow { border-top: 1px solid var(--a-line) }
```

One element per pair, one border, spanning both columns, and the first row
never draws one. `DetailRow` renders `<div class="drow"><dt/><dd/></div>`
inside the `<dl>` — valid HTML5, and the `dt`/`dd` association is unchanged.

### 1.2 The rest

| Reported | Cause |
| --- | --- |
| "Looks like a developer tool" | Monospace was the default: labels, values, dates, empty states, section headings and prose were all `--font-mono`. §15 reserves it for identifiers; that is now the rule. |
| "Large screens waste horizontal space" | No max content width. At 1920 a row was a 200px label and a ~1400px empty value cell. |
| "Cards contain too much empty space" | `v4.css` line 31 sets `section{padding:88px 0}` for the marketing pages. `AdminCard` renders a `<section>`, so every card inherited 88px of vertical padding — ~100px of dead space above each title. Found by looking at the first AFTER screenshot, not by any assertion. |
| "Statuses look like ordinary text" | `MISMATCH`, `Not reported`, `manual_review` and `unpaid` were body text. Two of them were raw database enums rendered verbatim. |
| "Wall of identical rows" (FMCSA) | Twelve undifferentiated rows with no grouping. |
| "Labels too small / weak" | Labels were `.62rem` (~10px) at `--color-steel`. |
| "Cards inconsistent" | Radius 3/6/8px, padding `20px 22px`, `18px 20px`, `26px`; no shared header treatment. |

## 2. The design system

Tokens are scoped to `.portal` and every colour is an existing `@theme` token
or a literal already present in `portal.css` — CLAUDE.md forbids new colours,
and the brief says to preserve the PickLoads dark identity with amber as the
primary accent. Elevation is white-alpha over those, the technique
`--color-line` already uses.

- **Spacing** `--s1..--s12` = 4·8·12·16·20·24·32·40·48. Nothing in the block
  uses a length that is not on the scale.
- **Radii** 4·6·8·12px. **Elevation** two subtle shadows.
- **Semantic tones** success / warning / danger / info / neutral, each a text
  colour and a background, all from the existing palette.
- **Structure** card padding 24/20/16, row min-height 50px, label column
  200px, page gutter 32/24/16, max content width 1720px.
- **Type** page 1.65rem/800 · card 1.06rem/700 · body .9rem · label .72rem/600
  uppercase · helper .79rem · code .72rem mono.

## 3. Primitives

`src/components/portal/admin-ui.tsx` — one file, because the brief lists
fourteen candidates and then says not to over-engineer. They render and
nothing else: no state, no fetching, no decisions.

`AdminPage` · `AdminPageHeader` · `AdminGrid` · `AdminColumn` · `AdminSection`
· `AdminCard` · `AdminCardShell` · `DetailList` · `DetailRow` · `DetailGroup`
· `StatusBadge` · `ReasonList` · `ReasonItem` · `InfoCallout` · `ReviewNote` ·
`StateBlock` · `ActionBar` · `EmptyState` · `MetricGrid` · `MetricCard`

## 4. The reference implementation

`/portal/admin/carrier-verifications/[id]`, per §4.

- **Header** gained a description, an identifier strip (USDOT / MC / submitted
  / expires) and the badge row.
- **§9 Submitted** — a `DetailList`; USDOT and MC carry `is-id` (mono, heavier)
  because they are record identifiers.
- **§10 FMCSA** — four labelled bands, IDENTITY / AUTHORITY / MATCHING /
  SOURCE. `Allowed to operate`, `Out of service` and the three match results
  are badges. The insurance caveat is an `InfoCallout` at the foot of the card.
- **§11 Engine** — risk tier and payment are badges via new maps in
  `review-labels.ts`; reason codes put the human sentence first with the
  machine code as a secondary chip, and a finding carries an amber rule down
  its left edge as well as sorting to the top.
- **§12 Staff review** — the note is a `ReviewNote` panel with its own sunken
  background, radius and line-height, not a table value.
- **§13 Decision** — `StateBlock` (icon + title + explanation) for each state,
  and the two actions sit in an `ActionBar` footer with its own top border,
  separated from the form.

### Raw enums

`manual_review` and `unpaid` were rendered verbatim to staff. They now read
`Manual review` and `Unpaid` through `RISK_TIER_BADGE` / `PAYMENT_BADGE`. The
stored values are untouched, and `badgeFor()` shows an unrecognised value
verbatim on a neutral badge rather than hiding a code/database divergence.

**Colour is never the only signal.** Every badge spells its state in words,
every toned metric carries a worded label, and findings are marked structurally
as well as chromatically.

## 5. The rest of the admin portal

§25 says shared primitives first, then migrate systematically, and warns
against redesigning every page at once if that risks regressions.

The two carrier-verification screens were rewritten onto the primitives. The
other 19 admin pages **adopt the system through the stylesheet**: they gained
`className="a-page"`, and `.a-page` scoped rules map their existing vocabulary
(`.psec`, `.ptiles`, `.ptile`, `.pcard`, `.ptable-wrap`, `.pbadge`, `.pbar`)
onto the same tokens, spacing, radii, card treatment and badge metrics.

Why not a markup rewrite: the dashboard alone is 694 lines of queries and
reductions wrapped around its markup, and every §26 requirement for metric
cards — consistent height, aligned rows, identical padding, a strong number, a
small label, no height jump from an extra line — is a CSS property, with CSS
Grid doing the sizing exactly as §26 asks. Converting the markup is now a
rename rather than a redesign, and it is the follow-up.

Everything is scoped to `.a-page` or `.portal:has(.a-page)`, so the carrier,
shipper and broker portals are untouched — which matters, because the
secretless e2e lane cannot authenticate into them to prove otherwise.

## 6. Sidebar (§16)

Row height 42px, consistent padding and alignment, hover, an active state that
uses an amber inset rule plus weight plus background (not colour alone), and a
visible focus ring. Navigation behaviour, order and links are unchanged.

## 7. Tests

| Suite | What it holds |
| --- | --- |
| `tests/unit/admin-verifications-a11y.test.tsx` (20) | Renders both views, axe-clean, and asserts the row structure that makes a single divider possible: every `dl.dlist` child is a `.drow` containing exactly one `dt` and one `dd`, and no `dt`/`dd` may sit loose. Plus: no information dropped, digest still truncated. Emits 4 fixtures. |
| `tests/e2e/admin-responsive-a11y.spec.ts` (20) | The fixtures behind the real compiled stylesheet at 12 widths (320→1920): overflow, divider clearance, wrapping, touch targets, action-row stacking, axe at 320/768/1440, and a non-vacuity proof. |
| `tests/unit/admin-ui-vocabulary.test.ts` (55) | No inline `style`, no raw hex in any cleaned file; every class the system introduces is both defined in `portal.css` and actually used. |
| `tests/e2e/admin-shots.spec.ts` (12) | Not assertions — writes the before/after PNGs. |

### Tests updated, not weakened (§28)

Where a test named the old DOM, the selector moved and the assertion stayed:
`.pdl > dd` → `.drow > dd`, `.preview-form .pactions` → `form .a-actions`,
`.pbar` → `.a-head`, `dd.mono` → `dd.is-id`. Two are worth calling out:

- **"No information was dropped"** now expects `Unpaid` and `Manual review`
  instead of `unpaid` and `manual_review`. Same assertion, same purpose —
  showing a database enum verbatim was the defect being fixed.
- **The action-row width check** compared button width against the row's
  border box. `.a-actions` is a padded footer, so 254px of a 254px content box
  read as 88% of the 286px outer box. It now measures the content box, which
  is what "full width" means.

### Dead code removed rather than assertions relaxed (§24)

`admin-ui-vocabulary` failed on four M-99 classes the moment the design system
absorbed what they did. `.preview-form`, `.preasons`, `.pbar-actions` and
`.pgap-sm` were confirmed unused across `src/` and their **rules were deleted**
(~1.3KB). The inventory list is the point: anything that falls off it is dead
code.

## 8. Visual validation (§29)

**What was validated.** The shipped markup rendered in real Chromium behind the
real compiled stylesheet, at 390 / 768 / 1440 / 1920, before and after, and
measured at twelve widths by the responsive suite. Two defects were found this
way and only this way — the 88px inherited `section` padding, and a badge
clipped by a narrow card — because both are invisible to jsdom and to every
structural assertion.

**What was NOT validated.** The live authenticated routes in a real browser
session. The Claude-in-Chrome extension is not connected, so the authenticated
`/portal/admin/*` pages were not opened and looked at. The dev server is up on
`localhost:3000` if you want to check them yourself; the 19 mapped pages in
particular have stylesheet-level changes that no screenshot here covers.

## 9. Remaining UI debt

1. Convert the 19 mapped admin pages' markup to the primitives (now a rename).
2. `.mono` is still applied 97 times across 63 files and defined nowhere —
   M-99's finding, unchanged, and still pinned by a test.
3. 37 inline `style` objects remain on 12 dispatch-desk pages (M-99 §7.3).
4. `#cfd6da` recurs in `portal.css` and deserves a real token; adding one is a
   theme change.
5. The detail page's right column ends higher than the left. §5 forbids fixing
   that with fixed heights, so it is content-driven and left alone.

## 10. Gate

| Lane | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 2417 passed, 4 skipped, 88 files |
| `npm run build` | clean |
| `npm run test:e2e` | 696 passed |

Lane note (unchanged from M-97/M-99): export the service-role and Stripe keys
as empty strings, run `npm run build:e2e` before `npm run test:e2e`, and run a
normal `npm run build` afterwards. Also — a running `next dev` overwrites
`.next` and will make the production build fail at runtime mid-suite; if
public-page specs start failing en masse, rebuild before believing them.
