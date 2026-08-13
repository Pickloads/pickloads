# PickLoads — Security Review (M-61)

**Date:** 2026-08-05 · **Scope:** `docs/UPGRADE-AUDIT.md` §6 (security risks),
decision **D3** (staff MFA) · **Commit baseline:** M-60 (`e003246`)

This is the evidence file for module M-61. Everything below was executed, not
asserted: every claim carries the command that produced it and the result.
Where a control cannot be proved without a live Supabase project, that is
stated explicitly rather than glossed.

---

## 1. Summary

| # | Audit §6 risk | Status after M-61 |
|---|---|---|
| 6.1 | MFA absent for staff | **Built** — TOTP enrollment + step-up under `/portal/admin/mfa`, enforced centrally (admin hard, dispatcher 14-day grace). Surface-level enforcement only — see §5. |
| 6.2 | audit_events not wired into every staff mutation | **3 gaps closed** (`document.review`, `settings.update`, `invoice.generate`) + 1 new control (`document.download`) + 2 MFA events. Coverage table in §4. |
| 6.3 | Shipper email-matching weakness | **Proved fixed** — 16 RLS assertions show shipper A cannot read shipper B's `freight_quotes`, nor unclaimed public quotes. |
| 6.4 | Public signup write surface | Unchanged (M-52/M-53 guard stack); re-verified that signup errors never echo provider text (§6). |
| 6.5 | Suspension must be central | Unchanged (`requireProfile`); MFA now enforced at the same choke point. |
| 6.6 | Staff invite tokens | Unchanged (0012 hash-only, single-use); RLS suite proves no session — staff or admin — can insert or read-then-forge invites. |
| 6.7 | **RLS isolation untested** | **165 assertions**, runnable via `npm run test:rls`. |
| 6.8 | Support/notification write surface | Proved: a customer cannot post into another tenant's thread, nor forge `is_staff = true` on their own message. |
| 6.9 | `company_settings` publicly readable | Confirmed intentional and still bounded — anon reads it, anon cannot write it. |

**One live defect was found and fixed** (migration `0013`) — see §3.

---

## 2. RLS isolation suite

### What it is

| File | Role |
|---|---|
| `supabase/tests/00_shim.sql` | Local PG16 stand-in for Supabase's `auth`/`storage` schemas and the `anon`/`authenticated`/`service_role` roles. Repo copy of the M-01 out-of-tree shim, so the suite is reproducible. |
| `supabase/tests/10_fixtures.sql` | Two carriers, two shippers, a non-owner member, an unaffiliated authenticated user, a dispatcher and an admin, with rows in every customer table. |
| `supabase/tests/20_rls_isolation.sql` | The assertions + the `rls_test` harness. |
| `scripts/run-rls-tests.sh` | Runner: fresh DB → shim → migrations `0001…0013` in order → seed → fixtures → assertions → count. |

### Why it fails loudly

Every assertion goes through one of five harness functions, each of which
`RAISE EXCEPTION`s on mismatch; psql runs with `ON_ERROR_STOP=1`, so one
regression aborts the run non-zero.

| Helper | Guarantees |
|---|---|
| `rls_test.eq(actual, expected, label)` | Exact row count for a SELECT. |
| `rls_test.ok(cond, label)` | Boolean assertion. |
| `rls_test.denied(stmt, label)` | Statement must be rejected — and **only** with SQLSTATE `42501`/`23514`/`P0001`. Any other error (typo, missing column, FK) is re-raised as `RLS TEST BROKEN`, so a broken test can never masquerade as a pass. |
| `rls_test.affects(stmt, n, label)` | Statement runs but touches exactly `n` rows (how RLS silently filters UPDATE/DELETE). |
| `rls_test.writes_nothing(stmt, label)` | Rejected **or** zero rows — used where either shape is legitimate. |
| `rls_test.reads_nothing(table, label)` | Zero rows **or** a `42501` refusal (several policies call `is_staff()`, whose EXECUTE grant excludes some roles — both outcomes mean "no data reaches the caller"). |

`denied` and `affects`/`writes_nothing`/`reads_nothing` are **SECURITY
INVOKER** on purpose: the statement must run as the caller's role, or RLS
would be bypassed and every assertion would pass vacuously.

### Anti-vacuity measures

1. **Grant parity.** The historical M-01 shim granted table privileges to
   `authenticated` only. On a real Supabase project `anon` holds the same
   grants and RLS is what stops it — so every anon assertion would have
   passed for the wrong reason. `00_shim.sql` now grants both roles, making
   the anon assertions test **policies**.
