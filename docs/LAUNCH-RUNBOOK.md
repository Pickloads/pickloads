# PickLoads — Launch Runbook

Exact, ordered steps to take pickloads.com live. Work top to bottom; each
step lists what to do, where, and which env var it produces. The app
degrades gracefully when a secret is missing (dev warnings, honest pending
states) — so a partial deploy never crashes, it just quietly disables the
affected integration. **Production must have every var set.**

*Last revised for M-82 (responsive + accessibility QA for the tracking
surfaces): **no migration, no environment variable, no `company_settings` key
and no cron entry** — M-82 is a QA and remediation module. Refreshed gate
counts (1468 unit / 742 RLS / 329 integration / **360** e2e / 388 pages). Three
things an operator should know: (1) **the mobile navigation drawer gained one
entry** — `Start Carrier Setup` (→ `/#quote`). It was in the desktop CTA row
only, which v4.css hides at ≤960px, so on every phone-width page the primary
carrier call to action was unreachable; the label was already in the v4
dictionary, so no translation changed. (2) **Portal form controls changed size
slightly**: date and time fields now render at 16px (below 16px, iOS Safari
zooms the page on focus and scrolls it sideways), checkboxes and radios are no
longer stretched to full width, and the document-upload file input and type
select are constrained to their container. Nothing moved, nothing was
restyled. (3) **Twelve horizontally scrolling tables and the dispatcher board
strip are now keyboard focus stops** (`Tab` reaches them, `←`/`→` scrolls
them) — several held no link at all and were previously unreachable without a
mouse. Full defect table in
[`docs/modules/M-82-responsive-a11y-qa.md`](modules/M-82-responsive-a11y-qa.md).*
Previously revised for M-81 (broker-partner access): migrations **0028–0029**
added to the order-and-rollback table, the `0001 → 0029` chain, refreshed gate
counts (1462 unit / 742 RLS / 329 integration / 283 e2e / 388 pages), a new
**§9c Broker-partner onboarding** section with its smoke test — and **no new
environment variable, no new `company_settings` key and no new cron entry**.
Five operational notes worth reading before go-live: (1) **APPLY 0028 BEFORE
0029, AND LET IT COMMIT** — 0028 is a single `alter type user_role add value`
and PostgreSQL refuses to *use* a new enum value in the transaction that added
it, so a runner wrapping both files together fails at 0029's first mention of
`'broker'`; (2) **0029 NARROWS `my_broker_partner_ids()`** to require `active`
**AND** `verification_status = 'verified'` — the backfill marks every
already-active organization verified, so deploying is access-neutral, but any
organization created afterwards reads **nothing** until an admin verifies it;
(3) **there is no self-service path to broker access at all** — an admin
creates the organization, verifies it, and sends a single-use invitation;
nothing on the public site can produce a partner account; (4) **0028 cannot be
rolled back** (PostgreSQL cannot drop an enum value) — reversing M-81 means
rolling back 0029 and running `update profiles set role = 'carrier' where role
= 'broker'`, after which the unused value sits inert, read by no policy; (5)
the partner portal shows §12's deny list to the partner on the shipment page
and on the invitation itself, so **support does not have to explain why a rate
is missing**.
Previously revised for M-80 (tracking map + provider adapters): migration **0027**
added to the order-and-rollback table, the `0001 → 0027` chain, refreshed gate
counts (1399 unit / 671 RLS / 295 integration / 270 e2e / 373 pages), a new
**§9b Map and tracking-provider configuration** section, an **eleventh
`company_settings` key** (`location_retention_days`, seeded 90) — and the
runbook's switchboard table corrected from nine keys to eleven, which had been
stale since M-69 added `referral_program_active`. **No new environment
variable**, **no new cron entry** (the §9 retention purge is task 3 of the
existing `/api/cron/daily`) and **no CSP change** (the map makes no network
request). Four operational notes worth reading before go-live: (1) **NO
PROVIDER IS CONNECTED** — no telematics contract, no credentials, no ELD
consent, so every shipment is milestone-tracked and the map never renders;
setting a provider's environment variables does **not** switch tracking on,
it only changes the adapter's refusal code; (2) the **retention purge deletes
real data nightly** — `location_retention_days` is an integer 1–3650 and
anything unparseable resolves to 90, so check `locationRetention.retentionDays`
in the cron response after editing it; (3) 0027 adds two triggers to the
shipped `shipment_events` table — it now **refuses coordinates** (PL422) so
positions live where the retention window can reach them, and mirrors any
event carrying a city into the purgeable series; (4) `eta_source = 'provider'`
remains **deliberately unreachable**, exactly as M-78 left it.
Previously revised for M-79 (shipment notifications): migration **0026** added to
the order-and-rollback table, the `0001 → 0026` chain, refreshed gate counts
(1238 unit / 588 RLS / 263 integration / 264 e2e / 373 pages), a **SECOND
CRON ENTRY** (`/api/cron/notifications`, every 5 minutes — §9 below), and a
**notification smoke test**. **No new environment variable and no new
`company_settings` key** — the worker reuses `CRON_SECRET`, and delivery
reuses `RESEND_API_KEY` / `EMAIL_FROM`. Three operational notes worth reading
before go-live: (1) **without `CRON_SECRET` the worker returns 503 and no
shipment email is ever sent** — the queue still fills, so the backlog is
recoverable, but nothing goes out until the secret is set; (2) 0026 is the
first migration since 0005 to **touch a shipped table** — it ADDS three
defaulted columns to `user_preferences`, drops nothing and changes no policy;
(3) §17's eleventh notification, *invoice available*, is wired and will find
**no rows** until M-96 ships shipper invoicing — that is the honest state, not
a defect.
Previously revised for M-78 (ETA architecture + exceptions/delays): migration
**0025** added to the order-and-rollback table, the `0001 → 0025` chain,
refreshed gate counts (1148 unit / 552 RLS / 222 integration / 253 e2e /
368 pages), a **one-command backfill an operator can safely re-run**, and an
**exception + ETA smoke test**. **No new environment variable and no new
`company_settings` key.** 0025 REPLACES `set_shipment_eta()` from 0022 — with
a byte-identical signature, so nothing else changes — and its rollback
therefore has an ORDER, spelled out in the table below. Two operational notes
worth reading before go-live: the `calculated` ETA source is **real
arithmetic over the recorded mileage and nothing more** (no traffic, no
weather, no prediction, no AI — say so if a customer asks), and the
`provider` source is **deliberately unreachable** until M-80 lands an adapter.
Previously revised for M-77 (shipment documents + POD workflow): migration
**0024** added to the order-and-rollback table, the `0001 → 0024` chain,
refreshed gate counts (1061 unit / 502 RLS / 194 integration / 240 e2e /
368 pages), a **new private storage bucket (`shipment-docs`) with a manual
creation step for non-Supabase environments**, and a **document + POD smoke
test**. **No new environment variable.** 0024 also REPLACES a function shipped
in 0019 — `shipment_transition_facts()` — which makes the `pod_uploaded`
status reachable for the first time, and reachable only with a staff-approved
POD; its rollback therefore has an ORDER, spelled out in the table below.
Previously revised for M-76 (carrier update experience + driver update link):
migration **0023** added to the order-and-rollback table, the `0001 → 0023`
chain, **one new environment variable (`DRIVER_TOKEN_SECRET`) that fails
CLOSED** plus an optional `DRIVER_TOKEN_TTL_HOURS`, and a **driver-link smoke
test**. 0023 introduces the platform's FIRST BEARER CREDENTIAL
(`/driver/update/[token]`) — read its threat model in
[`docs/modules/M-76-carrier-driver-updates.md`](modules/M-76-carrier-driver-updates.md)
before going live, because the operational rule it produces is short and
blunt: **treat every driver link as public the moment it is sent, and revoke
rather than explain.** Previously revised for M-75 (dispatcher shipment
operations): migration **0022**
added to the order-and-rollback table and the `0001 → 0022` chain.
**No new environment variable and no new `company_settings` key** — but
`brokerage_active` now gates a STAFF surface as well as the customer-facing
labels M-69 wired: with it off, `/portal/admin/shipments/new` renders an honest
card instead of a form and the create action refuses with a staff-readable
reason, while shipments already in flight stay fully operable. 0022 is the
first migration in this programme that is **purely additive and
non-destructive to roll back** — four `security definer` functions and nothing
else. Previously revised for M-74 (shipper shipment list + detail): migration
**0021** and its gate counts. 0021 is
the first migration in this programme that RELAXES a shipped constraint
(`invoices.carrier_id` NOT NULL → a CHECK) and its rollback note says exactly
what that costs. Previously revised for M-73 (public secure tracking,
`/track`): migration **0020**, the `0001 → 0020` chain, **one new environment
variable (`TRACKING_ACCESS_SECRET`) that fails CLOSED** and a `/track` smoke
test. Previously revised for M-72 (status-transition engine):
migration 0019, the 339-assertion RLS gate and a **new release gate —
`npm run test:integration`** (the §27 tier `FINAL-IMPLEMENTATION-PLAN` §4
restores). Previously revised for M-71 (shipment schema): migrations 0014–0018
and the `0001 → 0018` chain. Previously revised for M-62 (final QA), covering the account-system
upgrade M-50…M-61: migrations 0005–0013 with per-migration rollback notes, the
Supabase auth email templates, staff TOTP MFA + first-admin enrollment, the
in-app staff invite flow, the `shipper_signup_enabled` switch, and
`npm run test:rls` as a pre-deploy gate. Acceptance status for every
directive criterion lives in
[`docs/UPGRADE-ACCEPTANCE.md`](UPGRADE-ACCEPTANCE.md).*

---

## 1. Supabase — staging + production projects

