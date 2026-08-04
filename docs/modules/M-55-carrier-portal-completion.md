# M-55 — Carrier Portal Completion

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

## What was built

The directive's full carrier portal on the M-50 data model. Navigation:
**Overview / Company Profile / Trucks & Equipment / Drivers / Documents /
Agreements / Loads / Invoices & Payments / Notifications / Support / Account
Settings** (customer labels translated via the V4 bridge; staff nav unchanged).

| Surface | What it does |
|---|---|
| `/portal/carrier` (Overview) | Onboarding checklist (account → MC/DOT → required docs → agreement → activated), account/authority badge (pending/onboarding/active), missing-docs + docs-in-review tiles, agreement status, assigned dispatcher card, active + recently-completed loads, outstanding invoices, recent notifications, support entry — every block with an honest empty state. |
| `/portal/carrier/documents` | The M-25 documents page (upload/replace/review/≤5-min downloads), relocated from the portal home, lookup now membership-based. |
| `/portal/carrier/profile` | **Decision D5**: self-serve contact info (cookie-bound `profiles` update) + dispatch preferences (0010 `preferred_lanes`/`home_time_notes`, service-role write after membership check); regulated fields (MC/DOT/EIN/insurance/factoring/fee) read-only with a **change-request flow** → `[CHANGE REQUEST]`-tagged support thread + `audit_events` (`carrier.change_request`) + ops email. |
| `/portal/carrier/trucks` `/drivers` | Full CRUD on the 0006 tables (directive fields incl. VIN/plate/CDL/medical card), cookie-bound under the 0009 "member manage" policies; equipment select locked to the 8 public slugs. |
| `/portal/carrier/agreements` | Signed date (`agreement_signed_at`), executed-copy downloads (`dispatch_agreement` documents, signed URLs), **request re-send** (M-22 e-sign flow, rate-limited, honest refusal + ops alert when unconfigured). Sent/viewed honestly marked as untracked. |
| `/portal/carrier/invoices` | Reads the 0008 `invoices` mirror (outstanding/paid tiles, per-load lane, due dates, Stripe hosted payment links). `generateLoadInvoice` now **writes the mirror row**; the Stripe webhook updates `paid` / `void` / `uncollectible`. |
| `/portal/carrier/notifications` | 0007 feed (own-rows RLS), unread badges, mark-all-read. |
| `/portal/carrier/support` (+`/[id]`) | Decision D2 threads: new thread + replies (cookie-bound, `is_staff=false` forced by policy, 5000-char cap, per-user rate limit, escape-first rendering), assigned-dispatcher card. |
| `/portal/admin/support` (+`/[id]`) | Staff inbox: filterable list, change-request counter, thread view with staff reply (`answered`) and close/reopen. |
| `/portal/carrier/settings` | Password change (browser client → Supabase Auth), preferred language (`profiles.preferred_language`), email preferences (`user_preferences` upsert) — shared forms reused by M-56. |

## DB changes

`supabase/migrations/0010_carrier_portal.sql` (additive): `carriers.preferred_lanes`,
`carriers.home_time_notes` (D5 self-serve set) and `carriers.assigned_dispatcher_id`
(M-58 admin UI writes it; overview/support read it) + partial index. **No new RLS
policies** — preference writes go through server actions (service role after
membership check), so regulated columns stay unreachable from end-user sessions.
Validated on local PostgreSQL 16 (M-01 shim): 0001–0010 + seed under
`ON_ERROR_STOP=1`, column/FK/index assertions, and RLS spot checks (member can
read own carrier, member CANNOT update `carriers` directly).

## Security

- Every carrier read/write is cookie-bound RLS through `getMyCarrierId()`
  (memberships — M-57 doctrine); no carrier id travels in any request.
- Admin client used only where the anon key cannot go: dispatcher display
  name, dispatch-preference column writes, `audit_events`, thread-reopen.
- Support inserts: Zod + DB length caps, per-user rate limits, plain-text
  escape-first rendering (audit §6.8).
- Honest no-env states on every action (nothing pretends to have saved).

## i18n / tests

- ~190 supplemental strings (authored es/fr; ru/ht mirror EN per M-42
  precedent) → catalog **622 × 5 locales**; M-25/M-42 English-fallback
  leftovers backfilled; slug-collision baseline unchanged (9).
- +11 unit tests (`tests/unit/portal-forms.test.ts`: fleet schemas, D5 change
  requests, support caps, account prefs) → **96 unit**; 17 e2e green.

## Env / deployment

No new env vars. Apply 0010 with `supabase db push`. Extension points:
notifications writers (document review / load status flows) can now insert
rows; M-58 wires dispatcher assignment; team invites need only a membership
insert surface.
