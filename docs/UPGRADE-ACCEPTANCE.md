# PickLoads — Upgrade Directive Final Acceptance (M-62)

**Date:** 2026-08-05 · **Scope:** directive §24 final acceptance criteria,
walked item by item · **Baseline:** M-61 (`e03a75d`) + this module
· **Related:** [UPGRADE-AUDIT.md](UPGRADE-AUDIT.md) (the M-50a gap analysis
this upgrade was planned from), [SECURITY-REVIEW.md](SECURITY-REVIEW.md)
(M-61 evidence), [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md) (go-live procedure).

## How to read this document

| Mark | Meaning |
|---|---|
| ✅ | Built **and** proved in this environment. The evidence column names the test, file or command that proves it — no criterion is marked ✅ on the strength of "the code looks right". |
| ⚠️ | Built and unit/e2e-proved as far as a secretless environment allows, but the **end-to-end behaviour needs a live Supabase / Stripe / Resend / Dropbox Sign project** to confirm. The specific missing proof is named. |
| ❌ | Gap — not built, or built in a way that does not satisfy the criterion. |

**The honesty rule for this file:** this repository has never been connected
to a live Supabase project, Stripe account, Resend domain or Dropbox Sign
app. Every test lane runs on placeholder credentials
(`NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`). Anything whose
proof would require a real user row, a real confirmation email, a real
invoice or a real TOTP round trip is marked ⚠️ and says so. Those are not
failures — they are the correct residual state of a pre-launch build — but
presenting them as ✅ would be exactly the kind of fake claim the directive
forbids.

### Verification lane used throughout

```
npm run typecheck   # tsc --noEmit, strict, noUncheckedIndexedAccess  → clean
npm run lint        # eslint (next/core-web-vitals)                   → clean
npm run build       # next build on placeholder env                   → 337 pages
npm test            # vitest, 14 files                                → 168 passed
npm run test:rls    # local PG16, migrations 0001–0013 + fixtures     → 165 assertions
npm run test:e2e    # playwright chromium vs `next start`             → 145 passed
```

---

## Scoreboard

| | Count |
|---|---:|
| ✅ done and proved here | **17** |
| ⚠️ built, needs a live environment to finish proving | **8** |
| ❌ gap | **0** |
| **Total criteria** | **25** |

Every ⚠️ is an *environment* dependency, not an unbuilt feature. The
corresponding live-environment checks are all listed in
`docs/LAUNCH-RUNBOOK.md` § "Post-cutover verification (M-62 ⚠️ items)" so
none of them can be lost between here and go-live.

---

## 1. Carrier account creation — ⚠️

**Built.** `/create-account` chooser → `/create-account/carrier`
(`src/app/[locale]/(auth)/create-account/carrier/page.tsx`,
`src/components/auth/CreateCarrierForm.tsx`,
`createCarrierAccount` in `src/app/actions/account.tsx`). Full guard stack:
IP rate-limit → Turnstile → Zod → cookie-bound anon `signUp` → `carriers`
row + owner `carrier_memberships` row + `carrier_leads` row + `audit_events`.
Authority-status routing per directive: `active` → onboarding CTA;
`pending` → `profiles.status='pending'` + `account_status_history`;
`needs_help` → full account tagged `lead_type='new_authority'`;
`leased_on` → manual-review flag + high-priority lead.

**Proved here.**
- `tests/unit/account.test.ts` → `createCarrierAccountSchema` (5 tests):
  MC required only when authority is active, exactly the directive's four
  authority statuses, **forged `role` key stripped**, password bounds.
- `tests/e2e/smoke.spec.ts` → "carrier registration degrades honestly without
  env": the form submits and the action states *"no account was created"* —
  it never fakes a "check your email".
- `npm run test:rls` → carrier A/B isolation on every table the new account
  can reach (56 assertions).

**Needs a live environment.** That `auth.users` + `profiles` + `carriers` +
`carrier_memberships` rows are actually written, and that the
`on_auth_user_created` trigger fires in the real project. Nothing here has
ever created a real account.

## 2. Shipper account creation — ⚠️

