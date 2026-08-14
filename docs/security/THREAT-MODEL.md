# PickLoads — Threat Model

Nine principals. For each: what it can reach, what it must never reach, and
the control that actually stops it. "Control" means a mechanism, not an
intention — if the only thing standing between a principal and an asset is a
hidden button or a comment, it is listed as a gap, not a control.

**Trust boundaries.** Browser → Vercel edge (middleware) → RSC/server action →
Postgres (RLS) → Supabase Storage. Every boundary re-authorises; none inherits
a decision from the layer above it.

---

## 1. PUBLIC / ANONYMOUS

**Reaches:** marketing pages, `/track` (two-factor), public forms, `/login`,
newsletter confirm/unsubscribe, `robots.txt`, `sitemap.xml`, `posts` (published).

**Must never reach:** any row of `profiles`, `carriers`, `shippers`,
`documents`, `shipments`, `invoices`, `loads`, `audit_events`,
`webhook_events`, `support_*`, `staff_invites`; any storage object; any
shipment detail without both factors.

**Controls:** RLS on all 49 tables (anon reads verified to return 0 rows on
every sensitive table — see audit §7); **no anon INSERT policy anywhere** —
public writes go through server actions holding the service-role key, gated by
Zod + Turnstile + rate limit; `carrier-docs` is a private bucket.

**Abuse paths considered:** tracking-number enumeration (two factors +
constant-time compare + single refusal message + access ledger); form spam
(Turnstile + per-IP bucket); open redirect via `?next=` (`safeNext` rejects
absolute and `//` protocol-relative); credential stuffing (see gap below).

**Residual gap:** `/login` and `/forgot-password` carry **no Turnstile**, and
the rate limiter fails open (SEC-P2-03).

---

## 2. CARRIER

**Reaches:** own carrier org — profile, trucks, drivers, documents, loads,
invoices, agreements, notifications, support threads; own shipments.

**Must never reach:** another carrier's anything; shipper margins; broker
grants; dispatcher/admin surfaces; `company_settings` writes.

**Controls:** `my_carrier_ids()` — `SECURITY DEFINER`, `search_path` pinned —
scopes every policy. Membership via `carrier_memberships`, never a
client-supplied id. Column privileges (migration 0030) keep restricted
financial fields out of reach even where the row is visible.

**Abuse paths:** horizontal IDOR by swapping a carrier id (policy scopes by
membership, not by parameter); mass assignment on profile edit (Zod strips
unknown keys server-side); privilege escalation via `profiles.role` (no
policy permits a self-role write — probe returned 0 rows).

---

## 3. SHIPPER

Symmetric to CARRIER via `my_shipper_ids()`. Additionally must never see
carrier pay, dispatch fees, or broker margin on a shared shipment — enforced
by `src/lib/shipments/restricted-fields.ts` plus column privileges, not by
template omission.

---

## 4. BROKER PARTNER

**Reaches:** only shipments explicitly granted through
`broker_shipment_grants`.

**Must never reach:** ungranted shipments; the grant table itself as a writer;
any admin surface.

**Controls:** `my_broker_partner_ids()`; grants are staff-issued rows, and the
partner has no INSERT/UPDATE path to them. Brokerage being inactive does not
loosen this — the gate is independent of the grant model.

---

## 5. DISPATCHER (staff)

**Reaches:** shipments in scope, the board, carrier/shipper operational
records, support, CRM leads.

**Must never reach:** admin-only operations — role changes, staff invites,
`company_settings` writes, brokerage gate.

**Controls:** `is_staff()` plus the migration-0030 dispatcher scope policies
and column privileges. Vertical escalation to admin is a distinct policy set,
not a UI condition.

---

## 6. ADMIN (staff)

**Reaches:** everything a session can reach, including `company_settings` and
role management.

**Must never:** obtain the service-role key, or act without an audit record on
security-relevant operations.

**Controls:** admin is still an _authenticated Postgres session under RLS_ —
it is not the service role. `audit_events` is append-only.

**Accepted risk:** a compromised admin is a serious event by construction. The
mitigation is detection and response (`INCIDENT-RESPONSE-PLAN.md`), not
prevention.

---

## 7. SERVICE ROLE

**Treated as a root credential.** Bypasses RLS entirely.

**Controls:** referenced in exactly one module (`src/lib/supabase/admin.ts`),
which imports `server-only` — a build-time failure if a client component ever
pulls it in. There is **no generic proxy endpoint** that lets a user-supplied
table/filter reach it: every use is a named server action with its own schema
and its own authorisation check. Never serialised into HTML, never logged
(observability denylist includes `service_role`).

---

## 8. CRON

**Reaches:** `/api/cron/daily`, `/api/cron/notifications`, as the service role.

**Controls:** `Authorization: Bearer ${CRON_SECRET}` compared with
`timingSafeEqual`; 401 on mismatch, 503 when unset (fails closed, does no
work). Response bodies carry counts only, never customer data.

**Abuse paths:** unauthenticated invocation (blocked); timing oracle on the
secret (constant-time compare); replay (jobs are idempotent or bounded).

---

## 9. WEBHOOK PROVIDERS (Stripe, Dropbox Sign)

**Controls:** Stripe — `constructEventAsync` signature verification, then a
`(provider, event_id)` unique constraint for idempotency; 503 when
unconfigured. Dropbox Sign — HMAC-SHA256 over `event_time + event_type` with
`timingSafeEqual`.

**Known weakness:** the Dropbox Sign signature **does not cover the payload**.
Forged-payload replay is currently blocked only as a side effect of the
idempotency key being derived from the signed fields, and the same derivation
causes a silent drop on same-second collisions. See audit SEC-P2-02.

---

## Assets, ranked

1. `SUPABASE_SERVICE_ROLE_KEY` — full data access.
2. Carrier documents (W-9, COI, voided check) — PII + financial.
3. `PII_ENCRYPTION_KEY` — decrypts stored EIN/bank fields.
4. Auth sessions, especially staff.
5. Shipment commercial data — rates, margins, fees.
6. `company_settings` — the brokerage gate is a _regulatory_ control, not a
   feature flag: flipping it early would advertise brokerage without an active
   MC and bond.
