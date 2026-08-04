# PRODUCTION UPGRADE DIRECTIVE — Repository Audit (M-50a)

**Date:** 2026-08-04 · **Scope:** audit only, no code changes ·
**Directive:** full customer-account system + portal completion (M-50…M-62)

This document maps the directive against the shipped codebase (M-00…M-43,
all green) and defines the gap, the database plan, the risks, and the module
plan. Section 10 lists the only decisions that need business sign-off.

---

## 1. Current repository audit

**Stack (locked):** Next.js 15.5 (App Router, pinned — no 16), React 19,
Tailwind v4 (`@theme` tokens in `src/app/globals.css`; V4 prototype is the
final visual reference), next-intl 4 (en default + es/fr/ru/ht prefixed),
Supabase (`@supabase/ssr`), Zod 4, react-hook-form, Resend + React Email,
Stripe 19, Upstash rate limiting, Turnstile, Vitest + Playwright.

**Structure:**

- `src/app/[locale]/(site)` — public site: home, about, contact, faq,
  shippers, become-a-carrier, start-your-trucking-company, blog (+CMS
  output), legal shells, 8 `/dispatch/[equipment]` pages, 6+index
  `/truck-dispatch/[state]` pages. **222 static pages** in the build
  (M-42 verification).
- `src/app/[locale]/(auth)` — `/login`, `/forgot-password`,
  `/reset-password` (minimal chrome route group).
- `src/app/[locale]/portal` — role-routed portal (see §3). All portal
  routes `force-dynamic`, `noindex`, 0 portal routes in the prerender
  manifest.
- `src/app/actions` — 11 server-action modules (admin, billing, carrier,
  carrier-lead, contact-message, crm, freight-quote, loads, newsletter,
  onboarding, posts).
- `src/app/api` — cron/daily (CRON_SECRET), esign/webhook (HMAC,
  idempotent), stripe/webhook (signature-verified, idempotent),
  newsletter/confirm.
- `src/lib` — auth gates, supabase clients (browser/server/admin +
  middleware), crypto (AES-GCM EIN encryption, S-01), esign, stripe,
  rate-limit (fail-open), turnstile (fail-closed), uploads, validation
  (Zod, per form), markdown (escape-first), seo/jsonld.
- `src/emails` — 8 React Email templates + shared `theme.ts`.
- `supabase/migrations` — 0001 (enums + 13 tables + triggers), 0002 (RLS
  everywhere, no anon inserts), 0003 (signup→profile trigger + CRM
  journaling), 0004 (private `carrier-docs` bucket + storage policies).
  **These four are frozen — new work is 0005+.**
- `messages/` — 344 strings × 5 locales via the `extract-i18n.mjs`
  V4-dictionary pipeline (`useV4()` / `getV4()` bridge).
- `tests/` — **88 tests green**: 76 Vitest unit (validation, slug parity,
  markdown XSS, load state machine, PII crypto, guard degradation) + 12
  Playwright chromium smoke tests (secretless, ~13 s, against `next start`).

**Patterns in force (CLAUDE.md gate):** V4 tokens only (no raw hex);
public-form writes = rate-limit → Turnstile → Zod → **service-role insert**
(no anon insert policies; RLS is defense in depth); every module ships a
`docs/modules/M-XX-*.md`; module gate = functionality · responsiveness ·
WCAG AA · SEO · security · typecheck · lint · build; TS strict, no `any`;
graceful degradation without secrets (honest pending states, never fake
data); deviations cite audit finding IDs.

---

## 2. Existing account/auth features