2. **Positive controls.** The suite also asserts what *must* work: carrier A
   can insert and delete its own truck, can rename its own profile; a
   dispatcher can review documents; an admin can write `company_settings`;
   anon can read `company_settings` and published posts. A policy set that
   denied everything would fail.
3. **Injected-regression check.** Adding `create policy "REGRESSION leak" on
   trucks for select using (true)` made the run abort with exit code 3 and
   `RLS ASSERTION FAILED: carrierA cannot select carrierB trucks (expected 0
   row(s), got 1)`. Policy removed; suite green again.

### Result

```
$ npm run test:rls
▸ RLS suite — PG at /tmp/pgsock:5433, database pickloads_rls
✔ RLS isolation suite: 165 assertions passed
```

### Coverage table

| Group | Assertions | What is proved |
|---|---:|---|
| Carrier A vs carrier B | 56 | Cross-tenant SELECT blocked on `carriers`, `documents`, `loads`, `trucks`, `drivers`, `invoices`, `support_threads`, `support_messages`, `notifications`; staff ledgers (`carrier_leads`, `contact_messages`, `subscribers`, `email_log`, `webhook_events`, `audit_events`, `account_status_history`, `staff_invites`, `lead_activities`) invisible; `shippers`/`freight_quotes` invisible; cross-tenant INSERT/UPDATE/DELETE denied or zero-row; forged `is_staff` message denied; self-issued notification/audit rows denied; loads & carrier creation denied; own-tenant positive controls. |
| Role guard (`trg_profiles_role_guard`) | 4 | Non-admin cannot self-promote to `admin` or `dispatcher`; role unchanged afterwards; dispatcher cannot promote itself. |
| Membership helpers (`my_carrier_ids` / `my_shipper_ids`) | 18 | Owner **and** non-owner member both resolve to exactly 1 company and read its rows; a non-member authenticated user resolves to zero and sees nothing in 9 tables. |
| Shipper A vs shipper B (§6.3) | 16 | Own `freight_quotes` only; shipper B's quotes and unclaimed public quotes invisible; direct quote INSERT and self-quoting UPDATE denied; company creation denied; no access to carrier-side tables. |
| Anon key | 40 | 24 customer/staff tables read nothing; 8 INSERTs denied; 5 write attempts change nothing; 3 documented public reads still work (`company_settings`, published posts only, drafts hidden). |
| Staff | 33 | Dispatcher reads all carriers/documents/loads/trucks/drivers/invoices/shippers/quotes/CRM/journals/support/preferences/profiles; does **not** inherit customer notifications; cannot write `company_settings`, forge audit rows or invites, or self-promote; can review documents. Admin can write settings, edit own profile — and cannot mutate other accounts from a browser session (service-role only). |
| **Total** | **165** | |

### How to run

```bash
# Local PG16 (M-01 pattern) must be reachable:
pg_ctl -D /tmp/pgdata -l /tmp/pg16.log -o "-k /tmp/pgsock -p 5433 -c listen_addresses=" start
npm run test:rls          # PGHOST/PGPORT/PGUSER/RLS_TEST_DB override the defaults
```

Deliberately **not** part of `npm test`: vitest runs on placeholder env with
no database, and that property is load-bearing for CI and the e2e lane.

---

## 3. Defect found and fixed — public blog broken by an RLS grant (0013)

The suite failed on an assertion nobody expected to matter:

```
$ psql -d pickloads_rls -c "set role anon; select count(*) from posts where published = true;"
ERROR:  permission denied for function is_staff
```

**Cause.** `posts` carries two permissive SELECT policies from 0002 —
`"public read published posts" using (published)` and `"staff manage posts"
for all using (is_staff())`. PostgreSQL ORs permissive policies and applies
RLS quals **before** the caller's `WHERE`; for a row with `published = false`
the OR does not short-circuit, so `is_staff()` is invoked — and 0002 granted
EXECUTE on it to `authenticated` only.

**Impact.** `src/lib/posts.ts` reads the blog with a bare anon-key client.
On a live project the blog list, every post page and the sitemap would fail
the moment a single unpublished draft existed — i.e. the normal state of the
M-33 editor workflow. The module's honest-degradation path turns the error
into an empty blog plus a logged message, so it would have shipped silently.

