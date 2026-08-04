# M-02 — Auth Core (Supabase Clients & Middleware)

**Status:** ✅ Complete · **Phase:** 0 · **Date:** 2026-08-04

## What was built
- `src/lib/supabase/client.ts` — browser client (anon key; auth flows + Phase 2 portal reads only — never public writes, per decision Q3).
- `src/lib/supabase/server.ts` — cookie-bound server client for RLS-governed authenticated reads.
- `src/lib/supabase/admin.ts` — service-role client, guarded by `import "server-only"` (client-bundle import = build error). The ONLY write path for public-form data.
- `src/lib/supabase/middleware.ts` + `src/middleware.ts` — session refresh on every request; `/portal/*` redirects unauthenticated users to `/login?next=…` (login page ships with the Phase 2 portal).
- `src/lib/supabase/database.types.ts` — hand-authored types matching the M-01 migrations for Phase 0/1 tables. **Replace with `supabase gen types typescript --linked` output once a project is linked** and diff.
- `src/lib/env.ts` — fail-fast accessor for server secrets.

## Why this way
@supabase/ssr's documented App Router pattern (getAll/setAll cookie contract, no logic between client creation and `getUser()`); the three-client split makes the Q3 security model structurally enforceable rather than conventional.

## Env vars
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only).

## Extension points
- `PROTECTED_PREFIXES` in `middleware.ts` — add `/portal/admin` role gating in M-24 (role from JWT claim).
- next-intl middleware composes here in M-13.
