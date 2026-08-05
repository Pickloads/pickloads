# PickLoads — Production Platform

Production application for **PickLoads Logistics Group LLC** (pickloads.com) — truck dispatching & freight brokerage. Built per **Production Architecture v1.2** with the approved V4 prototype as the sole visual reference, then extended by the customer-account upgrade directive (M-50…M-62).

**Status: feature-complete, pre-launch.** 337 pages · 168 unit tests · 145 e2e tests · 165 RLS isolation assertions, all green. What still needs a live Supabase/Stripe/Resend project to finish proving is listed honestly in [`docs/UPGRADE-ACCEPTANCE.md`](docs/UPGRADE-ACCEPTANCE.md) (17 ✅ / 8 ⚠️ / 0 ❌).

## Stack (approved — do not substitute)
Next.js 15 App Router (pinned — no 16) · TypeScript strict · Tailwind CSS v4 · Supabase (Postgres/Auth/Storage/RLS) · next-intl (en/es/fr/ru/ht) · React Hook Form + Zod 4 · Resend + React Email · Cloudflare Turnstile · Upstash Redis (rate limiting) · Stripe (dispatch-fee invoicing only) · Dropbox Sign (e-sign) · Vercel

## Feature set

**Public site** — home, about, contact, FAQ, shippers, become-a-carrier wizard, start-your-trucking-company funnel, blog (staff CMS → public), legal shells, 8 `/dispatch/[equipment]` pages, 6 + index `/truck-dispatch/[state]` pages. Five locales, hreflang, sitemap, JSON-LD, consent-gated GA4. Five public forms, all behind rate-limit → Turnstile → Zod → service-role insert → Resend → `email_log`.

**Accounts** — `/portal` pre-auth door, `/create-account` chooser, carrier registration with four-way authority-status routing, shipper registration (industry/frequency/regions, gated by `shipper_signup_enabled`), never-auto-confirmed signups with a verified-email loop, login/logout, password recovery, role-aware redirects, central suspension enforcement, company memberships (owner/member) as the authoritative tenant join.

**Carrier portal** — overview dashboard · company profile (self-serve preferences, change requests for regulated fields) · trucks · drivers · documents (upload/replace/review/≤300 s signed download) · agreements · loads · invoices · notifications · support · account settings.

**Shipper portal** — overview (tracking gated on `brokerage_active`) · full professional quote form (addresses, hazmat, temperature, dimensions, deadlines) · quotes with a shipper-facing status timeline · documents · billing · support · company + account settings.

**Staff portal** — dashboard (sales, operations, dispatch, marketing, notifications) · leads CRM (kanban + journal) · loads + status machine + Stripe invoicing · freight-quote desk · blog editor · users (filter, approve/suspend with reason, dispatcher assignment, carrier activation, staff invites) · security/audit log · `company_settings` switchboard · TOTP MFA enrollment.

**Cross-cutting** — 15 localized customer email templates + `notify.ts` fan-out · generic `audit_events` ledger · WCAG 2.2 AA (skip links, off-canvas portal drawer, table→card transform, contrast tokens) · staff TOTP MFA (admin hard, dispatcher 14-day grace) · RLS on every table with no anon insert policies anywhere.

## Getting started
```bash
npm install
cp .env.example .env.local   # fill in Supabase staging keys at minimum
npm run dev
```