**Fix.** `supabase/migrations/0013_public_read_grant_fix.sql` grants EXECUTE
on `is_staff()` to `anon`. Additive; 0001–0004 untouched. `is_staff()` is
SECURITY DEFINER/STABLE and returns `false` when `auth.uid()` is null — it is
a boolean oracle about the caller and exposes no data. Verified: anon now
reads exactly the published post and still cannot see the draft (assertions
"anon reads published posts only" / "anon cannot read draft posts").

`current_user_role()` deliberately stays authenticated-only: its only
anon-reachable policy pairs with `using (true)` on `company_settings`, which
the planner constant-folds before the function is reached — proved by the
passing assertion "anon CAN read company_settings".

---

## 4. audit_events coverage

Written exclusively through `src/lib/audit.ts` (`recordAuditEvent`) or the
pre-existing inline inserts in `staff.ts`. All writes use the **service
role**; 0009 grants staff SELECT and **no** INSERT policy to anyone — the RLS
suite asserts that even an admin's browser session cannot forge a row.

| Action | Source | Status |
|---|---|---|
| `account.signup` | `account.tsx` (carrier + shipper) | pre-existing |
| `user.suspend` / `user.activate` | `staff.ts` | pre-existing |
| `carrier.activate` / `carrier.deactivate` | `staff.ts` | pre-existing |
| `carrier.assign_dispatcher` | `staff.ts` | pre-existing |
| `staff.invite` / `staff.invite_accepted` | `staff.ts` | pre-existing |
| `carrier.change_request` | `carrier-portal.ts` | pre-existing |
| `agreement.resend_requested` | `carrier-portal.ts` | pre-existing |
| `quote.status_change` | `quotes.ts` | pre-existing |
| **`document.review`** | `admin.ts` | **gap closed (M-61)** — approving/rejecting regulated compliance paperwork was journaled nowhere. |
| **`settings.update`** | `admin.ts` | **gap closed (M-61)** — `company_settings` is the launch switchboard (MC/DOT, brokerage flip, signup gating); `updated_by` recorded who, but was overwritten on the next edit and carried no timestamp/IP trail. The key is journaled, the value is not. |
| **`invoice.generate`** | `billing.ts` | **gap closed (M-61)** — money moving on a carrier's account was journaled only in `webhook_events`, which the security log does not read. |
| **`document.download`** | `admin.ts` | **new control (M-61)** — staff pulling a carrier's private W-9 / voided check / COI is the highest-PII read in the product. The *access* is journaled; the signed URL is not (that would put a live credential in the ledger). |
| **`staff.mfa_enrolled` / `staff.mfa_verified`** | `security.ts` | **new (M-61)** |

### Deliberately NOT journaled (documented, not overlooked)

| Action | Why |
|---|---|
| `loads.updateLoadStatus` / `createLoad` | Operational throughput, not a security event; the M-30 state machine already refuses illegal transitions and `invoice.generate` captures the money-moving step. Journaling every status tick would bury the ledger. |
| `crm.updateLeadStatus` / `addLeadActivity` | Already fully journaled in `lead_activities` (0003 trigger) — a second ledger would duplicate, not add. |
| `posts.savePost` / `togglePostPublished` | Public marketing content, versioned by `updated_at`/`author_id`; no PII, no privilege. |
| `support.staffReply` / `setSupportThreadStatus` | The messages themselves are the record; thread state is visible in the admin inbox. |
| Customer self-service (`fleet.ts`, `portal-account.ts`, `shipper-portal.ts`) | Tenant-scoped edits to their own data; RLS is the control and the row's `updated_at` is the trail. |

Pinned by `tests/unit/security.test.ts` — the required action strings must be
present in each action module, so deleting a journal write fails CI.

---

## 5. MFA enforcement matrix (decision D3)

Enrollment surface: **`/portal/admin/mfa`** (V4/portal.css vocabulary; QR
rendered from the enrollment response's `totp.qr_code`, with the raw secret
offered for manual entry; `challenge` + `verify` complete the factor).

Enforcement choke point: `src/lib/auth.ts` → `enforceStaffMfa()`, called by
`requireStaff()` and `requireAdmin()`. Every `/portal/admin/*` route already
funnels through one of those two gates (verified by grep across all 14 admin
pages), so the gate covers current **and future** staff pages — the same
reason suspension lives in `requireProfile`. `/portal/admin/mfa` is the one
route using `requireStaffNoMfa`, or the redirect would loop.