| Feature | State |
|---|---|
| `/login` | ✅ Email+password via browser Supabase client (the one legitimate anon-key surface, Q3). Safe `?next=` redirect (same-origin, `//` rejected), else `/portal/carrier`. Graceful without env. |
| `/forgot-password` | ✅ M-42 — `resetPasswordForEmail`, locale-preserving `redirectTo`, no account enumeration. |
| `/reset-password` | ✅ M-42 — recovery-session watch + `updateUser`. |
| Middleware protection | ✅ `updateSession` in root middleware protects `/portal` **including locale-prefixed paths** (`/es/portal/…`), redirects to `{locale}/login?next=`; auth cookies carried through the intl middleware. |
| Role model | ✅ `user_role` enum: admin / dispatcher / carrier / shipper on `profiles`. |
| Role guards | ✅ Server-side only: `requireProfile` / `requireStaff` / `requireAdmin` + `portalHomeFor(role)` role router at `/portal`. Cross-role portal access redirects to own surface. |
| Signup trigger | ✅ `handle_new_user` (0003): every `auth.users` row gets a `profiles` row; role defaults to `carrier`. |
| Privilege-escalation guard | ✅ `guard_role_change` trigger (0002): non-admin sessions cannot change any role, incl. their own. Only admins (or service role) change roles. |
| Carrier account creation | ✅ Only via the become-a-carrier wizard's final step: `completeOnboarding` → `admin.auth.admin.createUser` (auto-confirmed, judgment call documented) → profile enrich → `carriers.profile_id` link. Duplicate-email and already-claimed guards present. |
| Shipper account creation | ⚠️ **Staff invite only** — and only via the Supabase dashboard; there is **no in-app invite UI**. Topbar "Shipper Login" is still a Coming-Soon link (Footer links `/login`). |
| Public `/create-account` | ❌ Does not exist for any role. |
| Staff invites | ❌ No in-app flow (S-04 says invite-only, but the mechanics are manual: dashboard user + admin role promotion). |
| MFA | ❌ Absent entirely (no `mfa`/factor code anywhere). |
| Session/role e2e | Partial — `/portal` auth-wall redirect is smoke-tested; no role-matrix or RLS-isolation tests. |

---

## 3. Existing portal features

### Carrier (`/portal/carrier`, role `carrier`)
- **My Documents** (home): tiles for dispatch-agreement status (signed date
  vs awaiting), documents-in-review count, insurance expiry; document table
  (type, file, status badge incl. rejection note shown to carrier, date,
  **Download** via ≤5-min signed URL); **replacement uploads** (doc-type
  select + shared `DocUpload` dropzone → `pending` → M-24 review queue).
  Honest "not linked yet" state when `carriers.profile_id` isn't set.
- **My Loads**: read-only RLS-scoped list incl. delivered/invoiced/paid
  summary (fees, statuses). No actions.
- **My Profile**: **read-only** account + company block (MC/DOT, state,
  factoring, insurance expiry, fee %, EIN shown as "on file (encrypted)");
  "call us to update" note (deliberate M-25 judgment call).
- All reads cookie-bound under carrier RLS policies.

**Not present:** overview dashboard, profile editing, trucks & equipment,
drivers, agreements page (status is a tile only), invoices page, support.

### Shipper (`/portal/shipper`, role `shipper`)
- **My Quotes** only: tiles (requests/open/quoted) + quote table with
  shipper-facing status mapping (Received/In review/Quoted/Booked/Closed —
  internal CRM stages not leaked); "Request a new quote" links to the
  **public** `/shippers` form. Empty state honestly explains the
  email-matching limitation with a phone fallback.
- **Known deviation (documented in M-32):** no FK from `freight_quotes` to
  auth users → matching via **admin client** scoped
  `.eq("email", session.email)` (Supabase-verified email, after role gate).
  Phase-4 fix explicitly planned: `shipper_id` FK + backfill + RLS policy.

**Not present:** in-portal quote form (public form lacks addresses / hazmat
/ temperature / dimensions — validation schema has none of these fields),
tracking, billing, support.

### Admin (`/portal/admin`, roles admin+dispatcher; settings admin-only)
- **Dashboard** (M-24 + M-34): sales tiles (24h/7d/30d leads, 9-status
  funnel, conversion, first-contact vs 15-min target, callbacks,
  appointments, dispatch vs new-authority split); operations (document
  review queue with approve/reject + note, insurance expiring ≤30d,
  unsigned agreements); dispatch (active carriers, loads today/7d, fees
  invoiced vs collected, weighted avg RPM, per-dispatcher performance,
  state/equipment badge clouds); marketing (subscribers, posts, lead
  sources, **honest GA4/GSC placeholders**); notifications feed
  (`email_log` + failed `webhook_events` timeline).
