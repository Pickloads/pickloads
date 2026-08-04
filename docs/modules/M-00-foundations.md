# M-00 — Repo, Tooling & Design Tokens

**Status:** ✅ Complete · **Phase:** 0 · **Date:** 2026-08-04

## What was built

Production repo scaffold: Next.js **15.5** (App Router) + TypeScript strict + Tailwind CSS v4, with the V4 prototype's design tokens, security headers, and the project structure from Production Architecture v1.2 §3.

## Why it was built this way

- **Next.js pinned to 15.x** — the build directive mandates Next 15. `create-next-app` produced Next 16; it was pinned back. Consequence: Next 15 bundles postcss/sharp versions with 3 high npm-audit advisories fixed only in Next 16. **Resolved via `overrides` in package.json** (postcss ^8.5.25, sharp ^0.35.3) → `npm audit`: 0 vulnerabilities. Re-check after any `npm install`.
- **Tailwind v4 CSS-first tokens** (`src/app/globals.css` `@theme`) — every color/font/rhythm value copied verbatim from the V4 `:root` and component CSS, including the ~14 secondary grays V4 uses inline. Components must reference tokens, never raw hex.
- **Fonts via `next/font`** — same three families/weights the prototype loads from Google Fonts (Overpass 600–900, Barlow 400–600, IBM Plex Mono 400–600 + cyrillic subset for RU), self-hosted for Core Web Vitals and privacy (no request to Google at runtime).
- **Security headers in `next.config.ts`** (audit S-06): CSP scoped to the approved third parties (Turnstile, GA4, Supabase, Maps embed), HSTS, nosniff, frame-ancestors none, restrictive Permissions-Policy. `script-src` still allows `unsafe-inline` for GA bootstrap — tighten with nonces in M-15 if feasible.
- **TS strict extras**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. No `any` allowed (directive).

## How it works

- `src/app/layout.tsx` — root pass-through layout; the real shell moves to `src/app/[locale]/layout.tsx` in M-13 (next-intl).
- `globals.css` — V4 base styles (body 16.5px Barlow on asphalt, display headings, focus-visible amber outline) + `scroll-margin-top` fix (audit U-05).
- Folder layout mirrors arch §3: `src/components/{layout,sections,ui,forms}`, `src/lib/{supabase,validation,email}`, `content/{equipment,states}`, `messages/`, `supabase/migrations/`, `docs/modules/`.

## Environment variables

See `.env.example` — grouped by service, Phase 2+ keys left empty by design. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never get a `NEXT_PUBLIC_` prefix.

## Deployment requirements

- Vercel project (preview + production), Node 22.
- Two Supabase projects (staging + prod — decision Q8); apply migrations in order (see M-01).
- Upstash Redis database (decision Q4), Resend domain with SPF/DKIM, Turnstile site.
- Sentry DSN (decision Q8) — wiring lands with M-14 (first server actions worth instrumenting).

## Future extension points

- `@theme` tokens are the single place to evolve the design system.
- CSP is a string list — new third parties (Stripe JS, Dropbox Sign embed) get added per phase, never wildcarded.
- WCAG AA color exceptions (decision Q7) will be introduced as `*-aa` token variants in M-10 with a contrast report; none created yet.