| Role | Requirement | Trigger | Behaviour when unmet |
|---|---|---|---|
| `admin` | **Hard**, from day one | Always | Every `/portal/admin/*` request redirects to `/portal/admin/mfa`. Applies to unenrolled admins **and** to enrolled admins whose session is still AAL1 (step-up challenge). |
| `dispatcher` | **14-day grace** from `profiles.created_at`, then hard | `requirementFor()` | During grace: full access + a countdown banner rendered by the portal shell on every page. After: identical hard redirect. |
| `dispatcher`, missing/invalid `created_at` | **Hard** (fail safe) | — | Never grants an unbounded exemption because a column was null. |
| `carrier` / `shipper` | None | — | Customers are out of D3 scope; no gate, no banner. |
| Any role, **no Supabase env** | None | `isAuthConfigured()` false | Honest "not available in this environment" state; nothing gated. This is what keeps the placeholder build, 168 unit tests and 37 e2e tests green. |

Satisfaction requires **both** a `verified` TOTP factor **and**
`currentLevel === "aal2"` on the live session — a verified factor alone is not
enough, or an AAL1 session token would sail through.

### What MFA can and cannot enforce without a live Supabase project

**Can, and is enforced by this code:**

- No staff **surface** renders below the required assurance level. The gate
  runs before any data fetch in the page body, so an unenrolled admin never
  receives lead PII, EIN ciphertext, documents or the audit log.
- The dispatcher grace window is computed entirely from `profiles.created_at`
  — deterministic, unit-tested (`tests/unit/security.test.ts`, 8 cases
  including both fail-safe edges).
- Absent credentials degrade to a documented no-op instead of a crash or a
  fake "enrolled" state.

**Cannot, and is not claimed:**

- **The database does not know about AAL.** PostgreSQL RLS keys off
  `auth.uid()` and the profile role; `is_staff()` returns true for a stolen
  **AAL1** access token used directly against PostgREST. Closing this needs
  AAL-aware policies (`auth.jwt() ->> 'aal' = 'aal2'`) on a live project where
  the JWT shape can actually be observed — it cannot be written blind, and a
  wrong guess would lock every staff account out of the database. **Tracked as
  residual risk R-1.**
- **TOTP must be enabled on the project** (Supabase dashboard →
  Authentication → Multi-Factor). Without it `mfa.enroll` fails and the page
  shows the enrollment error; the app cannot flip that switch.
- **No factor can be created, challenged or verified here.** Enrollment,
  QR generation, the 30-second code window, replay protection and rate
  limiting are Supabase's; this module reads `listFactors()` and
  `getAuthenticatorAssuranceLevel()` and acts on them.
- **Recovery is deliberately not self-service.** A lost device requires
  another admin to delete the factor in the Supabase dashboard. Building a
  recovery-code flow would create a second, weaker credential.
- **The Supabase dashboard itself** has its own MFA setting, outside this
  codebase.
- **Nothing about MFA was exercised end-to-end**, because no live project
  exists in this environment. What is proved here is the *decision logic* and
  the *degradation path*, not a round trip with a real authenticator.

---

## 6. Verification sweep

Build under audit: `rm -rf .next && npm run build` on the committed
placeholder env (`NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`).

### 6.1 Secrets in client bundles — **0 findings**

```bash
# 1. secret VALUE patterns in everything shipped to the browser
grep -rIloE 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|sk_(live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|re_[A-Za-z0-9_]{16,}|service_role' .next/static
# → 0 matches

# 2. a secret env NAME bound to a value
grep -rIloE '(SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|TURNSTILE_SECRET_KEY|PII_ENCRYPTION_KEY|RESEND_API_KEY|CRON_SECRET|UPSTASH_REDIS_REST_TOKEN)"?\s*:\s*"[^"]+"' .next/static
# → 0 matches

# 3. any surviving process.env.<SECRET> reference in a client chunk
grep -rIloE 'process\.env\.(SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|TURNSTILE_SECRET_KEY|PII_ENCRYPTION_KEY|RESEND_API_KEY|CRON_SECRET|UPSTASH_REDIS_REST_TOKEN)' .next/static
# → 0 matches
```

**Honest reading of result 1.** The build runs on placeholder credentials, so
no real secret existed to leak; a value-pattern grep alone would be
theatre. Result **3** is the one that generalises: no `process.env.<secret>`
reference survives into any client chunk, so nothing would be inlined even
with production env set — Next.js only inlines `NEXT_PUBLIC_*`, and results 2
and 3 confirm nothing else reaches the client graph.

Two structural checks back it up:

```bash
# 4. no "use client" module imports a secret-bearing server module
for f in $(grep -rl '"use client"' src --include=*.tsx --include=*.ts); do
  grep -qE 'from "@/lib/(supabase/admin|env|crypto|audit|stripe|esign|mfa)"' "$f" && echo "LEAK: $f"; done
# → 0 findings

# 5. `import "server-only"` guard present (a client import becomes a build error)
head -1 src/lib/{supabase/admin,crypto,audit,mfa,stripe,esign,auth,uploads,notify}.ts
# → import "server-only";  ×9
```

One benign hit was investigated and dismissed: the staff loads page ships the
string `"Set STRIPE_SECRET_KEY to enable dispatch-fee invoicing"` — a tooltip
naming an env var on an authenticated staff-only page. A name, not a value.

### 6.2 Signed-URL TTLs — 2 call sites, both ≤ 300 s

```bash
grep -rn "createSignedUrl" src
# src/app/actions/admin.ts:157   staff review download   → SIGNED_URL_TTL_SECONDS
# src/app/actions/carrier.ts:38  carrier own download    → SIGNED_URL_TTL_SECONDS
```

Both were bare `300` literals. M-61 replaces them with the exported
`SIGNED_URL_TTL_SECONDS = 300` in `src/lib/uploads.ts`, and
`tests/unit/security.test.ts` pins the value **and** statically asserts that
no `createSignedUrl(...)` call in either file passes a numeric literal. A
future call site with `3600` fails CI. Agreement-document links come from
Dropbox Sign's own short-lived URLs (`src/lib/esign.ts`), not this bucket.

### 6.3 Error messages surfaced to clients

| Path | Before | After |
|---|---|---|
| `billing.ts` invoice generation | `` error: `Stripe error: ${message}` `` — returned the raw Stripe message (request ids, customer ids, the failing resource, occasionally a colliding email) to the staff UI. | **Fixed.** Logged server-side; the UI gets a fixed, actionable sentence. Pinned by a unit test. |
| Public form actions (`carrier-lead`, `freight-quote`, `contact-message`, `newsletter`, `onboarding`) | already correct | `throw` → caught → fixed `SERVER_ERROR_MESSAGE`. Verified by test. |
| `account.tsx` signup | already correct | `error.message` is only regex-tested to distinguish "already registered"; the returned string is one of two constants. Preserves Supabase's anti-enumeration behaviour. |
| Stripe / Dropbox Sign webhooks | already correct | Provider text goes to `console.error`, the staff-only `webhook_events.error` column and the internal ops email. The HTTP response is `{"error":"Processing failure"}`. |
| 4 admin list pages (`leads`, `loads`, `posts`, `settings`) | `Couldn't load X ({error.message})` | **Accepted, not changed.** Admin/staff-gated pages where the Postgres message is the intended debugging aid, and the surrounding copy explicitly tells the operator to check Supabase. Logged as residual risk **R-4**. |

---

## 7. Residual risks

| ID | Risk | Severity | Notes |
|---|---|---|---|
| **R-1** | RLS is not AAL-aware: a stolen **AAL1** staff token used directly against PostgREST still passes `is_staff()`. MFA gates the app surface, not the database. | **High** | Needs `auth.jwt() ->> 'aal'` policies authored against a live project. Do not guess blind — a wrong predicate locks staff out of the DB. |
| **R-2** | Dispatcher least-privilege is enforced in **query scoping** (`src/lib/staff-scope.ts`), not in policy. `is_staff()` does not distinguish admin from dispatcher, so a dispatcher's token can read any carrier via a direct API call. | **Medium** | Documented since M-58 (restrictive policies would require editing frozen 0002). A `0014` additive restrictive policy set is the clean fix once staging exists. |
| **R-3** | `audit_events` writes are best-effort: a failed insert logs loudly but does not roll back the action. | **Low** | Deliberate — refusing an approved suspension because the ledger hiccuped is worse. |
| **R-4** | Postgres error text is rendered on 4 staff list pages. | **Low** | Staff-only surface; deliberate debugging affordance. Revisit if non-technical staff are onboarded. |
| **R-5** | MFA has no self-service recovery; a lost device requires another admin. With a single admin account this is a lockout risk. | **Medium (operational)** | Mitigation is procedural: enroll two admins before flipping D3 on in production. Called out in the launch runbook step below. |
| **R-6** | The RLS suite runs against local PG16 with a **shim** for `auth`/`storage`, not against real Supabase. Policy logic is proved; JWT claim shapes, storage policies and PostgREST behaviour are not. | **Medium** | Re-run against a staging project post-link; the suite is portable (`PGHOST`/`PGPORT`). |
| **R-7** | `service_role` in the shim lacks `BYPASSRLS`, so the suite cannot prove the service-role path itself. | **Low** | Service-role bypass is a Supabase platform property, not an app policy. |
| **R-8** | Storage bucket policies (0004) are applied by the suite but not exercised — no object-level assertions. | **Medium** | Needs real storage; the folder-prefix policy is the only thing standing between carrier A and carrier B's W-9 at the object layer. |