Create **two** projects at [supabase.com/dashboard](https://supabase.com/dashboard)
(org: PickLoads Logistics Group): `pickloads-staging` and `pickloads-prod`,
region `us-east-1` (closest to NJ ops). For **each** project, in order:

1. **Apply migrations in order** — SQL Editor (or `supabase db push` with the
   CLI linked to the project). **Order matters and is not negotiable**: 0009
   depends on every table 0005–0008 creates, and 0008's `freight_quotes.
   shipper_id` FK plus its 0009 policy must land *before* public shipper
   signup is reachable (audit §6.3 sequencing constraint).

   Migrations **0001–0004 are frozen** — never edit them. Everything from
   0005 on is additive. Rollback notes are per-migration below; each one is
   written to be run **in reverse numeric order** and each drops only what
   its own migration created. `0001–0004` have no rollback: rolling those
   back means dropping the product.

   | # | File | Creates | Rollback |
   |---|---|---|---|
   | 0001 | `0001_types_and_tables.sql` | enums, 13 tables, `set_updated_at()` triggers | — (frozen; restore from backup) |
   | 0002 | `0002_rls.sql` | RLS on all tables, `is_staff()`, `current_user_role()`, `guard_role_change` — **no anon insert policies by design** | — (frozen) |
   | 0003 | `0003_auth_and_journal.sql` | `on_auth_user_created` → profile trigger, CRM status journaling | — (frozen) |
   | 0004 | `0004_storage.sql` | private `carrier-docs` bucket + storage policies | — (frozen) |
   | 0005 | `0005_accounts_memberships_audit.sql` | `shippers`, `carrier_memberships`, `shipper_memberships` (+ backfill from `carriers.profile_id`), `account_status_history`, `audit_events`, `user_preferences`; types `account_status`, `membership_role`; `profiles.status` column | `alter table profiles drop column status;` then `drop table user_preferences, audit_events, account_status_history, shipper_memberships, carrier_memberships, shippers cascade;` then `drop type account_status, membership_role;` **Destructive** — drops the audit ledger and every shipper company. Take a dump first. |
   | 0006 | `0006_fleet.sql` | `trucks`, `drivers` (+ indexes, updated_at triggers) | `drop table drivers, trucks cascade;` Destructive — loses carrier fleet data. |
   | 0007 | `0007_support_notifications.sql` | `support_threads`, `support_messages`, `notifications`; type `support_status` | `drop table notifications, support_messages, support_threads cascade; drop type support_status;` Destructive — loses support history. |
   | 0008 | `0008_billing_quotes.sql` | `invoices` mirror; type `invoice_status`; 14 additive `freight_quotes` columns (`shipper_id` FK, hazmat, temp, dims, pickup/delivery address+city+state) + one-shot email backfill of `shipper_id` | `drop table invoices cascade; drop type invoice_status;` and `alter table freight_quotes drop column shipper_id, hazmat, temp_controlled, temp_min_f, temp_max_f, dims_l_in, dims_w_in, dims_h_in, pickup_address, pickup_city, pickup_state, delivery_address, delivery_city, delivery_state;` **Do not roll this back while shipper self-signup is enabled** — dropping `shipper_id` re-opens the §6.3 email-matching weakness. Stripe remains the system of record for money, so dropping `invoices` loses only the local mirror. |
   | 0009 | `0009_rls_new_tables.sql` | RLS enabled on the 0005–0008 tables, 31 policies, `my_carrier_ids()` / `my_shipper_ids()` helpers | Reverse with `alter table <t> disable row level security;` for each 0005–0008 table and `drop function my_carrier_ids(), my_shipper_ids();`. **Rolling this back leaves the new tables with no tenant isolation** — only ever do it immediately before rolling back 0008–0005 too. |
   | 0010 | `0010_carrier_portal.sql` | `carriers.preferred_lanes`, `.home_time_notes`, `.assigned_dispatcher_id` (+ index) | `alter table carriers drop column preferred_lanes, home_time_notes, assigned_dispatcher_id;` Loses dispatcher assignments and self-serve preferences only. |
   | 0011 | `0011_quote_fields.sql` | `freight_quotes.pickup_company`, `.delivery_company`, `.delivery_deadline`, `.special_instructions`, `.contact_name` | `alter table freight_quotes drop column pickup_company, delivery_company, delivery_deadline, special_instructions, contact_name;` The in-portal quote form breaks until redeployed against the older schema. |
   | 0012 | `0012_staff_invites.sql` | `staff_invites` (hash-only tokens, role CHECK admin/dispatcher, staff-read policy) | `drop table staff_invites cascade;` Safe — invites are transient; already-accepted staff keep their roles. |
   | 0013 | `0013_public_read_grant_fix.sql` | `grant execute on function public.is_staff() to anon` | `revoke execute on function public.is_staff() from anon;` **Do not roll this back.** Revoking it re-breaks the public blog, every post page and `sitemap.xml` the moment one unpublished draft exists (SECURITY-REVIEW.md §3). |
   | 0014 | `0014_subscriber_unsubscribe_token.sql` | `subscribers.unsubscribe_token` (+ unique index, backfill) — the M-69/P-1 CAN-SPAM credential | `alter table subscribers drop column unsubscribe_token;` **Do not roll this back while marketing sends are live** — every `List-Unsubscribe` link already delivered stops resolving, which is the CAN-SPAM exposure P-1 closed. |
   | 0015 | `0015_company_settings_referral_flag.sql` | `company_settings` row `referral_program_active` (default `false`) | `delete from company_settings where key = 'referral_program_active';` The accessor fails closed, so the referral copy stays hidden — safe. |
   | 0016 | `0016_loads_deadhead_miles.sql` | `loads.deadhead_miles` (+ non-negative CHECK) | `alter table loads drop column if exists deadhead_miles;` Dump captured values first (`select id, deadhead_miles from loads where deadhead_miles is not null`); "True RPM" reverts to "—". |
   | 0017 | `0017_shipment_schema.sql` | **M-71.** 17 shipment enum types; `broker_partners`, `broker_partner_memberships`, `shipments`, `shipment_parties`, `shipment_assignments`; 17 indexes; `set_updated_at` triggers; `trg_shipments_tracking_number_immutable` (§5); `trg_shipments_brokerage_gate` (§2 — refuses INSERT while `brokerage_active` is false, fail-closed) | Full script in [`docs/modules/M-71-shipment-schema.md`](modules/M-71-shipment-schema.md) §DB changes. Drop the 4 triggers, the 2 trigger functions, the 5 tables `cascade`, then the 17 types. **Destructive** — dump the 5 tables first. Run **after** 0018's rollback. Also roll back `src/lib/supabase/database.types.ts` in the same deploy. |
   | 0018 | `0018_shipment_rls.sql` | **M-71.** `my_broker_partner_ids()` (active-filtered per §12); RLS on the 5 tables from 0017; 15 policies; **no anon policy by design** (§19 forbids anonymous shipment SELECT) | Full script in the M-71 doc. Drop the 15 policies, `disable row level security` on the 5 tables, drop the helper. **Dangerous in isolation** — this leaves five populated tables with no tenant isolation. Only ever run it immediately before rolling back 0017 too. |
   | 0019 | `0019_shipment_events.sql` | **M-72.** `shipment_events` (all 18 §7 fields; globally unique `idempotency_key`, per-shipment unique `external_event_id`); 6 indexes; `trg_shipment_events_append_only` (refuses UPDATE/DELETE for **every** role, service role included); RLS + 4 policies mirroring `AUDIENCE_EVENT_VISIBILITY`, **no anon policy**; 5 `security definer` functions (`shipment_transition_facts`, `apply_shipment_transition`, `append_shipment_event`, `set_shipment_appointment`, `apply_shipment_correction`) with **EXECUTE granted to `service_role` only** | Full script in [`docs/modules/M-72-transition-engine.md`](modules/M-72-transition-engine.md) §DB changes. Drop the 4 policies, disable RLS, drop the 5 functions (full signatures in the doc), drop the trigger **before** the table, then the trigger function, then `shipment_events cascade`. **Destructive** — dump `shipment_events` first; it is the entire timeline of every shipment. Roll back `src/lib/supabase/database.types.ts` and delete `src/lib/shipments/apply-transition.ts` in the same deploy. `shipments`/`shipment_parties`/`shipment_assignments` are untouched and keep working — statuses simply stop being writable through the engine. |
   | 0020 | `0020_shipment_tracking_access.sql` | **M-73.** `shipment_tracking_access` — the §19 public-tracking access ledger (8 columns, both FKs `NO ACTION`, length CHECKs); 4 indexes (per-IP, per-attempted-number, per-shipment, failures); `trg_shipment_tracking_access_append_only` (refuses UPDATE/DELETE for **every** role, service role included); RLS with **one** policy — staff SELECT — and **no anon policy and no write policy at all**, so every row arrives through the service role | Full script in [`docs/modules/M-73-public-tracking.md`](modules/M-73-public-tracking.md) §DB changes. Drop the policy, disable RLS, drop the trigger **before** the table, then the trigger function, then `shipment_tracking_access cascade`. Do **not** drop the `tracking_access_outcome` type — 0017 created it. **Destructive** — this is the only record of enumeration attempts against the platform; `pg_dump -t shipment_tracking_access` first. Roll back `src/lib/supabase/database.types.ts` and remove `src/lib/shipments/public-lookup.ts` + the `/track` route in the same deploy; the failure mode if you don't is *closed* (the lookup refuses when it cannot log), so `/track` says "temporarily unavailable" rather than serving unlogged lookups. |
   | 0021 | `0021_invoice_shipment_link.sql` | **M-74.** `invoices.shipment_id` + `invoices.shipper_id` (both nullable, FKs to `shipments`/`shippers`); `carrier_id`'s **NOT NULL replaced by** `invoices_party_present` (`carrier_id is not null or shipper_id is not null`); 2 partial indexes; ONE policy — `"member read shipper invoices"`. **Why the relaxation:** 0009's `"member read invoices"` is keyed on `my_carrier_ids()`, so a shipper invoice naming the hauling carrier would be readable BY that carrier — disclosing the shipper gross and therefore the margin. A shipper invoice must name no carrier. 0009's carrier policy is left byte-identical and every pre-0021 row stays visible to exactly whom it was before | Full script in [`docs/modules/M-74-shipper-shipments.md`](modules/M-74-shipper-shipments.md) §Migration 0021. Drop the policy, then the 2 indexes, then — **only if you truly need the NOT NULL back** — delete the null-carrier (shipper) invoices, drop the CHECK and re-add the NOT NULL, which **fails while any shipper invoice exists**; finally drop the 2 columns. `pg_dump -t invoices` first. Roll back `src/lib/supabase/database.types.ts` and the two `/portal/shipper/shipments` routes in the same deploy; if you don't, the detail page's invoice section renders its honest "we couldn't read your invoices" state and logs — it does not leak. |
   | 0022 | `0022_shipment_operations.sql` | **M-75.** FOUR `security definer` functions and nothing else — no table, no policy, no enum, no trigger, no index: `create_shipment` (row + `shipment_created` event, key-allow-listed, 0017's §2 gate and §5 CHECK/unique index still apply above it), `assign_shipment_carrier` (assignment row + `shipments.carrier_id` + event, atomically — a split write would leave the just-assigned carrier unable to SEE the shipment under 0018's policy; refuses another carrier's driver/truck with `PL422`), `release_shipment_assignment` (stamps `released_at`, never deletes; optionally clears `carrier_id`), `set_shipment_eta` (M-71's ETA columns + an `eta_update` event carrying the PREVIOUS value). **EXECUTE granted to `service_role` only**, after an explicit `revoke all … from public` | Full script in [`docs/modules/M-75-dispatcher-operations.md`](modules/M-75-dispatcher-operations.md) §DB changes. `drop function` the four, in reverse order (signatures in the doc). **NOT destructive** — no row is deleted and no column changes; shipments already created stay readable and their statuses stay writable through 0019's engine. What stops working is *creating* a shipment, assigning a carrier and updating an ETA, so roll back the M-75 surface in the same deploy: delete `src/lib/shipments/{create,assignments,eta}.ts` and the three `/portal/admin/shipments` routes, or the build calls functions that no longer exist. 0017–0021 are untouched. |
   | 0023 | `0023_driver_update_tokens.sql` | **M-76.** Enum `driver_token_outcome`; `shipment_driver_tokens` (the platform's first bearer credential — stores an **HMAC** of the token under `DRIVER_TOKEN_SECRET` and never the token; `expires_at` NOT NULL so a permanent link cannot exist) and `shipment_driver_token_access` (append-only ledger that doubles as the rate limiter's memory, so "rate limited" and "audit logged" are ONE write); 6 indexes; `trg_driver_tokens_immutable` (shipment/carrier/hash frozen, revocation one-way) and `trg_driver_token_access_append_only`; RLS + 3 policies, **no anon policy** even though the driver page is anonymous; **the repo's first COLUMN-level privilege revoke** — `token_hash` is unreadable by `authenticated` and `anon`; 4 `security definer` functions (`issue_shipment_driver_token`, `revoke_shipment_driver_token`, `redeem_shipment_driver_token`, `set_driver_token_consent`) with **EXECUTE granted to `service_role` only** | Full script in [`docs/modules/M-76-carrier-driver-updates.md`](modules/M-76-carrier-driver-updates.md) §DB changes. Drop the 3 policies, disable RLS, drop the 4 functions (signatures in the doc), drop each trigger **before** its table, then the 2 trigger functions, the 2 tables `cascade`, then the enum. **Destructive** — it drops every issued driver link and the entire record of who presented one; `pg_dump -t shipment_driver_tokens -t shipment_driver_token_access` first. Roll back `src/lib/supabase/database.types.ts`, delete `src/lib/shipments/driver-*.ts` and the `/driver/update/[token]` route in the same deploy; the failure mode if you don't is **closed** (an unreachable redeem is an "unavailable" refusal, never an unlogged grant). **The carrier surface survives this rollback** — `/portal/carrier/shipments` reads only `shipments` and `shipment_events`; remove the driver-link block from `CarrierShipmentDetailView` and the two link actions and §13's status/ETA/exception updates keep working. 0017–0022 are untouched. |
   | 0024 | `0024_shipment_documents.sql` | **M-77.** The private **`shipment-docs` bucket** (created by the migration itself — `public = false`, 10 MB, pdf/jpeg/png/heic); `shipment_document_audiences` (the §16 document-type → audience MATRIX as 22 rows, with CHECKs forbidding a `public` or `staff_only` cell); `shipment_documents` (4 CHECKs incl. `(status='approved') = (approved_at is not null)` and a path-prefix constraint; `storage_path` unique); 3 indexes (one partial, serving §20's POD lookup); `trg_shipment_documents_immutable` (what a document IS cannot change → PL409) and `trg_shipment_documents_visibility` (a row's band may NARROW, never widen → PL422); RLS + 4 policies (staff/shipper/carrier/**broker**), **no customer write policy** and a `revoke all … from authenticated, anon` before the SELECT grant, because Supabase's default privileges hand new tables full DML; 4 `security definer` functions — `shipment_document_reaches_audience` (`authenticated`), `add_shipment_document` + `review_shipment_document` (**`service_role` only**), `count_shipment_documents_awaiting_review` (`authenticated`, returns a COUNT and nothing else). **AND it REPLACES `shipment_transition_facts()` from 0019** — the one function in the chain a later migration was *instructed* to rewrite: 0019 shipped `approved_pod_document_id` as a literal `null` with the replacement SQL in the comment above it, addressed to M-77 by name. `pod_uploaded` becomes reachable, and only with an approved POD. | Full script in [`docs/modules/M-77-shipment-documents.md`](modules/M-77-shipment-documents.md) §Deployment. **THE ORDER MATTERS: re-run 0019's `create or replace function public.shipment_transition_facts(uuid)` block FIRST**, before dropping anything — it has the literal `null`, and doing it after the table is gone leaves every transition failing on a missing relation. Then drop the 5 policies (4 on `shipment_documents`, 1 on the matrix), the storage policy, the 4 functions, each trigger **before** its table, the 2 trigger functions, the 2 tables `cascade`, and finally `delete from storage.buckets where id = 'shipment-docs'` — **only if empty**. **Destructive** — it drops every BOL and POD filed against a shipment, and with them the evidence a delivery happened; `pg_dump -t shipment_documents` first. The **objects survive in the bucket**; the rows naming them do not, so they become unreachable rather than deleted, and emptying the bucket is a separate deliberate act. Roll back `src/lib/supabase/database.types.ts`, delete `src/lib/shipments/document*.ts`, `src/app/actions/shipment-documents.ts` and the two document components, and revert the four surface edits in the same deploy. It fails **CLOSED** either way: with the table gone and 0019's function restored, `pod_uploaded` is refused again — M-72's documented behaviour, not a new failure mode. 0017–0023 are otherwise untouched, and `carrier-docs` is untouched entirely. |
   | 0025 | `0025_shipment_eta_exceptions.sql` | **M-78.** The TWO tables M-71 deliberately left: `shipment_eta_history` (§10's previous-ETA record; `trg_shipment_eta_history_append_only` refuses UPDATE/DELETE for **every** role, owner included) and `shipment_exceptions` (§21's 13 types over the enum 0017 already created, its 10 fields, plus `source_event_id` **unique** and `resolution_event_id`; 3 CHECKs; 3 indexes, two partial). `trg_shipment_exceptions_lifecycle` enforces the rules §21 implies but does not spell: what an exception IS is frozen, resolution is one-way, notification is one-way, a closed exception is read-only for triage — all `PL409`. RLS + **one policy each** (staff), a `revoke all … from authenticated, anon` followed by **SELECT only** — the grant is required because `is_staff()` evaluates inside an `authenticated` session, and the customer holds the same grant and reads **zero rows**. FIVE `security definer` functions: `my_shipment_exceptions(uuid)` (**`authenticated`** — the customer projection, seven OUT columns with no `internal_description` and no `resolution`, audience resolved from the caller's own memberships and never from an argument), and `open_shipment_exception` / `resolve_shipment_exception` / `update_shipment_exception` / `backfill_shipment_exceptions` (**`service_role` only**). **AND it REPLACES `set_shipment_eta()` from 0022** — same 13-parameter signature (so grants and callers are untouched), body grows one INSERT so the column, the `eta_update` event and the history row land in ONE transaction. **It also RUNS THE BACKFILL once**, migrating M-75/M-76's event-only exceptions into rows and `RAISE NOTICE`-ing the count; it deletes nothing. | Full script in [`docs/modules/M-78-eta-exceptions.md`](modules/M-78-eta-exceptions.md) §Deployment. **THE ORDER MATTERS: re-run 0022's `create or replace function public.set_shipment_eta(...)` block FIRST**, before dropping anything — it is the same body minus the history INSERT, and doing it after the table is gone leaves every ETA update failing on a missing relation. Then drop the 2 policies, the 5 functions (signatures in the doc), each trigger **before** its table, the 2 trigger functions, and the 2 tables `cascade`. **Destructive for the LIFECYCLE, not for the HISTORY** — every exception ever opened survives as an `exception_opened` event and every resolution as an `exception_resolved` event, which is exactly why both functions write an event as well as a row; what is lost is `assigned_to`, `customer_notified_at`, the resolution text and the open/closed state. `pg_dump -t shipment_exceptions -t shipment_eta_history` first. ETA history reverts to the event metadata M-75 already wrote. Roll back `src/lib/supabase/database.types.ts`, delete `src/lib/shipments/{exceptions,eta-estimate}.ts`, revert `src/lib/shipments/eta.ts` to M-75's version, and revert the four surface edits and three action files in the same deploy. It fails **CLOSED** either way: with the table gone the accessor is gone too, the customer DTOs receive an empty exception list, and the banner disappears rather than erroring. 0017–0024 are otherwise untouched. |
   | 0026 | `0026_shipment_notifications.sql` | **M-79.** §17's notifications and §25's **background processing architecture**. 3 enums (`shipment_notification_event` — the eleven, in the directive's order; `notification_channel` — `email`/`in_app`, with **no `sms` value** because §17 permits SMS only with an approved provider and compliant opt-in, and a value nothing can deliver is a fake capability; `notification_delivery_state`). 5 tables: `shipment_notification_rules` (the event → notification mapping as DATA, 11 seeded rows, mirrored by `SHIPMENT_NOTIFICATION_RULES` in TypeScript and pinned cell-for-cell in both directions by the integration lane), `shipment_notification_queue` (**unique `idempotency_key`** — §17's key requirement made a database fact; a payload-safety CHECK refusing `signed_url`/`access_code`/`internal_message`/`gross_shipper_amount`/`carrier_pay` **at the writer**; a `(state='sent') = (sent_at is not null)` CHECK; 3 indexes, one partial on the hot worker read), `shipment_notification_attempts` (**append-only** for every role including the owner — a delivery ledger somebody can edit is not a ledger), `shipment_notification_watermark` (single-row harvest watermark; an optimisation, not the correctness mechanism — the harvest deliberately re-reads a 10-minute overlap and every re-read conflict-do-nothings), and `notification_suppressions` (address-level opt-out, lowercase enforced by CHECK). **THE ONE SHIPPED TABLE THIS TOUCHES is `user_preferences` (0005)** — three columns ADDED (`email_shipment_updates`, `inapp_shipment_updates`, both `default true`; `notification_token uuid` uniquely indexed), nothing dropped, no default changed, and 0009's four `user_preferences` policies byte-identical afterwards. RLS on all five tables, `revoke all … from authenticated, anon` then **SELECT only**, then **one staff-read policy each — five in total, and NO write policy for any role**. 4 `security definer` functions with **EXECUTE granted to `service_role` ALONE**: `enqueue_shipment_notification` (idempotent, reports whether it deduped), `harvest_shipment_notifications` (maps new `shipment_events` **and** shipper `invoices` onto queue rows), `claim_shipment_notifications` (`for update skip locked` + a lock TTL, so two workers split a batch rather than double-send it), `settle_shipment_notification` (writes the append-only attempt row **and** moves the queue row in ONE transaction). | Full script in [`docs/modules/M-79-shipment-notifications.md`](modules/M-79-shipment-notifications.md) §DB changes. **STOP THE WORKER FIRST** — remove the `/api/cron/notifications` entry from `vercel.json` or unset `CRON_SECRET` — so nothing claims rows mid-teardown. Then drop the 4 functions (signatures in the doc), the 2 triggers **before** their tables, the trigger function, the 5 tables `cascade`, the 3 `user_preferences` columns, and the 3 enums. **Destructive for the QUEUE and the ATTEMPT LEDGER, not for the history** — every notification the worker sent survives in `email_log` (M-14) and `notifications` (M-60), and every fact that produced one survives as a `shipment_events` row; what is lost is the retry state of anything in flight and the per-attempt provider answers. `pg_dump -t shipment_notification_queue -t shipment_notification_attempts` first. **EXPORT THE OPT-OUTS BEFORE DROPPING THE COLUMNS** — `select profile_id from user_preferences where not email_shipment_updates` — because dropping them re-subscribes everyone who unsubscribed, and keep `notification_suppressions` if you can: an address-level opt-out you cannot reproduce is the one piece of state whose loss is visible to a customer. Roll back `src/lib/supabase/database.types.ts`, delete `src/lib/shipments/notification-{rules,queue,worker}.ts`, `src/lib/notification-preferences.ts`, `src/app/actions/notification-preferences.ts`, `src/emails/{shipment-templates.tsx,phrases.ts}`, the cron route and the unsubscribe page, and revert the `resendNotificationAction` block in `src/app/actions/dispatcher-shipments.ts` to its M-75 text, in the same deploy. `sendEmail`'s and `notifyCustomer`'s new return values may STAY — they are additive and every other caller ignores them. It fails **CLOSED**: with the queue gone the worker route returns 503 and **no shipment email is sent at all**, rather than an unthrottled inline send appearing in its place. M-60's fan-out for every non-shipment flow is untouched throughout, and 0017–0025 are untouched entirely. |

   | 0027 | `0027_shipment_locations_providers.sql` | **M-80.** §9's map and provider architecture, and the **RETENTION EXECUTOR** the plan's §4 records as missing. `company_settings` row `location_retention_days` (`90`) + `location_retention_days()` (fails safe to 90 — never to "keep forever"). `shipment_locations` — the PURGEABLE position series (M-70's row type in full, incl. §9's vehicle **speed** and **raw provider metadata**), 5 CHECKs, a **partial UNIQUE** `(shipment_id, provider, external_event_id)` that makes §9's dedupe a database fact, a retention index, and `trg_shipment_locations_no_update` (a reading is a fact about a moment — PL409 for every role incl. the owner; DELETE deliberately NOT blocked, because this is the one shipment table §9 requires to be deletable). `tracking_provider_connections` — §9 Mode B's five fields incl. the **`tracking_url`**, one **active** connection per shipment, identity immutable and revocation one-way (PL409), plus a §15 CHECK refusing eight credential shapes in the URL and an https-only CHECK. **TWO TRIGGERS ON `shipment_events`, both additive**: `trg_shipment_events_no_coordinates` refuses a lat/long (PL422 — the ledger is append-only and therefore un-purgeable, so a coordinate there would outlive any retention window; no path in `src/` has ever written one) and `trg_shipment_events_location_mirror` copies any event carrying a city into the purgeable series, so §9 Mode A produces real history with no call-site change. RLS on both tables, `revoke all … from authenticated, anon` then **SELECT only**, then **one staff policy each — no customer policy, no anon policy, no write policy for any role**. SIX `security definer` functions: `my_shipment_locations(uuid,int)` (**`authenticated`** — the customer projection, seven OUT columns with no `raw_metadata`/`provider`/`external_event_id`, audience from the caller's own memberships, §9's four levels applied IN SQL, speed gated on `exact` **and** driver consent) and `record_shipment_location` / `set_shipment_location_visibility` (narrow = dispatcher, **widen = admin**, PL403) / `attach_tracking_provider_connection` / `revoke_tracking_provider_connection` / **`purge_expired_shipment_locations`** (**`service_role` only**). | Full script in [`docs/modules/M-80-map-providers.md`](modules/M-80-map-providers.md) §ROLLBACK. **REMOVE THE RETENTION TASK FROM `/api/cron/daily` FIRST** (or unset `CRON_SECRET`) so nothing calls the purger mid-teardown. Then drop the 2 `shipment_events` triggers and their functions, the 6 functions, the 2 policies, the 2 table triggers and their functions, the 2 tables `cascade`, and the settings key. **Destructive** for the position series and every provider link — `pg_dump -t shipment_locations -t tracking_provider_connections` first — but **NOT for the timeline**: every city/state ever reported survives as the `shipment_events` row it was mirrored from, which is why the mirror is a copy and not a move. Roll back `src/lib/supabase/database.types.ts`, delete `src/lib/shipments/{locations,retention,location-visibility,map-state}.ts` and `src/lib/shipments/providers/`, delete `src/components/tracking/{ShipmentMap,LocationPanel}.tsx`, and revert the three actions, three forms, four surfaces, the `dto.ts` `locations` additions and the cron task in the same deploy. It fails **CLOSED**: with the tables gone the accessors are gone, the DTOs receive an empty location list, the map never mounts and every panel renders §30's "Location temporarily unavailable". 0017–0026 are untouched. |
   | 0028 | `0028_broker_role_value.sql` | **M-81.** ONE STATEMENT: `alter type user_role add value if not exists 'broker'`. It is a file of its own because PostgreSQL refuses to *use* an enum value added in the same transaction — `supabase db push`, the SQL editor and `psql -1` all wrap a file, so 0029's first `'broker'` literal would fail. **The value grants NOTHING**: no policy in the chain reads `profiles.role = 'broker'` (asserted as a catalog fact), broker authorization stays organization-scoped exactly as M-71 built it, and a broker profile with no verified membership reads what an outsider reads. What it buys is M-58's invite idiom (which assigns a role server-side) and a `portalHomeFor()` branch, without which an invited partner ping-pongs between `requireCarrier` and its own home. | **NONE — PostgreSQL cannot drop an enum value.** Reverse M-81 by rolling back 0029 first, then `update profiles set role = 'carrier' where role = 'broker';`. The value then sits inert in the type, referenced by nothing. Recreating the type would mean rewriting `profiles.role` and `staff_invites.role` on shipped tables — a far larger risk than the line it removes. |
   | 0029 | `0029_broker_partner_access.sql` | **M-81.** §12's broker-partner access. Enum `broker_verification_status`; **8 columns on `broker_partners`** — `verification_status` (NOT NULL, default `'pending'`), `verified_by`, `verified_at`, plus plan §9.3's vetting checklist (`dot_number`, `bond_provider`, `bond_amount_usd`, `authority_since`, `days_to_pay`, recorded for a human, **scored by nothing**) — with a **backfill marking every already-`active` organization verified**, so deploying is access-neutral. **`my_broker_partner_ids()` is REPLACED** to require `active` **AND** `'verified'`: every 0018/0019/0024 policy inherits §12's *"verified"* in one write, and an admin suspending an organization revokes its access everywhere at once. Three tables: `broker_partner_invites` (M-58's idiom — SHA-256 hash only, single-use, 7-day expiry — plus §12's two additions: it names the ORGANIZATION, and it is revocable, with a CHECK refusing a row that is both accepted and cancelled), `broker_shipment_grants` (§12 *"shipment by shipment"*; a **partial UNIQUE** enforces one live grant per (shipment, partner) and revocation is a COLUMN so §15 can answer *"who could see this last March?"*), `broker_account_agreements` (§12 *"or account agreement"*; `shipper_id` **NOT NULL**, so §19's forbidden wildcard is unrepresentable). 7 indexes, 1 `updated_at` trigger. Two `security definer` functions: **`broker_can_read_shipment(uuid)`** (`authenticated`) — the ONE definition of the question, OR'ing M-71's party link with the two sharing shapes and evaluating the agreement window against `now()` — and **`verify_broker_partner(...)`** (**`service_role` only**), which moves the status and the `verified_by`/`verified_at` stamp together. RLS on all three tables with **no customer INSERT/UPDATE/DELETE policy of any kind**; `revoke all … from authenticated, anon`, then SELECT on the two grant tables and a **COLUMN-LEVEL** grant on `broker_partner_invites` that never names `token_hash` (naming it is a permission error for every session, staff included — M-76's 0023 idiom, and the ORDER matters: a table-level grant would override a column revoke). Four NEW SELECT-only policies on `shipments` / `shipment_events` / `shipment_parties` / `shipment_documents`, **added beside** 0018/0019/0024's four rather than replacing them — 0018's own instruction — so the effect is M-71's floor plus §12's two sharing shapes and nothing else. | Full script in [`docs/modules/M-81-broker-partner-access.md`](modules/M-81-broker-partner-access.md) §DB changes. **RESTORE 0018's `my_broker_partner_ids()` FIRST** (the verbatim body is in 0029's header) or every broker policy in the chain fails on a missing function. Then drop the 4 `broker shared read %` policies, the 5 policies on the new tables, the 2 functions, the 3 tables `cascade`, the 8 columns and the enum; finally `update profiles set role = 'carrier' where role = 'broker';`. **Destructive at the table drop** — it removes the record of which shipments were shared with which partner and under what agreement, so `pg_dump -t broker_shipment_grants -t broker_account_agreements -t broker_partner_invites` first. It fails **CLOSED**: with the tables gone a partner falls back to M-71's floor (`shipments.broker_partner_id` only), which is less access, never more. Roll back `src/lib/supabase/database.types.ts`, delete `src/lib/shipments/broker-{permissions,access}.ts`, `src/lib/validation/broker.ts`, `src/app/actions/broker-partners.ts`, the four broker components, the email template and the five routes, and revert `src/lib/{auth,memberships}.ts`, `PortalSidebar.tsx`, `ShipmentDocumentReview.tsx`, `ShipmentStaffDetailView.tsx` and the dispatcher detail page in the same deploy. 0017–0027 are untouched. |

   After applying, sanity-check the chain the same way CI does:

   ```bash
   npm run test:rls     # rebuilds a throwaway DB from 0001→0029 + seed + fixtures
   ```

   **Then VERIFY the two private buckets exist and are private (M-77):**

   ```sql
   select id, public, file_size_limit, allowed_mime_types
     from storage.buckets where id in ('carrier-docs', 'shipment-docs');
   ```

   Both rows must show `public = f`. `carrier-docs` comes from 0004,
   `shipment-docs` from 0024, and **each migration inserts its own row** — on
   hosted Supabase there is nothing to click.

   **If the query returns fewer than two rows** (a self-hosted Postgres
   without the `storage` schema, or an environment where the migration ran
   against an app database rather than the Supabase one), create the missing
   bucket **manually** before anyone uploads:

   - Supabase Studio → Storage → **New bucket** → name `shipment-docs`, and
     **leave "Public bucket" OFF**. Then set the limits in SQL:

   ```sql
   update storage.buckets
      set public = false,
          file_size_limit = 10485760,
          allowed_mime_types =
            array['application/pdf','image/jpeg','image/png','image/heic']
    where id = 'shipment-docs';
   ```

   A bucket created **public** is the one configuration mistake this module
   cannot survive: §16 says *"do not put shipment documents in public
   buckets"*, and a public bucket makes every BOL, POD and rate confirmation
   readable by URL regardless of what the row-level policies say. If in doubt,
   re-run the verification query and read the `public` column.

2. **Seed** — run `supabase/seed.sql` (idempotent, `on conflict do nothing`).
   Seeds the **11** `company_settings` keys with launch-safe defaults (see the
   switchboard section in the go-live checklist): MC/USDOT "pending",
   brokerage off, testimonials hidden, sample ticker, packet downloads off,
   `shipper_signup_enabled: true`, `referral_program_active: false` (M-69) and
   `location_retention_days: 90` (M-80).
3. **Auth configuration** — Authentication → URL Configuration:
   - Site URL: `https://pickloads.com` (staging: the Vercel preview domain).
   - Redirect URLs: `https://pickloads.com/**` — required for **both** the
     M-42 password-recovery `redirectTo` (`/reset-password` + locale
     variants) **and** the signup confirmation `redirectTo`
     (`/login?verified=1` + locale variants, `src/app/actions/account.tsx`).
     Without this, self-signup confirmation links dead-end.
   - **Enable TOTP** (Authentication → Multi-Factor → Authenticator app).
     Without it `mfa.enroll` fails and `/portal/admin/mfa` shows the
     enrollment error — the app cannot flip that switch itself.

   ### Supabase auth email templates (M-60 / M-62)

   **Auth emails are sent by Supabase, not by this app.** The 15 React Email
   templates in `src/emails/` cover the *product* lifecycle (welcome,
   documents, agreements, invoices, quotes, support, account status). There
   is deliberately **no app-side verify-email template** — branding the
   confirmation mail means customizing the dashboard templates:

   | Supabase template | Used by | Customize |
   |---|---|---|
   | **Confirm signup** | `/create-account/carrier` and `/create-account/shipper` (both use non-auto-confirmed `signUp`) | Required. Brand it and keep `{{ .ConfirmationURL }}` intact — the app appends `?verified=1`, which drives the "✓ Email verified" banner on `/login`. |
   | **Reset password** | `/forgot-password` | Required (was already in the M-43 runbook). |
   | Magic link / Change email / Reinvite | not used by the app today | Leave default. |

   Localization note: Supabase sends **one** template per event, so these
   emails are English-only regardless of the user's locale. Product emails
   respect `profiles.preferred_language` (en/es/fr authored; ru/ht mirror
   English pending native review). Do not claim localized auth mail.

4. **Create the first admin** — Authentication → Users → *Add user* (enter
   email + strong password, check *Auto Confirm*). The `on_auth_user_created`
   trigger creates the `profiles` row (role defaults to `carrier`). Promote
   it in the SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin', full_name = 'Emmanuel Larocque'
   where id = (select id from auth.users where email = 'admin@pickloads.com');
   ```

   Verify: sign in at `/login` → you land on `/portal/admin/mfa` (admins are
   hard-gated from day one — see step 4b), and after enrolling, the admin
   dashboard.

   **Create the SECOND admin the same way, now.** MFA has no self-service
   recovery: a lost authenticator requires another admin to delete the factor
   in the Supabase dashboard. A single-admin project with MFA on is a lockout
   waiting to happen (security review residual risk **R-5**).

   All further staff are added through the **in-app invite flow** (step 4c),
   not by hand.

4b. **Enroll staff MFA (decision D3)** — sign in as each admin → you are
   redirected to `/portal/admin/mfa` → scan the QR (or use the manual-entry
   secret) in any TOTP app → enter the 6-digit code to verify the factor.
   Enforcement, from `src/lib/mfa.ts` via `requireStaff`/`requireAdmin`:

   | Role | Requirement |
   |---|---|
   | `admin` | **Hard from day one.** Every `/portal/admin/*` request redirects to `/portal/admin/mfa` until a factor is verified **and** the session is AAL2 (a verified factor alone is not enough — an AAL1 token is stepped up). |
   | `dispatcher` | **14-day grace** from `profiles.created_at`, with a countdown banner in the portal shell, then identical hard redirect. A dispatcher with a null/unparseable `created_at` is hard-required (fail safe — never an unbounded exemption). |
   | `carrier` / `shipper` | Never gated. |

   `/portal/admin/mfa` is the one staff route exempt from the gate (or the
   redirect would loop). Flip dispatchers to hard by enrolling them; no code
   change is needed.

   Known limit (**R-1**, security review §5): RLS is not AAL-aware. MFA gates
   the application surface, not PostgREST — a stolen AAL1 staff token still
   passes `is_staff()` against the database API. Closing it needs
   `auth.jwt() ->> 'aal'` policies authored against the live project once the
   JWT shape can be observed. Do not guess blind.

4c. **Invite the rest of the staff (in-app, S-04)** — Admin →
   **Users** → *Invite staff*: enter the email and the role (`admin` or
   `dispatcher` only — customer roles are rejected by the schema). The app
   stores **only a SHA-256 hash** of a 32-byte token (`staff_invites`, 0012);
   the raw token exists once, in the email, in a single-use link that expires
   after **7 days**. The invitee opens `/invite/<token>`, sets a name and
   password, and the accept action creates the user **email-confirmed** (the
   link already proved inbox control) and assigns the role **via the service
   role** — `guard_role_change` still blocks any self-promotion attempt.
   Pending / accepted / expired invites are listed on the Users page, and
   every invite and acceptance is written to `audit_events` (viewable at
   Admin → **Security**). There is no self-serve staff signup anywhere.

5. **Regenerate DB types** (once, against either project — schemas are
   identical). Replaces the committed placeholder-typed file:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
   npm run typecheck   # must stay green; commit the regenerated file
   ```
6. Collect the three keys (Settings → API): Project URL, `anon` key,
   `service_role` key → env table below. **The service-role key is
   server-only — never expose it with a `NEXT_PUBLIC_` prefix.**

## 2. Vercel project

1. Import the Git repo at [vercel.com/new](https://vercel.com/new) — framework
   auto-detects Next.js; no build overrides needed (`npm run build`).
2. Set environment variables per the table below. Scope **Preview** to the
   staging Supabase project and test-mode keys; **Production** to the prod
   project and live keys. `vercel.json` registers the daily cron
   automatically on deploy.
3. Deploy once to a preview URL and click through: home, `/es`, quick-quote
   submit, `/become-a-carrier` wizard (secretless steps warn but complete),
   `/login`.

### Environment variable table

Audited against the code in M-62: every row below except the last three is
actually read by `src/` (`grep -rhoE "process\.env\.[A-Z0-9_]+" src scripts`).
**Degradation column** = what happens in production if the var is missing —
the app never crashes, it disables the integration and shows an honest state,
which is exactly why a half-configured deploy is dangerous rather than loud.

| Name | Scope | Where to get it | Missing ⇒ |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | build/public | `https://pickloads.com` (prod) / preview URL (staging) — drives canonical URLs, sitemap, hreflang | wrong canonical/hreflang URLs; **SEO damage** |
| `NEXT_PUBLIC_SUPABASE_URL` | build/public | Supabase → Settings → API → Project URL | no auth, no portal, no signup — every account surface says "not configured" |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build/public | Supabase → Settings → API → `anon` key | same as above |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Supabase → Settings → API → `service_role` key | **all form writes silently no-op** — leads, quotes, signups, invites are lost |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | build/public | Cloudflare → Turnstile → widget for `pickloads.com` | widget not rendered |
| `TURNSTILE_SECRET_KEY` | server only | same Turnstile widget | verification is a **no-op** — forms are unprotected from bots (verification fails *closed* only once the secret is set) |
| `UPSTASH_REDIS_REST_URL` | server only | Upstash → Redis DB → REST API | rate limiting disabled (fails **open** by design) |
| `UPSTASH_REDIS_REST_TOKEN` | server only | same | same |
| `RESEND_API_KEY` | server only | Resend → API Keys (after domain verifies) | no email at all — all 15 customer templates + ops notices log-only |
| `EMAIL_FROM` | server only | `PickLoads <notifications@pickloads.com>` | sends fail / land in spam |
| `EMAIL_INTERNAL_TO` | server only | `support@pickloads.com` (lead/quote/ops notifications) | staff never hear about new leads |
| `PII_ENCRYPTION_KEY` | server only | generate: `openssl rand -base64 32` | **EINs are dropped, not stored** (never plaintext). Set before the first real carrier. Rotation = decrypt/re-encrypt job. |
| `DROPBOX_SIGN_API_KEY` | server only | Dropbox Sign → Settings → API | e-sign send refuses with an honest message; wizard still completes |
| `DROPBOX_SIGN_WEBHOOK_SECRET` | server only | = API key unless a dedicated app secret is configured | webhook HMAC cannot be verified → signatures never recorded |
| `DROPBOX_SIGN_TEMPLATE_ID` | server only | template created in step 7 (signer role **must** be named `Carrier`) | e-sign send refuses |
| `DROPBOX_SIGN_TEST_MODE` | server only | `true` on staging, **unset/`false` in production** | live signatures on staging (or test-mode docs in prod — check this one) |
| `STRIPE_SECRET_KEY` | server only | Stripe → Developers → API keys (test on staging, live on prod) | "Generate invoice" disabled with a tooltip naming the var |
| `STRIPE_WEBHOOK_SECRET` | server only | signing secret from step 8 | payments never mark invoices paid; the `invoices` mirror stalls at `open` |
| `CRON_SECRET` | server only | generate: `openssl rand -hex 32` — Vercel Cron sends it as the Bearer token automatically. **Guards BOTH cron routes** since M-79 | `/api/cron/daily` refuses every call → **no insurance-expiry alerts, no callback digest**; `/api/cron/notifications` refuses every call → **no shipment notification is ever sent** (the queue still fills, so the backlog is recoverable) |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | build/public | GA4 admin (step 10) — fires only after cookie consent (S-05) | no analytics; admin marketing tiles keep their honest placeholders |
| `TRACKING_ACCESS_SECRET` | server only | generate: `openssl rand -hex 32` — HMAC key for the §4 public-tracking secondary credential (recipient ZIP / access code) | **`/track` refuses EVERY lookup** ("tracking is temporarily unavailable"). This is the one secret in this table that fails **closed**, deliberately: "cannot verify the credential" is not "the credential is correct". Rotating it invalidates every stored `public_access_hash` — every shipment then needs its access code re-issued by dispatch. |
| `DRIVER_TOKEN_SECRET` | server only | generate: `openssl rand -base64 48` — HMAC key for the §13 driver update link. **M-76** | **No driver link can be minted or verified.** Both issuing surfaces (carrier portal and dispatcher detail) render an honest "not configured" notice instead of a form, and `/driver/update/<anything>` renders "updates are temporarily unavailable". Fails **closed**, like `TRACKING_ACCESS_SECRET` and for the same reason. **Rotating it is a MASS REVOCATION** — every live driver link stops working immediately and every driver needs a new one. There is no dual-key verifier today (M-76 residual risk R-4); the `v1:` prefix and the column CHECK exist so one can be added without a migration. |
| `DRIVER_TOKEN_TTL_HOURS` | server only, optional | how long a driver link lives. Default **24**, clamped to **[1, 168]**. **M-76** | Defaults to 24h. A value outside the range is clamped rather than rejected, so `8760` produces a **week**, not a year. Shortening it is the cheapest lever if driver links are being forwarded; it takes effect on newly issued links only. |

> **Note.** `.env.example` is `.gitignore`d in this repository, so **this table
> is the authoritative list**. Both M-76 variables are also written into the
> local `.env.example` for anyone working in a checkout, but do not rely on
> that file surviving a fresh clone.

**Declared in `.env.example` but read by no code today** — listed so nobody
sets them expecting an effect:

| Name | Reality |
|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` | The contact-page map is a **keyless** `https://www.google.com/maps?...&output=embed` iframe (`(site)/contact/page.tsx`). No key is used. Remove the var or keep it as a placeholder for a future Maps JS API upgrade. |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` | Sentry was decision Q8 (optional at launch) and is **not wired in**. There is no Sentry SDK in `package.json`. Setting these does nothing until an error-reporting module ships. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No client-side Stripe surface exists (invoices are server-generated and paid on Stripe's hosted page). |

> Build-time note: `NEXT_PUBLIC_*` values are inlined at build; changing them
> requires a redeploy, not just a restart.

### Pre-deploy gate (run on the release commit, in this order)

```bash
npm run typecheck && npm run lint && npm run build   # module gate (CLAUDE.md)
npm test                 # 1468 unit assertions
npm run test:rls         # 742 RLS isolation assertions — see below
npm run test:integration # 329 integration tests against local PG16 — see below
npm run test:e2e         # 360 chromium tests against the production build
```

**Since M-82 the Playwright run regenerates its own fixtures.** A `globalSetup`
step re-runs the six tracking a11y suites in vitest (~28s) and writes the DOM
they render to `test-results/tracking-harness/`, which
`tests/e2e/tracking-responsive-a11y.spec.ts` then measures in Chromium behind
the real compiled stylesheets at §22's twelve widths. It has **no skip
switch** — stale fixtures are the exact failure mode that suite exists to
prevent — so `npm run build` must have run first, and a failure in setup fails
the whole run rather than silently measuring yesterday's markup. Budget ~6
minutes for the full e2e gate; the tracking responsive/a11y suite alone is
~1.9 minutes.

**`npm run test:rls` is a release gate, not an optional extra.** It rebuilds
a throwaway database from `0001 → 0029` + seed + two/three-tenant fixtures and
asserts that carrier A cannot reach carrier B, shipper A cannot reach shipper
B (including *unclaimed* public quotes), anon reaches nothing but
`company_settings` and published posts, and no session — staff or admin — can
forge an audit row, an invite or a role change. Since M-71 it also asserts
the shipment cluster: shipper/carrier/**broker** A cannot reach B's shipment,
an unapproved broker organization grants nothing, anon reads nothing from any
shipment table, no customer session can write a shipment at all, and the
tracking-number immutability trigger and the `brokerage_active` gate reject
even the table owner. Since M-72 it also asserts the timeline bands: a shipper
never reads a `staff_only` event, a carrier never reads a shipper-band event, a
broker reads only its own band, anon reads nothing, the append-only trigger
refuses even staff, and **even an admin session is refused EXECUTE** on the five
write functions. Since M-73 it also asserts the access ledger: its **exact
eight-column set** (so a future migration adding a column able to hold the
attempted secondary value fails the suite), that anon / the owning shipper /
the assigned carrier / a broker partner all read nothing from it while staff
read everything, that **no session can insert into it at all** — staff included,
because a session that could write the ledger could forge the evidence — and
that its append-only trigger refuses UPDATE and DELETE for the table owner.
Since M-75 it also asserts the dispatcher write path: all four migration-0022
functions refused `42501` to an **admin** session and to anon, the grants read
straight out of `pg_proc` (so a future `grant … to authenticated` fails even if
the refusals were satisfied for some other reason), and `shipment_exceptions` /
`shipment_eta_history` proved **absent** so M-78's deferral cannot rot into a
drift. Since M-76 it also asserts the driver-link cluster, including the repo's
first COLUMN-level revoke (`token_hash` unreadable by `authenticated` and
`anon`). Since M-77 it also asserts **§16's document matrix**: that the matrix
table has no `public` and no `staff_only` cell and neither can be inserted,
that a shipper reads exactly 3 of 8 fixture documents and a broker exactly 2
while staff read all 8 (so every customer zero is a band decision, not an empty
table), that **carrier A reads nothing of carrier B's documents**, that a
de-activated broker organization reads nothing, that a `pending` document and a
`staff_only`-narrowed one reach nobody, that a **rate confirmation filed as
`shipper` is refused by the database**, and that the two document write
functions are refused `42501` to an admin session. **Since M-81 it also
asserts §12's broker-partner cluster**: that an ACTIVE but UNVERIFIED
organization grants nothing while its member can still see the membership row
(so the zero is verification, not a missing fixture), that a per-shipment grant
and an account agreement each reach exactly one shipment and no other, that a
**revoked** grant and an **expired or revoked** agreement stop access, that
broker A still sees exactly its one linked shipment (M-81 widened nothing),
that a partner cannot grant, invite, verify or un-revoke anything for itself,
that `token_hash` is refused at COLUMN level to every session including staff,
and — read straight out of the catalog — that `my_broker_partner_ids()`
requires both clauses, that all four M-81 policies are SELECT-only, and that
**no policy anywhere authorizes on `profiles.role = 'broker'`**.
It needs a local PostgreSQL 16; it is deliberately **not** part of `npm test`, because vitest runs on
placeholder env with no database and that property is load-bearing for CI.

```bash
initdb -D /tmp/pgdata
pg_ctl -D /tmp/pgdata -l /tmp/pg16.log \
  -o "-k /tmp/pgsock -p 5433 -c listen_addresses=" start
npm run test:rls        # PGHOST / PGPORT / PGUSER / RLS_TEST_DB override defaults
```

**`npm run test:integration` is the second database gate, new in M-72.** It is
the tracking directive's §27 integration tier, which
[`docs/FINAL-IMPLEMENTATION-PLAN.md`](FINAL-IMPLEMENTATION-PLAN.md) §4 records
as *"diagnosed absent, then dropped entirely"* by the extension audit and
restores as M-83b; M-72 ships the lane plus the four tests it can prove today.
It builds its own throwaway database (`0001 → 0029` + seed, **not** the RLS
fixtures — it creates shipments through the engine) and then runs vitest
against it, so the real TypeScript transition engine drives the real SQL write
path: create → assign carrier → create event → update status, idempotent
replay, provider dedupe, compare-and-swap conflict, event-sourced appointments,
the §20 correction flow and the append-only refusal. **M-73 adds §27's fifth
named test — the public tracking lookup** — as fourteen scenarios driving the
real `lookupPublicTracking` against the real schema through a psql-backed
PostgREST adapter: happy path, wrong secondary value, unknown number, an
admin-suspended shipment, a rate-limit trip, and a sweep of the whole access
ledger proving the submitted secret is stored in no form. **M-74 adds §27's
sixth — the shipper portal lookup — M-75 adds the seventh, §27's
DISPATCHER FLOW end to end**: create → assign carrier (with driver and truck)
→ the pickup status walk → record a delay → update the ETA → mark delivered →
request the POD → complete with the §20 closeout assertion, alongside the
refusals that make it a control (another carrier's driver, a second open
assignment, a no-op ETA, `pod_uploaded` still refused until M-77, `completed`
refused without closeout), the §2 gate refusing creation and failing closed,
the §20 correction leaving the original event byte-identical, and dispatcher A
vs dispatcher B in both directions with an admin control.

**M-76 adds the eighth — §27's CARRIER FLOW end to end**: confirm dispatch →
en route → arrived at pickup → loaded → departed pickup → in transit → arrived
at delivery → unloading → delivered, through the real §13 action list and the
real engine, plus the driver-link lifecycle (issue → redeem → consent →
expire/revoke), the rate limit tripping on a real ledger, and the proof that
the redeem payload leaks no financial value on a shipment that has one. §27's
"upload BOL / upload POD" steps are **honestly absent** — they are M-77's.

```bash
npm run test:integration   # PGHOST / PGPORT / PGUSER / INTEGRATION_TEST_DB override defaults
```

Same PG16 prerequisite as the RLS suite, and deliberately **not** part of
`npm test` for the same reason. M-83b extends it with §27's remaining seven
tests as M-73…M-79 land — the runner, harness and npm script already exist.

It has already earned its keep once: it found the `is_staff()` anon-grant
defect that would have silently emptied the public blog and sitemap in
production (fixed in `0013`; SECURITY-REVIEW.md §3). **Re-run it against the
staging database after linking** — the local run uses a shim for Supabase's
`auth`/`storage` schemas, so JWT claim shapes and storage-object policies are
not yet covered (residual risks R-6/R-7/R-8).

## 3. DNS + domain

1. Vercel project → Domains → add `pickloads.com` and `www.pickloads.com`
   (www → apex redirect).
2. At the registrar, either delegate nameservers to Vercel or set
   `A @ → 76.76.21.21` and `CNAME www → cname.vercel-dns.com`.
3. Wait for the certificate to issue; verify `https://pickloads.com` and that
   HSTS is present (configured in `next.config.ts`).

## 4. Resend — email domain (SPF/DKIM)

1. Resend → Domains → Add `pickloads.com`, sending region us-east.
2. Add the DNS records Resend displays at the registrar/Vercel DNS —
   typically: TXT SPF on the `send` subdomain (`v=spf1 include:amazonses.com
   ~all`), MX on `send`, and the `resend._domainkey` TXT (DKIM). Verify in
   the Resend dashboard.
3. Create the API key → `RESEND_API_KEY`. Send a test through the contact
   form and check the admin Notifications feed (`email_log`).

## 5. Cloudflare Turnstile

Cloudflare dashboard → Turnstile → Add widget: domain `pickloads.com`
(+ the Vercel preview domain on the staging widget), Managed mode. Copy the
site key (public) and secret. The widget renders on every public form;
server-side verification fails closed once the secret is set.

## 6. Upstash Redis (rate limiting)

Upstash console → Create Redis database (region us-east-1, TLS). Copy the
REST URL + token. Limits are 5 requests/10 min per IP per form (uploads
wider) — sliding window, fail-open on outage by design.

## 7. Dropbox Sign (e-sign)

1. Upload the **lawyer-approved dispatch agreement** as a template. **The
   signer role must be named exactly `Carrier`** — the API call fills
   `signers[Carrier][name|email_address]` and breaks with any other role
   name. Merge fields as documented in `docs/modules/M-22-esign-webhook.md`.
2. Copy the template ID → `DROPBOX_SIGN_TEMPLATE_ID`; API key →
   `DROPBOX_SIGN_API_KEY` (+ webhook secret).
3. Settings → API → Event callback URL:
   `https://pickloads.com/api/esign/webhook`, then press **Test** — expects
   the `callback_test` 200 ("Hello API Event Received").
4. Production: ensure `DROPBOX_SIGN_TEST_MODE` is unset/`false`.

## 8. Stripe (dispatch-fee invoicing)

1. Activate the live account; copy the live secret key.
2. Developers → Webhooks → Add endpoint
   `https://pickloads.com/api/stripe/webhook`, events: **`invoice.paid`** and
   **`invoice.payment_failed`**. Copy the signing secret →
   `STRIPE_WEBHOOK_SECRET`.
3. Compliance guard is code-enforced: invoices carry ONLY the dispatch fee
   line (never freight charges) — see `src/lib/stripe.ts`.

## 9. Cron (O-01 daily ops alerts + M-79 notification worker + M-80 retention purge)

`vercel.json` schedules **two** jobs, and **both** authenticate with the
same `CRON_SECRET` bearer token, compared in constant time. Set it once in
Vercel and deploy. **M-80 added no third entry** — its retention purge is a
task inside the existing daily job.

| Schedule | Path | What it does |
|---|---|---|
| `0 11 * * *` | `/api/cron/daily` | M-35: insurance-expiry threshold alerts + callback digest · **M-80: §9 location-history retention purge** |
| `*/5 * * * *` | `/api/cron/notifications` | **M-79**: harvest new `shipment_events` into the notification queue, claim a bounded batch (25), deliver, settle |

Verify each once manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://pickloads.com/api/cron/daily
curl -H "Authorization: Bearer $CRON_SECRET" https://pickloads.com/api/cron/notifications
```

The notification worker answers with **counts only** — no addresses, no
tracking numbers, no payloads, no provider text (§26's never-log list applies
to a response body that lands in a Vercel log):

```json
{"ok":true,"harvested":{"scanned":0,"enqueued":0},"claimed":0,
 "sent":0,"suppressed":0,"failed":0,"dead":0,"notes":[]}
```

**Read the status code, not the body.** A run that could not reach the
database answers **503**, not a green 200 with zeros in it. Without
`CRON_SECRET` it answers 503 before doing any work; with a wrong token, 401.

**If `CRON_SECRET` is unset, no shipment notification is ever sent.** The
queue still fills whenever a harvest runs, so the backlog is recoverable —
set the secret and the next pass drains it — but nothing goes out until then.
This is the honest failure mode, deliberately chosen over an inline send that
would bypass the opt-out check with it.

### M-80 — the §9 location-retention purge (inside `/api/cron/daily`)

The daily response gains a `locationRetention` block:

```json
{"ok":true,"date":"2026-08-06",
 "locationRetention":{"ok":true,"retentionDays":90,"deleted":0,"moreRemaining":false},
 "insurance":{...},"callbacks":{...}}
```

- `retentionDays` is the **live** value of the `location_retention_days`
  switchboard key. If it reads **90** after you set something else, the value
  did not parse and the executor **failed safe** — fix the key, do not assume
  it worked.
- `moreRemaining: true` means a backlog is draining one batch (50 000) per
  night. That is normal after a long window is shortened; watch it fall.
- `ok: false` with a `reason` means the purge failed and **nothing was
  deleted**. The insurance and callback digests still went out. It is also
  emitted as §26's `location_provider_failure` signal.

**Changing the retention window is a settings edit, not a deploy** — Admin →
Settings, key `location_retention_days`, an integer 1–3650. Anything else
resolves to 90; the executor never resolves to "keep forever". **Shortening it
takes effect on the next nightly run, including for readings already stored.**

**Throughput.** 25 notifications per invocation × 12 invocations/hour = 300/h.
The bound is deliberate: a serverless invocation has a wall clock, and a
worker that tries to drain an unbounded backlog times out and settles nothing,
leaving every claimed row to its lock TTL. If volume outgrows it, raise
`WORKER_BATCH` in `src/lib/shipments/notification-worker.ts` **and** the
schedule together.

## 9b. Map and tracking-provider configuration (M-80)

**Nothing to configure, and that is the shipped state.**

**No provider is connected.** PickLoads holds no telematics contract, no
Motive/Samsara/Geotab/Verizon Connect credentials and no ELD consent from any
carrier. `tracking_provider_connections` is empty in every environment, the map
component never mounts, and every customer surface renders §30's *"Milestone
tracking"* — which is the truth, not a placeholder.

**There is no map API key, no tile provider and no map script.** The map is
inline SVG rendered from coordinates the server already disclosed; it makes
**zero network requests**, which is why the CSP in `next.config.ts` is
unchanged. Do not add a map key "just in case" — nothing reads one.

### Verifying the honest state after deploy

```sql
select count(*) from tracking_provider_connections;   -- expect 0
select location_retention_days();                     -- expect 90
select purge_expired_shipment_locations();            -- returns a JSON envelope
```

Then open any shipment at `/portal/admin/shipments/[id]` → **Tracking
providers**. All five rows must read *Not configured / **Not connected***. If
a row reads "Credentials present", somebody set an environment variable — see
below for what that does and does not mean.

### Environment variables for a FUTURE provider

Setting these does **not** switch tracking on. M-80 ships the adapter
*interface*; no HTTP transport is implemented for any vendor, by §9's own
instruction not to implement a fake connection. With credentials present the
adapter's refusal changes from `not_configured` to `not_implemented` and
nothing else. §15: credentials live here and **never** in a database column.

| Provider | Variables | Unit trap the adapter already handles |
|---|---|---|
| Motive | `MOTIVE_API_KEY` | — (imperial) |
| Samsara | `SAMSARA_API_TOKEN` | `"Richmond, VA"` is the only city field |
| Geotab | `GEOTAB_DATABASE`, `GEOTAB_USERNAME`, `GEOTAB_PASSWORD` | **`speed` is km/h** |
| Verizon Connect | `VERIZON_CONNECT_APP_ID`, `VERIZON_CONNECT_USERNAME`, `VERIZON_CONNECT_PASSWORD` | **`updateUtc` carries no zone** |

To actually connect one: implement the four `fetch*` methods in
`src/lib/shipments/providers/<vendor>.ts` (`normalize`, `dedupeKey`, the
consent gate, the dedupe index and the write path already exist), set the
variables, then move `eta_source = 'provider'` from `UNREACHABLE_ETA_SOURCES`
to `DISPATCHER_ETA_SOURCES` **in the same commit** — M-78's partition test
fails until both halves are done, which is the point.

**If a basemap is ever wanted**, it needs exactly one addition to the CSP in
`next.config.ts` — the tile host in `img-src`, nothing else — plus a tile layer
in `ShipmentMap`. `tests/e2e/shipment-map.spec.ts` asserts both absences today
and will fail until both are done deliberately.

### Mode B links (§9), operationally

A dispatcher records a driver-location link a provider gave them at
`/portal/admin/shipments/[id]` → *Tracking provider link*. It must be
`https://` and must not carry an API credential — the database refuses both
(23514). The link is **staff-only**: no customer surface shows it. Attaching
one moves the shipment to `link` mode; revoking the last one returns it to
`manual` and to §30's milestone label.

### Location privacy (§9), operationally

Per shipment, at *Customer location visibility*. Default `approximate`
(city/state, no coordinates). A **dispatcher may narrow** any shipment at any
time — that is the action to take when a shipper phones and asks for the map
off. **Widening requires an admin** (PL403 otherwise), because `exact` is the
setting §9 spends its warning paragraph on. The public `/track` page is capped
at city/state at **every** level. Each change is journalled as a `staff_only`
shipment event and an `audit_events` row.

## 9c. Broker-partner onboarding (M-81)

**Nothing to configure.** No environment variable, no `company_settings` key,
no cron entry. `broker_partners` is empty in every environment on day one, and
**there is no self-service path to broker access at all** — §3 forbids it, and
`src/lib/validation/broker.ts` has no `role`, `verification_status` or `active`
field for a browser to post.

### Onboarding a partner, in order

The order is not optional: each step is dark until the one before it is done.

1. **Admin only** → `/portal/admin/brokers` → *Add a partner organization*.
   Record what you checked: MC and DOT number, **authority grant date**, bond
   provider and amount, and stated days to pay. The organization is created
   **UNVERIFIED and inactive** and reads nothing.
2. **Verify.** The table shows *"under 12 months old"* beside a recent
   authority date — that is a FACT for you to weigh, not a verdict; nothing in
   the product scores a partner. Verification stamps who and when, and writes a
   `broker.verify` audit event.
3. **Invite a user.** Enter their email. The invitation link is single-use,
   expires in seven days, and exists **only** inside that email — the database
   stores a SHA-256 hash, and `token_hash` cannot be read by any session
   including yours (column-level grant). Cancel a pending invite from the same
   row.
4. **They accept** at `/broker-invite/<token>`, choosing a name and password
   and nothing else. The organization and the role come from the invite row.
5. **Share freight.** Either:
   * *shipment by shipment* — open the shipment at
     `/portal/admin/shipments/<id>` → **Broker partner access** → share. A
     **dispatcher** can do this for shipments in their scope; sharing with an
     unverified partner is refused rather than silently granting nothing.
   * *account agreement* — `/portal/admin/brokers` → **Account agreement**:
     one partner, one shipper account, an optional end date. Revoking it closes
     every shipment it covered at once.

### Revoking access, fastest first

| Need | Do this | Effect |
|---|---|---|
| One shipment, one partner | *Revoke* on the shipment's Broker partner access card | That shipment only, immediately |
| Everything under one agreement | *Revoke* the agreement | Every shipment of that shipper, immediately |
| **Everything, everywhere, now** | *Suspend* the organization | Every shipment, document, timeline and contact — one write, because the rule lives inside `my_broker_partner_ids()` |

### Smoke test (needs `brokerage_active` true and one real shipment)

1. Create a partner organization. **Before verifying**, invite yourself at a
   second address and accept. Sign in: `/portal/broker` must say *"Your
   organization is awaiting verification"* — **not** an empty table.
2. Verify the organization. Reload: the page now says nothing has been shared
   yet.
3. Share one shipment from its dispatcher page. Reload `/portal/broker`: **that
   shipment and no other.** Open it and confirm — status, timeline, ETA,
   approved contacts, and any APPROVED BOL or POD.
4. **Confirm the deny list on the same screen**: no rate, no customer price, no
   margin, no carrier name (only *"A carrier is assigned"*), no rate
   confirmation and no invoice in the document list. The *"What this portal
   never shows"* card states it in the partner's own language.
5. Revoke the share. Reload: the shipment is gone and its URL is a **404**, not
   a 403.
6. Suspend the organization. Reload: back to the unverified state, everywhere.
7. Check `/portal/admin/security`: `broker.partner_create`, `broker.verify`,
   `broker.invite`, `broker.invite_accepted`, `broker.grant_shipment`,
   `broker.revoke_shipment` and `broker.suspend` are all journalled, and **no
   entry contains a token**.

**If step 1 shows an empty shipment table instead of the awaiting-verification
card**, stop: `my_broker_partner_ids()` is not verification-gated, which means
0029 did not fully apply. Re-check it before sharing anything.

## 10. GA4 + Search Console

1. GA4: create the property, Web stream for `https://pickloads.com` →
   measurement ID → `NEXT_PUBLIC_GA4_MEASUREMENT_ID` → redeploy. The tag
   loads **only after cookie-consent accept** (audit S-05) — verify in
   Realtime after accepting the banner.
2. Search Console: verify the domain property (DNS TXT), submit
   `https://pickloads.com/sitemap.xml`, confirm hreflang pages index.

---

## Go-live checklist (block launch until all checked)

**Legal (arch §10) — external dependency: lawyer**
- [ ] Privacy policy, Terms of service, Cookie policy delivered and pasted
      into `/legal/*` pages; remove their `noindex` once counsel-approved.
- [ ] Carrier agreement + dispatch agreement finalized → Dropbox Sign
      template (step 7) rebuilt from the final text.
- [ ] Lawyer-approved carrier packet PDFs uploaded → flip
      `packet_downloads_live` to `true`.
- [ ] ESIGN consent language reviewed (onboarding step 4 checkbox).

**company_settings switchboard (admin → Settings, seeded pending-safe)**

All eleven keys, their seeded value and what they gate. Every edit is journaled
to `audit_events` as `settings.update` (key only, never the value) and takes
effect site-wide immediately — **no deploy**.

| Key | Seeded | Gates |
|---|---|---|
| `mc_number` | `{"status":"pending","value":null}` | Footer, compliance block, FAQ. Stays `pending` until FMCSA grants — see the one-pager below. |
| `usdot_number` | `{"status":"pending","value":null}` | Footer, compliance block. |
| `bond_status` | `{"status":"in_process","value":"BMC-84 $75K"}` | Surety-bond display. `in_process` until BMC-84 is actually filed. |
| `brokerage_active` | `false` | Every "brokerage live" message: shipper pages drop "Launching Soon", and the **shipper portal's Shipments & Tracking** surface flips from the honest waitlist (D1/D6) to the first-shipment empty state. **Since M-75 it also gates a STAFF surface**: with it off, `/portal/admin/shipments/new` renders an honest card instead of a create form, the create action refuses with a staff-readable reason, and 0017's trigger refuses the INSERT underneath both — while shipments already in flight stay fully operable (status, ETA, notes, assignments all keep working, by design). Flip only when the bond is effective and broker processes exist. |
| `testimonials_visible` | `false` | V4 sample testimonials stay hidden until 5+ verified reviews exist. |
| `stats` | `{"fee":"5%","avg_rate":null,"support":"24/7","states":"48"}` | Home stats tiles. **`null` renders hidden** — never invent a figure to fill it. |
| `packet_downloads_live` | `false` | Carrier-packet download buttons — off until lawyer-approved PDFs are uploaded. |
| `load_ticker_mode` | `"sample"` | Home load-board ticker: `sample` \| `live`. |
| `referral_program_active` | `false` | **M-69/P-2** — the sitewide `CtaBand` referral-bonus line. The approved V4 copy and all five translations stay in the codebase and render only when this is `true`. Flip it the day the referral programme (website directive §32 J) actually pays out, and not before: it is a promise on 20+ pages × 5 locales. |
| `location_retention_days` | `90` | **M-80/§9** — how many days of shipment location history to keep. `/api/cron/daily` DELETES older readings nightly. An integer **1–3650**; anything else (a word, a blank, a negative, 99999) resolves to **90** — the executor never resolves to "keep forever", so a typo shortens nothing and lengthens nothing. **Shortening it takes effect on the next nightly run, including for readings already stored.** Check `locationRetention.retentionDays` in the cron response after editing: if it still reads 90, the value did not parse. |
| `shipper_signup_enabled` | `true` | **Decision D1** — public shipper self-signup at `/create-account/shipper`. When `false`, the shipper door on the `/create-account` chooser shows an honest invite-only state instead of the form. This exists so **legal can switch shipper self-registration off without a deploy**; the signup copy is deliberately scoped to "request quotes and coordinate freight with vetted carriers" and makes no brokerage claims. |

- [ ] Reviewed all eleven values against the business's actual status.
- [ ] Confirmed `brokerage_active` and `shipper_signup_enabled` with counsel.

**Content prerequisites**
- [ ] Publish **2 blog articles** minimum via the admin blog editor (empty
      blog looks abandoned; SEO needs crawlable content at launch).
- [ ] **RU/HT native review** of the translated catalogs — machine-assisted
      RU/HT strings plus the M-42 supplemental strings (which deliberately
      mirror English in ru/ht) need a native speaker pass. **M-73 adds the
      `shipment` namespace: 176 keys, `en`/`es`/`fr` authored, `ru`/`ht`
      mirroring English pending review** (the established precedent — §24
      forbids machine-translating customer-facing tracking text, so a Russian
      visitor sees English words rather than plausible-sounding machine
      Russian about where their freight is). The statuses, the nine milestone
      labels and decision D-6's curated operator phrases are the priority:
      they are what a customer actually reads on `/track`. **M-78 adds 16
      keys on the same terms** — 11 new D-6 phrases (the `resolution.*` group
      that closes an exception, plus customs / detention / reroute delays),
      §30's seventh honest label (*"Estimated from distance and standard
      transit times"*) and the exception banner's resolved/open wording;
      `en`/`es`/`fr` authored, `ru`/`ht` mirroring English pending review.
      The resolution phrases are the highest priority of the batch: a
      customer who was told about a problem in their own language and then
      told it was fixed in English is the exact failure D-6 exists to
      prevent.
- [ ] Founder photo (About page shows a monogram until the shoot).

**Technical smoke (after DNS cutover)**
- [ ] Full pre-deploy gate green on the release commit (typecheck · lint ·
      build · `npm test` · `npm run test:rls` · `npm run test:integration` ·
      `npm run test:e2e`).
- [ ] Quick-quote submits → row in `carrier_leads` + notification email at
      `EMAIL_INTERNAL_TO` + `email_log` row.
- [ ] Full onboarding walkthrough on staging: wizard → uploads → e-sign
      (test mode) → portal.
- [ ] Password recovery round-trip (forgot → email → reset → portal).
- [ ] `robots.txt`, `sitemap.xml`, hreflang, security headers (check on
      [securityheaders.com](https://securityheaders.com)). `sitemap.xml` must
      list `/track` in all five locales and contain **nothing** matching
      `PL-\d{4}-\d{6}` (M-73: the lookup form is indexable, results have no
      URL at all).
- [ ] **`/track` smoke test (M-73).** With `TRACKING_ACCESS_SECRET` set and a
      real shipment created by dispatch (`public_tracking_enabled = true`, an
      access code set through `hashSecondaryValue`):
      1. `/track` renders the two-field form in all five locales; while
         `brokerage_active` is false the honest pre-brokerage notice is shown.
      2. Correct number **+** correct ZIP/access code → the result panel:
         status, ETA with "ETA provided by dispatcher", the nine-step timeline
         with visible "Completed"/"Current step" text, the shipment summary,
         and "Last updated by dispatch".
      3. Correct number **+ wrong** ZIP → one refusal message. Then an
         **unknown** number + any value → the **same** message, word for word.
         If the two differ, stop: that is an enumeration oracle.
      4. Five rapid attempts from one IP → the rate-limit message on the fifth.
      5. `select outcome, ip, tracking_number_attempted from
         shipment_tracking_access order by accessed_at desc limit 10` shows one
         row per attempt with the right outcomes — and **no column anywhere in
         the table holds the ZIP or access code you typed**.
      6. Submit the support-message button → a row in `contact_messages` whose
         subject is `Tracking support — PL-YYYY-######`, plus the internal
         notification email.
      7. With `TRACKING_ACCESS_SECRET` **unset** in a preview environment,
         every lookup says "temporarily unavailable" — never grants.
- [ ] **Shipper shipments smoke test (M-74).** Sign in as a shipper whose
      profile has a `shipper_memberships` row:
      1. While `brokerage_active` is **false** and the account has no
         shipments, `/portal/shipper/shipments` shows the "Launching soon"
         waitlist card — **not** an empty table with filters. The overview
         shows its four quote tiles and **no** shipment tile row.
      2. Flip `brokerage_active` to `true` (or create a shipment through
         dispatch, which needs the flag on). The list, the nine filters and
         the pager appear; the overview gains the eight §11 tiles. Confirm
         "Documents awaiting review" renders an **em-dash**, not `0` — M-77
         owns that table and a zero there would be a fake metric.
      3. Apply a filter → the URL carries it, the result count changes, and
         the "Next" link keeps the filter. Turn JavaScript off and repeat: the
         filter form is a plain GET and must still work.
      4. Open a shipment. Confirm the nine-step timeline, the ETA label, the
         **Location** block reading "Milestone tracking" with *"This page does
         not show a live GPS position"* (there is deliberately no map yet —
         M-80), the honest documents empty state, the invoice section, the
         contacts table with the carrier row saying "Contact through dispatch",
         and the update history.
      5. Edit the URL to another shipper's shipment id, and to `…/not-a-uuid`.
         **Both must render 404**, never 403 and never a partial page. If
         either shows a shipment, stop.
      6. Flip `brokerage_active` back to `false`. The shipper who now HAS
         shipments must still see them, with the "new bookings are paused"
         note — in-flight freight never disappears.
- [ ] **Dispatcher operations smoke test (M-75).** Sign in as a **dispatcher**
      (not an admin) with at least one carrier assigned on
      `/portal/admin/users`:
      1. While `brokerage_active` is **false**, `/portal/admin/shipments/new`
         shows the honest "brokerage is switched off" card — **not** a form.
         The board shows the same note above the columns. If a form appears,
         stop: the §2 gate is not wired.
      2. Flip `brokerage_active` to `true`. Create a shipment. The tracking
         number appears in `PL-YYYY-######` form and is stated on the detail
         page as **fixed at creation** — there must be no edit control for it
         anywhere.
      3. The board shows eight columns (**Needs Carrier · Carrier Assigned ·
         Pickup Today · In Transit · Delivery Today · Delayed · POD Pending ·
         Completed**) with a count in each heading and a "Scoped view" note
         naming your assigned-carrier count. Turn JavaScript **off** and
         re-apply a filter: the bar is a plain GET form and must still work.
      4. Paste the whole tracking number into the search box, then just the
         last six digits. Both find the shipment. Ask an admin for a tracking
         number outside your scope and search it: it must return **nothing**,
         not "not yours".
      5. Assign a carrier, then move the status to **Carrier Assigned**. Try
         moving straight to **Completed** — it must be refused with a stated
         reason, not silently ignored. Walk pickup → delivered, record a delay
         and an ETA (confirm the ETA is labelled as entered by dispatch),
         request the POD, then complete it with the closeout box ticked.
      6. Record a call and an email, add one **internal note** and one
         **public update**. Open the same shipment in the shipper portal (or
         `/track`): the public update is there and the internal note is
         **not**. If an internal note reaches a customer surface, stop.
      7. Open two browser tabs on the same shipment, change the status in one,
         then submit from the other. The second must say *"Somebody else moved
         this shipment… Reload"* — never a generic error and never a silent
         overwrite.
      8. As a **dispatcher**, confirm there is no "Correct the status" form.
         Sign in as an admin: it appears, refuses a one-word reason, and its
         correction leaves the original timeline entry in place with a new
         correction entry beside it.
      9. Edit the URL to a shipment outside your dispatcher scope: it must
         **404**. Then flip `brokerage_active` back to `false` and confirm the
         in-flight shipment is still fully operable.

- [ ] **Carrier update + driver-link smoke test (M-76).** Needs
      `DRIVER_TOKEN_SECRET` set and `brokerage_active` **true**, with a
      shipment assigned to a carrier that has a portal account:
      1. Sign in as that **carrier**. `/portal/carrier/shipments` lists the
         shipment. **There must be no dollar figure in the list at all** — the
         list projection names no financial column. If you see a rate, stop.
      2. Open it. Your **contracted pay** is shown, with the sentence saying
         the customer's price and our margin are not. Search the page for the
         shipper's gross: it must not be there in any form, including the HTML
         source.
      3. Record the walk §13 names: **confirm dispatch → en route → arrived at
         pickup → loaded → departed pickup → in transit**. Each control appears
         only when the shipment is in a status it can legally leave. There is
         **no cancel and no complete control** anywhere; if either appears,
         stop.
      4. **BOL / POD upload is NOT built (M-77).** The card says so in words.
         An upload button that appears to work is a defect, not a bonus.
      5. Create a driver link. **Copy it immediately — it is shown once and
         cannot be retrieved**, because only a fingerprint is stored. Confirm
         the URL contains no tracking number, no shipment id and no company
         name.
      6. Open the link in a **private window on a phone**, or at a 320px
         viewport. It must show the shipment, the stops and the update
         controls — and **no rate, no invoice, no shipper name, no map**. Every
         button should be comfortably thumb-sized.
      7. **Location consent starts OFF.** Confirm there are no city/state
         fields. Tick the consent box, save, and they appear. Send an update
         with a city. Untick and save: the fields disappear again.
      8. Send a status update from the driver link. It appears on the
         **carrier's** update history and on the dispatcher's — attributed to
         the link.
      9. **Revoke the link** from either the carrier detail page or
         `/portal/admin/shipments/<id>`. Reload the driver link: it must now
         read **"Tracking link expired"** with a phone number. Reload again in
         `/es` and `/fr` and confirm the heading is translated.
      10. Paste a nonsense token (`/driver/update/aaaa…`, 43 characters). It
          must render the **identical** page to the revoked one — if the two
          differ in any way, the link is enumerable and you should stop.
      11. Hit an invalid link **nine times from one network**. From the ninth
          the page says "too many tries". Check
          `select outcome, count(*) from shipment_driver_token_access group by
          1` — every attempt, including the rate-limited ones, is on the
          ledger. That table is the answer to "who used this link?" and it
          cannot be edited or deleted by anyone, service role included.
      12. With `DRIVER_TOKEN_SECRET` **unset** in a preview environment, both
          issuing surfaces show the honest "not configured" notice and no link
          can be created. That is the fail-closed path; a link that still
          minted would mean the guard is not wired.
- [ ] **Documents + POD smoke test (M-77).** Needs `brokerage_active`
      **true**, a shipment assigned to a carrier with a portal account, and
      that shipment walked to **delivered**:
      1. As the **carrier**, open the shipment. Under "Send a document" the
         type list must be exactly **BOL · POD · lumper receipt · detention
         documentation · delivery receipt**. If `Invoice`, `Quote`, `Carrier
         rate confirmation` or `Claim document` is in that list, **stop** —
         those are ours to issue.
      2. Upload a POD (a phone photo is the real case). The result says
         dispatch reviews it before the customer can see it. **Now check the
         shipper's view: the document must NOT be there.** An unreviewed
         document reaching a customer is the failure this step exists to
         catch.
      3. Try uploading a **`.pdf` that is really a text file** (rename
         anything). It must be refused as an unsupported type — the server
         reads magic bytes, never the extension or the browser's
         `Content-Type`.
      4. As **dispatcher**, open `/portal/admin/shipments/<id>`. The POD is
         listed as **In review**. Try to move the status to **POD uploaded**:
         the control must not be offered, and if you force it the server
         refuses with a precondition failure naming the POD.
      5. **Approve** the POD. Now "POD uploaded" is available and succeeds.
         That chain — upload, human approval, transition — is §20, and it is
         the only way that status can be reached.
      6. Back on the **shipper's** shipment detail, the POD now appears.
         Download it. The link opens in a new tab and **expires in five
         minutes** — wait six and reload the tab to confirm it is dead. Copy
         the URL out and paste it into a private window *within* the window to
         confirm it works, then again after expiry to confirm it does not.
      7. **The rate confirmation test.** As dispatcher, file a **Carrier rate
         confirmation** on the same shipment and approve it. It must appear
         for the **carrier** and must NOT appear for the **shipper** — check
         the page and then the HTML source. If the shipper can see it, stop
         and do not go live: that is §4's first named prohibition.
      8. File a **Claim document** and approve it. It must appear for
         **nobody** but staff.
      9. Tick **"Keep this staff-only"** on a BOL upload and approve it. It
         must stay invisible to every customer even though its type licenses
         three audiences.
      10. Check the ledger: `select action, target_table, detail from
          audit_events where action = 'document.download' order by created_at
          desc limit 5`. Every download you just did is there, with the doc
          type, the audience and `ttl_seconds`. **There must be no URL in any
          of them** — a signed URL in the audit trail is a live credential in
          a log, and if you see one, stop.
      11. As a **shipper**, load the portal overview. The "Documents awaiting
          review" tile shows a real number, not an em-dash. Approve everything
          and confirm it drops to `0` rather than to a dash — `0` means the
          query ran, a dash means it failed.
      12. **Reject** a POD with a note. Confirm the shipper's view loses it
          and the carrier is asked for a replacement, and that `select status,
          approved_at from shipment_documents where id = …` shows
          `rejected` / `NULL` — the approval timestamp is cleared, so the §20
          precondition tracks the current decision and not the history.
- [ ] **Exceptions + ETA smoke test (M-78).** Needs `brokerage_active`
      **true** and a shipment in transit with a shipper portal account:
      1. As **dispatcher**, open `/portal/admin/shipments/<id>` → **Log an
         exception**. Pick a type and severity, choose a **standard phrase**
         for "What the customer is told", and write the internal note. Save.
      2. Check the **register** below the forms: the exception is listed
         **Open**, with its severity, who it is assigned to and both
         descriptions. This is the only surface in the product where §21's ten
         fields appear together.
      3. **Now check the shipper's view and `/track`.** Both must show the
         calm banner with **only** the phrase you picked — translated, if the
         customer's language is not English. **If the internal note appears
         anywhere on either page, stop and do not go live**: that is §21's one
         named prohibition.
      4. Log a second exception with the customer line **left blank**. It must
         appear in the register and **on no customer surface at all** — a
         blank alarm is worse than silence, and the absence is deliberate.
      5. **Triage** the first one: reassign it, raise the severity, tick
         "Record that the customer has been told". Note the time. Tick it
         again and confirm the timestamp **does not move** — "when did the
         customer find out?" is not something a second click rewrites.
      6. **Resolve** it with a resolution and a standard resolution phrase.
         The banner on both customer surfaces now reads as closed rather than
         disappearing. Try to resolve it again: refused. Re-opening means
         logging a NEW exception, which is what leaves the reopen visible.
      7. **Update ETA** with source **Manual**. The customer page labels it
         *"ETA provided by dispatcher"*.
      8. Change it again with source **Calculated**. The server ignores
         whatever time you typed and computes from the recorded mileage; the
         label becomes *"Estimated from distance and standard transit
         times"*. On a shipment with **no mileage** it refuses outright and
         says so — that refusal is correct and is the honest behaviour.
         **`Provider` is not in the list and must not be**: no telematics
         adapter exists until M-80.
      9. Check the history: `select eta_kind, previous_eta_at, new_eta_at,
         eta_source from shipment_eta_history where shipment_id = '<id>'
         order by changed_at`. Every change has its PREVIOUS value beside the
         new one. Try `update shipment_eta_history set new_eta_at = now()` —
         it must fail with `PL409`. That table is append-only for everyone.
      10. Confirm the shipper's **portal feed** has an "Updated delivery
          estimate" notification. **Since M-79 there is also an email** — it
          is enqueued by the harvest and sent by the notification worker
          within about five minutes, not inline. Verify it with the M-79
          smoke test below rather than waiting on this page.
- [ ] **Backfill re-run (M-78, safe and idempotent).** Migration 0025 runs it
      once and prints the count. If exceptions were logged against a lagging
      replica, or a surface was rolled back and re-applied, re-run it as the
      service role:

      ```sql
      select public.backfill_shipment_exceptions();   -- returns rows inserted
      ```

      It **never deletes or edits a `shipment_events` row** (0019's append-only
      trigger refuses that from every role, service role included) and it
      **cannot duplicate** — `source_event_id` is unique. A second run on a
      clean database returns `0`. Anything other than `0` on a re-run means
      new event-only exceptions arrived, which is exactly what it is for.
- [ ] **Location, map and retention smoke test (M-80).** Needs
      `brokerage_active` **true**, `CRON_SECRET` set, and one shipment with a
      shipper portal account:
      1. **Confirm the honest state first.**
         `select count(*) from tracking_provider_connections;` → **0**, and
         `/portal/admin/shipments/<id>` → *Tracking providers* shows all five
         vendors as *Not configured / Not connected*. If any row claims a
         connection, stop — nothing in this build can produce one.
      2. As **dispatcher**, record a status update carrying a city and state.
         Confirm the history was mirrored:
         `select city, state, retention_expires_at from shipment_locations
          where shipment_id = '<id>';` — one row, with an expiry ~90 days out.
      3. Open the shipment in the **shipper portal**. The *Location* panel
         must show the badge **"Milestone tracking"**, the city you typed, the
         sentence *"PickLoads is not connected to a GPS or ELD provider…"*,
         and the visible list **"Recorded location updates"**. There must be
         **no map** — no `<svg>`, no image, no iframe. Same on `/track`.
      4. **Prove the ledger keeps no coordinates.**
         `insert into shipment_events (shipment_id, event_type, source,
          latitude, longitude, visibility) values ('<id>','location_update',
          'gps',37.5,-77.4,'public');` must fail with **`PL422`**. That is what
         makes the retention window a fact rather than a claim.
      5. **Walk §9's four levels.** As **dispatcher**, set *Customer location
         visibility* to **Hidden** — the shipper's panel must show *"Location
         temporarily unavailable"* and no readings. Then try to set it back to
         **Exact** as the dispatcher: refused, with *"Showing more of a
         truck's position is an admin action."* Do it as an **admin**: it
         succeeds. Confirm the audit trail:
         `select metadata from shipment_events where shipment_id = '<id>'
           and metadata->>'kind' = 'location_visibility_change';`
      6. **Prove the public cap.** With the level at **Exact**, look the
         shipment up on `/track`. The panel shows city and state and **no
         coordinates** — §9 forbids exposing an exact truck position to every
         public visitor, whatever the level says.
      7. **Prove the retention executor deletes.** Age one reading and run the
         purge:
         ```sql
         update company_settings set value = '1'::jsonb
           where key = 'location_retention_days';
         select purge_expired_shipment_locations();   -- deleted >= 1
         update company_settings set value = '90'::jsonb
           where key = 'location_retention_days';
         ```
         Then fire the daily cron and read the block:
         `curl -H "Authorization: Bearer $CRON_SECRET"
         https://pickloads.com/api/cron/daily` → `locationRetention.ok: true`
         and `retentionDays: 90`. **If `retentionDays` is 90 when you set
         something else, the value did not parse** — the executor failed safe,
         and your setting is not in force.
      8. **Prove the credential line (§15).** In *Tracking provider link*,
         paste `https://example.test/t/abc?api_key=SECRET`. It must be refused
         with a message naming environment variables. Paste
         `https://example.test/t/opaque-abc`: accepted, the shipment moves to
         `link` mode, and **no customer surface shows the link**. Revoke it —
         the shipment returns to `manual` and to the milestone label.

- [ ] **Broker-partner smoke test (M-81).** Needs `brokerage_active` **true**
      and one real shipment. Full walkthrough in **§9c**; the four checks that
      block launch:
      1. Invite yourself into an **unverified** organization and sign in.
         `/portal/broker` must say *"Your organization is awaiting
         verification"*. **An empty shipment table here means
         `my_broker_partner_ids()` is not verification-gated — stop, 0029 did
         not fully apply.**
      2. Verify, share ONE shipment, reload. **That shipment and no other.**
         Open a second shipment's id by hand: **404, never 403.**
      3. On the detail page confirm §12's deny list holds: **no rate, no
         customer price, no margin, no carrier name** (only *"A carrier is
         assigned"*), and the document list carries the approved BOL/POD and
         **not** the rate confirmation or the invoice. If any of those appear,
         stop and do not go live.
      4. Revoke the share → the shipment is gone and its URL 404s. Suspend the
         organization → everything is gone at once. Both are journalled in
         `/portal/admin/security`, and **no audit entry contains a token**.

- [ ] **Notifications smoke test (M-79).** Needs `brokerage_active` **true**,
      `CRON_SECRET` and `RESEND_API_KEY` set, and a shipment with a shipper
      portal account whose profile has a reachable address:
      1. As **dispatcher**, move the shipment to **Picked up** on
         `/portal/admin/shipments/<id>`.
      2. Fire the worker by hand rather than waiting five minutes:
         `curl -H "Authorization: Bearer $CRON_SECRET"
         https://pickloads.com/api/cron/notifications`. Expect **200** with
         `harvested.enqueued` ≥ 2 (one email, one in-app) and `sent` ≥ 2.
      3. **Run it a second time immediately.** `enqueued` and `sent` must both
         be **0** — §17's *avoid duplicate notifications*, enforced by the
         unique `idempotency_key`, not by a flag somebody can clear. **If the
         second run sends anything, stop and do not go live.**
      4. Check the customer's inbox. The email must carry: the tracking
         number; the **"Track this shipment"** link resolving to
         `/track?number=PL-…` with the number prefilled and the **ZIP field
         empty**; the honest foot note *"Milestone tracking — updates are
         entered by our dispatch team as the shipment moves"*; and a **"Stop
         shipment update emails"** link. It must carry **no amount, no
         internal note, no document link and no access code** — if any appears,
         stop.
      5. Confirm the delivery is logged twice, as it should be:
         ```sql
         select state, attempts, provider_message_id, sent_at
           from shipment_notification_queue where shipment_id = '<id>';
         select attempt_no, outcome, provider_message_id
           from shipment_notification_attempts a
           join shipment_notification_queue q on q.id = a.queue_id
          where q.shipment_id = '<id>' order by a.created_at;
         ```
         Then try `update shipment_notification_attempts set outcome = 'sent'`
         — it must fail with **`PL409`**. That ledger is append-only for every
         role, owner included.
      6. **Prove the opt-out.** Click the "Stop shipment update emails" link.
         The page must load **with no session**. Confirm on the page (the GET
         alone must change nothing — corporate link scanners prefetch every
         URL in an email). Now move the shipment to **In transit** and fire
         the worker again: the in-app feed row still appears, and **no email
         is sent**. The queue row for the email channel reads `suppressed`,
         **not** `failed` — an honoured opt-out is a success, and a dashboard
         that showed it as an outage would be lying. Turn it back on from the
         same page and confirm the next milestone mails again.
      7. **Prove a dispatcher cannot override it.** With the customer opted
         out, use **Resend notification** on the dispatcher page. It reports
         the email was queued; the worker then **suppresses** it. "We mailed
         somebody who had unsubscribed because a dispatcher pressed Resend" is
         the exact failure §17's preference rule exists to prevent.
      8. **Check the language.** Set the customer's `preferred_language` to
         `es` or `fr` and trigger another milestone. The email arrives in that
         language, and a **standard phrase** picked by dispatch arrives
         translated. Genuinely free-typed dispatcher text arrives in English
         under the label *"Written by dispatch, in English"* — that label is
         required and must not be removed; §24 forbids silently
         machine-translating operator text.
      9. **Confirm the queue is staff-only.** As the shipper, in a SQL session
         with their JWT: `select count(*) from shipment_notification_queue`
         returns **0**. As a dispatcher it returns the real count — the zero is
         a policy decision, not an empty table.
- [ ] Stripe + Dropbox Sign webhook test deliveries show in
      `webhook_events`.

### Post-cutover verification (the M-62 ⚠️ items)

Everything below is built and tested as far as a secretless environment
allows, but can only be *finished* against live services. Source of truth:
[`docs/UPGRADE-ACCEPTANCE.md`](UPGRADE-ACCEPTANCE.md) — 17 ✅, 8 ⚠️, 0 ❌.

- [ ] **Carrier signup** on staging → `auth.users` + `profiles` + `carriers`
      + `carrier_memberships` rows exist. Exercise all four authority
      branches (active / pending / needs-help / leased-on).
- [ ] **Shipper signup** → role promoted to `shipper`, `shippers` +
      `shipper_memberships` rows exist, and the post-verification
      quote-claiming one-shot links the right historical quotes.
- [ ] **Email verification round trip** — receive the real Supabase
      confirmation mail, click through to `/login?verified=1`, see the
      "✓ Email verified" banner, sign in. *(Needs the customized Confirm
      Signup template and the redirect allow-list from step 1.3.)*
- [ ] **Login + logout on every role** — each lands on its own portal home;
      cross-role URLs bounce; a suspended account gets
      `/login?error=suspended`.
- [ ] **Password recovery** end to end.
- [ ] **Portal responsiveness with a real session** — render every carrier,
      shipper and admin page at 375 px and 1440 px. The automated suite
      cannot reach these (they are session-gated, which the suite proves);
      pay particular attention to the four staff tables that keep horizontal
      scroll instead of the card transform.
- [ ] **Staff MFA round trip** — enroll, verify, obtain AAL2, pass the gate;
      confirm an AAL1 session is redirected. **Two admins enrolled** (R-5).
- [ ] **Staff invite round trip** — invite → email → `/invite/<token>` →
      account created with the right role → invite marked accepted → the
      link is dead on reuse and after 7 days.
- [ ] **`npm run test:integration` on the release commit** — the §27 tier
      restored in M-72. It needs only a local PG16, so unlike the items in
      this section it is *not* blocked on live services; it is listed with the
      gates above and repeated here so a post-cutover re-run is not forgotten.
- [ ] **`npm run test:rls` against the staging database** (closes R-6/R-7);
      add object-level storage assertions for R-8 (carrier A must not fetch a
      signed URL for carrier B's object path).
- [ ] **0013 grant on real Supabase** — with one published post *and one
      draft*, confirm `/blog`, the post page and `sitemap.xml` all serve.
- [ ] **One real email per template family** delivered, with `email_log` rows.
- [ ] **Stripe test invoice** → `invoices` mirror row flips to `paid` on the
      webhook.

---

## One-pager: the day the MC activates

Total time: ~10 minutes, zero deploys. Everything is driven by
`company_settings` (audit F-13) and updates site-wide immediately.

1. Sign in → Admin → **Settings**.
2. `mc_number` → `{"status":"active","value":"MC-XXXXXXX"}`
3. `usdot_number` → `{"status":"active","value":"XXXXXXX"}`
4. `bond_status` → `{"status":"active","value":"BMC-84 $75K"}` (only once
   the bond is actually filed/effective).
5. Result: footer + compliance blocks swap "PENDING" for the real numbers;
   FAQ answers update.
6. **Only when brokerage ops are truly ready** (bond effective, broker
   processes in place): flip `brokerage_active` → `true` — shipper pages
   drop "Launching Soon".
7. Announce: publish the prepared "We're live" blog post; email the carrier
   list (subscribers table) via Resend.
8. Verify `/`, `/faq`, `/shippers` in an incognito window (ISR: pages
   revalidate; force with a redeploy if anything looks cached).
