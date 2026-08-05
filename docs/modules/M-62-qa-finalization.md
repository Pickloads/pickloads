# M-62 — Full QA + Finalization

**Status:** ✅ Complete · **Phase:** Upgrade (final module) · **Date:** 2026-08-05

The last module of the project. No new product features: a responsive
screenshot + layout-integrity suite, an honest item-by-item walk of the
directive's §24 acceptance criteria, and the documentation that has to be
correct on the day someone else deploys this.

## What shipped

1. **`tests/e2e/responsive.spec.ts`** — 108 new Playwright tests.
2. **`docs/UPGRADE-ACCEPTANCE.md`** — all 25 §24 criteria, each with a
   status and the test/file/command that proves it.
3. **`docs/LAUNCH-RUNBOOK.md`** — rewritten for M-50…M-61.
4. **`docs/modules/INDEX.md`** + **`README.md`** — brought current.

## 1. Responsive screenshot suite

21 routes × 5 viewports, plus a sweep of all 21 at the two range endpoints,
plus a session-gate proof. 108 tests, ~1.2 min.

| | |
|---|---|
| **Viewports (screenshot matrix)** | 375×812 · 390×844 · 768×1024 · 1024×768 · 1440×900 |
| **Range endpoints (assertions only)** | 320×568 · 1920×1080 — closes the directive's stated 320→1920 span |
| **Routes** | 13 public (`/`, `/about`, `/contact`, `/faq`, `/shippers`, `/become-a-carrier`, `/start-your-trucking-company`, `/truck-dispatch`, `/truck-dispatch/new-jersey`, `/dispatch/dry-van`, `/blog`, `/legal/privacy`, `/es`) · 7 auth (`/login`, `/create-account` ×3, `/forgot-password`, `/reset-password`, `/invite/[token]`) · 1 portal-reachable (`/portal`) |

`/es` is in the list deliberately: Spanish is the widest translated nav and
topbar copy, so it is the worst case for the nav-overflow assertions.

### What each test asserts

- **HTTP** — the route renders (status < 400) and has exactly one `main#main`
  (the M-59 skip-link target).
- **No horizontal overflow** — `documentElement.scrollWidth - clientWidth ≤ 1`.
  On failure the detector walks the DOM and names the widest offending
  elements with their right edge in px, so the message is actionable rather
  than "something overflows".
- **Nav collapsed (≤960 px)** — `.navlinks` must actually be `display:none`
  (not merely narrow), `.menu-btn` must be visible with a ≥24 px tap target
  inside the viewport, and after opening the drawer: ≥8 entries, all with
  non-zero width, all inside the viewport, **none overlapping vertically**,
  and **no overflow with the menu open** (a distinct layout that the closed
  state does not exercise).
- **Nav expanded (>960 px)** — every link has non-zero size, is not clipped
  on either edge of the viewport, sits **inside the nav bar's own box**
  (catches a wrapped or vertically clipped row in the fixed 72 px bar), no
  two links overlap horizontally, and the three clusters (logo / navlinks /
  nav-cta) never intersect.
- **Auth pages** (Topbar-only chrome by design) fall through to a topbar
  containment check instead of being silently skipped.

### Anti-vacuity

A suite that passes on the first run deserves suspicion. Three injected
regressions were run against the same probes before the suite was accepted:

| Injection | Detector output |
|---|---|
| `<div style="width:3000px">` appended to `/` at 1440 px | `INJECTED OVERFLOW = 1560` |
| `nav.sitenav .navlinks a{position:absolute;left:120px}` | `OVERLAPPING PAIRS AFTER INJECTION = 7` |
| Baseline probe at 1440 px | `NAV ITEMS = 8` with real labels and non-overlapping x-ranges |
| Baseline probe at 375 px | `navlinks display = none · menu-btn display = block` |

The probes read live geometry; they do not constant-fold to a pass.

### Decision: baseline PNGs are NOT committed

Screenshots are written to Playwright's `outputDir`
(`test-results/responsive/<viewport>/<slug>.png`), which `.gitignore`
already excludes.