---

## 8. What still requires a live environment to prove

1. **A real TOTP round trip** — enroll, scan, verify, obtain AAL2, get past
   the gate, and confirm an AAL1 session is redirected. All of it is
   Supabase-side.
2. **AAL claim shape** in the issued JWT, needed before R-1 can be closed.
3. **Storage RLS** — that carrier A cannot fetch a signed URL for carrier B's
   object path (R-8), and that a signed URL genuinely expires at 300 s.
4. **The 0013 grant against real Supabase** — the fix is proved on PG16 with
   the shim; confirm the public blog and sitemap serve with drafts present.
5. **Anon grant parity** — that Supabase's `anon` really does hold the table
   grants the shim assumes. If it does not, the anon assertions are stronger
   than production requires (never weaker).
6. **Rate limiting and Turnstile under load** — both fail open by design when
   their env is absent (M-40); only production traffic proves the closed path.
7. **Email deliverability** of the security notices (M-60 surface).

---

## 9. Reproduce this review

```bash
npm run typecheck && npm run lint && npm run build   # gate
npm test                                             # 168 unit
npx playwright test                                  # 37 e2e
npm run test:rls                                     # 165 RLS assertions
# then the §6.1 greps against the fresh .next/
```

---
---

# PickLoads — Tracking Security Review (M-83)

**Date:** 2026-08-09 · **Scope:** `docs/DIRECTIVE-tracking.md` §§4, 19, 20, 25
· **Commit baseline:** M-82 (`a275611`) · **Module doc:**
[`docs/modules/M-83-tracking-security.md`](modules/M-83-tracking-security.md)

Same standard as §1–9 above: everything below was executed, not asserted, and
where a control cannot be proved without a live Supabase project that is said
rather than glossed. This section reviews the **tracking system** (M-70…M-82);
§1–9 remain the review of the pre-tracking product and are not restated.

---

## 10. Summary

| # | Risk carried into M-83 | Status after M-83 |
|---|---|---|
| T.1 | §19's seventh proof (*dispatcher permissions are limited*) was untestable — the control was query-level (`src/lib/staff-scope.ts`), so a test would have passed for the wrong reason | **Closed at the database.** Migration 0030 adds 14 RESTRICTIVE policies keyed on a two-arm scope predicate, plus a fix to the one SECURITY DEFINER function they cannot reach. 64 new RLS assertions, proved against a **second** dispatcher |
| T.2 | M-71's **R-1** — the three §18 financial columns were in the payload of any row a customer could read | **Closed.** 0030 revokes `gross_shipper_amount`, `carrier_pay`, `margin` and `public_access_hash` from `authenticated` and `anon`; an audience-aware SECURITY DEFINER accessor returns three of them to the callers entitled to them |
| T.3 | §19 proof 5 (*carriers cannot edit financial fields*) rested on the **absence** of a write policy | **Upgraded to a catalog fact.** `authenticated` and `anon` hold no INSERT/UPDATE/DELETE on `shipments` at all; every write is a SECURITY DEFINER RPC or the service role |
| T.4 | Public-DTO safety was proved on the serializers only — M-70's doc: *"they cannot show that M-73 calls `toPublicTrackingDto` rather than returning the row"* | **Closed at the route.** 20 unit assertions over every customer route module + a real action/real database key-set and value sweep on a row carrying seven sentinels |
| T.5 | Enumeration audit of the surfaces added since M-73 | **Done. Two defects found and fixed** — see §12 |
| T.6 | Token expiry / revocation / rate limiting / non-enumerability | Re-probed adversarially through the TypeScript path. Expiry, revocation and the two rate limits hold; **non-enumerability did not** (§12.1) and now does |
| T.7 | Residual risks scattered across M-71…M-82 module docs | **Consolidated** into one ledger — M-83 §9. Four closed, thirteen restated once with severity and closing condition |

---

## 11. Migration 0030 — what it removes

Every earlier tracking migration was purely additive. This one removes
privileges, deliberately, and both removals fail **closed**.

```sql
revoke all on public.shipments from authenticated, anon;
grant select (…49 operational columns…) on public.shipments to authenticated;
```