- **Leads CRM**: kanban pipeline, lead detail (status, activities journal,
  meta), auto status journaling via DB triggers.
- **Loads**: list + create + status machine
  (booked→in_transit→delivered→invoiced→paid, cancellable until money
  moves); **Generate invoice** on delivered loads (Stripe `send_invoice`,
  net-7, dispatch fee only; journaled into `webhook_events`).
- **Posts**: blog CMS (editor, publish workflow).
- **Settings** (admin only): every `company_settings` key, triple-guarded.

**Not present:** user/account management of any kind (no user list, no
approve/suspend, no dispatcher assignment UI beyond `loads.dispatcher_id`
at load level, no staff invites, no audit-log view).

---

## 4. Missing features vs the directive (gap list)

| Directive item | Status | Notes |
|---|---|---|
| `/portal` selection page (choose carrier/shipper/staff entry) | ❌ | `/portal` is a pure role-based redirect today; there is no pre-auth selection/marketing page. |
| `/create-account` with role choice | ❌ | No public signup at all. Carrier accounts only at end of onboarding wizard; shippers manual invite. |
| Carrier guided registration w/ authority-status routing | ◐ | The become-a-carrier wizard (4 steps) and `/start-your-trucking-company` (`lead_type=new_authority`) exist as **lead funnels**, but registration is not account-first and new-authority applicants get no account. |
| Shipper guided registration (industry/frequency/regions) | ❌ | No shipper signup; `freight_quotes` captures frequency only. |
| Staff invite-only (in-app) | ❌ | Policy exists (S-04, role guard trigger); mechanics are manual. |
| Role-aware redirects | ✅ | `portalHomeFor` + per-page gates already complete. |
| Carrier overview dashboard | ❌ | Home is the documents page. |
| Carrier company profile editing | ❌ | Read-only by design (M-25); needs an edit flow with staff verification for regulated fields. |
| Trucks & equipment | ❌ | No table, no UI (equipment is derived from loads on the admin dashboard — deliberate). |
| Drivers | ❌ | No table, no UI. |
| Carrier documents | ✅ | M-25 complete (upload/replace/review/download). |
| Carrier agreements page | ◐ | Status tile + e-sign flow exist; no dedicated page with agreement history/download. |
| Carrier loads | ◐ | Read-only list exists; directive-level detail (per-load view, docs) missing. |
| Carrier invoices | ◐ | Stripe invoices are emailed; no in-portal invoice history (data currently lives as `webhook_events` rows + Stripe). |
| Carrier support | ❌ | Nothing. |
| Shipper full quote form (addresses/hazmat/temp/dimensions) | ❌ | Public form is zip-to-zip, no hazmat/temp/dims fields anywhere in schema or validation. |
| Shipper tracking placeholder | ❌ | — |
| Shipper billing | ❌ | — (nothing invoiceable to shippers exists yet — see §5/§10). |
| Shipper support | ❌ | — |
| Admin: view/filter users | ❌ | — |
| Admin: approve/suspend accounts | ❌ | No account-status concept beyond `carriers.active`. |
| Admin: assign dispatchers | ◐ | `loads.dispatcher_id` exists; no carrier↔dispatcher assignment. |
| Admin: staff invites UI | ❌ | — |
| Admin: audit logs | ❌ | Partial precedents only (`lead_activities`, `email_log`, `webhook_events`); no generic audit table. |
| Multi-user memberships (DB ready, single-user UI) | ❌ | `carriers.profile_id` / email matching are strictly 1:1 today. |
| ~18 React Email templates | ◐ | 8 exist (all internal/ops-facing except newsletter confirm); customer-lifecycle set (welcome, approval, suspension, invite, quote-ready, support-reply, invoice, MFA, etc.) missing. |
| MFA for staff | ❌ | Absent. |
| i18n for new customer-facing strings | ◐ | Pipeline exists (344×5); portal carrier/shipper strings run through `getV4` but mostly fall back to English (documented M-25 leftover); admin surface intentionally English. |
| WCAG 2.2 AA incl. skip link | ◐ | AA is in the module gate, but **no skip link exists** anywhere in the layouts. |
| Responsive 320→1920 portal QA | ◐ | See §7. |
| RLS-isolation tests (carrier A ⊄ carrier B) | ❌ | No integration tests against a real/local Postgres; unit + smoke only. |
| No fake data / honest states | ✅ | Established house pattern — must be preserved in new pages. |

