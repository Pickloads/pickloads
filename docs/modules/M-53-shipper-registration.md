# M-53 — Shipper Registration + Portal Linkage

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

## What was built

- **`/create-account/shipper`** + `CreateShipperForm` (V4 `.bigform`):
  directive fields — company, contact, email, phone, **industry** (select,
  reusing V4 industry vocabulary), **shipping frequency**
  (one-time/weekly/monthly/seasonal), **regions** (checkbox set → text[]),
  password. All copy is quote-request-only wording (decision D1 — no
  brokerage claims pre-activation). The page itself honors the
  `shipper_signup_enabled` flag with the honest invite-only fallback.
- **`createShipperAccount` action** (`src/app/actions/account.tsx`): same
  guard stack + never-auto-confirmed anon `signUp` as M-52. Service-role
  post-processing: **role promotion to `shipper`** (server-side only — the
  `guard_role_change` trigger blocks any client session, audit §6.5),
  `shippers` row, owner `shipper_membership`, `audit_events`, internal
  `AccountSignupEmail`. Honest nothing-was-created state without env
  (e2e-pinned).
- **Post-verification → shipper portal** (`/portal/shipper` upgraded):
  - Self-signup accounts (membership exists): un-owned historical quotes
    whose email equals the **Supabase-verified session email** are claimed
    one-shot (service role, `%`/`_` escaped), then quotes are read through
    the cookie-bound client under the 0009 **"member read own quotes"** RLS
    policy — the M-32 admin-client workaround is retired for this path
    (audit §6.3: the FK+RLS landed in M-50, before this signup shipped).
  - Legacy staff-invited accounts (no membership): the documented M-32
    email-matching read stays unchanged.
  - New membership-aware empty state.
- Chooser + `/portal` shipper cards now link `Create Shipper Account →` /
  `Create your shipper account →`.

## Security notes

- Quote claiming never uses signup input — only the verified session email —
  so registering someone else's address links nothing until that address is
  itself verified (audit §6.3; email-change flows don't silently re-link).
- Role is assigned by the server action exclusively; the schema has no role
  field and Zod strips unknown keys.

## i18n / tests

- 20 new public strings via SUPPLEMENTAL (authored es/fr; ru/ht mirror EN) →
  catalog **433 × 5 locales**. Industry options reuse the V4 dictionary's
  existing translated literals ("Retail & E-commerce", "Food & Beverage",
  "Manufacturing", "Agriculture", "Automotive") — no slug collisions added
  (baseline 9 unchanged).
- +1 Playwright test: shipper form renders directive fields and degrades
  honestly without env (16 e2e green).

## Env / deployment

No new env vars. Same Supabase email-confirmation expectation as M-52.
