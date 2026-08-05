# Module Index — M-00 … M-43 · Upgrade M-50 … M-62 · M-69 → M-70 →

One row per shipped module. Every module passed the full gate (functionality
· responsiveness · WCAG AA · SEO · security · typecheck · lint · build; test
suites from M-40 on). Details live in each module's doc.

**Project status: RESUMED past M-62.** M-62 closed the upgrade directive and
was the final module *of that cycle*; work has since restarted against
[`docs/FINAL-IMPLEMENTATION-PLAN.md`](../FINAL-IMPLEMENTATION-PLAN.md),
which scopes M-69 … M-101 across three build cycles. **M-69 (Production
Integrity Pack) is the first module of the new programme** — Phase A, a
prerequisite that repairs seven live defects (§3, P-1…P-7) before any new
feature is built on them.

**M-70 opens Phase B** — tracking core (M-70 … M-79). It ships the shipment
domain layer only: types, DTO serializers and the tracking-number generator.
The tables land in M-71 and the status-transition engine in M-72.

Current totals: **343 pages** built · **268** unit tests · **160** e2e tests ·
**173** RLS isolation assertions. M-62-era baseline for comparison: 337 pages
· 168 · 145 · 165. Upgrade-directive acceptance is unchanged:
[`docs/UPGRADE-ACCEPTANCE.md`](../UPGRADE-ACCEPTANCE.md) — 17 ✅, 8 ⚠️
(live-environment dependencies, all listed in the runbook's post-cutover
checklist), 0 ❌.