---

## 5. Database changes required (new migrations 0005+, never touch 0001–0004)

Existing tables that already cover directive concepts: `profiles` (users),
`carriers` (carrier companies), `documents`, `loads`, `freight_quotes`
(quotes), `carrier_leads`, `company_settings`, `email_log` (email journal),
`webhook_events` (Stripe/e-sign ledger — **currently doubles as the
"invoice record"**), `subscribers`, `contact_messages`, `posts`,
`lead_activities`.

### 0005 — accounts, memberships, audit, preferences

```sql
-- Shipper companies (freight_quotes finally gets an owner)
create table shippers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  industry text,
  shipping_frequency text,          -- from guided registration
  regions text[],                   -- served/shipping regions
  phone text,
  billing_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Multi-user membership (DB-ready now, single-user UI at launch)
create type membership_role as enum ('owner','member');
create table carrier_memberships (
  carrier_id uuid not null references carriers(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (carrier_id, profile_id)
);
create table shipper_memberships (
  shipper_id uuid not null references shippers(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (shipper_id, profile_id)
);
-- Backfill: insert owner rows from carriers.profile_id (kept as-is for
-- back-compat; memberships become the authoritative join for RLS helpers).

-- Account status + history (approve/suspend)
create type account_status as enum ('pending','active','suspended');
alter table profiles add column status account_status not null default 'active';
create table account_status_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  old_status account_status,
  new_status account_status not null,
  reason text,
  changed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Generic audit ledger (staff + security-relevant actions)
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,             -- 'user.suspend','settings.update',...
  target_table text, target_id uuid,
  detail jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index idx_audit_events_recent on audit_events (created_at desc);

-- Staff invites (S-04 made self-service)
create table staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role user_role not null check (role in ('admin','dispatcher')),
  token_hash text not null,         -- store hash, never the token
  invited_by uuid not null references profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table user_preferences (
  profile_id uuid primary key references profiles(id) on delete cascade,
  email_load_updates boolean not null default true,
  email_document_reviews boolean not null default true,
  email_marketing boolean not null default false,
  updated_at timestamptz not null default now()
);
```

### 0006 — fleet

```sql
create table trucks (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  unit_number text,
  equipment text not null,          -- keep in sync with the 8 equipment slugs
  year int, make text, model text, vin text,
  plate text, plate_state text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_trucks_carrier on trucks (carrier_id);

create table drivers (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  full_name text not null,
  phone text, email text,
  cdl_number text, cdl_state text, cdl_expiry date,
  medical_card_expiry date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_drivers_carrier on drivers (carrier_id);
-- Optional: loads.driver_id / loads.truck_id nullable FKs (ALTER, additive).
```

### 0007 — support + notifications

```sql
create type support_status as enum ('open','answered','closed');
create table support_threads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  carrier_id uuid references carriers(id),
  shipper_id uuid references shippers(id),
  subject text not null,
  status support_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references support_threads(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  kind text not null,               -- 'document_reviewed','load_status',...
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_unread on notifications (profile_id, created_at desc) where read_at is null;
```

### 0008 — billing + shipper quote linkage

