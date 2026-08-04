# M-54 — Role-Aware Redirects, Session States & Role Integrity

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

## What was built

### Role-aware redirects everywhere
- **Post-login fallback** is now `/portal` (the server role router) instead of
  the hard-coded `/portal/carrier` — every role (carrier / shipper /
  dispatcher / admin) lands on its own home via `portalHomeFor`; `?next=`
  still wins (same-origin-only guard unchanged).
- **`/login` and all three `/create-account` pages** role-route
  already-authenticated visitors to their portal home (suspended accounts are
  exempted so they can see the error state instead of looping).
- Per-page role gates (`requireProfile`/`requireStaff`/`requireAdmin` +
  cross-role bounce on every portal page) verified present and unchanged.

### Suspension enforced centrally (audit §6.5)
- `SessionProfile` now carries `profiles.status`; **`requireProfile` redirects
  suspended sessions to `/login?error=suspended`** — every current and future
  portal page inherits enforcement, so suspension is never cosmetic.

### Expired-session handling + clear auth error states
- Middleware: on a protected path with auth cookies present but no valid
  user, the login redirect carries `expired=1` — the login page shows
  "Your session expired — sign in again to continue." instead of a silent
  bounce. A plain auth-wall redirect (`?next=`) shows "Sign in to continue
  where you left off."; `?error=suspended` shows the suspension notice with
  the phone/email path.
- Sign-in errors now distinguish **unverified email** ("Verify your email
  first…", matching the M-52 never-auto-confirm policy) from bad credentials.

### Roles never client-assignable — verified server-side
- Defense layers, each verified:
  1. `/create-account` schemas contain no role field; Zod strips a forged
     `role` key — **unit-tested** (carrier + shipper).
  2. Role assignment happens only in server actions via the service role
     (signup trigger default `carrier`; shipper promotion server-side).
  3. DB backstop `trg_profiles_role_guard` — **verified against PostgreSQL
     16**: an authenticated session's self-promotion to admin raises
     "changing role requires admin" while non-role self-updates succeed
     (added to the M-50 migration check suite, all green).

## Files

`src/lib/auth.ts`, `src/lib/supabase/middleware.ts`,
`src/app/[locale]/(auth)/login/page.tsx`, `src/components/auth/LoginForm.tsx`,
the three `create-account` pages, `tests/unit/account.test.ts` (9 new tests →
**85 unit**), smoke suite (+1 → **17 e2e**), 4 supplemental strings (es/fr) →
catalog **437 × 5 locales**.

## Notes

- No DB changes, no new env vars.
- Approving/suspending accounts from the admin UI is the later
  admin-account-management module; the enforcement and history table are live
  now (writes via service role only).
