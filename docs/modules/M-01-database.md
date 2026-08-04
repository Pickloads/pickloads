# M-01 — Database Schema, RLS & Storage

**Status:** ✅ Complete (validated on PostgreSQL 16) · **Phase:** 0 · **Date:** 2026-08-04

## What was built

Four ordered migrations + seed implementing Production Architecture v1.2 §4 with every correction from the approved pre-build audit:

| File | Contents |
|---|---|
| `0001_types_and_tables.sql` | 8 enum types, 13 tables, indexes, `updated_at` triggers, fee-computation trigger |
| `0002_rls.sql` | RLS on **all** tables, role helper functions, privilege-escalation guard |
| `0003_auth_and_journal.sql` | Profile auto-creation on signup, automatic CRM status journaling, KPI stamping |
| `0004_storage.sql` | Private `carrier-docs` bucket (10 MB cap, MIME allow-list) + per-carrier folder policies |
| `seed.sql` | `company_settings` launch defaults (PENDING credentials, feature gates) |

## Database changes vs. Architecture v1.2 (each tagged in the SQL)

- **F-03** — `loads.dispatch_fee` is no longer a generated column hard-coded at 5%. `fee_pct_applied` is **snapshotted from the carrier at booking** by the `compute_load_fee()` BEFORE trigger and the fee recomputes on gross changes. *Verified: two carriers at 5%/8% produce $100/$160 on the same $2,000 gross; changing the carrier's rate afterwards does not alter existing loads.*
- **F-04** — `lead_activities` moved after `freight_quotes`; `check (num_nonnulls(lead_id, quote_id) = 1)` enforces exactly one parent. *Verified: orphan insert rejected.*
- **F-07** — new `company_settings` table (arch §9 referenced it, never defined it); RLS enabled on all 13 tables, not 5.
- **F-08** — new `contact_messages` table for the Contact form + Notifications module.
- **F-09** — `loads.dispatcher_id` added (per-dispatcher performance metrics).
- **F-14** — `load_status` enum replaces free text; `posts` slug unique **per locale**; missing indexes added (quotes pipeline, documents review queue, carriers by profile, insurance expiry partial index); file metadata columns on `documents`; `updated_at` everywhere.
- **S-02** — new `webhook_events` table: `(provider, event_id)` unique constraint gives webhook idempotency.
- **O-06** — new `email_log` table backing the Notifications dashboard.
- New: `carrier_leads.first_contacted_at` — powers the "< 15 min first contact" KPI; stamped automatically on the first transition out of `NEW`. *Verified.*

## Security model (decisions Q3, findings F-05/F-06, S-01/S-04)

- **No anonymous write policies exist.** All public-form writes go through server handlers using the service-role key after Zod + Turnstile validation. RLS is defense in depth.
- Role checks use `is_staff()` / `current_user_role()` — `SECURITY DEFINER` helpers that avoid the profiles-inside-profiles RLS recursion (F-06).
- `trg_profiles_role_guard` blocks non-admin role changes → no self-promotion to staff (S-04). Staff accounts are invite-only, promoted by admin.
- `carriers.ein` must be encrypted at the application layer before insert (S-01) — helper lands in M-21 (first module that writes it). W-9/voided-check files live only in the private bucket, served via ≤5-min signed URLs, paths namespaced `{carrier_id}/…`.
- Automatic journaling (`status_change` rows) runs as `SECURITY DEFINER` so it works from both service-role and portal sessions; the activity-touch trigger deliberately skips `status_change` rows to avoid same-row re-update hazards (documented in the SQL).

## How to apply

```bash
# Supabase CLI, staging first:
supabase link --project-ref <staging-ref>
supabase db push          # applies supabase/migrations in order
psql $STAGING_URL -f supabase/seed.sql
# repeat for prod after staging verification
```

Local validation used in this module: PostgreSQL 16 + a shim for `auth`/`storage` schemas (`auth.uid()`, `storage.foldername`). All migrations + seed pass with `ON_ERROR_STOP`.

## Future extension points

- `company_settings` is the single switchboard for launch day (MC/USDOT/bond, testimonials, packet downloads, ticker mode, brokerage flip).
- `lead_activities` covers leads *and* quotes; SMS activity type exists for a future Twilio integration (Q6: deferred).
- `webhook_events` is provider-agnostic — Stripe (M-31) and Dropbox Sign (M-22) share it.
- Type generation: `supabase gen types typescript --linked > src/lib/supabase/database.types.ts` once a project is linked (placeholder committed in M-02).