```sql
-- Proper invoices table. RECOMMENDED. Today an invoice exists only as a
-- Stripe object plus a webhook_events row ('invoice_created' + payment
-- events). That is an audit ledger, not a queryable billing record: the
-- carrier portal cannot list invoices without parsing JSONB payloads with
-- the service role, amounts/status aren't indexed, and the honest-states
-- rule forbids faking it. A thin mirror table (written by the billing
-- action and updated by the existing idempotent Stripe webhook) gives the
-- carrier invoices page and admin reporting a real source of truth while
-- Stripe stays the system of record for money.
create type invoice_status as enum ('draft','open','paid','void','uncollectible');
create table invoices (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id),
  load_id uuid references loads(id),
  stripe_invoice_id text unique,
  amount_cents bigint not null,
  currency text not null default 'usd',
  status invoice_status not null default 'open',
  hosted_url text,
  issued_at timestamptz, due_at timestamptz, paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_invoices_carrier on invoices (carrier_id, created_at desc);

-- The M-32 Phase-4 fix, exactly as that doc planned:
alter table freight_quotes
  add column shipper_id uuid references shippers(id),
  add column hazmat boolean,
  add column temp_controlled boolean, add column temp_min_f int, add column temp_max_f int,
  add column dims_l_in int, add column dims_w_in int, add column dims_h_in int,
  add column pickup_address text, add column pickup_city text, add column pickup_state text,
  add column delivery_address text, add column delivery_city text, add column delivery_state text;
-- Backfill shipper_id by email match at migration time (one-shot, logged).
```

### 0009 — RLS for everything above

Same doctrine as 0002: enable RLS on every new table; **no anon policies**;
staff via `is_staff()`; own-data via membership helpers, e.g.:

```sql
create or replace function public.my_carrier_ids() returns setof uuid
language sql security definer stable set search_path = public as $$
  select carrier_id from carrier_memberships where profile_id = auth.uid()
$$;
-- carriers/documents/loads/trucks/drivers/invoices: carrier_id in (select my_carrier_ids())
-- shippers/freight_quotes: shipper_id in (select my_shipper_ids())
-- support: participants read own threads; staff read all; inserts bound to auth.uid()
-- notifications/user_preferences: profile_id = auth.uid()
-- audit_events / staff_invites / account_status_events: staff read; writes via
--   service role or SECURITY DEFINER triggers only
```

Existing carrier RLS policies (`profile_id = auth.uid()`) stay valid;
new membership-based policies are added alongside (additive, no edits to
0002). `database.types.ts` regenerated/extended for all new tables.

---

## 6. Security risks

1. **MFA absent** (directive requires it for staff). Staff accounts gate
   PII (EIN ciphertext, documents, all leads). Supabase TOTP MFA + AAL2
   checks in `requireStaff`/`requireAdmin` and the middleware are needed;
   enforcement hardness is a §10 decision.
2. **No audit-events table.** Approve/suspend, role changes, settings
   edits, invoice generation, and document review are only partially
   journaled (settings has `updated_by`; role changes are guarded but not
   logged). Directive's admin audit log requires 0005 `audit_events` +
   wiring in every mutating staff action.
3. **M-32 shipper email-matching weakness (documented).** Admin-client read
   scoped by session email — acceptable only while shippers are
   staff-invited. **Public shipper signup makes it unacceptable**: an
   attacker who registers (or changes email to) an address that previously
   submitted quotes reads that lead's data. The 0008 `shipper_id` FK +
   RLS policy + cookie-bound reads must land **before or with** shipper
   self-signup; email-change flows must not silently re-link quotes.
4. **Public signup opens a new write surface.** Today `createUser` runs
   only inside the rate-limited, Turnstile-gated onboarding action.
   `/create-account` must reuse the same guard stack (rate-limit →
   Turnstile → Zod → service-role) and decide email confirmation policy
   (public signup should NOT auto-confirm the way the onboarding wizard
   does — that judgment call was scoped to the in-flow wizard).
