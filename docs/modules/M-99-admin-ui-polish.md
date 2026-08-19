# M-99 — admin dashboard & carrier-verification presentation cleanup

Presentation only. No data logic, no FMCSA rule, no RBAC, MFA, Stripe,
activation gate or RLS policy was touched, and no information was removed from
any screen. Every query, filter and decision path is byte-identical.

---

## 1. Root cause

The admin surface was not suffering from many small layout bugs. It had one
defect repeated at ~60 call sites:

> **A class whose defaults suited a different context, corrected at the call
> site with an inline `style` object.**

The clearest instance is `.pempty` — a standalone empty-state box carrying
`padding:26px`. Used inside a `.pcard`, which already pads, every single call
site wrote `style={{ padding: 0 }}` to undo it. That is not seven bugs; it is
one missing rule. The same shape produced:

| Symptom reported | Actual cause |
| --- | --- |
| "Text sitting directly on divider lines" | `.ptable-wrap` (a scroller, `padding:0`) used as a section container, so a heading's box began exactly at the border. Zero clearance, not overlap. |
| "Labels and values cramped / misaligned" | Detail screens used `table.ptable` for what is a description list. Row padding came from table cells tuned for dense data. |
| "Inconsistent spacing" | 60+ inline `style` objects, each a local guess: `marginTop: 22`, `padding: "0 0 12px"`, `padding: "14px 0 0"`. |
| "Status chips wrap awkwardly" | Chip rows were hand-rolled `style={{display:"flex",gap:8,flexWrap:"wrap"}}` — three separate copies of `.pbadges`, which already existed. |
| "Metric tiles don't line up" | `.ptile` was a plain block, so a tile with a `.sub` line and one without had different heights. |

The fix is therefore vocabulary, not layout tweaking: name the missing
patterns once in `portal.css`, then delete the inline overrides.

## 2. What was added to `src/app/portal.css`

