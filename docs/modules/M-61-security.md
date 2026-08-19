# M-61 — Security Audit, Staff MFA & RLS Isolation Tests

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-05

Full evidence file: **[`docs/SECURITY-REVIEW.md`](../SECURITY-REVIEW.md)** —
every command, every result, the MFA matrix, the RLS coverage table and the
residual-risk register live there. This doc is the module summary.

## What was built

| Surface | What it does |
|---|---|
| `/portal/admin/mfa` (staff) | Supabase Auth TOTP enrollment + step-up. `mfa.enroll({factorType:"totp"})` → QR rendered from the response's `totp.qr_code` (normalised to a `data:` URL for either SDK shape) with the raw secret offered for manual entry → `challenge` + `verify` activates the factor and mints the AAL2 session. A staff member who is already verified but signed in at AAL1 gets the challenge form alone. Abandoned `unverified` factors are cleaned up before a re-enroll. Status card: account, role, policy, authenticator state, session AAL. Honest "not available in this environment" state without Supabase env. Journals `staff.mfa_enrolled` / `staff.mfa_verified`. |
| MFA enforcement (central) | `src/lib/mfa.ts` computes the state; `enforceStaffMfa()` in `src/lib/auth.ts` is called by **`requireStaff` and `requireAdmin`** — the two gates every one of the 14 existing `/portal/admin/*` pages already funnels through, so current and future staff pages inherit it (same reason suspension lives in `requireProfile`). **`admin` → hard from day one** (unenrolled *or* AAL1 → redirect on every admin route). **`dispatcher` → 14-day grace from `profiles.created_at`**, then identical hard redirect. Satisfaction needs a `verified` factor **and** `currentLevel === "aal2"` — a verified factor alone would let an AAL1 token through. `/portal/admin/mfa` is the single route on `requireStaffNoMfa`, or the redirect loops. |
| Dispatcher countdown banner | `MfaGraceBanner` (server component) renders in the portal shell, so it follows staff across every page while the window is open — days left + the exact deadline + a set-it-up button. Self-hiding: nothing renders once a factor is verified, for non-staff roles, or without auth env. |
| RLS isolation suite | `supabase/tests/` (shim + fixtures + assertions) driven by `scripts/run-rls-tests.sh` → **`npm run test:rls`**. Builds a throwaway DB on local PG16, applies migrations `0001…0013` + seed + two-tenant fixtures, runs **165 assertions**. |
| audit gaps closed | `document.review`, `settings.update`, `invoice.generate` were named in audit §6.2 but journaled nowhere; plus a new `document.download` control (staff pulling a carrier's private W-9/COI/voided check is the highest-PII read in the product — the access is journaled, never the signed URL). All writes now go through one writer, `src/lib/audit.ts`. |

## Decisions applied

- **D3** (audit §10.3) exactly as approved: admin hard, dispatcher 14-day
  grace with a visible banner, customers never gated.
- Graceful degradation is not a fallback but a **requirement**: with
  placeholder env `getMfaState` reports `configured:false`, `satisfied:true`,
  nothing is gated, nothing pretends to be enrolled. The whole test estate
  (168 unit + 37 e2e) runs secretless and stays green.
- **Fail safe on missing data**: a dispatcher whose `created_at` is null or
  unparseable is treated as hard-required, never as permanently exempt.

## DB changes

`0013_public_read_grant_fix.sql` — **a real defect the new suite caught**, not
a refactor. `posts` carries two permissive SELECT policies from 0002;
PostgreSQL ORs them and applies RLS quals before the caller's `WHERE`, so a
row with `published = false` invokes `is_staff()` — whose EXECUTE grant 0002
gave to `authenticated` only. Result on a live project: the anon-key blog
reads in `src/lib/posts.ts` (list, post pages, sitemap) fail the moment one
draft exists — the normal state of the M-33 editor — and the honest-degradation
path turns that into a silently empty blog. The migration grants EXECUTE on
`is_staff()` to `anon`; the function is SECURITY DEFINER/STABLE and returns
`false` for anonymous sessions, so it exposes nothing. Additive — 0001–0004
stay frozen. Validated on PG16 by the suite (anon reads the published post,
still cannot see the draft). `current_user_role()` stays authenticated-only,
with the reason documented in the migration.

## Files

New: `src/lib/mfa.ts` · `src/lib/audit.ts` · `src/app/api/portal/mfa-journal/route.ts`
(M-97: was `src/app/actions/security.ts`; a Server Action there redirected admins
to /login mid-MFA — see docs/modules/M-97-mfa-session.md) ·
`src/app/[locale]/portal/admin/mfa/page.tsx` ·
`src/components/portal/MfaEnrollment.tsx` ·
`src/components/portal/MfaGraceBanner.tsx` ·
`supabase/migrations/0013_public_read_grant_fix.sql` ·
`supabase/tests/{00_shim,10_fixtures,20_rls_isolation}.sql` ·
`scripts/run-rls-tests.sh` · `tests/unit/security.test.ts` ·
`docs/SECURITY-REVIEW.md`.

Changed: `src/lib/auth.ts` (session carries `createdAt`; `enforceStaffMfa`,
`requireStaffNoMfa`, `MFA_ROUTE`) · `portal/layout.tsx` (banner) ·
`PortalSidebar.tsx` (Two-factor auth entry) · `actions/admin.ts` (3 audit
writes + shared TTL) · `actions/billing.ts` (`invoice.generate` + no more raw
Stripe text in the UI) · `actions/carrier.ts` (shared TTL) ·
`src/lib/uploads.ts` (`SIGNED_URL_TTL_SECONDS`) · `package.json`
(`test:rls`).

The M-01 validation shim moves **into the repo** (`supabase/tests/00_shim.sql`)
from its former `/tmp/pgshim` home, with one substantive change: `anon` now
receives the same table grants Supabase gives it in production. Without that,
every anon assertion would have passed because of a missing grant instead of a
policy — vacuously.

## Verification sweep (results; commands in the review doc)

- **Client-bundle secrets: 0.** Three greps over `.next/static` (JWT/`sk_`/
  `whsec_`/`re_`/`service_role` value patterns, secret-name-to-value bindings,
  surviving `process.env.<SECRET>` references) all return 0. The third is the
  one that generalises — nothing would be inlined even with production env.
  Backed by two structural checks: no `"use client"` module imports a
  secret-bearing lib, and all nine of those libs carry `import "server-only"`.
- **Signed URLs: 2 call sites, both ≤ 300 s**, now via the exported
  `SIGNED_URL_TTL_SECONDS`; a unit test pins the value **and** statically
  rejects any numeric literal creeping back into `createSignedUrl(...)`.
- **Error leakage: 1 fixed** (`billing.ts` returned the raw Stripe message —
  request/customer ids — to the staff UI). Public forms, webhooks and signup
  were already returning fixed strings; 4 admin list pages keep rendering the
  Postgres message deliberately (staff-only debugging affordance, logged as
  residual risk R-4).

## Tests / gates

+29 unit (`security.test.ts`: MFA matrix incl. both fail-safe edges, no-env
degradation, signed-URL TTL pins, audit-coverage static scan, error-message
pins) → **168 unit**; **37 e2e** unchanged and green; **165 RLS assertions**
via `npm run test:rls`. `typecheck` · `lint` · `build` clean. No new env vars.

Suite integrity: the RLS harness re-raises any SQLSTATE outside
`42501/23514/P0001` as `RLS TEST BROKEN`, carries positive controls (what
*must* work), and was validated by injecting `create policy "REGRESSION leak"
on trucks for select using (true)` — the run aborted with exit 3 and the exact
failing assertion.

## Deployment

`supabase db push` applies `0013`. Then, per D3, **before** the first admin
signs in: Supabase dashboard → Authentication → Multi-Factor → enable TOTP.
Enroll **two** admins before relying on the hard gate — there is no
self-service recovery by design (residual risk R-5); a lost device needs
another admin to delete the factor in the dashboard.

## Extension points

- **R-1 (High):** RLS is not AAL-aware — a stolen AAL1 staff token still
  passes `is_staff()` against PostgREST. Needs `auth.jwt() ->> 'aal'`
  policies authored against a live project; guessing the claim shape blind
  would lock staff out of the database.
- **R-2:** dispatcher least-privilege is query-scoped (`staff-scope.ts`), not
  policy-enforced; a `0014` additive restrictive policy set closes it without
  touching frozen 0002.
- **R-8:** storage-bucket policies (0004) are applied by the suite but not
  exercised — object-level assertions need real Supabase storage.
- The RLS suite is portable: point `PGHOST`/`PGPORT` at a staging project and
  the same 165 assertions re-run against real Supabase (removes R-6/R-7).
- `recordAuditEvent` is the single insertion point for any future staff
  mutation; `tests/unit/security.test.ts` fails CI if a journaled action loses
  its write.