5. **Role redirect coverage is good but static.** `portalHomeFor` +
   per-page gates cover the 4 roles; new pages must use the same gates,
   and `profiles.status='suspended'` must be enforced centrally
   (middleware or `requireProfile`) or suspension is cosmetic.
6. **Staff invite tokens**: store hashes only, expiring, single-use;
   accepting an invite must set the role via service role (the
   `guard_role_change` trigger correctly blocks self-promotion).
7. **RLS isolation untested.** 0002 policies exist but no test proves
   carrier A cannot read carrier B (directive requires it). Needs
   integration tests against a local Supabase/Postgres with two seeded
   carriers/shippers exercising anon + authenticated clients.
8. **Support/notifications inserts** are a new authenticated write surface
   — body-length limits, rate limiting, and escape-first rendering (reuse
   the M-33 markdown/escape discipline) required.
9. **`company_settings` is publicly readable** — fine today; new feature
   flags for signup gating are fine there, but never invite tokens/secrets.

---

## 7. Responsive risks

- **`portal.css` is 83 lines with 3 media queries** (860px sidebar
  collapse, 1020px grid, 640px form rows). It was sized for v1 portals; the
  directive multiplies portal surface ~5×.
- **Tables on mobile:** `.ptable` has no <640px strategy — admin loads,
  carrier docs, and shipper quotes already scroll/overflow at 320–375px
  (`.ptable-wrap` exists but horizontal-scroll UX at 320px needs explicit
  QA). New pages (trucks, drivers, invoices, users, audit log) are all
  table-heavy: define a shared card-collapse or scroll-with-affordance
  pattern once, in `portal.css`, before building them.
- **Forms:** `.pform-row` collapses at 640px, but the new guided
  registration and full quote form (addresses, dims, temp ranges) are the
  longest forms in the product; multi-step + single-column at ≤640px, and
  the V4 `.bigform` vocabulary on public pages needs a 320px pass.
- **V4 CSS is public-site oriented** (439 lines, hero/section vocabulary);
  `/portal` selection and `/create-account` are public-facing pages that
  should use V4 vocabulary — fine, but the wizard step UI (currently in the
  onboarding components) is the only precedent and needs 320px checks.
- **Inline styles** appear in portal pages (`style={{display:"flex"…}}`) —
  acceptable per house style but they bypass media queries; watch on the
  new dense dashboards.
- **WCAG 2.2 AA additions:** no skip link exists (directive names it);
  2.2 also implies focus-not-obscured and 24px target-size checks on the
  kanban and sidebar; document-per-module as usual.

---

## 8. Proposed module plan M-50…M-62