**Built.** `/create-account/shipper` with the directive's guided fields
(industry select, one-time/weekly/monthly/seasonal frequency, region
checkboxes → `text[]`), gated by the `shipper_signup_enabled`
`company_settings` flag (decision D1) with an honest invite-only fallback
when it is off. `createShipperAccount` mirrors the carrier guard stack,
promotes the role **server-side** (service role — `guard_role_change` still
blocks self-promotion), writes `shippers` + owner `shipper_memberships` +
`audit_events`.

**Proved here.** `tests/unit/account.test.ts` → `createShipperAccountSchema`
(4 tests: region splitting + 12-entry cap, unknown frequency nulled not
rejected, forged `role` stripped); `tests/e2e/smoke.spec.ts` → "shipper
registration (M-53) renders directive fields and degrades honestly";
16 shipper-isolation RLS assertions.

**Needs a live environment.** Real row creation + the role promotion actually
landing, and the post-verification quote-claiming one-shot
(`src/lib/shipper-quotes.ts`) matching a real verified session email.

## 3. Email verification — ⚠️

**Built.** Public signups are **never auto-confirmed** (audit §6.4): both
account actions use the cookie-bound anon client's `signUp` with
`emailRedirectTo: {origin}{localePath}/login?verified=1`
(`src/app/actions/account.tsx:142,334`). The return loop is implemented:
`LoginForm.tsx` renders "✓ Email verified — you can sign in now." on
`?verified=1`, and distinguishes the *unverified-email* sign-in failure from
bad credentials. The staff-invite path is the deliberate exception — the
tokenized link already proved inbox control, so `acceptStaffInvite` creates
the user confirmed (documented judgment, M-58).

**Proved here.** The redirect construction and the two login states are
pinned in code and e2e (`auth states (M-54)` covers the sibling
expired/suspended states on the same component).

**Needs a live environment.** The confirmation email itself is sent by
**Supabase Auth**, not by this app — there is deliberately no app-side
template (M-60). Proving verification end-to-end requires the real project
with the Confirm-Signup template customized and the redirect allow-list set.
Both steps are now written up in the runbook (§1.3 "Supabase auth email
templates"). **This is the single largest ⚠️ in the list.**

## 4. Login / logout — ⚠️

**Built.** `/login` (`src/components/auth/LoginForm.tsx`) signs in through the
browser Supabase client — the one legitimate anon-key surface (decision Q3) —
with a same-origin-validated `?next=` (rejects `//`), falling back to the
`/portal` role router. Logout is in the portal shell
(`src/components/portal/PortalSidebar.tsx:66` → `auth.signOut()` → redirect).

**Proved here.** `tests/e2e/smoke.spec.ts` → "/portal/carrier redirects
unauthenticated visitors to /login" (the auth wall), "auth states (M-54)"
(continue / expired / suspended banners), "/login links to /forgot-password".
Middleware protection of locale-prefixed portal paths is exercised by the
M-62 responsive suite's `portal-internal routes are session-gated` test,
which asserts all 7 sampled portal routes 307 to `/login?next=`.

**Needs a live environment.** An actual credential round trip and cookie
lifetime; the secretless lane can only prove the *refusal* paths.

## 5. Password recovery — ⚠️

**Built.** M-42: `/forgot-password` (`resetPasswordForEmail`,
locale-preserving `redirectTo`, no account enumeration) and
`/reset-password` (recovery-session watch → `updateUser`).

**Proved here.** `tests/e2e/smoke.spec.ts` → "password recovery (M-42,
secretless)" ×2: the forgot form refuses with *"not configured"* on
placeholder env rather than crashing or firing a network call; the reset page
correctly reports the missing recovery session as "invalid or has expired".

**Needs a live environment.** The real email → link → new password → sign-in
round trip. Requires the Supabase redirect allow-list (`https://pickloads.com/**`)
from runbook §1.3.

## 6. Role-based redirects — ✅

**Built.** `portalHomeFor(role)` + `/portal` role router; per-page
`requireProfile` / `requireCarrier` / `requireStaff` / `requireAdmin` gates;
authed visitors on `/login` and `/create-account` are bounced to their
portal home; cross-role portal access redirects to the caller's own surface;
suspension is enforced centrally in `requireProfile`
(`/login?error=suspended`); expired cookies are stamped `?expired=1` by the
middleware; staff MFA is enforced at the same choke point (M-61).

