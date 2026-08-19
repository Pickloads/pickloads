# M-94b — Mobile navigation: scroll containment

A defect fix shipped alongside M-94, on its own commit. Unrelated to carrier
onboarding; it lives here because every change in this repository ships with a
module note.

**Reported:** "On mobile, when the hamburger menu is opened, swiping/scrolling
moves the page behind the menu instead of scrolling only the menu content."

---

## 1. Root cause — three faults, and the third was invisible

### (a) The drawer had no scroll lock behind it

`.mobile-menu` renders **inside** `nav.sitenav`, which is `position: sticky;
top: 0`. So the panel stayed pinned to the top of the screen while the document
scrolled underneath it. The menu looked frozen and the page slid around behind
it — exactly what was reported. Nothing anywhere locked the body.

### (b) The drawer had no scroller and no height limit

It is a flat list of every destination on the site: a CTA, five groups with
their entries, and the utility links. On a 360×640 phone that is roughly 900px
of content in a 640px viewport, with `max-height` unset and `overflow` default.
The last several links could not be reached at all — scrolling "toward them"
scrolled the page instead, because the drawer was not a scroll container and
the page was.

### (c) The drawer was in flow, so opening it moved the page

This one only surfaced once the fix was measured. As an in-flow block inside
the sticky nav, opening the drawer added ~530px to the top of the document. The
browser's **scroll anchoring** then compensated by scrolling down by the same
amount to keep the content underneath visually still — so a reader at `y = 600`
was silently at `y = 1130` the instant the menu appeared.

Every "capture the position and restore it" scheme therefore restored the wrong
number. The first version of this fix did exactly that and
`tests/e2e/mobile-nav.spec.ts` caught it as a 530px discrepancy. The answer is
not to chase the compensation but to stop growing the document.

---

## 2. The fix

### The drawer overlays instead of occupying flow

```css
.mobile-menu.open{
  display:block;
  position:absolute; top:100%; left:0; right:0;      /* (c) */
  max-height:var(--mm-max-h, calc(100dvh - 110px));  /* (b) */
  overflow-y:auto;
  overscroll-behavior:contain;                       /* (a), scroll chaining */
  -webkit-overflow-scrolling:touch;
  padding-bottom:calc(94px + env(safe-area-inset-bottom,0px));
}
```

Same place on screen, same background, same border, same link treatment — the
change is that it no longer takes layout space, so nothing shifts and scroll
anchoring has nothing to compensate for.

`position: absolute` rather than `fixed`: `nav.sitenav` carries
`backdrop-filter`, which makes it the containing block for fixed descendants
anyway, so `fixed` would have behaved like this while reading as if it did not.

The bottom padding clears **both** the iPhone home indicator and the fixed
`.call-fab`, which sits at `z-index: 60` over this panel below 960px. Without
it the last one or two destinations are permanently under the call button.

### The body lock (`SiteNav.tsx`)

`position: fixed` on `<body>` at a negative offset, not `overflow: hidden`:
`overflow: hidden` does not stop iOS Safari rubber-banding or dragging. That
technique resets the document scroll to 0, which is why the position is
captured on open and restored on cleanup.

The restore is `window.scrollTo({ top, left: 0, behavior: "instant" })`. The
`behavior` is load-bearing: the site sets `html { scroll-behavior: smooth }`,
so the two-argument `scrollTo(0, y)` **animates** — the page visibly slides back
from the top, and for the half-second it lasts the position is wrong. The e2e
suite caught that too.

One `useEffect` cleanup restores everything, so **every** close path — the
hamburger, Escape, a link click, a route change, a resize across the
breakpoint — runs the same restore. There are no five copies to drift apart.

### Height measurement

`max-height` in CSS cannot know where the nav ends: at scroll-top the topbar is
still on screen and the nav bottom is ~110px down; once scrolled it is ~72px. A
static `calc()` is wrong at one end, and being wrong at the bottom end puts the
last menu item off-screen again. So `--mm-max-h` is measured from
`nav.getBoundingClientRect().bottom` against `visualViewport.height` — the
visual viewport, because iOS shrinks it when its toolbars are showing and the
difference is about two menu rows. Recomputed on `resize`, `orientationchange`
and `visualViewport.resize`. The CSS fallback covers first paint and no-JS.