* `anon` now holds **no privilege of any kind** on `shipments`. It never had a
  policy (§19 forbids anonymous SELECT and M-73 goes through the service
  role), so the grant it held was dead weight that only RLS was standing on.
  Now both stand on it.
* `authenticated` can read 49 operational columns and write nothing.
  Verified before the revoke that nothing in `src/` writes this table through
  a browser session: the sole `.update()` on `shipments` — §14's dispatcher
  reassignment — uses `tryCreateAdminClient()`, and every other write is an
  0019/0022 RPC granted to `service_role` alone.
* `service_role` is untouched (the revoke names `authenticated, anon`
  explicitly), so production's platform grants survive. **Not asserted** —
  the shim has no service-role grants at all (M-61 R-7 / M-83 RL-5). The
  direction of failure is loud: if the assumption were wrong, every
  service-role write would fail on deploy rather than silently degrade.

The 14 RESTRICTIVE policies work because PostgreSQL ANDs restrictive policies
on top of the OR of permissive ones. No shipped policy is edited, nothing is
widened, and every non-dispatcher short-circuits on the first arm of
`staff_scope_ok()` — which is asserted for shipper, carrier, broker and admin
sessions so the new policy cannot have silently narrowed four modules' work.

---

## 12. Defects found and fixed

### 12.1 A malformed driver token was distinguishable — and free

`redeemDriverToken` documented a decoy-hash fallback for malformed input. The
fallback was `hashDriverToken("")`, which returns `null` (the empty string is
malformed too), so the guard collapsed and the request returned `unavailable`
without ever reaching the database.

**Impact.** Unknown, expired, revoked and carrier-released tokens answer
`expired`; a malformed one answered `unavailable`, and
`/driver/update/[token]` renders those as different cards — so the shape of
the input was observable in the response, against §13's non-enumerability
requirement and against M-76's own documented claim that all five refusals are
identical. Worse, the malformed path skipped
`shipment_driver_token_access` entirely: a scripted scan of garbage tokens was
invisible to §26's `repeated_invalid_tracking_attempts` counter and spent no
rate-limit budget.

**Fix.** `decoyDriverTokenHash()` — a well-formed, keyed digest of a constant
that no minted token can equal — restores the unconditional RPC call. M-73's
`DECOY_ACCESS_HASH` pattern, applied to the second credential in the system.

**Found by** the new identical-refusal assertion on its first run:
`payloads differed: {"ok":false,"code":"expired"} | … | {"ok":false,"code":"unavailable"}`.

### 12.2 The staff document-download action had no scope check

`getStaffDocumentUrlAction` calls `resolveStaffActor()` rather than
`resolveShipmentAccess()`, which every other §14 action calls first — so a
dispatcher could mint a 300-second signed URL for **any** shipment's document,
including one outside their scope. M-77's doc named dispatcher scoping as
query-level without noticing that this path had no query-level control either.

**Fix.** 0030's restrictive policy on `shipment_documents`. The action reads
the row through the cookie-bound client, so the row is now invisible and the
shared `"Document not found."` is the answer — identical to a nonexistent id.

---

## 13. Enumeration audit

| Surface | 404-vs-403 | Error text | Timing | Redirect | Verdict |
|---|---|---|---|---|---|
| `/track` | POST action, no URL | ONE refusal for six internal outcomes, asserted byte-identical as serialized JSON | 350 ms floor + unconditional decoy comparison | none | Clean |
| `/portal/{shipper,carrier,broker,admin}/shipments/[id]` | `notFound()` for malformed / unknown / another tenant's / out-of-scope | one shared message per surface | — | none | Clean |
| `/driver/update/[token]` | one card for five reasons | — | — | none | **Defect 12.1 — fixed** |
| M-75 tracking-number search | zero results, identical to "does not exist" | — | — | none | Clean; DB-backed since 0030 |
| Document downloads ×4 | one `"Document not found."` | shared constant | — | none | **Defect 12.2 — fixed** |

The `/track` assertion is `new Set(serialized payloads).size === 1` across six
refusal classes — unknown number, wrong second factor, admin-suspended
tracking, malformed number, impossible year, empty second factor. Three
companions prove the ledger still records the **true** outcome for each, that
the attempted second factor is stored in no form at all (value-level sweep
over the whole table), and that an unconfigured environment answers a known
and an unknown number identically.

---

## 14. Test counts

```
$ npm run typecheck && npm run lint && npm run build   # clean, 388 pages
$ npm test                    → 1488 unit  (51 files)
$ npm run test:rls            → 806 RLS assertions
$ npm run test:integration    → 354 integration
$ npx playwright test         → 360 e2e
```