| Module | Phase | Doc | Summary |
|---|---|---|---|
| M-00 | 0 | [M-00-foundations.md](M-00-foundations.md) | Repo, tooling, Next.js 15 + Tailwind v4 setup, V4 design tokens in `globals.css`, security headers, env scaffolding |
| M-01 | 0 | [M-01-database.md](M-01-database.md) | Full schema (13 tables, enums, triggers), RLS on everything (no anon inserts), private storage bucket, `company_settings` switchboard, seed |
| M-02 | 0 | [M-02-auth-core.md](M-02-auth-core.md) | Supabase clients (browser/server/admin), session middleware, `/portal` protection |
| M-02b | 2 | [M-02b-login-and-types.md](M-02b-login-and-types.md) | Portal sign-in page + generated DB types for Phase 2 tables |
| M-10/11 | 1 | [M-10-11-home.md](M-10-11-home.md) | V4 component library + home page (hero, ticker, services, pricing, quick-quote, compliance, packet) — pixel-faithful conversion |
| M-12 | 1 | [M-12-interior-pages.md](M-12-interior-pages.md) | About, Contact, FAQ, Shippers, legal shells (noindex until counsel-approved) |
| M-13 | 1 | [M-13-i18n.md](M-13-i18n.md) | next-intl routing (en default, es/fr/ru/ht prefixed), V4-dictionary extraction pipeline, `useV4()` bridge |
| M-13b | 1 | [M-13b-i18n-migration.md](M-13b-i18n-migration.md) | Completed string migration across all interior pages |
| M-14 | 1 | [M-14-forms.md](M-14-forms.md) | Live lead capture: quick-quote + contact + newsletter + freight quote — rate-limit → Turnstile → Zod → service-role insert → Resend, `email_log` journal |
| M-15 | 1 | [M-15-seo-analytics.md](M-15-seo-analytics.md) | Metadata, hreflang, sitemap/robots, JSON-LD, consent-gated GA4 |
| M-16 | 1 | [M-16-equipment-pages.md](M-16-equipment-pages.md) | 8 `/dispatch/[equipment]` landing pages with original copy |
| M-20/21 | 2 | [M-20-21-onboarding-uploads.md](M-20-21-onboarding-uploads.md) | Become-a-carrier wizard (4 steps), secure document uploads, EIN encryption (S-01) |
| M-22 | 2 | [M-22-esign-webhook.md](M-22-esign-webhook.md) | Dropbox Sign agreement flow + HMAC-verified idempotent webhook |
| M-23 | 2 | [M-23-crm.md](M-23-crm.md) | Leads pipeline (kanban), activities journal, auto status journaling |
| M-24 | 2 | [M-24-admin-dashboard.md](M-24-admin-dashboard.md) | Admin dashboard (sales + operations) and company-settings editor |
| M-25 | 2 | [M-25-carrier-portal.md](M-25-carrier-portal.md) | Carrier portal v1: documents, agreement status, replacements |
| M-26 | 2 | [M-26-new-authority-page.md](M-26-new-authority-page.md) | `/start-your-trucking-company` funnel, `lead_type=new_authority` + auto-tagging |
| M-30 | 3 | [M-30-loads.md](M-30-loads.md) | Loads CRUD + status machine (booked→…→paid, cancellable until money moves) |
| M-31 | 3 | [M-31-stripe.md](M-31-stripe.md) | Stripe dispatch-fee-only invoicing + signature-verified idempotent webhook |
| M-32 | 3 | [M-32-shipper-portal.md](M-32-shipper-portal.md) | Shipper portal v1 (email-matched quotes), role-routed portal homes |
| M-33 | 3 | [M-33-blog-cms.md](M-33-blog-cms.md) | Staff blog editor + publish workflow, escape-first markdown renderer, public blog with Article JSON-LD |
| M-34 | 3 | [M-34-dashboard-dispatch-marketing.md](M-34-dashboard-dispatch-marketing.md) | Dashboard: dispatch KPIs, marketing modules, notifications feed |
| M-35 | 3 | [M-35-state-pages-crons.md](M-35-state-pages-crons.md) | 6 `/truck-dispatch/[state]` pages + daily cron (insurance alerts, callback digest, CRON_SECRET-guarded) |
| M-40 | H | [M-40-unit-tests.md](M-40-unit-tests.md) | Vitest: 76 tests — validation schemas, i18n slug parity, markdown XSS, load state machine, PII crypto, guard degradation |
| M-41 | H | [M-41-e2e-smoke.md](M-41-e2e-smoke.md) | Playwright: 12 chromium smoke tests against the production build, secretless (~13s) |
| M-42 | H | [M-42-password-recovery-i18n.md](M-42-password-recovery-i18n.md) | `/forgot-password` + `/reset-password` flows, login link, 10 supplemental es/fr dictionary strings |
| M-43 | H | [M-43-launch-runbook.md](M-43-launch-runbook.md) | Launch runbook (`docs/LAUNCH-RUNBOOK.md`), README deployment section, this index |
| M-50 | U | [M-50-data-model.md](M-50-data-model.md) | Upgrade data model: migrations 0005–0009 (shippers, memberships + backfill, account status/history, audit, preferences, fleet, support, notifications, invoices, `freight_quotes.shipper_id` FK + RLS), extended DB types |
| M-51 | U | [M-51-portal-selection.md](M-51-portal-selection.md) | Pre-auth `/portal` selection page (two V4 cards), header Login + Get Started, mobile menu + Support entries, real topbar/footer auth links (Coming-Soon toasts removed) |
| M-52 | U | [M-52-create-account-carrier.md](M-52-create-account-carrier.md) | `/create-account` chooser (D1-gated shipper door) + carrier registration with authority-status routing (onboarding / pending / new-authority / leased-on manual review), never-auto-confirmed signups, verified-email loop |
| M-53 | U | [M-53-shipper-registration.md](M-53-shipper-registration.md) | Shipper registration (industry/frequency/regions, quote-request wording), server-side role promotion, post-verification quote claiming + RLS-scoped shipper portal reads (admin-client workaround retired for self-signups) |
| M-54 | U | [M-54-role-redirects.md](M-54-role-redirects.md) | Role-aware redirects everywhere (login fallback → `/portal` router, authed auth-pages bounce), central suspension enforcement, expired-session + suspended + unverified-email states, role-integrity verified (unit + PG trigger checks) |
| M-55 | U | [M-55-carrier-portal-completion.md](M-55-carrier-portal-completion.md) | Carrier portal completion: overview dashboard, D5 profile editing + change requests, trucks/drivers CRUD, agreements + re-send, invoices mirror surface, notifications, support threads (+staff inbox), account settings; migration 0010 |
| M-56 | U | [M-56-shipper-portal-completion.md](M-56-shipper-portal-completion.md) | Shipper portal completion: overview with brokerage-gated tracking waitlist, full professional quote form (0011 fields, membership-verified insert), quotes status timeline, honest documents/billing states, support, company + account settings |
| M-57 | U | [M-57-membership-architecture.md](M-57-membership-architecture.md) | Membership doctrine surfaced app-wide: wizard claims now write owner memberships, last profile_id lookups converted (loads page, billing email, cron alerts — owner-first with legacy fallback), statically pinned by test; invite-teammate extension path documented |
| M-58 | U | [M-58-admin-account-management.md](M-58-admin-account-management.md) | Admin account management: /portal/admin/users (filter/paginate, approve/suspend + history/audit/email/notification, onboarding progress, dispatcher assignment), tokenized single-use staff invites (0012), security log, dispatcher least-privilege query scoping |
| M-59 | U | [M-59-responsive-a11y.md](M-59-responsive-a11y.md) | Responsive + WCAG 2.2 AA sweep: V4 media-block ordering root-cause fix, off-canvas portal drawer, table→card transform, skip links, contrast tokens, axe e2e scan over 16 pages |
| M-60 | U | [M-60-email-suite.md](M-60-email-suite.md) | Customer email suite: 15 localized React Email builders on a shared CustomerEmail layout, `notify.ts` fan-out (notification + email + journal), wired across signup/onboarding/documents/agreements/billing/quotes/support; admin quotes desk + carrier activate toggle |
| M-61 | U | [M-61-security.md](M-61-security.md) | Security audit: staff TOTP MFA (`/portal/admin/mfa`, admin hard / dispatcher 14-day grace, central gate in `requireStaff`/`requireAdmin`), 165-assertion RLS isolation suite (`npm run test:rls`) that caught + fixed a live anon-grant defect (0013), audit_events gaps closed, secret/TTL/error-leak sweep, [SECURITY-REVIEW.md](../SECURITY-REVIEW.md) |
| M-62 | U | [M-62-qa-finalization.md](M-62-qa-finalization.md) | **Final module.** Responsive suite (`tests/e2e/responsive.spec.ts`, 108 tests: 21 routes × 375/390/768/1024/1440 with full-page screenshots + 320/1920 endpoint sweep; no-overflow and nav clip/overlap assertions, injected-regression validated; baseline PNGs deliberately not committed — 33 MB, decision documented); [UPGRADE-ACCEPTANCE.md](../UPGRADE-ACCEPTANCE.md) walking all 25 directive §24 criteria (17 ✅ / 8 ⚠️ live-env / 0 ❌); runbook rewritten for M-50…M-61 (migrations 0005–0013 order + per-migration rollback, audited env table incl. 3 declared-but-unused vars, Supabase auth email templates, staff MFA + two-admin rule, in-app invite flow, 9 `company_settings` keys, `npm run test:rls` as a release gate, post-cutover checklist); INDEX + README |