| Module | Scope | Already done / shrink |
|---|---|---|
| **M-50 — Data model** | Migrations 0005–0009 (§5), backfills (memberships from `carriers.profile_id`, `freight_quotes.shipper_id` by email one-shot), regenerated `database.types.ts`, seed updates, RLS helpers. | Loads/documents/carriers schema untouched; 0001–0004 frozen. |
| **M-51 — Public account system** | `/portal` selection page (pre-auth, V4), `/create-account` with role choice; carrier branch: authority-status routing (has MC → account + link to onboarding wizard; `new_authority` → account + funnel tagging, honest "authority in progress" portal state); shipper branch: industry/frequency/regions → `shippers` + membership; full guard stack; email confirmation; role-aware redirects. | Login/forgot/reset done (M-02b/M-42); wizard reused for carrier detail; `portalHomeFor` done. |
| **M-52 — Staff security** | Supabase TOTP MFA enrollment + AAL2 gate for staff (enforcement per §10), staff-invites table+flow+UI hook, `audit_events` wiring into all staff mutations, suspension enforcement in `requireProfile`/middleware. | Role guard trigger + gates exist. |
| **M-53 — Carrier overview + profile** | `/portal/carrier` becomes an overview dashboard (loads, docs, agreement, insurance, invoices tiles — honest empty states); profile **editing**: self-serve contact/preferences, change-request flow for regulated fields (MC/DOT/insurance/EIN) per §10 D5. | Data reads and tiles largely exist; documents page (M-25) moves to `/portal/carrier/documents` unchanged. |
| **M-54 — Trucks & drivers** | CRUD pages under carrier portal on 0006 tables; equipment list synced with the 8 equipment slugs; optional load linkage display. | Nothing exists — full build, but small CRUD. |
| **M-55 — Carrier loads, agreements, invoices** | Load detail view; agreements page (status + signed doc download via existing signed-URL pattern); invoices page reading the 0008 `invoices` table; billing action + Stripe webhook write/update the mirror rows. | Loads list (read-only) done; e-sign + Stripe flows done — this is mostly surfacing. |
| **M-56 — Support + notifications** | Threaded support (carrier+shipper submit, staff answer from admin), simple statuses (§10 D2); `notifications` bell/feed for customers; `user_preferences` page; admin support inbox. | Admin notifications feed (ops) exists and stays. |
| **M-57 — Shipper portal completion** | In-portal full quote form (addresses/hazmat/temp/dims on extended `freight_quotes`, cookie-bound insert now that `shipper_id`+RLS exist), quotes page moved off the admin client, tracking placeholder (honest "activates with your first booked load"), billing (honest empty state per §10 D6), support entry. | Quote listing/status mapping done; empty-state copy pattern established. |
| **M-58 — Admin account management** | `/portal/admin/users`: list/filter (role, status, company), approve/suspend with reason (→ `account_status_events` + email), dispatcher↔carrier assignment, staff-invite UI (M-52 flow), audit-log viewer. | Nothing exists — full build; reuses ptable/pbar vocabulary. |
| **M-59 — Email suite** | ~10 new React Email templates on the existing `theme.ts` + `email_log` journal: welcome (carrier/shipper), email-confirm, staff invite, account approved/suspended, quote-ready, support reply, invoice issued/paid, document reviewed, MFA enrolled. | 8 templates + sending/journal infra done. |
| **M-60 — i18n pass** | Extract every new public/customer-facing string through the SUPPLEMENTAL pipeline (es/fr authored, ru/ht mirrored pending native review, per M-42 precedent); backfill the M-25/M-32 carrier/shipper strings that currently fall back to English. Admin surface stays English (existing scope decision). | Pipeline + 344-string base done. |
| **M-61 — Responsive + a11y hardening** | `portal.css` v2 (shared mobile-table pattern, form patterns), full 320→1920 QA on every portal/public page, WCAG 2.2 AA sweep + **skip link** in both layouts, focus/target-size checks. | Public site already AA-gated per module; this is the portal-wide sweep. |
| **M-62 — Tests + runbook** | RLS-isolation integration suite (local Supabase, carrier A vs B, shipper A vs B, suspended user), unit tests for new validation/state machines, e2e for signup/login/role-routing/MFA gate, LAUNCH-RUNBOOK + INDEX updates. | 88 existing tests stay; playwright + vitest infra done. |

Ordering: M-50 → (M-51, M-52 parallel) → M-53–M-58 → M-59/M-60 continuous →
M-61/M-62 gate.

---

## 9. Files expected to change (by area)

- **Migrations (new only):** `supabase/migrations/0005…0009_*.sql`,
  `supabase/seed.sql` additions; `src/lib/supabase/database.types.ts`.
- **Auth core:** `src/lib/auth.ts` (status + AAL checks, membership
  helpers), `src/lib/supabase/middleware.ts` (suspension, MFA step-up
  route), `src/middleware.ts` (only if new public route groups need it).
- **New route groups/pages:** `src/app/[locale]/(auth)/create-account/…`,
  `(auth)/mfa/…`, `(auth)/invite/[token]/…`; `/portal` selection page
  (moves the pure redirect); `portal/carrier/{documents,trucks,drivers,`
  `agreements,invoices,support,settings}`; `portal/shipper/{quotes/new,`
  `tracking,billing,support}`; `portal/admin/{users,users/[id],audit,`
  `support}`.