**Proved here.** `tests/unit/guards.test.ts` (guard degradation),
`tests/unit/security.test.ts` (29 tests — the MFA requirement matrix at the
same gate, including both fail-safe edges), `tests/e2e/responsive.spec.ts` →
`portal-internal routes are session-gated` (7 routes × redirect target),
`tests/e2e/smoke.spec.ts` → auth-wall + login-state tests, and the RLS
suite's 4 role-guard assertions proving `trg_profiles_role_guard` blocks
self-promotion in the database. Marked ✅ because the routing decision logic
is fully deterministic and fully tested here; only the *session* behind it
would come from a live project, and that is covered by criteria 4 and 24.

## 7. Carrier portal — ✅ (surface) / ⚠️ (live data)

**Built (M-25 + M-55 + M-57 + M-59 + M-60).** Eleven surfaces:
Overview dashboard (onboarding checklist, authority/account badges, missing
docs, review queue, agreement, assigned dispatcher, active/completed loads,
outstanding invoices, notifications) · Company Profile (D5: self-serve
contact + lanes/home-time, change-request flow for regulated MC/DOT/EIN/
insurance/factoring fields) · Trucks & Equipment CRUD · Drivers CRUD ·
Documents (upload/replace/status/≤300 s signed-URL download) · Agreements
(signed date, executed-copy download, rate-limited e-sign re-send) · Loads ·
Invoices & Payments (0008 mirror table) · Notifications · Support threads ·
Account Settings. Every empty state is honest — no fabricated rows.

**Proved here.** `tests/unit/portal-forms.test.ts` (11 tests: truck schema
with the equipment list pinned in lock-step with the 8 public slugs, driver
schema, D5 change-request field set, support body cap matching the DB CHECK);
`tests/unit/membership-doctrine.test.ts` (22 tests — a static scan that
**fails CI** if any portal page queries `carriers`/`shippers` by
`profile_id` instead of the membership helpers); RLS suite's 56 carrier
assertions incl. own-tenant positive controls; responsive suite covers the
shared portal vocabulary via `/portal` and the auth forms.

**Needs a live environment.** The pages themselves cannot be *rendered* in
this lane (no session — proved, not assumed, by the session-gate test). Their
responsive behaviour was audited statically in M-59 against the real built
CSS; their data paths are proved at the schema/RLS/validation layer.

## 8. Shipper portal — ✅ (surface) / ⚠️ (live data)

**Built (M-32 + M-53 + M-56).** Overview (tiles + Shipments & Tracking gated
by `brokerage_active`, honest pre-brokerage waitlist per D1/D6) · full
professional in-portal quote form (every directive field: pickup/delivery
company + address + city/state/zip, pickup date, delivery deadline ≥ pickup,
commodity, weight, pallets, L/W/H, 8 equipment types + "not sure",
temperature min/max cross-checked, hazmat, frequency, special instructions,
contact) · My Quotes with a shipper-facing status timeline (internal CRM
stages never leaked) · Documents (honest brokerage-gated state) · Billing
(honest D6 placeholder) · Support · Company Settings · Account Settings.

**Proved here.** `tests/unit/portal-quote.test.ts` (6 tests: city/state/zip
required both ends, deadline-before-pickup rejected, inverted temperature
range rejected, past pickup dates and unknown equipment rejected, weight/dims
bounded); `tests/unit/emails.test.ts` → `QUOTE_STAGE_MAP` parity with the
M-56 timeline; RLS suite's 16 shipper assertions — **including that a
shipper cannot read unclaimed public quotes**, which is the audit §6.3
weakness closed.

**Needs a live environment.** Same as criterion 7 — session-gated rendering.

## 9. Admin account management — ✅ (surface) / ⚠️ (live data)