**Measured cost of the alternative: 105 full-page PNGs, 33 MB** (the home
page at 375 px alone is 1.1 MB). Committing them would add tens of megabytes
that get rewritten wholesale by any token, copy or spacing change, producing
review diffs no human reads. Pixel baselines are also environment-sensitive
(font hinting and rasterization differ between the container and a
developer's machine), so they generate false failures that train people to
ignore the suite.

**The assertions are the enforcement mechanism.** They are deterministic,
environment-independent, and describe *what* broke and *by how many pixels*.
The PNGs remain as the diagnostic artifact of the most recent run — exactly
what you want to look at *after* an assertion tells you where to look.

Trade-off accepted: this suite cannot catch a purely cosmetic regression
(wrong color, wrong font weight) that breaks no geometry. That class is
covered by the V4 token discipline (CLAUDE.md), the `v4-slugs` catalog tests
and the axe contrast scan.

### Portal-internal pages

`/portal/{carrier,shipper,admin}/*` need a real Supabase session and cannot
be reached in the secretless lane. Rather than assume that, the suite
**proves** it: `portal-internal routes are session-gated` walks 7 portal
routes and asserts each one lands on `/login?next=`. Their responsive
behaviour was audited in M-59 against the real built CSS via a static
harness; the runbook's post-cutover checklist carries the live re-check.

## 2. `docs/UPGRADE-ACCEPTANCE.md`

All 25 §24 criteria: **17 ✅ · 8 ⚠️ · 0 ❌**.

Every ⚠️ is an environment dependency (live Supabase / Stripe / Resend /
Dropbox Sign), never an unbuilt feature — this repo has never been connected
to a live project, and the doc says so at the top instead of implying
otherwise. The eight are: carrier signup, shipper signup, **email
verification** (Supabase-side template — the largest one), login/logout,
password recovery, and the live-data halves of the carrier portal, shipper
portal and admin account management. All eight are mirrored into the
runbook's *Post-cutover verification* checklist so none can be lost.

Two findings surfaced while walking the criteria and are recorded rather than
quietly fixed:

- **Three env vars in `.env.example` are read by no code**
  (`NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` — the contact map is a keyless embed;
  `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_AUTH_TOKEN` — no Sentry SDK is installed;
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — no client-side Stripe surface). The
  runbook now has a dedicated "declared but unused" table so nobody sets them
  expecting an effect.
- **21 raw-hex occurrences across 12 components** breach CLAUDE.md's "never
  raw hex in components" rule. All 21 are exact V4/U-03 palette values
  already declared in `v4.css`/`portal.css` (12 of them the single portal
  error red `#f2c9c9`), so there is zero visual deviation. Not refactored
  here — a finalization module should not touch a dozen component files for
  cosmetic parity on the last commit — and logged as a post-launch cleanup.

## 3. Runbook rewrite

New or rewritten sections:

- **Migrations 0005–0013** — application order with the dependency
  constraints stated (0009 needs 0005–0008; 0008's `shipper_id` FK must
  precede public shipper signup, audit §6.3), and a **rollback note per
  migration** including the two that must *not* be rolled back (0008 while
  shipper signup is on; 0013 ever — revoking that grant re-breaks the public
  blog and sitemap).
- **Env-var table** re-audited against `grep -rhoE "process\.env\.[A-Z0-9_]+" src scripts`,
  with a *Missing ⇒* column (what actually breaks in production) and the
  "declared but unused" table above.
- **Supabase auth email templates** — Confirm signup and Reset password are
  Supabase-side; there is deliberately no app-side verify-email template
  (M-60). Includes the honest note that Supabase sends one template per
  event, so auth mail is English-only while product mail is localized.
- **Staff MFA** — enrollment steps, the admin-hard / dispatcher-14-day-grace
  matrix, the AAL2 requirement, and the **enroll two admins before enabling**
  rule (R-5: no self-service recovery).
- **Staff invite flow** — the in-app replacement for the old "promote them in
  the SQL editor" instruction.
- **`company_settings`** — all nine keys in a table with what each gates,
  including `shipper_signup_enabled` (D1, legal's no-deploy off switch).
- **Pre-deploy gate** — the six commands with `npm run test:rls` promoted to
  a release gate, plus why it is not in `npm test` and why it must be re-run
  against staging.
- **Post-cutover verification** — the 12 live-environment checks.

## Gate

| Lane | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | ✓ 337 pages · 65 route entries (50 SSG → 330 paths, 12 dynamic, 3 static files) · 0 portal routes in the prerender manifest |
| `npm test` | **168 passed** (14 files) |
| `npm run test:rls` | **165 assertions passed** |
| `npm run test:e2e` | **145 passed** (19 smoke + 18 axe + 108 responsive) |

No DB changes, no env changes, no new dependencies.

## Files

- `tests/e2e/responsive.spec.ts` (new)
- `docs/UPGRADE-ACCEPTANCE.md` (new), `docs/modules/M-62-qa-finalization.md` (new)
- `docs/LAUNCH-RUNBOOK.md`, `docs/modules/INDEX.md`, `README.md` (rewritten)

## Extension points

- **New route** → add one line to `ROUTES` in `responsive.spec.ts` and to
  `PAGES` in `axe.spec.ts`. It is then covered at all 7 widths automatically.
- **New viewport** → add to `VIEWPORTS`; nothing else changes.
- **New nav pattern** → `NAV_COLLAPSE_MAX` (960) is the single source of the
  collapse breakpoint; keep it in sync with `v4.css`.
- **Visual-regression later** → if pixel baselines are ever wanted, run them
  in a pinned container image and store them in an artifact store or Git LFS,
  not in the repo; keep these geometry assertions either way, since they are
  the ones that survive a font-rendering change.