| M-69 | A | [M-69-production-integrity.md](M-69-production-integrity.md) | **First module past M-62.** Production Integrity Pack — the seven live defects in `FINAL-IMPLEMENTATION-PLAN` §3: tokenized `/newsletter/unsubscribe` (5 locales, GET-renders/POST-acts, idempotent, rate-limited) + RFC 8058 one-click endpoint and `List-Unsubscribe` header pair, closing the CAN-SPAM gap the confirmation email promised (P-1, migration 0014 — dedicated `unsubscribe_token`, rationale documented); the sitewide referral-bonus promise gated behind a new `referral_program_active` key with the approved copy and all five translations kept intact (P-2, 0015 + seed); the ungated "Freight Brokerage" footer label gated on `brokerage_active` with the already-approved "For Shippers" fallback (P-3); all 10 direct `audit_events` inserts across 4 action files routed through `src/lib/audit.ts` with unchanged semantics, plus an ESLint `no-restricted-syntax` rule (injection-validated) that keeps it that way (P-4); `document.download` journalled on the carrier path — actor/document/carrier, never the signed URL (P-5); `packet_downloads_live` and `testimonials_visible` wired from dead config to real behaviour through a new fail-closed `company-settings` accessor, with the V4 testimonial markup restored behind a double lock and zero sample content (P-6); `formatRpm` → `formatLoadedRpm` with every label corrected, new `formatTrueRpm` and nullable `loads.deadhead_miles` + capture field — no displayed value silently changed (P-7, 0016) |
| M-70 | B | [M-70-shipment-domain.md](M-70-shipment-domain.md) | **Opens Phase B.** Shipment domain foundation — no migrations, no routes, no UI: `src/lib/shipments/types.ts` (§6's 18 statuses in lifecycle order behind a `satisfies Record<ShipmentStatus, …>` guard; §7 event type/source/visibility with a **fifth `broker` band** added for the same reason `FINAL-IMPLEMENTATION-PLAN` §4 flags on `doc_visibility` — without it §12's "BOL, when authorized" is unimplementable; §9 tracking modes + the four location-visibility levels; §10 ETA source/confidence; §16 document types + visibility; §21's 13 exception types + severity; 10 row types M-71's DDL is written from, incl. `ShipmentRow` (§18 expanded, `@staffOnly` tags on `gross_shipper_amount`/`carrier_pay`/`margin`) and `ShipmentEventRow` with all 18 §7 fields incl. `idempotency_key`/`external_event_id`/`metadata`; `statusKey()` and siblings returning i18n KEYS — no catalogue entries, those land with M-73's UI in five locales); `tracking-number.ts` (`PL-YYYY-######` — CSPRNG sequence with rejection sampling, UTC year, tolerant normalisation ↔ canonical storage, strict rejection incl. adjacent-year and overflow, and the SQL pattern + unique-index + immutability-trigger names exported so M-71's DDL cannot drift; the guessing mitigation documented honestly — the number is an identifier, never a credential, per §5's own "secure secondary verification"); `dto.ts` (five audience serializers built by **explicit allow-list construction** — no spread, no `delete` — so a future column defaults to invisible; §4's forbidden list absolute for the public audience, `public_access_hash` serialized by nobody including staff, staff-only event bands unreachable from any customer timeline, §9's four privacy levels applied per audience with `exact` capped at city/state for public visitors). +77 unit (**268**) incl. key-set equality per audience, a sentinel sweep over serialized JSON, a `@staffOnly` static scan, a structural guard on `dto.ts` itself, and three anti-vacuity checks proving the safety assertions can fail. 173 RLS + 160 e2e unchanged (no schema, no surface) |

Phases: 0 = foundations · 1 = public site · 2 = onboarding/CRM · 3 =
loads/billing/content · H = hardening · U = upgrade directive (M-50a audit) ·
A = integrity prerequisite (FINAL-IMPLEMENTATION-PLAN phase A) · B = tracking
core (FINAL-IMPLEMENTATION-PLAN phase B).
