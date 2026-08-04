# M-52 — /create-account Chooser + Carrier Registration

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

## What was built

- **`/create-account`** (auth route group, V4 `.svc` cards) — the directive's
  role chooser. Carrier door → `/create-account/carrier`. Shipper door is
  gated by the `shipper_signup_enabled` company_settings flag (decision D1;
  default ON, quote-request-only wording, honest invite-only card when OFF);
  until M-53 lands the open door routes to the `/shippers` quote funnel.
- **`/create-account/carrier`** + `CreateCarrierForm` (V4 `.bigform`):
  authority-status select drives fields and routing —
  | Authority status | Routing (directive M-52) |
  |---|---|
  | active | full account → **onboarding** (M-20 wizard CTA); MC # required |
  | pending | account parked `profiles.status='pending'` + `account_status_history` reason; honest tracking copy |
  | none (needs help) | **full account** (decision D7) + `lead_type='new_authority'` funnel tagging → launch checklist CTA |
  | leased-on | `status='pending'` + `account_status_history` **manual-review flag** + high-priority CRM lead |
- **`createCarrierAccount` server action** (`src/app/actions/account.tsx`):
  full public-write guard stack (rate limit → Turnstile → Zod →
  service-role). The auth user is created via the cookie-bound **anon
  `signUp`** (the one legitimate anon surface, Q3) so Supabase sends its own
  verification email — public signups are **never auto-confirmed** (audit
  §6.4; auto-confirm stays scoped to the in-flow wizard). Then service-role:
  profile enrich, `carriers` row (inactive), owner `carrier_membership`, CRM
  lead (`source='create_account'`, routing tag), `audit_events`
  (`account.signup`), internal `AccountSignupEmail` notification.
- **Verification loop:** `emailRedirectTo` → locale-preserving
  `/login?verified=1`; the login form shows a "✓ Email verified" banner.
  Duplicate emails are caught both via error text and Supabase's
  anti-enumeration stub (`identities: []`).
- **Honest without env:** no service key → the success panel states plainly
  that *nothing was created* (never a fake "check your email"); e2e-pinned.
- Header/mobile **Get Started** now targets `/create-account`; the `/portal`
  carrier card's create link targets `/create-account/carrier`.

## Security

- Roles are never client-assignable (audit §6.5): the action has no role
  input, Zod strips unknown keys, the signup trigger defaults to `carrier`,
  and `trg_profiles_role_guard` blocks any client-side role update.
- Same rate-limit key (`create-account`) for the whole surface; Turnstile
  fail-closed when configured; password 8–72 (bcrypt bound).
- `account_status_history` writes are service-role only (0009 RLS).

## Validation / i18n / tests

- `src/lib/validation/account.ts`: carrier + shipper schemas (shipper used in
  M-53); MC # required only when authority is active (refine).
- 44 new public strings via SUPPLEMENTAL (authored es/fr; ru/ht mirror EN,
  M-42 precedent) → catalog 366 → **413 × 5 locales**. One M-51 string was
  reworded ("Get quotes and coordinate…") to avoid a 56-char slug collision.
- 2 new Playwright tests: chooser renders both doors; secretless carrier
  registration surfaces the honest no-env message.

## Env / deployment

No new env vars. Requires Supabase email confirmations **enabled** in the
project (default) — documented judgment: if disabled project-side, the action
reports the honest "you're signed in" state instead.
