# PickLoads — Launch Runbook

Exact, ordered steps to take pickloads.com live. Work top to bottom; each
step lists what to do, where, and which env var it produces. The app
degrades gracefully when a secret is missing (dev warnings, honest pending
states) — so a partial deploy never crashes, it just quietly disables the
affected integration. **Production must have every var set.**

*Last revised for M-73 (public secure tracking, `/track`): migration **0020**
added to the order-and-rollback table, the `0001 → 0020` chain, **one new
environment variable (`TRACKING_ACCESS_SECRET`) that fails CLOSED**, a `/track`
smoke test, and refreshed gate counts (437 unit / 357 RLS / 47 integration /
174 e2e / 348 pages). Previously revised for M-72 (status-transition engine):
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

   After applying, sanity-check the chain the same way CI does:

   ```bash
   npm run test:rls     # rebuilds a throwaway DB from 0001→0020 + seed + fixtures
   ```

2. **Seed** — run `supabase/seed.sql` (idempotent, `on conflict do nothing`).
   Seeds the **9** `company_settings` keys with launch-safe defaults (see the
   switchboard section in the go-live checklist): MC/USDOT "pending",
   brokerage off, testimonials hidden, sample ticker, packet downloads off,
   and `shipper_signup_enabled: true`.
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
| `CRON_SECRET` | server only | generate: `openssl rand -hex 32` — Vercel Cron sends it as the Bearer token automatically | `/api/cron/daily` refuses every call → **no insurance-expiry alerts, no callback digest** |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | build/public | GA4 admin (step 10) — fires only after cookie consent (S-05) | no analytics; admin marketing tiles keep their honest placeholders |
| `TRACKING_ACCESS_SECRET` | server only | generate: `openssl rand -hex 32` — HMAC key for the §4 public-tracking secondary credential (recipient ZIP / access code) | **`/track` refuses EVERY lookup** ("tracking is temporarily unavailable"). This is the one secret in this table that fails **closed**, deliberately: "cannot verify the credential" is not "the credential is correct". Rotating it invalidates every stored `public_access_hash` — every shipment then needs its access code re-issued by dispatch. |

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
npm test                 # 437 unit assertions
npm run test:rls         # 357 RLS isolation assertions — see below
npm run test:integration # 47 integration tests against local PG16 — see below
npm run test:e2e         # 174 chromium tests against the production build
```

**`npm run test:rls` is a release gate, not an optional extra.** It rebuilds
a throwaway database from `0001 → 0020` + seed + two/three-tenant fixtures and
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
It builds its own throwaway database (`0001 → 0020` + seed, **not** the RLS
fixtures — it creates shipments through the engine) and then runs vitest
against it, so the real TypeScript transition engine drives the real SQL write
path: create → assign carrier → create event → update status, idempotent
replay, provider dedupe, compare-and-swap conflict, event-sourced appointments,
the §20 correction flow and the append-only refusal. **M-73 adds §27's fifth
named test — the public tracking lookup** — as fourteen scenarios driving the
real `lookupPublicTracking` against the real schema through a psql-backed
PostgREST adapter: happy path, wrong secondary value, unknown number, an
admin-suspended shipment, a rate-limit trip, and a sweep of the whole access
ledger proving the submitted secret is stored in no form.

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

## 9. Cron (O-01 daily ops alerts)

Set `CRON_SECRET` in Vercel and deploy — `vercel.json` schedules
`GET /api/cron/daily` at 11:00 UTC (insurance-expiry threshold alerts +
callback digest). Verify once manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://pickloads.com/api/cron/daily
```

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

All nine keys, their seeded value and what they gate. Every edit is journaled
to `audit_events` as `settings.update` (key only, never the value) and takes
effect site-wide immediately — **no deploy**.

| Key | Seeded | Gates |
|---|---|---|
| `mc_number` | `{"status":"pending","value":null}` | Footer, compliance block, FAQ. Stays `pending` until FMCSA grants — see the one-pager below. |
| `usdot_number` | `{"status":"pending","value":null}` | Footer, compliance block. |
| `bond_status` | `{"status":"in_process","value":"BMC-84 $75K"}` | Surety-bond display. `in_process` until BMC-84 is actually filed. |
| `brokerage_active` | `false` | Every "brokerage live" message: shipper pages drop "Launching Soon", and the **shipper portal's Shipments & Tracking** surface flips from the honest waitlist (D1/D6) to the first-shipment empty state. Flip only when the bond is effective and broker processes exist. |
| `testimonials_visible` | `false` | V4 sample testimonials stay hidden until 5+ verified reviews exist. |
| `stats` | `{"fee":"5%","avg_rate":null,"support":"24/7","states":"48"}` | Home stats tiles. **`null` renders hidden** — never invent a figure to fill it. |
| `packet_downloads_live` | `false` | Carrier-packet download buttons — off until lawyer-approved PDFs are uploaded. |
| `load_ticker_mode` | `"sample"` | Home load-board ticker: `sample` \| `live`. |
| `shipper_signup_enabled` | `true` | **Decision D1** — public shipper self-signup at `/create-account/shipper`. When `false`, the shipper door on the `/create-account` chooser shows an honest invite-only state instead of the form. This exists so **legal can switch shipper self-registration off without a deploy**; the signup copy is deliberately scoped to "request quotes and coordinate freight with vetted carriers" and makes no brokerage claims. |

- [ ] Reviewed all nine values against the business's actual status.
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
      labels and decision D-6's 29 curated operator phrases are the priority:
      they are what a customer actually reads on `/track`.
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
