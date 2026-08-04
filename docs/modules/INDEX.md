# Module Index — M-00 … M-43 · Upgrade M-50+

One row per shipped module. Every module passed the full gate (functionality
· responsiveness · WCAG AA · SEO · security · typecheck · lint · build; test
suites from M-40 on). Details live in each module's doc.

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

Phases: 0 = foundations · 1 = public site · 2 = onboarding/CRM · 3 =
loads/billing/content · H = hardening · U = upgrade directive (M-50a audit).
