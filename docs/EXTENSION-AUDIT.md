# EXTENSION DIRECTIVES — Repository Audit (M-70a)

**Date:** 2026-08-05 · **Scope:** audit only, no code changes ·
**Baseline commit:** `341819f` (M-62, final module of the upgrade cycle) ·
**Directives audited:**
[`docs/DIRECTIVE-tracking.md`](DIRECTIVE-tracking.md) (Enterprise Shipment
Tracking, modules M-70…M-84) and
[`docs/DIRECTIVE-business-website.md`](DIRECTIVE-business-website.md)
(Enterprise Business Website, §32 A–V).

Both directives require an audit before code. The tracking directive names
15 mandatory items ("FIRST RESPONSE REQUIRED") — **Part A** answers them in
order. **Part B** walks §32 A–V. **Part C** covers the uploaded
carrier-management skill.

Method: every claim below was read out of the repository at `341819f`
(migrations `0001`–`0013`, `src/app` route tree, `src/lib`, `src/app/actions`,
`src/emails`, `messages/`, `tests/`, `docs/`). Where something does not exist
it is marked ❌, not glossed.

---

# PART A — TRACKING DIRECTIVE AUDIT

## 1. Existing `loads` and shipment-related architecture

### 1.1 The `loads` table (migration `0001`, lines 191–244 — FROZEN)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `carrier_id` | uuid **NOT NULL** → `carriers(id)` | **The pivotal constraint.** Every load must have a carrier at insert time. |
| `dispatcher_id` | uuid → `profiles(id)` | Audit F-09; auto-set to the acting staff user in `createLoad`. |
| `broker_name`, `broker_mc` | text | The **third-party broker PickLoads booked FROM**, not a PickLoads customer. Free text, no FK, no vetting record. |
| `origin_city/state`, `dest_city/state` | text | City + 2-letter state only. **No street addresses, no ZIPs, no lat/lng.** |
| `pickup_date`, `delivery_date` | date | **Dates, not timestamps.** No appointment windows, no times, no timezone. |
| `equipment` | text | Free text (loosely tracks the 8 equipment slugs). |
| `gross_rate` | numeric ≥0 | **The carrier's revenue** from the third-party broker. |
| `miles` | int >0 | Loaded miles. **No deadhead column** (see Part C, finding C-1). |
| `fee_pct_applied` | numeric | Snapshotted per load; `NOT NULL` dropped at 0001:239 so the trigger can fill it, then re-imposed as `check` constraint `loads_fee_pct_applied_present`. |
| `dispatch_fee` | numeric | **Trigger-computed**, never written by the app. |
| `status` | `load_status` enum | 6 values only. |
| `rate_con_path`, `bol_path`, `pod_path` | text | **Three bare text columns** — no documents table, no metadata, no visibility model, no upload UI. Written by nothing today. |
| `created_at`, `updated_at` | timestamptz | `trg_loads_updated_at` BEFORE UPDATE. |

**Indexes:** `(carrier_id, status)`, `(dispatcher_id, created_at desc)`,
`(status, delivery_date)`.

**Trigger behaviour** (`compute_load_fee`, `0001:222–241`,
`BEFORE INSERT OR UPDATE OF gross_rate, fee_pct_applied`):

1. On INSERT with `fee_pct_applied IS NULL` → `select c.dispatch_fee_pct
   from carriers c where c.id = new.carrier_id`.
2. Always → `dispatch_fee := round(coalesce(gross_rate,0) * fee_pct_applied / 100, 2)`.

**This trigger hard-depends on `carrier_id` resolving to a real carrier row.**
A load with a NULL `carrier_id` produces `fee_pct_applied = NULL`, which then
violates `loads_fee_pct_applied_present`. This is load-bearing for item 8.

### 1.2 State machine

`load_status` enum (`0001:24`): `booked · in_transit · delivered · invoiced ·
paid · cancelled`.

Transitions live in **`src/lib/loads.ts`** (`LOAD_TRANSITIONS`), a plain
module shared by server actions, RSC pages and client components:

```
booked     → in_transit | cancelled
in_transit → delivered  | cancelled
delivered  → invoiced   | cancelled
invoiced   → paid
paid       → (terminal)
cancelled  → (terminal)
```

Enforcement is **server-side only**, in `src/app/actions/loads.ts`
`updateLoadStatus()`: Zod-parse → `staffSession()` role check → read current
status → check `LOAD_TRANSITIONS` → UPDATE with `.eq("status", currentStatus)`
as an optimistic-concurrency guard. There is **no DB-level transition
constraint** and **no status-change history table** — a transition leaves no
trace beyond `updated_at`. `src/lib/loads.ts` also exports
`LOAD_STATUS_LABELS`, `LOAD_STATUS_BADGE` (both `Record<LoadStatus, …>` —
exhaustive, so any enum value added breaks the typecheck), `formatMoney`,
`formatRpm`, `formatLane`. `tests/unit/loads.test.ts` pins the transition map.

### 1.3 Who can do what, today

| Actor | On `loads` |
|---|---|
| **admin / dispatcher** | Full CRUD via RLS `"staff manage loads" for all using (is_staff())`. UI: create (`/portal/admin/loads/new`) + list/filter + status buttons + Generate-invoice (`/portal/admin/loads`). Dispatchers are additionally **query-scoped** to their assigned carriers by `src/lib/staff-scope.ts` (app-level, not RLS — documented judgment in M-58). |
| **carrier** | SELECT only, two OR-ed policies: `"carrier own loads"` (legacy `carriers.profile_id`) and `"member read loads"` (`my_carrier_ids()`). UI: `/portal/carrier/loads`, read-only, shows lane/pickup/broker/equipment/gross/RPM/**dispatch fee**/status. **No carrier write path of any kind.** |
| **shipper** | **Nothing.** No policy, no column linking a load to a shipper, no UI. |
| **anon** | Nothing (RLS suite asserts 0 rows). |

### 1.4 What "shipment-adjacent" data actually exists

- `freight_quotes` (0001 + 0008 + 0011) — the closest thing to a shipment
  request: `shipper_id` FK, pickup/delivery **address, city, state, ZIP**,
  `pickup_date`, `delivery_deadline`, commodity, `weight_lbs`, pallets,
  equipment, `hazmat`, `temp_controlled`, `temp_min_f/max_f`, `dims_l/w/h_in`,
  `pickup_company`, `delivery_company`, `special_instructions`,
  `contact_name`, `quoted_rate`, `status` (**reuses `lead_status`**, not a
  quote enum). Status changes auto-journal into `lead_activities`
  (`trg_freight_quotes_journal`, 0003).
- `invoices` (0008) — `load_id` FK, Stripe mirror.
- `carriers`, `trucks`, `drivers` (0001/0006) — fleet exists; **`loads` has
  no `truck_id`/`driver_id`** (0006 explicitly names those as a deliberately
  deferred additive ALTER).

**There is no shipment, tracking number, event, location, ETA, exception,
POD-workflow, broker-partner or public-tracking artefact anywhere in the
repository.**

---

## 2. Existing Shipper Portal functionality (`/portal/shipper`, role `shipper`)

Delivered by M-32 → M-53 → M-56. Gate: `requireShipper(locale)`
(`src/lib/auth.ts`) → suspension check → role check. All pages
`force-dynamic` + `robots: noindex`.

| Route | State |
|---|---|
| `/portal/shipper` | Overview: 4 tiles (quote requests / pending / quoted / booked) computed from `QUOTE_STATUS` stage mapping. **"Shipments & tracking" card is already gated on `company_settings.brokerage_active`** — honest "Launching soon" waitlist text when false. This is the exact hook the tracking directive plugs into. |
| `/portal/shipper/quotes` | Quote list with the shipper-facing 4-stage timeline (Received → In review → Quoted → Booked); internal CRM stages never leaked. |
| `/portal/shipper/quotes/new` | Full professional quote form on the 0008/0011 fields. Insert via server action after membership verification. |
| `/portal/shipper/documents` | **Honest empty state**, gated on `brokerage_active`: "no shipper-facing document flow exists yet". |
| `/portal/shipper/billing` | **Honest placeholder** (decision D6): nothing is invoiced to shippers. |
| `/portal/shipper/support` + `/[id]` | Threaded support on `support_threads`/`support_messages`, staff-answerable from `/portal/admin/support`. |
| `/portal/shipper/company`, `/settings` | Company + account settings, notification preferences. |

Data access: `src/lib/shipper-quotes.ts` — **dual path**. Self-signup
(membership exists) → one-shot claim of unowned quotes matching the
Supabase-**verified** session email, then cookie-bound read under the 0009
`"member read own quotes"` policy. Legacy staff-invited accounts (no
membership) → documented admin-client read `.eq("email", session.email)`.

**Missing vs directive §11:** `/portal/shipper/shipments`,
`/shipments/[shipmentId]`, dashboard shipment metrics (pickups today,
in-transit, delayed, deliveries today), server-side pagination and the 9
filters, timeline, ETA, map, shipment documents, shipment contacts.

---

## 3. Existing Carrier Portal shipment functionality (`/portal/carrier`)

Delivered by M-25 → M-55. Gate `requireCarrier`. 11 routes: overview,
documents, loads, trucks, drivers, agreements, invoices, profile,
notifications, support(+`/[id]`), settings.

Relevant to tracking:

- **`/portal/carrier/loads`** — read-only table (`.ptable--cards` +
  `data-th` responsive transform from M-59), membership-resolved carrier id
  (`getMyCarrierId`), RLS-scoped read, dispatch-fee transparency.
  **Zero write actions.**
- **`/portal/carrier/documents`** — the only real document surface in the
  product: doc-type select + `DocUpload` dropzone → `documents` row
  (`status='pending'`) → staff review queue → approve/reject with note →
  `notifyCustomer` fan-out. Downloads via ≤300 s signed URL
  (`SIGNED_URL_TTL_SECONDS`), `document.download` audited.
- **`/portal/carrier/notifications`** — `notifications` feed.

**Missing vs directive §13:** every carrier status action (confirm dispatch,
en-route, arrived, loaded, in transit, delayed, arrived at delivery,
delivered), BOL/POD upload against a shipment, ETA update, exception
submission — and the entire `/driver/update/[secureToken]` surface.

---

## 4. Existing Dispatcher / Admin functionality (`/portal/admin`)

14 routes. Gate `requireStaff` (admin+dispatcher) or `requireAdmin`; both
funnel through `enforceStaffMfa` (M-61: admin hard, dispatcher 14-day grace).