- **Actions:** new `account.ts` (signup, membership), `staff.ts` (invites,
  approve/suspend, assign), `fleet.ts` (trucks/drivers), `support.ts`,
  `notifications.ts`, `preferences.ts`; extend `billing.ts` (invoice
  mirror), `freight-quote.tsx` (extended fields + authed path),
  `carrier.ts` (profile edit/change-request); `api/stripe/webhook`
  (invoice mirror updates).
- **Validation:** new Zod modules per form area in `src/lib/validation/`.
- **Components:** `src/components/portal/` grows (tables, forms, sidebar
  nav additions), `src/components/auth/` (signup wizard, MFA),
  layout components (skip link in `(site)`, `(auth)`, portal layouts).
- **Emails:** ~10 new files in `src/emails/` + `src/lib/email` senders.
- **Styles:** `src/app/portal.css` (major), `globals.css` (skip-link,
  focus tokens only — V4 tokens untouched).
- **i18n:** `messages/*.json` (+SUPPLEMENTAL entries in
  `scripts/extract-i18n.mjs`).
- **Tests:** `tests/unit/*` additions, new `tests/integration/rls.*`,
  `tests/e2e/*` additions, `playwright.config.ts`/`vitest.config.ts` if the
  integration lane needs a separate project.
- **Docs:** `docs/modules/M-50…M-62*.md`, `INDEX.md`, `LAUNCH-RUNBOOK.md`
  (MFA setup, new env/config, migration order 0005+).

---

## 10. Decisions requiring business approval

Only true business/legal/pricing calls. Everything else above is
engineering judgment within existing house rules.

1. **Shipper self-signup wording pre-MC/brokerage-bond activation.**
   The site currently shows bond/authority as "pending" via
   `company_settings`. Letting shippers self-register before brokerage
   authority is active is a legal/marketing exposure question (what are we
   promising them?). **Recommended default:** allow self-signup now, with
   copy scoped to "request quotes and coordinate freight with vetted
   carriers" (no brokerage claims), and a `company_settings` flag
   (`shipper_signup_enabled`) so legal can flip it without a deploy.
2. **Support: simple messages vs full ticketing.** **Recommended default:**
   simple threaded `support_threads`/`support_messages` with
   open/answered/closed status — no SLA engine, assignment, or categories at
   launch. The schema upgrades cleanly to ticketing later.
3. **MFA enforcement for staff: hard vs soft at launch.**
   **Recommended default:** soft-launch — enrollment prompt for all staff
   with a 14-day grace banner, **hard-required for `admin` role from day
   one** (admins can change roles and settings). Flip dispatchers to hard
   once both real staff are enrolled.
4. **Memberships now-in-DB / later-in-UI.** Confirm that multi-user company
   accounts ship as data model + RLS only, with single-user UI (no "invite
   teammate" button) at launch. **Recommended default:** yes — tables,
   backfill, and membership-based RLS in M-50; team UI deferred to a
   post-launch module.
5. **Carrier self-service edits to regulated fields (MC/DOT/insurance/
   EIN/factoring).** Compliance stance today is "call us" (M-25).
   **Recommended default:** self-serve for contact info, phone, language,
   notification preferences; regulated fields submit a **change request**
   that staff approve (keeps compliance review, removes the phone call).
6. **Shipper billing at launch.** Nothing is invoiced to shippers today
   (Stripe bills carriers' dispatch fees only); a shipper "Billing" page
   can only be an honest placeholder unless the business intends to bill
   shippers at launch. **Recommended default:** honest placeholder
   ("invoices appear here once your first shipment is booked") — no shipper
   invoicing flow until brokerage operations actually produce one.
7. **New-authority carriers (no MC yet) get accounts immediately?**
   **Recommended default:** yes — account at signup, routed to the
   `/start-your-trucking-company` funnel state, portal shows honest
   "authority in progress" checklist; converts to full carrier when staff
   activate the record. (This matches the existing lead_type machinery.)

---

*End of audit. Next step on approval: M-50 (migrations 0005–0009).*