**Built (M-58 + M-60 + M-61).** `/portal/admin/users` (admin-only): role +
status filters with exact-count pagination, login emails resolved via the
admin auth API, approve / suspend-with-mandatory-reason / reactivate
(self-suspension and admin accounts protected) each writing
`profiles.status` → `account_status_history` → `audit_events` → in-portal
notification → `AccountStatusEmail`; per-carrier onboarding progress (x/5);
dispatcher assignment (`carriers.assigned_dispatcher_id`); carrier
activate/deactivate toggle; staff-invite management.
`/portal/admin/security` = paginated `audit_events` viewer with action filter
and actor resolution. `/portal/admin/mfa` = TOTP enrollment + step-up.
Dispatcher least-privilege via `src/lib/staff-scope.ts` query scoping.

**Proved here.** `tests/unit/staff.test.ts` (7 tests: suspension requires a
reason, only the two staff roles are invitable, 64-hex token shape, empty
dispatcher = unassign, pagination clamps garbage); RLS suite's 33 staff
assertions (a dispatcher cannot write `company_settings`, forge audit rows or
invites, or self-promote; an admin's *browser session* cannot mutate other
accounts — that path is service-role only).

**Needs a live environment.** Rendering (session-gated) and the admin auth
API calls that resolve login emails.

## 10. Staff invite-only — ✅

**Built (S-04, M-58).** There is no self-serve staff signup anywhere. An
admin creates an invite → migration `0012` stores **only the SHA-256 hash**
of a 32-byte token → the raw token exists once, in the invite email →
`/invite/[token]` accept page → `acceptStaffInvite`: rate-limit → hash
lookup → expiry (7 days) + single-use (`accepted_at`) checks → `createUser`
→ **role assigned server-side by the service role** → invite consumed →
audit + ops email.

**Proved here.** `tests/unit/staff.test.ts` → `staffInviteSchema` rejects
customer roles, `acceptInviteSchema` accepts only a 64-hex token;
`tests/e2e/smoke.spec.ts` → "/invite/[token] renders and degrades honestly
without env" (states *no account was created*) and "malformed invite tokens
404"; RLS suite proves **no session — staff or admin — can insert into
`staff_invites` or read a hash and forge an acceptance**; the
`guard_role_change` trigger (4 assertions) blocks self-promotion at the DB.
Marked ✅: the invariant "staff accounts cannot be created by a member of the
public" is proved at the schema, policy, validation and route layers here.

## 11. Carrier RLS isolation (carrier A ⊄ carrier B) — ✅

**Proved here.** `npm run test:rls` → **56 carrier-vs-carrier assertions**
plus 18 membership-helper assertions. Cross-tenant SELECT is blocked on
`carriers`, `documents`, `loads`, `trucks`, `drivers`, `invoices`,
`support_threads`, `support_messages`, `notifications`; every staff ledger
(`carrier_leads`, `contact_messages`, `subscribers`, `email_log`,
`webhook_events`, `audit_events`, `account_status_history`, `staff_invites`,
`lead_activities`) is invisible; cross-tenant INSERT/UPDATE/DELETE is denied
or affects zero rows; a forged `is_staff = true` support message is denied;
self-issued notification and audit rows are denied.

**Anti-vacuity** (why this is a real proof, not a green light on an empty
suite): the shim grants table privileges to `anon` *and* `authenticated` so
policies — not missing grants — are what the anon assertions test; positive
controls assert what must still work (carrier A can insert and delete its own
truck, rename its own profile); and an injected `create policy "REGRESSION
leak" on trucks for select using (true)` made the run abort non-zero with the
exact failing assertion named. Full detail: SECURITY-REVIEW.md §2.

**Caveat (carried, not hidden):** the suite runs against local PG16 with a
shim for Supabase's `auth`/`storage` schemas. Policy logic is proved; JWT
claim shapes, storage-object policies and PostgREST behaviour are not
(residual risks R-6, R-7, R-8 in SECURITY-REVIEW.md §7).

## 12. Shipper RLS isolation (shipper A ⊄ shipper B) — ✅