| Area | State |
|---|---|
| Dashboard (`/portal/admin`) | Sales tiles, 9-status funnel, first-contact-vs-15-min KPI; **Dispatch**: active carriers, loads today/7d, fees invoiced vs collected, weighted avg RPM, per-dispatcher performance, state/equipment badge clouds; **Operations**: document review queue, insurance ≤30 d, unsigned agreements; Marketing; notifications timeline (`email_log` + failed `webhook_events`). |
| Loads (`/portal/admin/loads`) | Filter by status/carrier/dispatcher, totals, status buttons, Generate-invoice on `delivered`, Stripe event ledger. `limit(200)`, **no pagination**. |
| Loads/new | Create-load form (12 fields). |
| Leads CRM | Kanban pipeline + lead detail + activities journal. |
| Quotes (`/portal/admin/quotes`) | M-60 freight-quote desk: status + rate editor, stage-change-only customer notifications, `quote.status_change` audit. `limit(100)`, no pagination. |
| Users (`/portal/admin/users`) | Role/status filters, exact-count pagination, approve/suspend/reactivate, onboarding progress x/5, **dispatcher↔carrier assignment**, staff invites (0012), carrier activate toggle. |
| Security (`/portal/admin/security`) | Paginated `audit_events` viewer with action filter + actor resolution. |
| Settings (`/portal/admin/settings`) | All 9 `company_settings` keys, admin-only, audited. |
| Support, Posts, MFA | Staff support inbox; blog CMS; TOTP enrollment/step-up. |

**Missing vs directive §14/§15:** the operational board (Needs Carrier /
Carrier Assigned / Pickup Today / In Transit / Delivery Today / Delayed /
POD Pending / Completed), convert-quote-to-shipment, assign carrier /
driver / truck, appointments, ETA edits, public/internal updates, exception
log+resolve, POD request, resend-notification, per-shipment update history,
tracking-visibility controls, tracking-code revocation, document-access
history, retention settings.

---

## 5. Existing DB tables + RLS relevant to tracking

**Migrations:** `0001`–`0004` **frozen**; `0005`–`0013` shipped (accounts /
memberships / audit → fleet → support+notifications → billing+quote fields →
RLS for all new tables → carrier-portal columns → quote fields → staff
invites → anon `is_staff()` EXECUTE grant). New work starts at **`0014`**.

**Tables that tracking will reuse rather than recreate:**

| Table | Tracking relevance |
|---|---|
| `profiles` (+`status`, `role`) | Actors. `user_role` enum = admin/dispatcher/carrier/shipper — **no broker role**. |
| `carriers` (+`assigned_dispatcher_id`, 0010) | Carrier org; dispatcher assignment already exists. |
| `shippers` (0005) | Shipper org — the shipment's customer. |
| `carrier_memberships` / `shipper_memberships` (0005) | The authoritative person↔company join. RLS helpers `my_carrier_ids()` / `my_shipper_ids()` (0009, SECURITY DEFINER, `authenticated` only). |
| `freight_quotes` (0008/0011) | The quote a shipment converts from. |
| `documents` (0001) | Carrier-compliance docs. **`carrier_id NOT NULL`** — cannot host shipment documents. |
| `notifications` (0007) | In-app feed; `kind` is free text, so shipment kinds need no schema change. |
| `email_log` (0001) | Email journal (`lead_id`/`quote_id` FKs only). |
| `audit_events` (0005) | Generic ledger; single writer `src/lib/audit.ts` (service-role, best-effort, never secrets). |
| `webhook_events` (0001) | Provider-dedup ledger (`unique(provider, event_id)`) — the pattern a telematics adapter should copy. |
| `support_threads/_messages` (0007) | Threads carry `carrier_id`/`shipper_id`, **no shipment link**. |
| `user_preferences` (0005) | 3 boolean toggles only — no per-event shipment preferences. |
| `company_settings` (0001) | 9 keys incl. `brokerage_active`. **Publicly readable by design** — never put tracking secrets here. |

**RLS doctrine in force** (0002 + 0009, proved by 165 assertions in
`supabase/tests/20_rls_isolation.sql`, `npm run test:rls`):

- **No anon policies anywhere.** The anon key's entire read surface is
  `company_settings` + published `posts`; every public write goes through a
  server action with the service-role key after rate-limit → Turnstile →
  Zod (decision Q3).
- Role predicate `is_staff()` (SECURITY DEFINER, STABLE); EXECUTE granted to
  `authenticated` **and** `anon` (0013 — see §10.5, this is directly relevant
  to any new anon-reachable policy).
- Own-data via membership helpers; `guard_role_change` blocks self-promotion.
- Writes to `audit_events`, `notifications`, `staff_invites`,
  `account_status_history` have **no INSERT policy for anyone** — service
  role only.
- Storage: one private bucket `carrier-docs` (10 MB, pdf/jpeg/png/heic),
  prefix-scoped to `{carrier_id}/…`, signed URLs ≤300 s.

---

## 6. Existing document + notification infrastructure

### Documents

- Bucket `carrier-docs` (0004) — **private**, MIME allow-list at bucket
  level, magic-byte sniffing server-side (`src/lib/uploads.ts` `sniffMime`),
  `sanitizeFileName`, 10 MB cap, path `{carrier_id}/{uuid}-{name}`.
- Table `documents`: `carrier_id NOT NULL`, `doc_type` enum (7 values:
  mc_authority, coi, w9, voided_check, noa, dispatch_agreement, other),
  `doc_status` enum (pending/approved/rejected/expired), reviewer + note,
  `expires_at`, file metadata.
- Access: RLS (staff all; carrier own via legacy + membership policies) +
  storage policies. Downloads mint a ≤300 s signed URL and write a
  `document.download` audit event.
- **Gaps for §16:** no shipment linkage; no visibility model
  (shipper-visible / carrier-visible / staff-only); doc types don't cover
  BOL, POD, rate confirmation, lumper receipt, detention docs, delivery
  receipt, claims; `loads.bol_path/pod_path/rate_con_path` are dead text
  columns with no writer; no shipper-side upload path at all.

### Notifications

- `src/lib/notify.ts` — one call = `notifications` row + localized email +
  `email_log` journal; best-effort (never fails the business write);
  owner-recipient resolvers per the M-57 membership doctrine
  (`getCarrierOwnerRecipient` / `getShipperOwnerRecipient` /
  `getRecipientByProfile`).
- `src/emails/` — 15 localized customer builders in
  `customer-templates.tsx` on the shared `CustomerEmail` V4 layout, plus 11
  standalone internal/ops templates (lead, quote, contact, onboarding,
  insurance-expiry, webhook-failure, staff-invite, account-signup,
  account-status, newsletter-confirm, internal-notification);
  `src/emails/i18n.ts` resolves locale from `profiles.preferred_language`,
  else form locale, else `en` (ru/ht currently mirror en, flagged for native
  review). `tests/unit/emails.test.ts` pins subject/locale/parity.
- **Gaps for §17:** no `notification_deliveries` table (no per-attempt
  provider response, no retry state, no **idempotency key** — dedup today is
  ad-hoc, e.g. the `signed_at` guard on the e-sign webhook); no per-event
  preference model (`user_preferences` has 3 booleans); no background/queued
  processing (every send is inline in the request); no SMS (correctly — the
  directive requires explicit opt-in + provider).

---

## 7. Gaps vs the tracking directive, per directive section

| § | Requirement | Status | Gap |
|---|---|---|---|
| 2 | Brokerage gating | ◐ | `brokerage_active` exists and already gates the shipper overview/documents copy. **No server-side gate** on any write path — gating is presentational today. |
| 3 | 5 roles incl. Broker Partner | ◐ | 4 roles exist. Broker partner absent (see §10.4 for why *not* to add an enum value). |
| 4 | `/portal/shipper/shipments` + public `/track` | ❌ | Neither route exists. |
| 5 | `PL-YYYY-######` tracking numbers | ❌ | No number, no sequence, no uniqueness constraint. |
| 6 | 18-status shipment enum | ❌ | `load_status` has 6, semantically different (billing-oriented tail: invoiced/paid). |
| 7 | `shipment_events` timeline + 4 visibility levels | ❌ | No event table anywhere. Nearest precedent: `lead_activities` (CRM) and the `journal_*_status_change` triggers. |
| 8 | Customer tracking page | ❌ | — |
| 9 | Map + 3 tracking modes + provider adapter | ❌ | No lat/lng column, no provider table, no adapter interface. Only Maps usage is the keyless contact-page iframe. |
| 10 | ETA architecture + history | ❌ | No ETA field anywhere; `loads` has dates only. |
| 11 | Shipper portal expansion | ◐ | 8 of 8 routes named by the directive exist **except** `/shipments` and `/shipments/[id]`; dashboard shows quote metrics only. |
| 12 | Broker-partner access | ❌ | — |
| 13 | Carrier updates + driver token link | ❌ | Carrier portal is read-only on loads. No token infrastructure except the 0012 staff-invite hash pattern (good precedent). |
| 14 | Dispatcher board + operations | ◐ | Loads board exists (filters, no pagination); none of the shipment operations. |
| 15 | Admin management | ◐ | Users/security/settings exist; every shipment-specific admin control missing. |
| 16 | Shipment documents + permissions | ❌ | See §6. |
| 17 | Event-driven notifications | ◐ | Fan-out + templates + journal exist; per-event prefs, delivery ledger, idempotency, retry missing. |
| 18 | DB architecture | ❌ | 0 of the ~14 named tables exist in shipment form. |
| 19 | RLS + public-tracking route | ◐ | Doctrine, helpers and a 165-assertion suite exist and are directly reusable; no shipment policies. |
| 20 | Status-transition validation | ◐ | Pattern exists (`LOAD_TRANSITIONS` + server enforcement + optimistic guard). Needs an 18-state version with **preconditions** (POD required, cancellation reason). |
| 21 | Exceptions/delays | ❌ | — |
| 22 | Responsive | ◐ | M-59/M-62 delivered the framework (`.ptable--cards`, off-canvas drawer, 108-test responsive suite over 21 routes). New surfaces are the hardest yet — see item 12. |
| 23 | WCAG 2.2 AA | ◐ | Framework in place (skip links, axe scan over 16 pages, contrast tokens). Timeline/map text-equivalents are new work. |
| 24 | i18n, **5 locales incl. Russian** | ◐ | 683×5 strings, `useV4()`/`getV4()` + SUPPLEMENTAL pipeline. Note this directive says 5 locales; the website directive §32 O says 4 — see Part B. |
| 25 | Performance/scale | ◐ | No pagination on the loads or quotes boards today; every shipment list must ship with server-side pagination from day one. |
| 26 | Observability | ◐ | Sentry DSN declared in `.env.example`; console-based logging in practice. |
| 27 | Testing | ◐ | 168 unit + 145 e2e + 165 RLS assertions + axe + responsive suites — all directly extensible. No integration lane against a live DB other than the RLS suite. |

---

## 8. RECOMMENDED APPROACH — extend `loads` vs introduce `shipments`

