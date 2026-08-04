# M-02b — Phase 2 Types & Portal Sign-In

**Status:** ✅ Complete · **Phase:** 2 · **Date:** 2026-08-04

## What was built
- **`database.types.ts` extended** with the Phase 2 tables the M-01 migrations
  already define: `carriers`, `documents`, `lead_activities`, `webhook_events`.
  Same type-alias + `Relationships: []` pattern M-14 established (supabase-js's
  `GenericSchema` requirement). Schema untouched — types mirror the SQL 1:1.
  `carriers.ein` is documented as ciphertext-only (S-01; helper lands in M-21).
- **`/login`** — `(auth)` route group under `[locale]` with minimal chrome
  (Topbar only; sign-in is a utility surface). V4 `.bigform` vocabulary on a
  `.light` section under `PageHero`. Email + password via the **browser**
  Supabase client (auth flows are the one legitimate anon-key surface, Q3),
  U-03 loading/error states, `noindex`.
- **Redirect contract:** success navigates (full page load, so middleware sees
  the new cookies) to `?next=` when it is a safe same-origin relative path,
  else `/portal/carrier`. Open-redirect guarded (`/` prefix, `//` rejected).
- **Middleware fix:** `/portal` protection now recognizes locale-prefixed
  paths (`/es/portal/...`) — `updateSession` strips the locale segment before
  matching `PROTECTED_PREFIXES` and redirects to `{locale}/login?next=`.
- **Chrome updates:** Topbar + Footer "Carrier Login" is a real link now
  (Shipper Login stays Coming Soon until M-32).

## Graceful degradation
With placeholder/absent `NEXT_PUBLIC_SUPABASE_URL` the form renders normally
and submits show a clear "not configured in this environment" error instead of
a crash. Build requires no secrets.

## DB changes
None.

## Endpoints
None (client-side `signInWithPassword`; session cookies via @supabase/ssr).

## Env vars
None new — uses `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Deployment
None new. Password reset flow is a Phase 2 leftover (Supabase hosted reset
email works once SMTP is configured; an in-app `/reset` page can follow).

## Extension points
- `safeNext()` in `LoginForm` is the single redirect policy point.
- Staff MFA enforcement (S-04) attaches to this flow when enabled in Supabase.
- `/login` is deliberately locale-routed: translations flow through `useV4`
  as soon as dictionary entries exist.