**Proved here.** `npm run test:rls` → **16 shipper assertions**: own
`freight_quotes` only; shipper B's quotes invisible; **unclaimed public
quotes invisible** (this is the audit §6.3 attack — register with an address
that previously submitted quotes and read that lead's data — proved closed);
direct quote INSERT denied; self-quoting UPDATE denied; company creation
denied; no access to any carrier-side table. The M-32 admin-client
email-matching workaround is retired on the self-signup path
(`src/lib/shipper-quotes.ts`), replaced by the 0008 `shipper_id` FK + the
0009 `"member read own quotes"` policy, exactly as M-32 planned.

## 13. Public forms still functional — ✅

**Built and unchanged in behaviour.** Quick-quote, contact, newsletter,
freight quote, the 4-step carrier wizard with document uploads, and the
`/start-your-trucking-company` funnel. Doctrine intact: rate-limit →
Turnstile → Zod → **service-role insert** → Resend → `email_log`. No anon
insert policies were added anywhere in 0005–0013 (RLS suite: 8 anon INSERTs
denied, 5 anon writes change nothing).

**Proved here.** `tests/e2e/smoke.spec.ts` → quick-quote invalid phone
surfaces the Zod error in `.form-err`, and a valid phone completes gracefully
with `.form-ok` "RECEIVED" on placeholder env (rate-limit and Turnstile
no-op, DB write skipped, email log-only — no crash, no fake success);
`tests/unit/validation.test.ts` (24 tests) covers the schemas;
`tests/unit/guards.test.ts` (12 tests) covers rate-limit fail-**open** and
Turnstile fail-**closed**. The M-62 responsive suite additionally renders
every form page at 7 widths.

## 14. V4 design preserved — ✅ (with one documented nit)

**Held.** No visual redesign happened anywhere in M-50…M-62. New public and
auth surfaces (`/portal` selection, `/create-account` ×3, `/invite/[token]`)
are composed from existing V4 vocabulary (`.svc`, `.services-grid`,
`.bigform`, `.page-hero`, `.btn-amber`). The only change to `v4.css` in the
whole upgrade was M-59 **moving two `@media` blocks verbatim** to the end of
the file — values untouched — because they had been sitting before the rules
they override and were silently dead. `globals.css` gained exactly two
tokens (`--color-amber-aa`, `--color-slate-aa`), which *complete* the M-00
Q7 contrast promise rather than change the palette.

**Proved here.** `tests/unit/v4-slugs.test.ts` (13 tests) pins the V4
dictionary key algorithm against the real `en`/`es` catalogs;
`tests/e2e/smoke.spec.ts` asserts the hero renders through `t.rich` with the
`<em>loaded</em>` emphasis and that the pricing grid still has exactly 3
named plans; the 108-test responsive suite screenshots every route at 5
viewports and asserts nav integrity at 7 widths.

**Documented nit (honest, not swept):** CLAUDE.md says *"never raw hex in
components"*. There are **21 raw-hex occurrences across 12 files** —
`src/components/ui/Logo.tsx` (3, SVG `fill`/`stroke` attributes) and 18
inline-style occurrences in portal components, of which 12 are the single
value `#f2c9c9`. All 21 are exact values from the V4 / U-03 palette already
declared in `v4.css` / `portal.css` (e.g. `.pbadge.red{color:#f2c9c9}`), so
there is **zero visual deviation** — the rule breach is a maintainability
one. Not refactored in M-62 (a finalization module should not touch 12
component files for a cosmetic-parity change on the last commit); logged here
as a post-launch cleanup: promote `#f2c9c9`/`#4CC492` to `--color-error-soft`
/ `--color-mint` and sweep the inline styles.

## 15. SEO intact — ✅

**Proved here.** `tests/e2e/smoke.spec.ts` → `sitemap.xml` returns 200 with
`content-type: xml`, contains `<urlset>`, the equipment pages, the locale
alternates and `hreflang`; `robots.txt` returns 200, `Disallow: /portal`,
`Disallow: /api`, and points at the sitemap. The build report shows the
public surface is still statically generated (50 SSG route entries → 330
prerendered paths) and that **zero portal routes appear in
`.next/prerender-manifest.json`** — verified directly:

```
$ node -e "const m=require('./.next/prerender-manifest.json'); \
           console.log(Object.keys(m.routes).filter(r=>r.includes('portal')))"
[]
```

Every portal page carries `export const dynamic = "force-dynamic"` and
`robots: { index:false, follow:false }`; `/portal` (the pre-auth door) is
`noindex` too. Metadata, canonical URLs, hreflang alternates and JSON-LD
(Organization / Service / FAQ / Article) are unchanged from M-15/M-33/M-35.

## 16. Works 320 → 1920 px — ✅

**Proved here.** `tests/e2e/responsive.spec.ts` (new in M-62) renders 21
routes — 13 public (incl. `/es` for the widest translated nav strings), 7
auth, 1 portal-reachable — at **375, 390, 768, 1024 and 1440 px** with a
full-page screenshot each, and additionally sweeps every route at the two
range endpoints **320 px and 1920 px**. 108 tests, all green.
`tests/e2e/axe.spec.ts` (M-59) independently checks 320 px on 5 pages.
M-59's manual audit covered 360/414/480/820/1280 as well.

## 17. No horizontal overflow — ✅

**Proved here.** Every one of the 21 routes × 7 widths asserts
`documentElement.scrollWidth - clientWidth <= 1`, and — at the collapsed
widths — asserts it again **with the mobile menu open**, which is a distinct
layout. On failure the detector names the widest offending elements and the
exact pixel overshoot, so a regression is actionable rather than a mystery.

**Anti-vacuity:** injecting a `width:3000px` div into the home page made the
same detector report `INJECTED OVERFLOW = 1560`, confirming the measurement
is live and not constant-folding to zero.

## 18. Mobile forms & dashboards usable — ✅ (customer surfaces) / ⚠️ (staff-only tables)

**Built (M-59).** Portal sidebar becomes a proper off-canvas drawer ≤860 px
(sticky mobile bar, backdrop, focus moves in on open and back to the toggle
on close, Escape and route-change close, `aria-expanded`/`aria-controls`/
`aria-current`). Customer-facing tables (carrier loads, invoices, documents,
trucks, drivers, shipper quotes) use a CSS-only table→card transform
(`.ptable--cards` + `data-th`). `.pform-row` and `.bigform` grids collapse to
single column at ≤640/520 px. `@media(pointer:coarse)` bumps portal nav,
mobile-menu links, `.langsel`, `.menu-btn`, `.btn-sm` and table links to
≥44 px.

**Proved here.** The M-62 responsive suite asserts, at every collapsed width,
that `.navlinks` is actually `display:none`, that `.menu-btn` is visible with
a ≥24 px tap target inside the viewport, that all ≥8 mobile-menu entries have
non-zero width, sit inside the viewport and **do not overlap vertically**,
and that opening the menu introduces no overflow. Every form page
(`/create-account/carrier`, `/create-account/shipper`, `/login`,
`/forgot-password`, `/reset-password`, `/invite/[token]`, `/contact`,
`/shippers`, `/become-a-carrier`) is in the matrix.
`tests/e2e/axe.spec.ts` proves 0 WCAG 2.2 A/AA violations on 16 of them.

**Needs a live environment (⚠️ half).** Staff tables (admin loads, users,
security, support) deliberately keep controlled horizontal scroll rather than
card-collapse — dense scan-across data staff use on desktop. Those pages, and
the customer dashboards, are session-gated and could not be rendered in this
lane (proved by the session-gate test). M-59 audited them via a static
harness using the real built CSS. Confirm on staging with a real session.

## 19. Tests pass — ✅

| Lane | Command | Result |
|---|---|---|
| Unit | `npm test` | **168 passed**, 14 files, 9.9 s |
| E2E | `npm run test:e2e` | **145 passed**, 1 chromium project, ~1.5 min |
| RLS isolation | `npm run test:rls` | **165 assertions passed** |

E2E breakdown: 19 smoke (M-41…M-58) + 18 axe/WCAG (M-59) + 108 responsive
(M-62). Net change in M-62: **+108 e2e** (37 → 145). No test was deleted,
skipped or weakened.

## 20. Production build passes — ✅

```
$ rm -rf .next && npm run build
 ✓ Compiled successfully in 26.1s
 ✓ Generating static pages (337/337)
```

**65 route entries**: 50 SSG (330 enumerated prerendered paths across 5
locales), 12 dynamic (`ƒ` — the 4 API routes, `[...rest]`, `blog/[slug]`,
`invite/[token]`, and the parameterised portal detail pages), 3 static files
(`_not-found`, `robots.txt`, `sitemap.xml`). Middleware 104 kB. First-load JS
shared by all: 102 kB. `npm run typecheck` and `npm run lint` are clean on
the same tree.

## 21. Documentation updated — ✅

`docs/modules/M-62-qa-finalization.md` (this module) · this file ·
`docs/modules/INDEX.md` rows for M-50…M-62 · `README.md` rewritten for the
current feature set, command list (incl. `test:rls`) and doc map. Every
module M-50…M-61 already shipped its own `docs/modules/M-XX-*.md` per the
CLAUDE.md rule; M-62 adds no new gaps.

## 22. Runbook updated — ✅

`docs/LAUNCH-RUNBOOK.md` now covers the full upgrade: migrations **0005–0013
in application order with a rollback note per migration**, the audited env-var
table (including three vars declared in `.env.example` that **no code reads** —
called out rather than left implying they matter), Supabase auth email-template
customization (the verify-email path, which is Supabase-side per M-60), staff
MFA setup and the two-admin enrollment rule (residual risk R-5), the in-app
staff invite flow, the `shipper_signup_enabled` switch alongside the other 8
`company_settings` keys, `npm run test:rls` as a **pre-deploy gate**, and a
"Post-cutover verification" section that lists every ⚠️ item from this
document.

## 23. No placeholders presented as real — ✅

**Doctrine.** Every surface that cannot show real data shows an honest state
naming the reason, never fabricated rows. Examples: shipper Billing says
invoices appear after the first booked shipment (D6, because nothing is
invoiced to shippers yet); shipper Tracking is gated on `brokerage_active`
with a waitlist, not a fake map; the admin dashboard shows explicit GA4/GSC
placeholders labelled as such (O-07); the carrier portal says "not linked
yet" when `carriers.profile_id`/membership is absent; the About page shows a
monogram instead of a stock founder photo; testimonials are hidden until 5+
verified reviews exist.

**Proved here (this is the strongest-tested criterion in the list).** The
secretless e2e lane exists precisely to prove it: with no Supabase
credentials, `/create-account/carrier`, `/create-account/shipper` and
`/invite/[token]` must all render the string **"no account was created"** —
three separate e2e assertions. `/forgot-password` must say *"not
configured"*. `/reset-password` must say the session *"is invalid or has
expired"*. A build that silently faked success would fail these tests.
`tests/unit/crypto.test.ts` proves the same principle at the data layer:
without `PII_ENCRYPTION_KEY` the EIN is **dropped, never stored in
plaintext** (`[crypto] refusing to store PII`).

## 24. No fake business claims — ✅

**Held.** MC/USDOT/bond render as **PENDING** from `company_settings`
(`{"status":"pending","value":null}`) — no invented numbers anywhere in the
repo. `brokerage_active` is seeded `false`, which gates every "brokerage
live" message site-wide; shipper self-signup copy is scoped to "request
quotes and coordinate freight with vetted carriers" with no brokerage claims
(decision D1). `stats` ships with `avg_rate: null`, which renders hidden
rather than as a made-up figure. `testimonials_visible: false`.
`packet_downloads_live: false` until lawyer-approved PDFs exist. Legal pages
remain `noindex` until counsel approves the text. Stripe invoices are
**code-enforced** to carry only the dispatch-fee line, never freight charges
(`src/lib/stripe.ts`). All nine `company_settings` keys and the day-the-MC-
activates procedure are in the runbook.

## 25. No exposed secrets — ✅

**Re-run against the M-62 build** (not inherited from M-61):

| Check | Result |
|---|---|
| Secret **value** patterns (`eyJ…`, `sk_live/test_`, `whsec_`, `re_`, `service_role`) in `.next/static` | **0 files** |
| A secret env **name** bound to a value in `.next/static` | **0 files** |
| Any surviving `process.env.<SECRET>` reference in a client chunk | **0 files** |
| `"use client"` modules importing `@/lib/{supabase/admin,env,crypto,audit,stripe,esign,mfa}` | **0 findings** |
| `import "server-only"` first line of the 9 secret-bearing lib modules | **9/9 present** |

The generalising check is the third: Next.js only inlines `NEXT_PUBLIC_*`, and
no `process.env.<secret>` reference survives into any client chunk — so
nothing would leak even with production env set. (The build under test runs
on placeholder credentials, so a value-pattern grep alone would be theatre;
that is stated rather than glossed.) Signed URLs for the private
`carrier-docs` bucket are pinned at 300 s via the exported
`SIGNED_URL_TTL_SECONDS`, and `tests/unit/security.test.ts` **statically
fails CI if any `createSignedUrl(...)` call passes a numeric literal**.
`.gitignore` excludes `.env*`; `git ls-files` carries no env file.

---

## Consolidated live-environment checklist (every ⚠️ in one place)

These are mirrored in `docs/LAUNCH-RUNBOOK.md` § "Post-cutover verification".

1. Create a carrier account through `/create-account/carrier` on staging —
   confirm `auth.users` + `profiles` + `carriers` + `carrier_memberships`
   rows, and the `pending`/`new_authority`/`leased_on` branches.
2. Create a shipper account — confirm role promotion to `shipper` and the
   post-verification quote-claiming one-shot.
3. Receive and click a real Supabase confirmation email; land on
   `/login?verified=1`; sign in. (Requires the customized Confirm-Signup
   template and the redirect allow-list.)
4. Sign in and sign out on every role; confirm each lands on its portal home.
5. Full password-recovery round trip.
6. Render every carrier / shipper / admin portal page with a real session at
   375 px and 1440 px, and re-run the overflow check by hand on the staff
   tables (criterion 18's ⚠️ half).
7. A real TOTP round trip: enroll, verify, obtain AAL2, pass the gate — and
   confirm an AAL1 session is redirected. **Enroll two admins before flipping
   D3 on** (residual risk R-5: no self-service MFA recovery).
8. Re-run `npm run test:rls` against the staging database (`PGHOST`/`PGPORT`
   overrides) to close residual risks R-6/R-7, and add object-level storage
   assertions for R-8.
9. Confirm the 0013 `is_staff()` grant on real Supabase: publish one post,
   leave one draft, and check the blog list, a post page and `sitemap.xml`
   all serve.
10. Send one real email per M-60 template family and confirm the `email_log`
    rows and Resend deliverability.
11. Fire a Stripe test invoice end-to-end and confirm the `invoices` mirror
    row transitions on `invoice.paid`.
12. Dropbox Sign `callback_test` → 200, then a real test-mode signature →
    `agreement_signed_at` set exactly once.

---

## Known deviations carried into launch (nothing here is new in M-62)

| ID | Item | Where documented |
|---|---|---|
| R-1 | RLS is not AAL-aware — a stolen AAL1 staff token still passes `is_staff()` against PostgREST. MFA gates the app surface, not the database. | SECURITY-REVIEW.md §7 |
| R-2 | Dispatcher least-privilege is query scoping (`staff-scope.ts`), not policy. | SECURITY-REVIEW.md §7, M-58 |
| R-3 | `audit_events` writes are best-effort (a ledger hiccup does not roll back an approved action — deliberate). | SECURITY-REVIEW.md §7 |
| R-4 | Postgres error text is rendered on 4 staff-only list pages (deliberate debugging affordance). | SECURITY-REVIEW.md §7 |
| R-5 | No self-service MFA recovery — enroll two admins before enabling. | SECURITY-REVIEW.md §7, runbook |
| R-6/R-7/R-8 | RLS suite runs on shimmed PG16; storage objects not exercised. | SECURITY-REVIEW.md §7 |
| — | ru/ht translations mirror English pending native review (M-42 precedent, 683×5 strings). | Runbook go-live checklist |
| — | Admin surface is English-only (scope decision from M-24). | M-60 |
| — | Team/"invite teammate" UI deferred post-launch; memberships ship as data model + RLS (decision D4). | M-57 |
| — | 21 raw-hex occurrences in 12 components (exact palette values, zero visual deviation). | Criterion 14 above |
