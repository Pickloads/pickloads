# PickLoads — Production Platform

Production application for **PickLoads Logistics Group LLC** (pickloads.com) — truck dispatching & freight brokerage. Built per **Production Architecture v1.2** with the approved V4 prototype as the sole visual reference.

## Stack (approved — do not substitute)
Next.js 15 App Router · TypeScript strict · Tailwind CSS v4 · Supabase (Postgres/Auth/Storage/RLS) · next-intl (en/es/fr/ru/ht) · React Hook Form + Zod · Resend + React Email · Cloudflare Turnstile · Upstash Redis (rate limiting) · Stripe (Phase 3) · Dropbox Sign (Phase 2) · Sentry · Vercel

## Getting started
```bash
npm install
cp .env.example .env.local   # fill in Supabase staging keys at minimum
npm run dev
```

## Commands
`dev` · `build` · `typecheck` · `lint` · `format` · `test` (Vitest) · `test:e2e` (Playwright)

## Testing
- `npm test` — Vitest unit suites (`tests/unit/`): validation schemas, i18n slug parity, markdown XSS safety, load state machine, PII crypto, guard degradation.
- `npm run build && npm run test:e2e` — Playwright smoke suite (`tests/e2e/`) against the production build on :4321. Restart the server after rebuilding (`reuseExistingServer` is on).

## Deployment
Full ordered go-live procedure: **[`docs/LAUNCH-RUNBOOK.md`](docs/LAUNCH-RUNBOOK.md)** — Supabase staging/prod (migrations → seed → first admin → generated types), Vercel env-var table, DNS, Resend SPF/DKIM, Turnstile, Upstash, Stripe + Dropbox Sign webhooks, `CRON_SECRET`, GA4/Search Console, the go-live checklist and the "day the MC activates" one-pager.

Short version:
1. Create Supabase staging + prod projects; apply `supabase/migrations/` **in order**, run `supabase/seed.sql`, create the first admin (SQL snippet in the runbook), regenerate `src/lib/supabase/database.types.ts` via `supabase gen types`.
2. Import the repo into Vercel; set every variable from the runbook's env table (staging keys on Preview, live on Production). Missing secrets degrade gracefully — but production must have all of them.
3. Point DNS at Vercel, verify the Resend domain (SPF/DKIM), register the Stripe (`/api/stripe/webhook`) and Dropbox Sign (`/api/esign/webhook`) endpoints, set `CRON_SECRET`.
4. Work through the runbook's go-live checklist (legal docs, `company_settings`, 2 blog posts, RU/HT review) before announcing.

Iron rules: `SUPABASE_SERVICE_ROLE_KEY` is server-only (never `NEXT_PUBLIC_`); `NEXT_PUBLIC_*` values are inlined at build time — changing one requires a redeploy.

## Documentation
- `docs/modules/INDEX.md` — one-table summary of every module (M-00…M-43).
- `docs/modules/` — one doc per module: what/why/how, DB changes, endpoints, env vars, deployment, extension points. **Required for every module before it is considered done.**
- `docs/LAUNCH-RUNBOOK.md` — production go-live procedure.
- `supabase/migrations/` — ordered SQL; every deviation from Architecture v1.2 is tagged with its audit finding ID.

## Phases
1. **Phase 1** — public site + forms + i18n + SEO (lead generation live)
2. **Phase 2** — carrier onboarding, uploads, e-sign, CRM, admin dashboard
3. **Phase 3** — loads, Stripe billing, shipper portal, blog CMS, state pages
4. **Hardening** — unit + e2e test suites, password recovery, launch runbook (M-40…M-43)
