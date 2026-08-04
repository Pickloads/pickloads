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

## Documentation
- `docs/modules/` — one doc per module: what/why/how, DB changes, endpoints, env vars, deployment, extension points. **Required for every module before it is considered done.**
- `supabase/migrations/` — ordered SQL; every deviation from Architecture v1.2 is tagged with its audit finding ID.

## Phases
1. **Phase 1** — public site + forms + i18n + SEO (lead generation live)
2. **Phase 2** — carrier onboarding, uploads, e-sign, CRM, admin dashboard
3. **Phase 3** — loads, Stripe billing, shipper portal, blog CMS, state pages