`.pdl` (description list — the correct element for label/value detail),
`.phelp` (footnote prose), `.plede` (a card's opening paragraph), `.pbadges`,
`.pbar-actions`, `.pactions`, `.preview-form`, `.preasons`, `.ppager` +
`.pcount`, `.pgap` / `.pgap-sm`, `.psubhead`, `.pside-head`, `.pempty.flush`,
`.pcard.alert`, `.pcard.narrow`, `.ptiles.compact`, and the table-cell
modifiers `.stacked` / `.wrap` / `.nw` / `.tsub` / `.tact` / `.treason`.

`.ptile` became a flex column with a `min-height`, so tiles align whether or
not they carry a sub-line. Under 640px `.pdl` collapses to one column with the
divider above the label only.

The file is append-only for this module — no existing rule was altered.

## 3. Deliberately scoped, not widened

`.pempty.flush`, `.psubhead` and `.pgap-sm` are written as explicit modifiers
even though the honest fix is a descendant rule (`.pcard .pempty {padding:0}`).

**Why.** There are 139 further `.pempty` call sites outside this module, on
carrier / shipper / broker portal pages. The e2e lane runs secretless and
cannot authenticate, so it cannot reach any of them — a descendant rule would
change surfaces no test in this repository is able to check. The modifier
changes only what this module actually looked at.

Widening it is the follow-up, and it needs those pages covered first.

## 4. Known gap left in place: `.mono`

`className="mono"` is applied **97 times across 63 files** and has no rule
anywhere except `.pdl>dd.mono`. Every one of those elements renders in the body
face — which is why so many call sites bolt an inline `font-size` on beside it.

It is **not** fixed here. Defining `.mono` globally would restyle public
marketing pages, and "the V4 prototype is FINAL — convert, never redesign"
makes that a deliberate decision, not a side effect of a dashboard cleanup.
The admin surfaces below now use `.tsub`, which really does set the mono face.

`tests/unit/admin-ui-vocabulary.test.ts` pins the gap: if `.mono` is ever
given a definition, that test fails and tells you to remove it.

## 5. Files changed

**Stylesheet** — `src/app/portal.css`.

**New presentational components** — extracted from async Server Components so
they can be rendered in jsdom and measured at all:

- `src/components/portal/CarrierVerificationQueueView.tsx`
- `src/components/portal/CarrierVerificationDetailView.tsx`

**Rewritten as fetch → map → render** (queries unchanged):

- `src/app/[locale]/portal/admin/carrier-verifications/page.tsx`
- `src/app/[locale]/portal/admin/carrier-verifications/[id]/page.tsx`

**Markup cleanup, zero inline `style` remaining**:

- `src/app/[locale]/portal/admin/page.tsx` (14 inline style objects → 0)
- `src/app/[locale]/portal/admin/users/page.tsx` (11 → 0)
- `src/app/[locale]/portal/admin/mfa/page.tsx` (3 → 0, including two raw hex
  colours moved out of the component per CLAUDE.md)
- `src/components/portal/CarrierReviewForm.tsx`
- `src/components/portal/PortalSidebar.tsx`

## 6. Tests

- `tests/unit/admin-verifications-a11y.test.tsx` — 20 tests. Renders both new
  views, runs axe, asserts `dl`/`dt`/`dd` pairing, that no `table.ptable`
  survives on the detail screen, that `.ptable-wrap` contains only tables, that
  every badge carries text, that **no information was dropped**, and that the
  FMCSA digest is still truncated. Emits 4 harness fixtures.
- `tests/e2e/admin-responsive-a11y.spec.ts` — 20 tests. Loads those fixtures
  behind the real compiled CSS at **12 breakpoints** (320 → 1920): horizontal
  overflow, divider clearance, text wrapping, touch-target size, action-row
  stacking at 320, long-value wrapping, and axe at 320 / 768 / 1440.
- `tests/unit/admin-ui-vocabulary.test.ts` — 31 tests. No inline `style` and no
  raw hex in any cleaned file; every class this module introduced is both
  defined in `portal.css` and actually used; the `.mono` gap stays pinned.

### The divider probe measures clearance, not crossing

The first version of the e2e probe asked whether text *ink crossed* a border
line. Reconstructing the pre-M-99 markup showed it reported that layout as
clean — because a heading whose box starts exactly at its container's border
**touches** the rule without crossing it, which is precisely the reported
symptom. The probe now measures the **gap** between a block-level box's border
and the text it bounds, flagging under 4px. Crossing is simply negative
clearance, so this subsumes the stricter check.

It is scoped to block-level boxes: an inline-block `.pbadge` draws its border
3px from its own label by design, and flagging that would report the chip
design as a defect.

The final test in the file reconstructs the pre-M-99 markup and **asserts the
probe still fails on it**. Without that, a probe that silently stopped
measuring would read as a pass.

## 7. Follow-up owed

1. Define `.mono`, or delete the class from all 97 call sites (§4).
2. Widen `.pempty.flush` → `.pcard .pempty` once carrier/shipper/broker portal
   pages have coverage (§3).
3. 37 inline `style` objects remain on 12 dispatch-desk pages outside this
   brief's scope — `quotes` (7), `loads` (7), `support/[id]` (6), `security`
   (6), `leads/[id]` (3), `shipments/new` (2), and one each in `support`,
   `shipments`, `settings`, `posts`, `posts/[id]`, `brokers`. Most are the same
   patterns the new classes already absorb (`<td style={{whiteSpace:"nowrap"}}>`
   ×7 → `.nw`; the pager ×1 → `.ppager`); a few need judgment
   (`border:"none"`, `whiteSpace:"pre-wrap"`, a `ScrollRegion` style prop).

## 8. Running the lanes on a machine with a populated `.env.local`

Unchanged from M-97, repeated because it cost time again: `.env.e2e`
deliberately sets no service-role or Stripe key, so a populated `.env.local`
leaks real ones in and seven "degrades honestly without env" tests fail.
Export them empty for the run. Note also that `npm run build:e2e` must precede
`npm run test:e2e` (NEXT_PUBLIC_* are inlined at build time), and that a normal
`npm run build` must be re-run afterwards, or the build-scan tests in
`owner-business-decisions.test.ts` read the e2e bundle and fail.

## 9. Gate

| Lane | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 2393 passed, 4 skipped, 88 files |
| `npm run build` | clean |
| `npm run test:e2e` | 684 passed |
