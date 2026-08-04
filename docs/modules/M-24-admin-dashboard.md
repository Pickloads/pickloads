# M-24 — Admin Dashboard (Sales + Operations) & Company Settings

**Status:** ✅ Complete · **Phase:** 2 · **Date:** 2026-08-04

## What was built

### `/portal/admin` (staff)
Arch §7 tiles, computed in the server component over the 1000 most recent
leads (RLS-scoped reads):
- **Sales:** new leads 24h / 7d / 30d · full 9-status pipeline funnel ·
  lead→active conversion rate · **avg first-contact time vs the 15-minute
  target** (from the trigger-stamped `first_contacted_at`; tile turns
  green/red around the target) · callbacks due today (open leads with
  `callback_at` before end of day, incl. overdue) · appointments upcoming ·
  dispatch vs new-authority split.
- **Operations:**
  - *Documents pending review* — oldest-first queue with **View** (≤5-min
    signed URL, S-01), **Approve / Reject** + review note (rejection requires
    a note); updates `documents.status/reviewed_by/review_note`.
  - *Insurance expiring ≤30 days* — expired vs expiring badges, active flag.
  - *Unsigned agreements* — carriers with `agreement_signed_at` null.

### `/portal/admin/settings` (admin only)
Every `company_settings` key (mc_number, usdot_number, bond_status, feature
flags…) editable as JSON with per-row save; `updated_by` stamped. Guarded
three times: `requireAdmin` page gate → admin check in the action → RLS
"admin write settings". A visible note warns the table is publicly readable
(never store secrets).

## Judgment calls
- **Server client instead of the admin client** for dashboard reads/writes:
  the staff RLS policies cover every query needed, keep `auth.uid()`
  attribution (`reviewed_by`, `updated_by`) and preserve defense in depth.
  The service-role client stays reserved for flows RLS cannot express
  (public-form inserts, storage writes during onboarding). Deviation from
  the "admin client" letter of the plan, aligned with its Q3 spirit.
- Aggregates in JS over ≤1000 rows, not SQL views — at current volume this
  is exact and keeps the schema frozen. Swap to a view/RPC when leads exceed
  the window.
- **Crons (O-01) deferred**: insurance-expiry and callback *emails* need
  Vercel Cron; the dashboard surfaces both lists today. Leftover, noted.
- Pending-doc carrier names resolved with a second query (hand-authored
  types carry no PostgREST embed metadata; `Relationships: []`).

## DB changes
None. Writes: `documents` (review), `company_settings`.

## Endpoints
Server actions: `reviewDocument`, `getDocumentSignedUrl` (staff, 300 s),
`updateCompanySetting` (admin).

## Env vars
None new.

## Verification
typecheck ✓ · lint ✓ · build ✓ · portal routes absent from
prerender-manifest (dynamic) ✓ · settings JSON validation rejects malformed
values with a helpful message ✓

## Extension points
- Notifications feed (email_log/webhook_events failures) slots in as another
  Operations table on this page.
- M-34 adds Dispatch + Marketing modules beside Sales/Operations.
- Vercel Cron endpoints for O-01 alerts can reuse the same queries.