RLS 742 → 806, integration 329 → 354, unit 1468 → 1488. E2E and page count
unchanged: M-83 adds no surface a browser can reach.

### Anti-vacuity

**Ten injections**, each written after the assertion it was meant to break,
each confirmed to fail loudly, each removed. The full table is M-83 §8.
Summarised: neutralising the shipments scope policy, halving the scope
predicate, granting the financial columns back, restoring UPDATE, un-scoping
the SECURITY DEFINER accessor, removing the accessor's audience clause,
leaking `margin` through the public DTO, spreading the row over the DTO,
un-scoping the document policy, and adding a `hint` field to the public
refusal — all caught, by name.

One injection **failed to fail** and is recorded as such: returning a fresh
refusal object instead of the frozen constant changed nothing, because the
assertion compares serialized payloads rather than object identity. That is
the assertion measuring the right thing.

---

## 15. Residual risks

The tracking system's residual risks are **not** listed here. They are
consolidated — with §7's R-1…R-8 folded in — into a single ledger in
[`docs/modules/M-83-tracking-security.md`](modules/M-83-tracking-security.md)
§9, as **RL-1 … RL-13**, each with a severity and the specific thing that
would close it. Duplicating them here would recreate exactly the per-module
drift M-83 exists to end.

The three that most affect a production launch:

* **RL-3** (High) — RLS is not AAL-aware. A stolen AAL1 staff token still
  passes `is_staff()`. M-61's R-1, unchanged; it needs a live project.
* **RL-4** (Medium) — both database lanes run on local PG16 with a shim. 806
  policy and privilege assertions are proved; JWT claim shapes, storage
  policies and PostgREST behaviour are not.
* **RL-9** (Medium) — storage object policies are applied but never exercised;
  no lane has object storage.

---

## 16. What still requires a live environment

Items 1–7 of §8 stand. M-83 adds three:

8. **That `service_role` retains its grants on `shipments`** after 0030's
   revoke. Reasoned, not asserted (RL-5). Fails loudly if wrong.
9. **That PostgREST surfaces a column-privilege refusal as a 401/403 body
   rather than leaking the column name** in a way that is itself informative.
   The refusal is identical for every id, so it is not an existence oracle
   either way — but the exact wire shape is Supabase's.
10. **That the restrictive policies do not regress staff query plans** at
    production row counts. `dispatcher_may_see()` probes `carriers` once per
    row; 0005's `assigned_dispatcher_id` index is the mitigation and 0030
    raises if it is ever dropped.

---

## 17. Dependency advisories

The stack is locked (see `README`), so a published advisory against a
transitive dependency is remediated through the `overrides` block in
`package.json` rather than by upgrading the package that pulled it in. That
mechanism already carried `postcss` and `sharp`; this is the third entry.

### GHSA-2v37-7h3g-55p8 — `nanoid` < 3.3.18 (High) — REMEDIATED 2026-08-13

**Dependency path.** Not a direct dependency:

```
pickloads
└─┬ @tailwindcss/postcss@4.3.3
  └─┬ postcss@8.5.25          ← already pinned by an existing override
    └── nanoid@3.3.17         ← vulnerable
```

**The advisory.** `nanoid`'s custom-alphabet generator can loop indefinitely
when called with a size of zero.

**Exposure here: none at runtime.** The path is build tooling — PostCSS uses
`nanoid` while compiling CSS, it is a `devDependency` subtree, and no
application code calls it. Nothing in `src/` imports `nanoid`, directly or
transitively, and it is not in the browser bundle. The remediation is
therefore about keeping the audit gate honest rather than about closing a
reachable hole — which is the point of holding the gate at zero: a real
advisory should not have to be spotted among a list of accepted ones.

**Remediation.** `"nanoid": "^3.3.18"` added to `overrides`. Same major, one
patch release, and the version was confirmed published before pinning.

**Blast radius, measured rather than assumed.** `npm install` regenerated the
lockfile and the entire diff is three lines:

```
package-lock.json | 6 +++---
-      "version": "3.3.17",
+      "version": "3.3.18",
```

No other package moved. `npm audit` → **0 vulnerabilities**; the installed tree
resolves `nanoid@3.3.18`.

**Timing worth recording.** `npm audit` returned 0 twice on 2026-08-12 and
reported this on 2026-08-13, so the advisory published inside a day. The gate
catching it the next morning is the mechanism working, not a lapse.
