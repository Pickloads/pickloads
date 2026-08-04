# M-50 — Upgrade Data Model (migrations 0005–0009)

**Status:** ✅ Complete (validated on PostgreSQL 16) · **Phase:** Upgrade · **Date:** 2026-08-04

## What was built

The full database layer for the customer-account upgrade (docs/UPGRADE-AUDIT.md §5,
approved §10 defaults), as five additive migrations. **0001–0004 remain frozen.**

| File | Contents |
|---|---|
| `0005_accounts_memberships_audit.sql` | `shippers`, `membership_role` enum, `carrier_memberships` + `shipper_memberships` (+ backfill from `carriers.profile_id`), `account_status` enum + `profiles.status`, `account_status_history`, `audit_events`, `user_preferences` |
| `0006_fleet.sql` | `trucks`, `drivers` (+ per-carrier indexes, `updated_at` triggers) |
| `0007_support_notifications.sql` | `support_status` enum, `support_threads`, `support_messages` (5000-char body check), `notifications` (partial unread index) |
| `0008_billing_quotes.sql` | `invoice_status` enum, `invoices` mirror table, `freight_quotes.shipper_id` FK + directive quote fields (hazmat/temp/dims/addresses) + one-shot email backfill |
| `0009_rls_new_tables.sql` | RLS on all 12 new tables, `my_carrier_ids()`/`my_shipper_ids()` SECURITY DEFINER helpers, membership policies, **"member read own quotes"** on `freight_quotes`, additive membership policies on `carriers`/`documents`/`loads` |

`src/lib/supabase/database.types.ts` extended with all new enums/rows/functions
(hand-authored, matching the migrations exactly, same M-02b pattern).
`supabase/seed.sql` gains the `shipper_signup_enabled` flag (decision D1 —
legal can disable shipper self-signup without a deploy).

## Why

- **Sequencing constraint (audit §6.3):** `freight_quotes.shipper_id` + its RLS
  policy MUST exist before any public shipper signup ships (M-53). The M-32
  admin-client email-matching workaround becomes unacceptable once attackers
  can self-register arbitrary emails. This module lands the fix first.
- **Decision D4:** multi-user memberships ship as data model + RLS only;
  single-user UI at launch. `carriers.profile_id` stays for back-compat;
  memberships are the authoritative join for new policies.
- **Invoices mirror (audit §5/0008):** `webhook_events` is an audit ledger, not
  a queryable billing record; the carrier invoices page needs a real source of
  truth while Stripe stays the system of record for money.

## DB changes / security model

- Same 0002 doctrine: **no anon policies**; staff via `is_staff()`; own-data
  via membership helpers; writes to `account_status_history`/`audit_events`/
  memberships/`notifications` are service-role only.
- Backfills, both idempotent one-shots:
  - `carrier_memberships` ← owner rows from `carriers.profile_id` (verified: a
    claimed carrier gets exactly one owner row; unclaimed carriers get none).
  - `freight_quotes.shipper_id` ← case-insensitive email match against shipper
    members' `auth.users.email` (verified; unmatched quotes stay unlinked).
    Runtime claiming (M-53) uses the Supabase-**verified** session email only —
    email-change flows never silently re-link quotes (audit §6.3).
- `profiles.status` defaults to `'active'`; suspension is enforced centrally in
  `requireProfile` (M-54), not per page.
- `support_messages.body` capped at 5000 chars in-schema (audit §6.8); the app
  layer adds rate limiting + escape-first rendering when the support module ships.

## Validation

Local PostgreSQL 16 (M-01 shim pattern: `auth.uid()`, `auth.users`,
`storage.buckets/objects/foldername`, `authenticated`/`anon`/`service_role`
roles). All of 0001–0009 + seed pass under `ON_ERROR_STOP=1`, followed by
assertion checks: both backfills, RLS enabled on all 12 new tables, and
RLS-isolation spot checks (carrier session sees only its own carrier/trucks and
cannot insert into another carrier's fleet; shipper session sees only its
linked quotes/company; non-staff cannot read `audit_events`).

## How to apply

```bash
supabase db push          # applies 0005–0009 in order after the frozen 0001–0004
psql $URL -f supabase/seed.sql   # idempotent; adds shipper_signup_enabled
```

No new env vars. No endpoints.

## Extension points

- `loads.driver_id` / `loads.truck_id` nullable FKs — additive ALTER for the
  load-detail module.
- `staff_invites` (audit 0005 sketch) deliberately deferred to the staff-security
  module (not in the M-50…M-54 scope).
- Memberships support `role='member'` today; the team-UI module only needs an
  invite surface, no schema change.
- `invoices` is written by the billing action + Stripe webhook (carrier
  invoices-page module); rows are additive to the existing `webhook_events` ledger.