### Recommendation: **introduce a new `shipments` table. Do not extend `loads`.**

This is the pivotal call and the directive explicitly asks for honesty about
it ("Do not duplicate the existing `loads` table **if it already represents
operational shipments**"). The honest finding is that **it does not.**

### 8.1 Why `loads` is not a shipment

`loads` models **dispatch-side work**: *a load PickLoads found for its carrier
client, booked from a third-party broker, on which PickLoads earns a
percentage of the carrier's gross.* The directive's shipment models
**brokerage-side work**: *freight a shipper gave PickLoads, which PickLoads
tenders to a carrier, on which PickLoads earns the spread.* Five concrete
consequences:

1. **Counterparty inversion.** `loads.broker_name/broker_mc` is the entity
   PickLoads buys from. In a shipment, PickLoads *is* the broker. Reusing the
   row means the same table has two opposite meanings depending on a flag —
   the exact ambiguity that produces mis-scoped RLS.
2. **`carrier_id NOT NULL` vs `carrier_search`.** Statuses 1–4
   (`quote_requested`, `quote_sent`, `quote_accepted`, `carrier_search`) all
   describe a shipment **with no carrier**. Dropping the NOT NULL requires
   also rewriting `compute_load_fee()` (which selects
   `carriers.dispatch_fee_pct` by `new.carrier_id`) and relaxing
   `loads_fee_pct_applied_present` — i.e. touching the trigger and constraint
   that every existing invoice's correctness depends on (finding F-03).
3. **Economics mismatch.** `gross_rate` + `fee_pct_applied` + trigger-computed
   `dispatch_fee` is a *dispatch* fee model. A shipment needs
   `gross_shipper_amount`, `carrier_pay` and a derived margin — three
   staff-only fields the existing trigger would silently mangle
   (`dispatch_fee` would be computed off the shipper amount).
4. **Enum blast radius.** Postgres enums are append-only in practice. Adding
   12 values to `load_status` makes every exhaustive `Record<LoadStatus, …>`
   (`LOAD_TRANSITIONS`, `LOAD_STATUS_LABELS`, `LOAD_STATUS_BADGE`) a
   typecheck error, breaks `tests/unit/loads.test.ts`, and puts
   `quote_requested`/`carrier_search` values in the carrier portal's status
   filter — for rows carriers must never see.
5. **Legal separation.** Dispatch is legal today; brokerage is gated on
   `brokerage_active` (§2, and the carrier-management skill is emphatic about
   it). With two tables, the legal boundary is **structural** — a shipments
   row cannot exist without the brokerage gate being satisfied, and the
   distinction survives every future refactor. With one table it is a column
   value, one bad WHERE clause away from a compliance incident.

### 8.2 What the new table looks like

`shipments` gets its own enum `shipment_status` (18 values), its own
`tracking_number` with a UNIQUE constraint, `shipper_id NOT NULL`,
`carrier_id NULLABLE`, `dispatcher_id`, `quote_id → freight_quotes(id)`,
`broker_partner_id`, full origin/destination address+ZIP, timestamptz
appointment windows, equipment/commodity/weight/pallets/distance, staff-only
`gross_shipper_amount` / `carrier_pay` / `margin_amount`, tracking-visibility
controls, current location snapshot, current ETA, and the lifecycle
timestamps. Full sketch in item 9.

### 8.3 Migration strategy

**Purely additive. No rename, no data movement, no destructive DDL.**

1. `0014` creates `shipment_status` + `shipments` + the tracking-number
   sequence. Nothing existing is altered.
2. `0015`–`0019` add the satellite tables and RLS (item 9).
3. **One optional bridge column**, `shipments.load_id uuid null references
   loads(id)`, for the future case where PickLoads brokers a shipment *and*
   dispatches it to one of its own carrier clients. Nullable, no backfill, no
   behaviour attached at launch. (Deliberately on `shipments`, not `loads`, so
   migration 0001's table is never touched.)
4. **No existing `loads` row is migrated, converted or read by the shipment
   code.** Zero rows change. `/portal/admin/loads`, `/portal/carrier/loads`,
   `src/lib/loads.ts`, the Stripe invoice flow and `invoices.load_id` all
   continue byte-identically.

### 8.4 Rollback

Because nothing existing is modified, rollback is `drop table shipments…
cascade; drop type shipment_status;` in reverse migration order, plus
removing the new route directories. The `0014`+ migrations must be written so
each has a documented inverse (the M-62 runbook already requires
per-migration rollback notes). **Rollback risk to the shipped product: none.**
This is the single strongest argument for the new-table approach — extending
`loads` would make rollback require reversing an enum extension and a trigger
rewrite on a table that holds real invoices.

### 8.5 What happens to existing `loads` rows and UI

| Surface | After M-70…M-84 |
|---|---|
| `loads` table + trigger + constraints | Untouched. Still the dispatch system of record. |
| `/portal/admin/loads`, `/loads/new` | Unchanged. Gains a sibling `/portal/admin/shipments`. |
| `/portal/carrier/loads` | Unchanged. Gains a sibling `/portal/carrier/shipments` (the surface where carriers *write*). |
| `src/lib/loads.ts`, `tests/unit/loads.test.ts` | Unchanged. New `src/lib/shipments.ts` + `shipments.test.ts` alongside. |
| Stripe / `invoices.load_id` | Unchanged. Shipper-side invoicing (if ever enabled) is a separate decision (D-W/D-T). |
| Nav/IA | Two clearly-labelled desks: **Loads (dispatch)** and **Shipments (brokerage)**. The brokerage desk is hidden entirely while `brokerage_active = false`. |

**Honest trade-off:** two tables means two lists a dispatcher can look at, and
a small amount of duplicated presentational code (lane formatting, money
formatting — both already extracted as pure helpers in `src/lib/loads.ts` and
reusable as-is). That cost is real and it is far smaller than the cost of
making one table mean two things.

---

## 9. Proposed migrations (0014+)

`0001`–`0004` are frozen and **not touched**. `0005`–`0013` exist; new work
starts at `0014`. Sketches (illustrative, not final DDL):

### `0014_shipments_core.sql`

```sql
create type shipment_status as enum (
  'quote_requested','quote_sent','quote_accepted','carrier_search',
  'carrier_assigned','dispatched','en_route_to_pickup','arrived_at_pickup',
  'loading','picked_up','in_transit','delayed','arrived_at_delivery',
  'unloading','delivered','pod_uploaded','completed','cancelled');
create type tracking_mode      as enum ('milestone','city_state','exact','hidden');
create type eta_source         as enum ('manual','calculated','provider','dispatcher_adjusted');

-- Per-year counter; SECURITY DEFINER so only the server path can advance it.
create table tracking_number_counters (year int primary key, last_value bigint not null default 0);
create function next_tracking_number() returns text ... ;   -- 'PL-'||year||'-'||lpad(n,6,'0')

create table shipments (
  id uuid primary key default gen_random_uuid(),
  tracking_number text not null unique,           -- immutable; NOT the PK (§5)
  shipper_id  uuid not null references shippers(id),
  carrier_id  uuid references carriers(id),       -- NULL until carrier_assigned
  dispatcher_id uuid references profiles(id),
  quote_id    uuid references freight_quotes(id),
  broker_partner_id uuid,                          -- FK added in 0017
  load_id     uuid references loads(id),           -- optional bridge (§8.3)
  status      shipment_status not null default 'quote_requested',
  -- origin/destination: company, address, city, state, zip, lat, lng
  -- appointments: pickup_appt_start/end, delivery_appt_start/end (timestamptz)
  equipment text, commodity_category text, weight_lbs int, pallets int, distance_miles int,
  reference_number text, customer_po text,
  -- STAFF-ONLY financials (never in a public/shipper projection):
  gross_shipper_amount numeric, carrier_pay numeric, margin_amount numeric,
  -- tracking controls
  public_tracking_enabled boolean not null default false,
  tracking_mode tracking_mode not null default 'milestone',
  public_access_hash text,                         -- sha256 of the access code
  tracking_revoked_at timestamptz, is_sensitive boolean not null default false,
  -- location snapshot + ETA
  current_city text, current_state text, current_lat numeric, current_lng numeric,
  last_location_at timestamptz,
  estimated_pickup_at timestamptz, estimated_delivery_at timestamptz,
  eta_source eta_source, eta_confidence text, eta_updated_at timestamptz,
  delay_minutes int, delay_reason_public text, delay_reason_internal text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  completed_at timestamptz, cancelled_at timestamptz, cancellation_reason text
);
create index idx_shipments_shipper  on shipments (shipper_id, created_at desc);
create index idx_shipments_carrier  on shipments (carrier_id, status);
create index idx_shipments_board    on shipments (status, estimated_delivery_at);
create index idx_shipments_tracking on shipments (tracking_number);
create trigger trg_shipments_updated_at before update on shipments
  for each row execute function set_updated_at();     -- reuse 0001's helper
```

*No `dispatch_fee`-style trigger.* Margin is computed in the application and
stored explicitly, so nothing implicitly recalculates money.

### `0015_shipment_events.sql`

`event_visibility` enum (`public|shipper|carrier|staff_only`),
`event_source` enum (`dispatcher|carrier|driver|eld|gps_provider|system|admin|shipper`),
then `shipment_events` (id, shipment_id, event_type, status, event_time,
recorded_at, source, created_by, city, state, latitude, longitude,
public_message, internal_message, visibility, metadata jsonb,
external_event_id, **`idempotency_key` with `unique(shipment_id,
idempotency_key)`**), plus `shipment_eta_history` and `shipment_locations`
(append-only, retention-configurable).
Index: `(shipment_id, event_time desc)` + partial index on `visibility`.

### `0016_shipment_documents.sql`

`shipment_doc_type` enum (quote, shipper_confirmation, rate_confirmation,
bol, lumper_receipt, detention, delivery_receipt, pod, invoice, claim, other),
`doc_visibility` enum (public, shipper, carrier, staff_only),
`shipment_documents` table (mirrors `documents`' metadata + review model),
and a **new private bucket `shipment-docs`** with its own storage policies
(reusing `carrier-docs`' prefix model would leak carrier folder structure to
shippers). Same 10 MB cap, same MIME allow-list, same ≤300 s signed URLs.

### `0017_shipment_access.sql`

`shipment_parties` (contacts per shipment, role-typed),
`shipment_assignments` (carrier/driver/truck/dispatcher history — **who
changed what, when**),
`broker_partners` + `broker_partner_memberships` + `shipment_broker_access`
(per-shipment grants, admin-issued),
`driver_update_tokens` (**sha256 hash only**, shipment-scoped, `expires_at`,
`revoked_at`, `used_count`, `last_used_at` — the 0012 `staff_invites`
pattern),
`shipment_tracking_access` (public-lookup log: tracking number attempted,
outcome, ip, ua — feeds enumeration alerting).

### `0018_shipment_exceptions_notifications.sql`

`exception_type` + `exception_severity` enums, `shipment_exceptions`
(severity, public/internal description, opened/resolved timestamps,
opened_by/assigned_to, customer_notified, resolution);
`notification_preferences` (per-profile, per-event-kind booleans — supersedes
nothing, sits alongside `user_preferences`);
`notification_deliveries` (channel, event kind, shipment_id, recipient,
provider_message_id, status, attempts, last_error, **`idempotency_key`
unique**).

### `0019_shipment_rls.sql`

Every table above gets `enable row level security` and:

- **No anon policy on any of them** (item 10.5).
- staff: `for all using (is_staff())`.
- shipper: `select using (shipper_id in (select my_shipper_ids()))`.
- carrier: `select using (carrier_id in (select my_carrier_ids()))` — **SELECT
  only.** No UPDATE policy; carrier writes go through server actions after
  transition validation (the same reasoning documented in `0010` for the
  carrier preference columns).
- broker partner: grant-based only —
  `select using (id in (select shipment_id from shipment_broker_access
  where broker_partner_id in (select my_broker_partner_ids())))`.
- events: visibility-aware
  (`visibility = 'public'` OR `'shipper'`+shipper match OR `'carrier'`+carrier
  match OR `is_staff()`), so **`staff_only` notes can never reach a customer
  session even if a page forgets to filter**.
- `shipment_tracking_access`, `driver_update_tokens`,
  `notification_deliveries`: staff SELECT; **no INSERT policy for anyone**
  (service role only), matching `audit_events`.

### `0020_provider_adapters.sql` (optional, can fold into 0017)

`tracking_provider_connections` (provider enum, carrier_id, external ids,
consent status, expiry, **credentials by env-var name only — never plaintext
in the DB**, per §15).

**Env vars introduced:** none required for launch (Mode A is manual). Future:
`NEXT_PUBLIC_MAPS_*`, `MOTIVE_*`, `SAMSARA_*`, `GEOTAB_*`,
`TRACKING_ACCESS_CODE_PEPPER`.

---

## 10. Security risks

### 10.1 Public enumeration of `/track`

`PL-YYYY-######` is **sequential and trivially enumerable** — `PL-2026-000459`
follows `PL-2026-000458`. The directive accepts this *only* because secondary
verification is mandatory. Required controls, all of which have an existing
precedent in the repo:

- **Mandatory second factor** on every lookup (delivery ZIP or emailed access
  code). Never resolve by tracking number alone.
- **Uniform failure.** One error string for "no such number", "wrong code" and
  "tracking revoked" — otherwise the endpoint is an existence oracle.
  Compare access codes with a constant-time comparison of hashes.
- **Rate limiting**, tighter than the 5/10 min default in
  `src/lib/rate-limit.ts`: bucket per IP *and* per tracking number.
  Note the limiter **fails open** when Upstash env is unset (documented
  degradation) — for `/track` that is unacceptable in production, so the
  runbook must list `UPSTASH_*` as **required**, not optional.
- **Turnstile** on the form (`src/lib/turnstile.ts` fails closed — correct).
- **Log every attempt** to `shipment_tracking_access` + an `audit_events` row
  on bursts (`tracking.enumeration_suspected`), and alert.
- **Never** expose the shipment UUID in any URL or DTO.
- `public_tracking_enabled` defaults to **false**; an admin (or the
  quote-accepted transition) turns it on per shipment. `tracking_revoked_at`
  kills it instantly.

### 10.2 DTO leakage of financial fields

`shipments` will carry `gross_shipper_amount`, `carrier_pay`,
`margin_amount`. The current codebase's habit of `select("a, b, c")` column
lists is good but not enforced. Required:

- A single `src/lib/tracking/dto.ts` exporting `toPublicTrackingDTO()` and
  `toShipperShipmentDTO()`, with **explicit allow-lists**, plus a unit test
  that asserts the exact key set of each DTO (the `tests/unit/emails.test.ts`
  parity-pin pattern). A field added to `shipments` must not silently appear
  in a customer response.
- **Defense in depth:** a Postgres view `shipments_public_v` exposing only
  safe columns, used by the public route, so a coding mistake still cannot
  select margin.
- **Never `select("*")`** on `shipments` outside staff surfaces — worth an
  eslint rule or a grep-based unit test.
- Note the asymmetry with the existing product: `/portal/carrier/loads`
  deliberately shows `dispatch_fee` to the carrier (fee transparency is a
  brand promise). The shipment analogue — margin — is the **opposite**: never
  shipper-visible, never carrier-visible.

### 10.3 Driver update tokens (`/driver/update/[secureToken]`)

- Store **sha256 hash only** (`0012` precedent), raw token exists once in the
  message that delivers it.
- Shipment-scoped, expiring (recommend delivery+24 h or 72 h, whichever is
  sooner), revocable, single-purpose: a whitelist of ~6 transitions, no
  financial fields, no other shipments.
- Rate limited per token and per IP; every use → `audit_events`
  (`driver_token.use`), every failure too.
- **Token-in-URL hygiene:** set `Referrer-Policy: no-referrer` on the route,
  ensure the token never reaches Sentry breadcrumbs or access logs, and
  prefer delivering the link by email/copy-link rather than SMS at launch
  (SMS needs Twilio + compliant opt-in, §17).
- The route must live **outside** `/portal` so the middleware's auth
  redirect does not fire, and must be `noindex`.

### 10.4 Broker-partner scoping

**Do not add a fifth value to the `user_role` enum.** `user_role` is
referenced by `current_user_role()`, `is_staff()`, `guard_role_change`,
`portalHomeFor()`, `staff_invites.role`'s CHECK, and several exhaustive
`Record<UserRole, …>` maps. A new value ripples into all of them and into the
165-assertion RLS suite.

Recommended model: broker partners are an **organization type**
(`broker_partners` + memberships), their users keep an existing role, and
access is **per-shipment grant** (`shipment_broker_access`), admin-issued,
never self-registered (§12). Their RLS must never be company-wide, and their
DTO must exclude carrier packet/insurance, shipper billing, commission and
margin.

### 10.5 RLS vs server-route for `/track` — the decision

**Decision: server route + service-role client, with NO anon policy on any
shipment table.**

Reasons:

1. §19 mandates it ("Do not use direct anonymous table SELECT access").
2. It matches the house doctrine (Q3): public traffic never holds a DB
   policy; the anon key's read surface stays exactly `company_settings` +
   published `posts`, a property the RLS suite already asserts — so **the
   existing suite will catch any regression for free**.
3. Migration `0013` is the cautionary tale: adding a permissive anon-reachable
   policy to `posts` silently broke the public blog because PostgreSQL ORs
   permissive policies and evaluates every referenced function, and `anon`
   lacked EXECUTE on `is_staff()`. Any anon policy on `shipments` would
   re-open that class of bug on a table carrying margin data.

Concretely: `/track` is a server action / route handler that does
rate-limit → Turnstile → Zod → service-role lookup → verify second factor →
`toPublicTrackingDTO()` → log access. Authorization lives in application code
**and** the DTO **and** the view — three layers, none of them a DB policy for
anon.

### 10.6 Other risks

- **Storage:** shipment docs in a **new** bucket. Reusing `carrier-docs`
  would require a shipper to read under a `{carrier_id}/` prefix, which the
  0004 policies deliberately forbid.
- **Carrier write surface:** `0009`'s `"member manage trucks" for all` is the
  wrong template to copy. Carriers get SELECT + server-mediated status
  updates only.
- **Realtime:** leave Supabase Realtime **off** for `shipments`/
  `shipment_events`. §14 says so explicitly, and a subscription broadcasts
  row payloads (RLS-filtered, but still the full row shape) to browser
  sessions — including `margin_amount` for staff sessions.
- **Observability (§26):** never log access codes, driver tokens, exact
  coordinates beyond operational need, or document contents. The existing
  `src/lib/audit.ts` contract already says "never carries secrets" — extend
  the same rule to Sentry scrubbing for `/track` and `/driver/*` paths.
- **`company_settings` is publicly readable** (0002 `using (true)`). Tracking
  feature flags are fine there; the access-code pepper is **not** — that is
  an env var.

---

## 11. Legal / authority gating requirements

The tracking directive §2 and the carrier-management skill (Part C) agree:
**dispatching and brokering are legally different activities, and brokering
without an active FMCSA broker MC + BMC-84 bond is illegal.** FMCSA has
pursued dispatch services operating as unlicensed brokers. This is the single
hardest constraint on this work and it is a *product* constraint, not a copy
constraint.

Current state: `company_settings.brokerage_active = 'false'`;
`mc_number` and `usdot_number` are `{"status":"pending"}`;
`bond_status` = `BMC-84 $75K, in_process`.

### What tracking MAY do before `brokerage_active = true`

- **Exist as code, schema and migrations.** Nothing about creating tables is
  a representation to a customer.
- Ship the `/track` route **dark**: reachable, `noindex`, and returning the
  honest "no shipment matches / tracking activates with your first booked
  shipment" state. No nav entry, no sitemap entry, no marketing copy.
- Keep the existing honest shipper-portal waitlist state
  (`/portal/shipper` already does this correctly today).
- Track **dispatch-side loads on behalf of a carrier client**, *if and only
  if* counsel confirms the framing — i.e. PickLoads is reporting status to
  its carrier client (and, through the carrier, to the carrier's own
  customer), and is not taking control of a shipper's freight, re-posting a
  load, or sitting in the payment chain. **Recommended default: OFF** at
  launch; treat this as decision D-T5.

### What tracking MUST NOT do before `brokerage_active = true`

- Create a `shipments` row with `shipper_id` + `gross_shipper_amount` +
  `carrier_pay` (that combination *is* brokerage economics on its face).
- Present any public-facing claim that PickLoads is moving a shipper's
  freight, tender freight to a carrier, or display "your PickLoads shipment"
  to a shipper.
- Show any fabricated, sample or demo shipment (§30 and the house
  honest-states rule).
- Expose a "Shipment Tracking" nav item, sitemap URL or marketing section.

### How the gate must be implemented (this is the specific ask)

The current gate is **presentational** — pages read `brokerage_active` and
change copy. That is not enough for tracking. Required:

1. **Server-side gate on the write path.** `createShipment` (M-75) reads
   `company_settings.brokerage_active` server-side and refuses with an honest
   error when false. Not a UI conditional.
2. **A second key**, `tracking_public_enabled`, so `/track` can be turned on
   independently of brokerage go-live (e.g. for dispatch-side tracking under
   D-T5, or for a staged rollout after MC activation).
3. **Nav/SEO gating** in one place: the tracking nav entry, the sitemap entry
   and the marketing section all read the same flag.
4. **A unit test** pinning "shipment creation is refused when
   `brokerage_active` is false" — the same discipline as the
   `tests/unit/staff.test.ts` guard tests.
5. Runbook entry: flipping `brokerage_active` is a **legal** action requiring
   the real MC number + active bond in `company_settings`, taken by an admin,
   audited (`settings.update` already writes to `audit_events`).

---

## 12. Responsive risks

The M-59/M-62 framework is strong (off-canvas portal drawer ≤860 px,
`.ptable--cards` + `data-th` transform on 6 customer tables, ≥44 px coarse
targets, `tests/e2e/responsive.spec.ts` = 108 tests over 21 routes ×
375/390/768/1024/1440 plus a 320/1920 sweep, `tests/e2e/axe.spec.ts` over 16
pages). The tracking surfaces are nonetheless the hardest yet:

1. **⚠️ Repo-specific footgun — CSS ordering.** M-59's root-cause fix was
   moving V4's two responsive media blocks to the **end** of
   `src/app/v4.css`. Equal-specificity rules appended *after* those blocks
   are dead on mobile. Any tracking styles must go in `portal.css`, or in
   `v4.css` **before** the media blocks. This has already broken every page
   once; it will break again if not stated in the module docs.
2. **Timeline (§7/§8).** A horizontal stepper clips at 320 px ("no clipped
   timeline"). Build vertical-first with an `<ol>` and switch to horizontal
   only ≥768 px. Needs a text equivalent for AT (§23) regardless.
3. **Dispatcher board (§14), 8 columns.** The CRM kanban is the only
   precedent and it is already the widest surface. An 8-column board must
   become stacked, filterable accordions ≤860 px — not a horizontally
   scrolling board.
4. **Map (§9).** New failure mode for this codebase (`.ptable-wrap` doesn't
   apply). Needs an `aspect-ratio` container, lazy-loaded script (§25), a
   `prefers-reduced-motion` path, and an accessible list-of-locations
   alternative.
5. **Shipment list** is the widest table in the product (tracking #, lane,
   status, ETA, carrier, docs, actions). Must adopt `.ptable--cards` from the
   first commit, and must paginate server-side — the existing loads/quotes
   boards use bare `limit(200)`/`limit(100)`, which is not a pattern to copy.
6. **Appointment windows** need date **and** time. M-59 explicitly flags iOS
   date-input overflow; `datetime-local` at 320 px is a specific, testable
   risk. Prefer split date + time-select controls.
7. **Public `/track` is a `(site)` page**, so it uses the V4 vocabulary
   (`.page-hero`, `.wrap`), not `portal.css` — a mixed-vocabulary page is a
   new situation and needs its own 320 px pass.
8. Add all new routes to `tests/e2e/responsive.spec.ts` and
   `tests/e2e/axe.spec.ts` in the same module that creates them, not in a
   later QA module.

---

## 13. Implementation module plan M-70 … M-84

Sizing is honest: **S** ≈ ½ day, **M** ≈ 1–2 days, **L** ≈ 3–4 days, **XL** ≈ a
week+, at the density of the existing M-50…M-62 modules.

| Module | Scope | Size | What shrinks because it already exists |
|---|---|---|---|
| **M-70** | *This audit.* Architecture decision (item 8), gating decisions, doc commit. | S | — |
| **M-71** — Shipment schema & migrations | `0014`–`0019` (+`0020`), tracking-number generator, regenerated `database.types.ts`, seed keys, per-migration rollback notes, RLS suite fixtures for two shippers/carriers/a broker partner. | L | Migration discipline, `set_updated_at()`, membership helpers, `is_staff()`, RLS test harness (`rls_test.*`), `scripts/run-rls-tests.sh` — **all reusable verbatim**. |
| **M-72** — Status transition + event engine | `src/lib/shipments.ts` (18-state map + preconditions), `recordShipmentEvent()` with idempotency, visibility helper, admin-correction path with mandatory reason + audit. | M | `LOAD_TRANSITIONS` + `updateLoadStatus` are the exact pattern (read-then-write + `.eq(status)` optimistic guard); `src/lib/audit.ts` is the ledger writer. |
| **M-73** — Public secure `/track` | Route + form + verification + rate limit + Turnstile + DTO + view + access logging + enumeration alerting + honest states. | L | `rate-limit.ts`, `turnstile.ts`, the Zod/`FormState` form pattern, V4 page vocabulary, honest-state copy patterns. |
| **M-74** — Shipper shipments list + detail | `/portal/shipper/shipments` (+`/[id]`), **server-side pagination**, 9 filters, timeline, ETA, documents, support link; dashboard shipment metrics. | L | Portal shell, sidebar/drawer, `.ptable--cards`, `getShipperQuotes` dual-path precedent, honest empty states, `requireShipper`. |
| **M-75** — Dispatcher shipment operations | `/portal/admin/shipments` board (8 columns, filters, pagination), create shipment, **convert accepted quote → shipment**, assign carrier/dispatcher/driver/truck, appointments, status/ETA updates, public update vs internal note, exception log/resolve, POD request, resend notification, update history. | XL | Loads board + create form + `staff-scope.ts` dispatcher scoping + `QuoteStatusForm` are close templates; `freight_quotes` already holds every field the conversion needs. |
| **M-76** — Carrier shipment updates + driver link | `/portal/carrier/shipments` with the allowed action set; `/driver/update/[token]` (hash-only tokens, expiry, revocation, rate limit, audit). | L | `staff_invites` (0012) is the token model; `DocUpload` is the upload widget; carrier portal shell exists. |
| **M-77** — Shipment documents + POD | `shipment-docs` bucket + policies, upload/review/download with visibility model, POD gate on `pod_uploaded`, document-access history. | M | `uploads.ts` (magic bytes, sanitize, TTL), the whole `documents` review/notify/audit pipeline, signed-URL discipline. |
| **M-78** — ETA, exceptions, delays | ETA edit + history + change events, exception CRUD with public/internal descriptions, delay surfacing on `/track` and portals, calm-explanation copy. | M | Nothing directly; small tables, mostly UI + copy. |
| **M-79** — Shipment notifications | `notification_preferences` + `notification_deliveries` with idempotency + retry, 11 customer notification kinds, localized React Email templates, tracking links. | L | `notify.ts` fan-out, `CustomerEmail` layout, `emails/i18n.ts`, `email_log` — this is **mostly new templates**, not new infrastructure. |
| **M-80** — Map + provider adapter | Lazy map component, `TrackingProvider` interface (fetch location / last update / ETA inputs / normalize / dedup), `tracking_provider_connections`, **no fake connection** — honest "provider not connected". | M | `webhook_events` dedup model is the template for provider event idempotency. |
| **M-81** — Broker-partner access | `broker_partners`, memberships, admin invite + per-shipment grants, restricted DTO, restricted portal view. | M | Membership + invite + RLS-helper patterns all exist. |
| **M-82** — Responsive + a11y QA | 320→1920 across all new routes, timeline text equivalent, map alternative, aria-live status, reduced motion; extend `responsive.spec.ts` + `axe.spec.ts`. | M | Both suites exist and are parameterized by route list. |
| **M-83** — RLS, security + enumeration audit | Extend the RLS suite (shipper A⊄B, carrier A⊄B, broker A⊄B, anon sees nothing, carrier cannot write financials, unauthorized transitions fail, expired/revoked tokens fail), DTO key-set tests, enumeration test, SECURITY-REVIEW addendum. | L | 165 assertions + the anti-vacuity machinery (grant parity, positive controls, injected-regression check) are directly extensible. |
| **M-84** — E2E, docs, runbook | 5 e2e flows (§27), module docs, `docs/modules/INDEX.md`, `LAUNCH-RUNBOOK.md` (new env, migration order 0014+, tracking config, rollback), UPGRADE-ACCEPTANCE-style walk of §31. | M | Playwright infra, secretless lane, runbook structure. |

**Ordering:** M-70 → M-71 → M-72 → (M-73, M-74, M-75 in that priority order)
→ M-76 → M-77 → M-78 → M-79 → M-80/M-81 → M-82/M-83/M-84 as the gate.
**Rough total: 4–6 weeks of focused build** at the observed module density.

---

## 14. Files expected to change (by area)

- **Migrations (new only):** `supabase/migrations/0014…0020_*.sql`;
  `supabase/seed.sql` (+`tracking_public_enabled`, retention keys);
  `supabase/tests/10_fixtures.sql` + `20_rls_isolation.sql`;
  `src/lib/supabase/database.types.ts` (regenerated).
- **New libs:** `src/lib/shipments.ts` (status map + labels + badges),
  `src/lib/tracking/{dto,access,eta,visibility}.ts`,
  `src/lib/tracking/providers/{index,motive,samsara,geotab}.ts`,
  `src/lib/driver-tokens.ts`, `src/lib/shipment-documents.ts`.
- **Touched libs:** `src/lib/rate-limit.ts` (dedicated tracking bucket +
  fail-closed note), `src/lib/notify.ts` (delivery ledger + idempotency),
  `src/lib/audit.ts` (new action constants), `src/lib/auth.ts` (broker-partner
  gate if approved), `src/lib/seo.ts` (`/track` noindex + gated sitemap).
- **New actions:** `src/app/actions/shipments.ts`, `shipment-events.ts`,
  `shipment-documents.ts`, `tracking.ts` (public lookup),
  `driver-updates.ts`, `broker-partners.ts`, `notification-prefs.ts`.
- **Touched actions:** `quotes.ts` (convert-to-shipment), `support.ts`
  (shipment-linked threads).
- **New routes:** `(site)/track`, `(site)/track/[trackingNumber]` (optional
  deep link, still verification-gated); `driver/update/[token]` (own route
  group, outside `/portal`); `portal/shipper/shipments(+/[id])`;
  `portal/carrier/shipments(+/[id])`; `portal/admin/shipments(+/[id], /new,
  /board)`; `portal/admin/broker-partners`; `portal/admin/tracking-settings`.
- **Components:** `src/components/tracking/` (Timeline, StatusBadge,
  ShipmentMap, ETABlock, ExceptionBanner, TrackingForm),
  `src/components/portal/Shipment*`, sidebar nav additions in the portal
  shell, nav/footer entries in `SiteNav.tsx`/`Footer.tsx` (flag-gated).
- **Emails:** ~11 new builders in `src/emails/customer-templates.tsx` + i18n
  entries.
- **Styles:** `src/app/portal.css` (timeline, board, shipment cards) and
  `src/app/v4.css` **before the trailing media blocks** — or better, a new
  `src/app/tracking.css` imported after `v4.css`. `globals.css` tokens
  untouched.
- **i18n:** `messages/*.json` ×5 via `scripts/extract-i18n.mjs` SUPPLEMENTAL.
- **Tests:** `tests/unit/{shipments,tracking-dto,driver-tokens,eta}.test.ts`;
  `tests/e2e/{tracking,shipper-shipments,dispatcher-shipments}.spec.ts`;
  route lists in `responsive.spec.ts` + `axe.spec.ts`;
  `supabase/tests/20_rls_isolation.sql`.
- **Docs:** `docs/modules/M-70…M-84*.md`, `docs/modules/INDEX.md`,
  `docs/LAUNCH-RUNBOOK.md`, `docs/SECURITY-REVIEW.md` (addendum), `README.md`.
- **Config:** `.env.example` (tracking/map/provider vars),
  `next.config.ts` (CSP `frame-src`/`connect-src` if a map provider is added).

---

## 15. Decisions requiring business approval — with recommended defaults

| # | Decision | Recommended default |
|---|---|---|
| **D-T1** | **Extend `loads` or create `shipments`?** | **Create `shipments`.** `loads` is carrier-centric dispatch work with a NOT-NULL carrier and a fee trigger; shipments are shipper-centric brokerage work that legally must not exist before MC activation. Additive migration, zero risk to shipped code, trivial rollback. (Full analysis: item 8.) |
| **D-T2** | Second factor on `/track`: delivery ZIP, emailed access code, or both? | **Both, per shipment.** Default to delivery ZIP (customers know it); allow an access code for shipments flagged `is_sensitive`. Store a `tracking_verification_mode` column. |
| **D-T3** | Tracking-number format: sequential `PL-YYYY-######` or random? | **Sequential, as the directive specifies**, because the mandatory second factor + rate limit + uniform errors carry the security. If business prefers un-guessable numbers, switch to a 8-char base32 suffix — a one-line change to the generator, but less human-readable on the phone. |
| **D-T4** | Default location precision. | **`milestone` for public `/track`, `city_state` for the shipper portal, `exact` only when a provider is connected AND the driver has consented.** Per-shipment override for staff. |
| **D-T5** | May shipments/tracking be used at all before `brokerage_active = true`? | **No, by default.** Ship the code dark. Dispatch-side tracking of existing `loads` is plausible but is a legal question for counsel — do not enable it on engineering judgment. |
| **D-T6** | Broker partner: new `user_role` value or grant-based access? | **Grant-based**, no enum change (item 10.4). Broker partners are an org + per-shipment grants, admin-invited only. |
| **D-T7** | Driver update link delivery channel. | **Email / copy-link at launch.** SMS requires Twilio, written opt-in and TCPA-compliant records — a separate decision with real legal exposure. |
| **D-T8** | Realtime on the dispatcher board? | **No.** 30-second polling on the board only. §14 says don't Realtime everything; a subscription also broadcasts full row shapes. |
| **D-T9** | Location-history retention. | **90 days at full precision, then coarsen to city/state; delete raw coordinates at 12 months.** Configurable via `company_settings`. |
| **D-T10** | What may a shipper see about the carrier? | **Carrier company name + MC once assigned; equipment; nothing else.** Never the driver's personal phone (§8), never the carrier's packet, insurance or rate confirmation. |
| **D-T11** | Are shippers ever invoiced through the platform? | **Not at launch.** The existing shipper billing page is an honest placeholder (decision D6) and should stay that way until brokerage operations actually produce an invoice. |

---

# PART B — BUSINESS WEBSITE DIRECTIVE (§32 A–V)

## B.1 Item-by-item walk

Legend — **Built** = shipped and meets the item · **Partial** = real
foundation exists, named sub-features missing · **Net-new** = nothing exists.
Effort: S ≈ ½ day · M ≈ 1–2 d · L ≈ 3–4 d · XL ≈ a week+.

| § | Item | Status | What exists | What's missing | Effort | Dependencies |
|---|---|---|---|---|---|---|
| **A** | Company website experience (15 named sections) | **Partial** | Home, About, Contact, FAQ, Shippers, Become-a-Carrier, `/start-your-trucking-company`, Blog, Legal shells, 8 `/dispatch/[equipment]`, 6+index `/truck-dispatch/[state]` — 337 pages, all on the V4 system, 5 locales. | Dedicated **Our Services** hub, **Freight Brokerage** page (must be `brokerage_active`-gated), **Carrier Resources**, **Careers**, **Support Center**, **Shipment Tracking** entry; nav/footer IA rework for ~6 new top-level entries. | M | Tracking (A→ `/track`), H, D |
| **B** | Customer reviews / testimonials | **Net-new** (flag exists) | `company_settings.testimonials_visible = false` seeded; V4 prototype has a testimonials section deliberately omitted at launch (comment in `(site)/page.tsx`); admin settings editor can flip the flag. | `testimonials` table, submission form, **approval workflow**, featured flag, logo upload, carousel component, homepage section. | M | Storage bucket for logos; **honest-states rule** (see B.3) |
| **C** | Internal carrier reviews / scorecards | **Net-new** | `carriers` table, `loads` history, `documents` review timestamps, `audit_events`. | `carrier_reviews` / `carrier_scorecards` tables, staff-only UI, the 9 named metrics, internal notes, active/inactive flag. **Must never be public.** | M | Load/shipment data for computed metrics; **Part C skill defines the metric set** |
| **D** | Live chat + Support Center | **Partial** | `support_threads`/`support_messages` (0007) + carrier/shipper portals + `/portal/admin/support` staff inbox + `contact_messages` + contact form + FAQ page + `SupportEmail` templates. | Public (unauthenticated) support center page, ticket history for guests, **live-chat adapter layer** (no hardcoded provider), article search, KB integration. | L | E, T |
| **E** | Knowledge base | **Net-new** | `posts` table is a *structural* precedent (slug+locale unique, markdown, publish workflow, escape-first renderer); FAQ page is static copy. | `kb_articles` + categories + tags + search + related + featured; staff editor; 10 named categories. | M | T (search), D |
| **F** | Downloads center | **Partial** (flag + section exist) | `company_settings.packet_downloads_live = false`; `Packet.tsx` home section; private `carrier-docs` bucket + signed-URL discipline. | `downloadable_resources` table with **versioning**, a public/gated download bucket, admin management UI, the 10 named resources, download analytics. | M | Legal sign-off on each PDF |
| **G** | Company blog | **Built (extend)** | `posts` (slug+locale unique, title/excerpt/category/body_md/cover_style/published/published_at/author_id), staff editor `/portal/admin/posts(+/[id],/new)`, public `/blog` + `/blog/[slug]`, Article JSON-LD, ISR 600 s, sitemap feed, escape-first markdown, newsletter CTA. | **Tags** (no column), **featured image** (`cover_style` is a CSS gradient class, not an image), **related posts**, **search**, **pagination** (bare `limit(100)`), author display, per-post SEO overrides. | S–M | Storage bucket for cover images; T |
| **H** | Careers | **Net-new** | Nothing (no `careers` string anywhere in `src/app`). | `job_postings` + `job_applications`, application form, **resume upload** (a brand-new *public* upload surface — highest-risk new write path in this directive), application tracking UI. | M | New private bucket; rate-limit/Turnstile/magic-byte reuse; **PII retention policy** |
| **I** | Partner program | **Net-new** | `contact_messages` + lead-capture pattern reusable. | Partner page, `partner_inquiries` table (or `carrier_leads.lead_type` extension), 5 partner categories. | S | — |
| **J** | Referral program | **Net-new** | Nothing. | `referral_codes` + `referral_events` + attribution, referral dashboard, history. Directive permits **architecture only** if rewards aren't live. | M | Legal/tax review of rewards (1099) |
| **K** | Request a quote | **Built** | Public `QuickQuote` (home) + `/shippers` freight-quote form + in-portal `/portal/shipper/quotes/new` with **every** directive field (origin/destination address+city+state+ZIP, equipment, commodity, pickup date, delivery deadline, contact, hazmat, temp, dims, instructions); **CRM integration is real** — `freight_quotes.status` uses `lead_status` and `trg_freight_quotes_journal` writes `lead_activities`; staff desk at `/portal/admin/quotes` with stage-change notifications. | **File attachments** on quote requests only. | S | Storage bucket |
| **L** | Become a carrier | **Built** | `/become-a-carrier` 4-step wizard, `DocUpload` (magic-byte validated), MC/DOT capture, insurance + W-9 + authority uploads, EIN encrypted (S-01), Dropbox Sign agreement + HMAC webhook, onboarding progress x/5 on `/portal/admin/users`, carrier portal handoff, welcome/document/agreement emails. | A public-facing progress view for an in-flight application (progress is staff-side today); carrier-packet download tie-in (→ F). | S | F |
| **M** | Login experience | **Partial** | `/portal` pre-auth selection page (2 V4 cards), `/login`, `/forgot-password`, `/reset-password`, `/create-account` chooser + carrier/shipper branches, `portalHomeFor()` role routing, suspension + MFA gates. | Four **labelled** entry points (Client / Carrier / Dispatcher / Admin). Presentational only — directive says do not duplicate auth logic, so this is deep-links into the existing `/login` with a role hint. | S | — |
| **N** | Newsletter | **Partial** | `subscribers` (email unique, `confirm_token`, `confirmed_at`, `unsubscribed_at`), `NewsletterForm`, double opt-in via `/api/newsletter/confirm`, `NewsletterConfirmationEmail`, resubscribe handling, admin subscriber count. | **⚠️ No unsubscribe route exists** — the column is written only by the resubscribe path, and no user-facing unsubscribe URL exists. That is a **CAN-SPAM compliance gap** the moment a marketing email ships. Also missing: segmentation, export, analytics. | S–M | **Fix unsubscribe first** |
| **O** | Multi-language | **Built (with an inconsistency)** | next-intl, **5 locales** (`en` default + `es`/`fr`/`ru`/`ht`), `localePrefix: "as-needed"`, 683×5 strings, `useV4()`/`getV4()` + SUPPLEMENTAL extraction pipeline, hreflang + x-default, localized emails. | **The directive lists only 4 public languages and omits Russian** — see B.3. Only genuinely missing work is extracting new strings for A–V and the tracking surfaces. | S | — |
| **P** | Google Reviews layer | **Net-new** | Nothing. | Places API adapter, cached rating/count, approved-display gate, homepage widget. Requires a Google Business Profile **that has reviews** + billing-enabled API key. | M | GBP existing; B (shared review UI) |
| **Q** | Google Maps | **Built** | Keyless Google Maps embed iframe on `/contact` (address, `output=embed`), CSP `frame-src` already permits google.com, `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` declared in `.env.example` (currently unused — flagged in the M-62 runbook env audit). | Directions link, and a keyed/JS map **only if** the tracking map needs it. | XS | Tracking M-80 may supersede |
| **R** | Meeting booking (Calendly) | **Net-new** | Nothing. | Booking section + provider adapter, CSP `frame-src` entry, consent handling (Calendly sets cookies — must sit behind the existing consent gate used for GA4). | S | Consent banner |
| **S** | Audit logs | **Built (extend)** | `audit_events` (0005) + single writer `src/lib/audit.ts` (service-role, no-secrets contract) + `/portal/admin/security` paginated viewer with action filter and actor resolution; coverage table in `docs/SECURITY-REVIEW.md` §4; RLS proves no session can forge a row. | **Login events** (Supabase auth logs are not mirrored into `audit_events`), **shipment changes** (table doesn't exist yet), broader portal-action coverage, export. | S | Tracking M-72 |
| **T** | Advanced / global search | **Net-new** | Per-surface filters exist (loads, users, security, support, quotes, blog listing) but **no cross-entity search**. | Global search over shipments, customers, carriers, blog, FAQ, KB, documents — with **role-scoped result filtering**, which is the real work: one endpoint returning rows from 7 tables is a serious authorization surface. Needs `pg_trgm`/`tsvector` + per-entity permission predicates. | L | E, G, tracking |
| **U** | **Dark / light mode** | **Net-new — and the largest single item in this directive** | The V4 system is **dark-first**: `body{background:asphalt;color:paper}`; `.light` (15 rules in `v4.css`) is a **section variant** meaning "this band has a paper background", not a theme. Tokens in `@theme` are *absolute* colors (`--color-asphalt`, `--color-paper`, `--color-steel`), not semantic roles. | A semantic token layer (`--surface`, `--surface-2`, `--text`, `--text-muted`, `--border`, …) introduced across `globals.css` (86 L) + `v4.css` (479 L) + `portal.css` (119 L) + the inline `style={{color:"var(--color-steel)"}}` usages scattered through portal pages; a persisted Light/Dark/System toggle; **re-validating WCAG AA contrast in both themes** (the Q7 `*-aa` tokens were derived for the dark theme's light *sections*); re-baselining the 108-test responsive screenshot suite and re-running the axe scan in both themes. | **XL** | **Business + design approval — see B.3** |
| **V** | PWA | **Net-new** | Nothing: `public/` holds 5 stock Next.js SVGs; there is no `manifest`, no icon set, no service worker, no `favicon` beyond `src/app/favicon.ico`. | Manifest, full icon/splash set, service worker with an **explicit never-cache list** (`/portal/**`, `/track`, `/driver/**`, all API routes), offline shell for public marketing pages only, update notifications. | M | Icon design assets; **security review of the cache policy** |

## B.2 Proposed module plan (M-85+)

| Module | Scope | §32 items | Size |
|---|---|---|---|
| **M-85** | Corporate site completion: `/services`, `/freight-brokerage` (flag-gated), `/carrier-resources`, `/support`, nav + footer IA, SEO/sitemap/hreflang for the new pages. | A | M |
| **M-86** | Newsletter compliance + completion: **unsubscribe route first**, then segmentation, export, analytics. *(Pulled early because it is a live compliance gap, not a feature.)* | N | S |
| **M-87** | Testimonials system + honest-states gate; reuses the `testimonials_visible` flag. | B | M |
| **M-88** | Internal carrier reviews + scorecards (staff-only), metric set per Part C. | C | M |
| **M-89** | Knowledge base + FAQ upgrade + article search. | E, part D | L |
| **M-90** | Support Center + live-chat adapter (provider-agnostic, ships OFF). | D | M |
| **M-91** | Downloads center with versioning + admin management. | F | M |
| **M-92** | Blog upgrade: tags, cover images, related posts, pagination, author, per-post SEO. | G | S–M |
| **M-93** | Careers + applications + resume upload (new bucket, retention policy). | H | M |
| **M-94** | Partner program + referral architecture. | I, J | M |
| **M-95** | Login Center entry points + quote attachments + become-a-carrier progress view. | M, K, L | S |
| **M-96** | Google Reviews adapter + Maps polish + Calendly booking. | P, Q, R | M |
| **M-97** | Audit-log expansion (login + shipment + portal actions, export). | S | S |
| **M-98** | Global search (role-scoped, `tsvector`/`pg_trgm`). | T | L |
| **M-99** | PWA (manifest, icons, service worker with never-cache list, update prompt). | V | M |
| **M-100** | **CONDITIONAL — Dark/Light theme system.** Only on explicit business + design approval; own design sign-off, own contrast audit, own screenshot re-baseline. | U | XL |
| **M-101** | i18n extraction (5 locales), responsive 320→1920, WCAG 2.2 AA + axe, e2e, docs/runbook/INDEX for everything M-85…M-99. | O + gate | L |

## B.3 Flagged items — verified against the repo, stated honestly

### §32 U — Dark/Light mode ⚠️ **This is a major visual undertaking, not a toggle**

Verified: `src/app/globals.css` sets `body{background:var(--color-asphalt);
color:var(--color-paper)}` — the product is dark-first at the root. `.light`
appears **15 times** in `v4.css` and every occurrence is a *section* override
(`.light{background:var(--paper);color:var(--ink)}`, `.light .eyebrow`,
`.light .field input`, `.light .why-list li`, …). There is **no semantic token
layer**: `@theme` exposes literal colors (`--color-asphalt`, `--color-paper`,
`--color-steel`, `--color-fog`, `--color-cloud`, `--color-slate-body`, …),
which components reference directly, including in inline styles.

Additionally, **`CLAUDE.md` states the V4 prototype is FINAL — "Convert, never
redesign"** — and the previous directive froze the brand/palette and forbade
major visual change without approval. A true theme switch means:

1. introducing a semantic layer and rewriting ~600 lines of CSS to use it;
2. designing a light palette that does not exist yet (there is no approved
   light-theme brand);
3. re-deriving the Q7 AA contrast tokens for the second theme;
4. re-baselining `tests/e2e/responsive.spec.ts` (108 tests) and re-running
   `axe.spec.ts` in both themes;
5. auditing every `style={{ color: "var(--color-…)" }}` in portal pages.

**Recommendation:** treat §32 U as **deferred pending explicit business +
design approval** (decision D-W1). If the goal is user comfort rather than a
second brand, a much cheaper alternative delivers most of the value: honour
`prefers-color-scheme` for *print* and add a high-contrast/reduced-transparency
pass, keeping one brand. If a real theme switch is approved, it must be its
own module cycle with a design deliverable before any code.

### §32 O — the language list is inconsistent with the shipped product ⚠️

The website directive lists **four** public languages (English, Spanish,
French, Haitian Creole) and **omits Russian**. The platform ships **five
locales** (`routing.locales = ["en","es","fr","ru","ht"]`), with
`messages/ru.json` at 63.6 KB — the **largest** of the five dictionaries. The
tracking directive §24 lists **five**, including Russian. The
carrier-management skill also names Russian as a client language.

**Recommendation: keep Russian.** Removing a shipped locale would break
hreflang, delete indexed URLs (SEO damage), orphan the largest dictionary and
contradict the tracking directive read three weeks later. Treat §32 O's
four-item list as an omission, not an instruction. Flag it to the business for
confirmation (decision D-W2) but do not act on it silently in either
direction.

### §32 B — testimonials vs `testimonials_visible` and the honest-states rule

`company_settings.testimonials_visible` is seeded `false` with the description
*"V4 sample testimonials stay hidden until 5+ verified reviews exist"*, and
`(site)/page.tsx` carries an explicit comment that testimonials are omitted at
launch per the prototype's own note + arch §9 (finding F-13). The house rule
(no fake data, honest states) has been enforced through 62 modules.

**Recommendation:** build the full system — table, submission, **approval
workflow**, featured flag, carousel — but keep the public section behind the
existing flag, and never seed sample rows. Publish only testimonials with a
named real customer and written consent. Threshold for flipping the flag is a
business decision (D-W3); recommended default ≥5 approved, verified
testimonials.

### §32 G / N / K / L / M / Q / S / T — what is genuinely already built

Checked before calling anything net-new:

- **G Blog — already built**, needs extending (tags, cover images, related,
  pagination, search). Do not rebuild the CMS.
- **N Newsletter — already built** (double opt-in, confirm route, email,
  resubscribe). **But the unsubscribe route does not exist** — a compliance
  gap, promoted to M-86 ahead of feature work.
- **K Request a Quote — already built**, including full CRM integration.
  Only file attachments are missing.
- **L Become a Carrier — already built end-to-end** (wizard, uploads, MC/DOT,
  insurance, W-9, e-sign, onboarding progress, portal handoff).
- **M Login — mostly built**; the four labelled entry points are
  presentational deep links, not new auth.
- **Q Google Maps — already built** on `/contact` (keyless embed).
- **S Audit logs — already built** (table, single writer, admin viewer,
  RLS-proved integrity); needs login + shipment coverage.
- **T Global search — genuinely net-new**, and it is a real authorization
  surface, not a UI feature.

### Overall scope reality — stated plainly

The two directives together are **larger than the entire M-50…M-62 upgrade
cycle** that produced the current 337-page product. Concretely:

- **Tracking:** 15 modules, ~7 new migrations, ~6 core + ~8 satellite tables,
  ~14 new routes, a new storage bucket, a provider-adapter layer, 11 new email
  templates, and a new *public* attack surface. Estimated **4–6 weeks**.
- **Business website:** 17 modules, ~10 new tables, ~12 new public routes, a
  second upload surface (résumés), a global search engine, a PWA, and — if
  approved — a full theme system. Estimated **5–8 weeks**, of which §32 U
  alone is **1–2 weeks with design**.

**This is 2–3 focused build cycles, not one.** Any plan that promises both in
one pass will ship shallow versions of features whose value is entirely in
their depth (RLS correctness, enumeration resistance, honest states).

**Recommended sequencing:**

1. **Now — compliance and cheap wins (≈1 week):** newsletter unsubscribe
   (M-86, a live legal gap), audit-log login events (M-97), Maps/Calendly
   (M-96 partial), Login Center + quote attachments (M-95), blog upgrade
   (M-92). These are small, unblock marketing, and touch nothing risky.
2. **Then — tracking core (M-70…M-79, ≈4 weeks):** highest strategic value,
   longest lead time, and the thing that makes PickLoads look like a real
   logistics platform. Ships **dark** behind `brokerage_active` — build now,
   reveal at MC activation.
3. **Then — demand generation (M-85, M-87…M-93, ≈3 weeks):** corporate
   sections, testimonials, KB, support center, downloads, careers, partner /
   referral. These acquire customers and recruit carriers **now**, while
   brokerage is still gated.
4. **Then — tracking finishing (M-80…M-84) + global search (M-98) + PWA
   (M-99).**
5. **Last, and only if approved — dark/light theme (M-100)**, with a design
   deliverable first.

Rationale for putting tracking ahead of the website sections despite the legal
gate: tracking has the deepest schema dependencies (audit logs, search,
carrier scorecards and the support center all want to reference shipments),
so building it first prevents rework in five other modules.

## B.4 Business-website decisions requiring approval

| # | Decision | Recommended default |
|---|---|---|
| **D-W1** | **Ship a real Dark/Light theme switch (§32 U)?** | **Defer.** The V4 identity is frozen and dark-first with no light brand defined; a true switch is XL and touches every token, both test suites and every page. Ship a `prefers-color-scheme` print/high-contrast pass instead. Revisit only with an approved light palette and a dedicated module. |
| **D-W2** | **Keep Russian as a public language (§32 O lists only 4)?** | **Keep it.** 5 locales are shipped, `ru.json` is the largest dictionary, the tracking directive names 5, and the ops skill lists Russian as a client language. Removing it costs indexed URLs and hreflang integrity for no benefit. |
| **D-W3** | Threshold for making testimonials public. | **≥5 approved testimonials from named real customers with written consent**, staff-approved, flag flipped by an admin. Never seed samples. |
| **D-W4** | Google Reviews (§32 P). | **Build the adapter, ship it disabled.** Requires a Google Business Profile that actually has reviews plus a billing-enabled Places key. Displaying "0 reviews" is worse than displaying nothing. |
| **D-W5** | Careers: publish openings, or an honest "no current openings"? | **Honest state until a real requisition exists.** Do not collect résumés (sensitive PII) with no role to attach them to; that creates a retention obligation with no purpose. |
| **D-W6** | Referral program rewards. | **Architecture + tracking only, rewards OFF** (the directive explicitly permits this). Paying referral rewards has 1099/tax implications needing accounting sign-off. |
| **D-W7** | Live chat provider and staffing. | **Adapter built, widget OFF.** An unanswered chat widget damages trust more than no widget. Turn on only with a staffed window; keep the existing callback + contact form as the promise. |
| **D-W8** | PWA offline scope (§32 V). | **Public marketing pages only.** `/portal/**`, `/track`, `/driver/**` and all API routes are explicitly network-only and never cached — the directive's own rule ("offline functionality should never expose stale or sensitive shipment data") made concrete. |
| **D-W9** | Downloads center: which resources are public vs gated? | **PickLoads' own credentials (authority letter, COI, W-9, company profile) public once legal approves them; the carrier packet and dispatch/broker agreements behind an email capture.** `packet_downloads_live` stays `false` until the PDFs are lawyer-approved. |
| **D-W10** | Partner program go-live before MC activation. | **Inquiry form only.** No partner logos or listings until agreements are signed — same honest-states rule as testimonials. |
| **D-W11** | Global search result scope (§32 T). | **Role-scoped, server-side, never a single unfiltered index.** Anonymous visitors search blog + FAQ + KB only. Customers additionally search their own shipments/documents. Staff search everything. |

---

# PART C — THE UPLOADED CARRIER-MANAGEMENT SKILL

**File:** `/home/claude/work/carrier-mgmt-upload/pickloads-carrier-management/SKILL.md`
(Apache-2.0, `version: 1.0.0-pickloads`, forked from
`carrier-relationship-management`).

## C.1 What it is

It is a **Claude skill** — YAML frontmatter (`name`, `description`, `license`,
`version`, `metadata`) plus ~250 lines of markdown operational playbook. It
contains **no code, no schema, no components**. Its content is business
expertise for the operator: which hat to wear (dispatcher vs broker vs
advisor), carrier-client onboarding checklists, load-board and rate
negotiation tactics, broker vetting, a per-truck dispatch scorecard, carrier
vetting and double-brokering defence, new-authority risk tiering, shipper
trust-building, margin management, market-intelligence heuristics, decision
frameworks, escalation triggers and weekly KPIs.

**It is therefore not a repository change.** Nothing in it should be
translated into `src/`. If the business wants it version-controlled alongside
the platform, the right home is `docs/reference/` (or a skills directory
outside the Next.js app) — never `src/content` or any bundled path, since it
is internal operating guidance, not customer-facing content and not
app data.

Its most load-bearing sentence for this audit is the legal one, and it
independently corroborates tracking directive §2: *"Until PickLoads' broker MC
is active, all activity must stay strictly on the dispatch side: never take
control of a shipper's freight, never re-post a load, never sit in the payment
chain between shipper and carrier."*

## C.2 Where its content SHOULD inform the code

Six concrete places, with file/module references.

**C-1 — §32 C internal carrier scorecards must use the skill's metric set, and
`formatRpm` is currently mislabelled.**
The skill's *Dispatch Scorecard* table defines exactly five weekly metrics
with targets and red flags: gross revenue per truck per week
(<80 % of target for 2 weeks), **true RPM** (>10 % below market for 2 weeks),
**deadhead %** (<15 % target, >25 % red flag), loads booked vs offered
(>50 % rejection), broker payment incidents (any invoice >45 days). Module
**M-88** should implement these columns verbatim rather than inventing
metrics, and add the brokerage-side KPIs (on-time pickup/delivery ≥95 %,
carrier identity verification 100 %).
**Concrete defect this exposes:** `src/lib/loads.ts` `formatRpm(gross, miles)`
divides by `loads.miles`, which is **loaded miles only**; the skill defines
true RPM as `rate ÷ (deadhead + loaded miles)`. `loads` has **no
`deadhead_miles` column**, and the admin dashboard presents this figure as
"weighted avg RPM". Either add `loads.deadhead_miles` (additive ALTER) and a
`formatTrueRpm()` helper, or relabel the existing metric "loaded RPM"
everywhere it appears (`/portal/admin/loads`, `/portal/admin/page.tsx`,
`/portal/carrier/loads`). Presenting loaded RPM as RPM to a carrier client is
exactly the kind of quiet inaccuracy the house honest-data rule exists to
prevent.

**C-2 — Broker vetting needs to be data, not free text.**
`loads.broker_name` / `loads.broker_mc` are unvalidated free-text columns with
no FK and no vetting record. The skill's *Broker Vetting* section requires:
active authority + $75 K bond verified on FMCSA, credit score / days-to-pay
(or the client's factoring company's approval list), broker MC age <12 months
as a fraud signal, and specific red flags. Recommend a `brokers` table
(`mc_number` unique, `bond_status`, `bond_verified_at`, `days_to_pay`,
`factor_approved`, `authority_age_months`, `risk_flags[]`, `blocked_at`,
`last_verified_at`) with a nullable FK from `loads` and `shipments`, plus a
server-side guard in `src/app/actions/loads.ts` `createLoad()` that refuses to
book against a `blocked_at` broker. This directly implements the skill's
escalation rule *"Broker payment >45 days past due → stop booking with that
broker firm-wide, same day."*

**C-3 — New-authority risk tiering must gate carrier assignment on shipments
(M-75).**
The skill defines Tier 1 (any authority age, including own New Authority
Program graduates — short-haul, low-value dry freight, first 5 loads
probationary), Tier 2 (6+ months, clean CSA — standard freight), Tier 3 (12+
months, references — high-value, time-critical, reefer). The platform already
has the feeder side of this (`lead_type = 'new_authority'`,
`/start-your-trucking-company`, M-26) but nothing on the assignment side. Add
`carriers.risk_tier` + `carriers.probation_loads_remaining` and enforce them
in the M-75 assign-carrier action: a Tier-1 carrier cannot be assigned to a
shipment flagged high-value/reefer/time-critical, and their first five
shipments auto-set an elevated monitoring flag. The skill is explicit that
this tiering is a competitive moat *and* that the vetting must be documented
so cargo-insurance claims aren't jeopardised — which means the decision must
land in `audit_events`, not just a column.

**C-4 — The skill's escalation triggers are the specification for M-79's
notification rules and the daily cron.**
Each row maps to an automated rule:
*carrier insurance lapse or authority revocation → suspend dispatching within
1 hour* — the M-35 daily cron already emails on `insurance_expiry ≤30 d`;
extend it to auto-set `carriers.active = false` on lapse, write an
`audit_events` row and notify the assigned dispatcher.
*Brokered load: carrier unreachable in transit → check calls escalating to
shipper notification within 4 hours* — becomes a cron over
`shipments.last_location_at` staleness that auto-opens a
`shipment_exceptions` row (M-78) and fires the §17 "delay reported"
notification.
*Client truck <80 % of weekly target for 2 weeks* — a dispatcher task
notification driven by the C-1 scorecard.
*Suspected identity fraud / double-brokering → freeze the load within 2 hours*
— a first-class shipment status/exception with a hard block on the
`picked_up` transition (M-72).

**C-5 — Carrier identity verification must be a hard precondition on the
`carrier_assigned` transition (M-72), not a checklist.**
The skill lists carrier identity verification completion as a KPI with a
target of **100 % before first load** and a red flag of *"any exception"*, and
describes the concrete procedure (call back on the FMCSA-listed number, match
the dispatcher email domain to the carrier's listed domain, verify the
truck/driver at pickup matches the carrier on the rate confirmation, written
no-re-brokering certification). Tracking directive §20 already says
"`carrier_assigned` requires a carrier assignment"; the skill upgrades that to
"requires a **verified** carrier assignment". Implement as
`carriers.identity_verified_at` + `verified_by`, checked server-side in the
transition engine, surfaced in the M-75 assign dialog, and audited.

**C-6 — Margin thresholds and communication cadence are product defaults, not
guesses.**
*Margin:* the skill puts healthy spot brokerage gross margin at **10–18 %**,
with <8 % or >25 % as red flags. The staff-only shipment detail (M-75) should
compute `margin_pct` and render a warn badge outside that band, using the
skill's exact numbers rather than an invented threshold.
*Cadence:* the skill's shipper-trust section prescribes *"pickup confirmation,
in-transit check call, delivery confirmation with POD within hours — for every
load, unprompted"* and names silence as the reason small shippers leave big
brokers. That is precisely the §17 notification list, and it argues that the
default `notification_preferences` for pickup / in-transit / delay / delivered
/ POD should be **ON by default**, not opt-in — the overcommunication *is* the
product differentiator.

**Secondary, worth noting:** the skill's communication section states PickLoads
serves clients in **English, Spanish, French, Russian and Haitian Creole**, and
that contract-critical terms (detention, deadhead, factoring, rate
confirmation) should be shown in English alongside any translation because
rate confirmations and legal documents are in English. That independently
supports decision **D-W2** (keep Russian) and gives a concrete i18n rule for
the tracking and rate-confirmation strings.

---

*End of audit. Next step, on approval of D-T1 and the gating decisions:
M-71 (migrations `0014`+).*