Every integration degrades gracefully when its secret is missing — the app shows an honest state ("no account was created", "not configured") and never fabricates success. That property is enforced by the secretless e2e lane.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | Production build (337 pages) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit`, strict + `noUncheckedIndexedAccess` |
| `npm run lint` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Vitest unit suites — **168 tests** |
| `npm run test:e2e` | Playwright chromium — **145 tests** (needs `npm run build` first) |
| `npm run test:rls` | **165 RLS isolation assertions** against a local PostgreSQL 16 |

## Testing

- **`npm test`** (`tests/unit/`, 14 files) — validation schemas, account/staff/portal/quote schemas, i18n slug parity, markdown XSS (string + DOM), load state machine, PII crypto, rate-limit/Turnstile degradation, MFA requirement matrix, email localization, and a static membership-doctrine scan that fails CI if a portal page queries a company by `profile_id` instead of the membership helpers.
- **`npm run build && npm run test:e2e`** (`tests/e2e/`) — 19 smoke + 18 axe/WCAG 2.2 AA + 108 responsive tests against the production build on :4321, all secretless. Kill any stale `next-server` before running: `reuseExistingServer` is on, and a server from an older build serves dead chunk hashes.
- **`npm run test:rls`** (`supabase/tests/`) — rebuilds a throwaway database from migrations `0001 → 0013` + seed + two-tenant fixtures and proves carrier A ⊄ carrier B, shipper A ⊄ shipper B, anon reaches nothing but `company_settings` and published posts, and no session can forge an audit row, invite or role change. Requires a local PG16; deliberately **not** part of `npm test` (vitest must stay database-free). **This is a release gate** — see the runbook.

## Deployment

Full ordered go-live procedure: **[`docs/LAUNCH-RUNBOOK.md`](docs/LAUNCH-RUNBOOK.md)** — Supabase staging/prod (migrations 0001–0013 **with per-migration rollback notes** → seed → auth config + email templates → first admin → MFA enrollment → staff invites → generated types), audited Vercel env-var table, DNS, Resend SPF/DKIM, Turnstile, Upstash, Stripe + Dropbox Sign webhooks, `CRON_SECRET`, GA4/Search Console, the pre-deploy gate, the go-live checklist, post-cutover verification, and the "day the MC activates" one-pager.

Short version:
1. Create Supabase staging + prod projects; apply `supabase/migrations/` **in order (0001 → 0013)**, run `supabase/seed.sql`, configure auth URLs + email templates + TOTP, create **two** admins, enroll MFA, regenerate `src/lib/supabase/database.types.ts`.
2. Import the repo into Vercel; set every variable from the runbook's env table (staging keys on Preview, live on Production). Missing secrets degrade gracefully — but production must have all of them.
3. Point DNS at Vercel, verify the Resend domain (SPF/DKIM), register the Stripe (`/api/stripe/webhook`) and Dropbox Sign (`/api/esign/webhook`) endpoints, set `CRON_SECRET`.
4. Work through the go-live checklist (legal docs, the nine `company_settings` keys, 2 blog posts, RU/HT native review) and the post-cutover verification list before announcing.

Iron rules: `SUPABASE_SERVICE_ROLE_KEY` is server-only (never `NEXT_PUBLIC_`); `NEXT_PUBLIC_*` values are inlined at build time — changing one requires a redeploy; migrations `0001–0004` are frozen, all new work is `0005+`.

## Documentation

| Doc | What it is |
|---|---|
| [`docs/modules/INDEX.md`](docs/modules/INDEX.md) | One row per shipped module, M-00 … M-62. Start here. |
| `docs/modules/M-XX-*.md` | One doc per module: what/why/how, DB changes, endpoints, env vars, deployment, extension points. **Required before a module counts as done.** |
| [`docs/UPGRADE-AUDIT.md`](docs/UPGRADE-AUDIT.md) | The M-50a repository audit the upgrade was planned from: gap list, DB plan, risks, module plan, and the 7 business decisions (D1–D7). |
| [`docs/UPGRADE-ACCEPTANCE.md`](docs/UPGRADE-ACCEPTANCE.md) | Every directive §24 acceptance criterion with its status and the evidence — including what can only be proved against live services. |
| [`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md) | M-61 evidence: RLS suite design, the `0013` defect it caught, `audit_events` coverage, MFA enforcement matrix, secret sweep, 8 residual risks. |
| [`docs/LAUNCH-RUNBOOK.md`](docs/LAUNCH-RUNBOOK.md) | Production go-live procedure. |
| `supabase/migrations/` | Ordered SQL; every deviation from Architecture v1.2 is tagged with its audit finding ID. |
| `supabase/tests/` | RLS isolation shim, fixtures and assertions. |
| [`CLAUDE.md`](CLAUDE.md) | Engineering rules and the module gate. |

## Phases
1. **Phase 1** — public site + forms + i18n + SEO (lead generation live)
2. **Phase 2** — carrier onboarding, uploads, e-sign, CRM, admin dashboard
3. **Phase 3** — loads, Stripe billing, shipper portal, blog CMS, state pages
4. **Hardening** — unit + e2e suites, password recovery, launch runbook (M-40…M-43)
5. **Upgrade** — customer account system, portal completion, memberships, admin account management, email suite, responsive/a11y sweep, security audit, final QA (M-50…M-62)