### Breakpoint safety

Above 960px the hamburger is `display: none` and the drawer with it. A rotation
or window resize across that line closes the drawer via `matchMedia`, because
otherwise the body stays locked with no visible control left to unlock it.

### Accessibility

`aria-expanded` and `aria-controls` were already correct and are unchanged.
Added: Escape returns focus to the hamburger, and focus is contained to
`{hamburger} ∪ drawer` while the drawer is open, so a keyboard user cannot walk
out into a page they cannot see.

`aria-modal` was considered and **rejected**: it would hide the hamburger — the
only close control this design has — from assistive technology, and adding a
second close button inside the drawer would change a visual design this task is
explicitly not allowed to redesign. Keeping the toggle inside the trap means
Shift+Tab from the first link lands on the control that closes the thing. The
honest limit: the background is inert to touch, wheel and Tab, but a screen
reader's own navigation can still reach it.

---

## 3. Files changed

```
src/components/layout/SiteNav.tsx   body lock, height measurement, breakpoint
                                    close, focus containment, focus restore
src/app/v4.css                      .mobile-menu.open — overlay + own scroller
tests/e2e/mobile-nav.spec.ts        11 regression tests (new)
```

No component was renamed, no markup restructured beyond two refs, and no colour,
font, spacing or radius token changed.

---

## 4. Before / after

| | Before | After |
|---|---|---|
| Swipe with the menu open | the page scrolls behind it | only the menu scrolls; the page does not move by 1px |
| Reaching the last menu item | impossible below ~900px of viewport | scrolls into view inside the drawer |
| Closing the menu | position was never disturbed, because it was never locked | restored to the exact pixel, instantly |
| Opening the menu | content below the bar lurched down ~530px (masked by scroll anchoring) | nothing moves |
| Escape | closed, focus left wherever it was | closes, restores position, focus returns to the hamburger |
| Tab with the menu open | walked into the page behind | contained to the hamburger and the drawer |
| Resize to desktop with it open | drawer vanished; no lock existed to leak | drawer closes and the lock is released |
| Desktop | unchanged | unchanged (asserted) |

---

## 5. Tests run

* `npm run typecheck` — clean
* `npm run lint` — clean
* `npm test` — 2221 passed, 4 skipped
* `npm run test:e2e` — 649 passed, including the 11 new mobile-nav tests
* `npm run build` — clean, 439 pages

`tests/e2e/mobile-nav.spec.ts` measures the page rather than the source:
everything that was wrong here is browser behaviour — sticky positioning,
scroll chaining, scroll anchoring, a body lock that has to survive
`position: fixed`, a viewport that changes height. jsdom has none of it, so a
unit test would have asserted that the fix was *written*, not that it *works*.

**The honest limit — an EXTERNAL DEVICE-VALIDATION ITEM, not a code blocker.**
This project runs Chromium. Playwright's WebKit is not Mobile Safari, and iOS
Chrome is WebKit too, so neither can be exercised here. The `position: fixed`
body lock is the technique chosen *because* `overflow: hidden` is known to fail
on iOS, and `overscroll-behavior: contain` is supported from iOS 16.4 — but the
iPhone/iPad verification the task asks for has not been performed.

It should be, on a real device, before this reaches production. It does not
gate anything else: the fix is contained to the mobile drawer, and no server,
security or data path depends on the outcome.

**The device checklist**, so whoever has an iPhone can run it in two minutes:
open the menu halfway down a long page; swipe up and down hard enough to
rubber-band; confirm the page behind does not move; scroll to the last item in
the menu and confirm it is reachable above the call button; close the menu and
confirm the page is exactly where it was; rotate to landscape with the menu
open and confirm it re-fits; repeat with the iOS toolbars both shown and
hidden.
