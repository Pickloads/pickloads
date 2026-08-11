# M-81 — Broker-Partner Access

**Status:** ✅ Complete · **Phase:** C (tracking completion) · **Date:** 2026-08-06

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase C module table, row M-81 —
*"Broker-partner access: admin-invited only, org-scoped, explicit allow/deny
permission lists per §12"* — plus the plan's §4 **restored requirement**,
*"§12's broker permission allow/deny lists"*, which the extension audit
dropped, and §9.3's *"the skill's broker checklist … is the field list for
broker-partner onboarding"*.

Authority: `docs/DIRECTIVE-tracking.md` **§12 in full** (the spec), §3 (*"Do not
allow public self-registration as a broker partner without admin approval"*),
§19 (*"Broker A cannot view Broker B's shipment"*, *"only shipments explicitly
linked to their broker organization **and permitted by sharing policy**"*), §16
(the document band), §22, §23, §24, §25, §30.

Migrations **0028** (one statement) and **0029**. 0001–0004 frozen and
untouched; 0005–0027 untouched entirely — 0018's helper is REPLACED in 0029
(`create or replace`), which is an extension of M-71's file, not an edit to it.

---

## What §12 asked for, and where each clause lives

| §12 clause | Where it is enforced |
|---|---|
| *"invited by an admin"* | `broker_partner_invites` (0029) + `createBrokerInviteAction` / `acceptBrokerInviteAction`. Hashed, single-use, expiring, revocable. **The only path to `role = 'broker'`.** |
| *"verified"* | `broker_partners.verification_status` (0029) + `verify_broker_partner()`. Required by `my_broker_partner_ids()`, so **every** policy inherits it. |
| *"attached to a broker organization"* | `broker_partner_memberships` (M-71) — untouched. |
| *"granted access shipment by shipment"* | `broker_shipment_grants` (0029). |
| *"or account agreement"* | `broker_account_agreements` (0029). |
| MAY see (six items) | `BROKER_MAY_SEE` + `BROKER_FIELD_POLICY` + `DOCUMENT_AUDIENCES` (M-77) + the `public` / `broker` event bands (M-70). |
| MUST NOT see (six items) | `BROKER_MUST_NOT_SEE` + `BROKER_DENIED_SOURCES`, each pinned to the migration that enforces it. |

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0028_broker_role_value.sql` | **One statement**: `alter type user_role add value if not exists 'broker'`. |
| `supabase/migrations/0029_broker_partner_access.sql` | 1 enum, 8 columns on `broker_partners`, 3 tables, 7 indexes (2 partial-unique), 1 trigger, 2 `security definer` functions, `my_broker_partner_ids()` **narrowed**, 4 new policies + 5 table policies, column-level grants. |
| `src/lib/shipments/broker-permissions.ts` | **The allow/deny lists as data.** `BROKER_FIELD_POLICY` is a full `Record<keyof ShipmentRow, …>`; a new column does not compile until it is decided. |
| `src/lib/shipments/broker-access.ts` | The partner's reads: membership state, the reachable-id resolution across §12's three shapes, list, detail, timeline, contacts, access basis. Cookie-bound client only. |
| `src/lib/validation/broker.ts` | Nine Zod schemas. **None has a `role`, `verification_status` or `active` field.** |
| `src/app/actions/broker-partners.ts` | Ten actions: create · verify/suspend · invite · revoke invite · **accept (public)** · grant shipment · revoke grant · create agreement · revoke agreement · list verified partners. |
| `src/app/[locale]/portal/broker/**` | The partner portal: list (home) + detail + a redirect for the dangling parent. |
| `src/app/[locale]/(auth)/broker-invite/[token]/page.tsx` | The one unauthenticated surface in the module. |
| `src/app/[locale]/portal/admin/brokers/page.tsx` | Admin: create, verify, invite, agreements. |
| `src/components/portal/BrokerShipmentShare.tsx` | §12's per-shipment grant, on the dispatcher's shipment page. |

---

## THE ALLOW / DENY TABLE

§12 states both lists in words. `src/lib/shipments/broker-permissions.ts` states
them as structures a compiler enforces and a test walks. This is the full table.

### MAY see — §12's six, and what serves each

| §12 | Served by |
|---|---|
| assigned shipments | `broker_can_read_shipment()` (0029): party link **or** live per-shipment grant **or** live account agreement |
| status | `BrokerShipmentDto.status` / `.status_key` |
| timeline | `shipment_events` in the `public` + `broker` bands (`AUDIENCE_EVENT_VISIBILITY.broker`) |
| POD | `DOCUMENT_AUDIENCES.pod` includes `broker` (M-77) |
| BOL, **when authorized** | `DOCUMENT_AUDIENCES.bol` includes `broker`; **the authorization IS the shipment link/grant/agreement** |
| approved contact channels | `shipment_parties` WHERE `public_contact = true` (0018 + 0029) |

### MUST NOT see — §12's six, and what refuses each

| §12 | Refused by |
|---|---|
| carrier's private packet | no broker policy on `carriers`, `documents`, `shipment_assignments`, `drivers`, `trucks`; `carrier_id` reaches the DTO as a **boolean** |
| carrier insurance records | `documents` (type `coi`) is carrier-membership + staff scoped only; insurance is not a `shipment_document` type at all |
| shipper billing | no broker policy on `invoices` / `freight_quotes`; `DOCUMENT_AUDIENCES.invoice` and `.quote` exclude `broker` |
| PickLoads commission | **both** `gross_shipper_amount` and `carrier_pay` denied — either one plus the other computes it |
| internal margin | `margin` is named by `toStaffDto` and no other serializer |
| unrelated shipments | `broker_can_read_shipment()` returns false; §19's broker-A-vs-broker-B proof |

### Every `ShipmentRow` column, decided

`BROKER_FIELD_POLICY` is a **full `Record`** over all 53 columns:
**42 allowed, 11 denied.** `tests/unit/shipment-broker-permissions.test.ts`
transcribes the expectation from the directive (never from the code) and walks
every cell, then re-checks it against the real `toBrokerDto` output.

**Allowed (42)** — `id` · `tracking_number` · `shipper_reference` ·
`po_number` · `status` · `completed_at` · `cancelled_at` ·
`cancellation_reason` · `created_at` · `updated_at` · `origin_company` ·
`origin_address` · `origin_city` · `origin_state` · `origin_zip` ·
`destination_company` · `destination_address` · `destination_city` ·
`destination_state` · `destination_zip` · `equipment` ·
`commodity_category` · `weight_lbs` · `pallets` · `distance_miles` ·
`pickup_appointment_at` · `delivery_appointment_at` · `estimated_pickup_at` ·
`estimated_delivery_at` · `eta_source` · `eta_confidence` · `eta_updated_at` ·
`delay_minutes` · `tracking_mode` · `location_visibility` · `current_city` ·
`current_state` · `current_latitude` · `current_longitude` ·
`last_location_at`, plus two that change shape:

| Column | Reaches the DTO as | Why |
|---|---|---|
| `delay_reason_public` | `delay_reason` | The broker payload has no other delay reason to disambiguate from — and `delay_reason_internal` is denied, so the name cannot become ambiguous by accident. |
| `carrier_id` | `carrier_assigned` (boolean) | §1 wants *"assigned carrier status"* visible; §12 forbids the carrier's private packet. A boolean answers the first without opening the second: the broker learns a truck is booked, not whose. |

**Denied (11)**

| Column | §12 clause (or the stated reason beyond it) |
|---|---|
| `gross_shipper_amount` | shipper billing |
| `carrier_pay` | **PickLoads commission** — M-70's rule restated: *"no financial field to the broker partner, not even `carrier_pay`"* |
| `margin` | internal margin |
| `shipper_id` | *beyond §12* — counterparty identity |
| `broker_partner_id` | *beyond §12* — counterparty identity. Their OWN id would be harmless; the same serializer runs for a shipment reached by GRANT, where the linked partner is somebody else entirely. A field that is safe on one row and a disclosure on the next is denied on all of them. |
| `dispatcher_id` | *beyond §12* — internal operations |
| `quote_id` | shipper billing |
| `load_id` | *beyond §12* — internal operations |
| `public_tracking_enabled` | *beyond §12* — internal operations |
| `delay_reason_internal` | *beyond §12* — internal operations |
| `public_access_hash` | *beyond §12* — the §4 secondary-verification credential, serialized for **no** audience including staff (M-70) |

The three "beyond §12" reasons are named as their own values
(`counterparty_identity`, `internal_operations`, `access_credential`) rather
than filed under a directive clause they do not belong to. A deny list whose
justifications are approximate is a deny list nobody can audit.

### Documents (§16's matrix, through §12's eyes)

Derived from M-77's `DOCUMENT_AUDIENCES` rather than restated — and pinned by a
test that asserts the derivation still yields exactly these three.

| Type | Broker |
|---|---|
| `bol` | **allow** (§12 "BOL, when authorized") |
| `pod` | **allow** (§12 names it outright) |
| `other` | **allow** — M-77's escape hatch, which defaults to `staff_only` per row |
| `quote` · `shipper_confirmation` · `invoice` | deny — §12 shipper billing |
| `rate_confirmation` | deny — §12 commission |
| `lumper_receipt` · `detention_documentation` · `delivery_receipt` | deny — §16 gives these to the two commercial parties, and a broker partner is neither |
| `claim` | deny — §16 "private claim review" |

### Off-`shipments` denials

`BROKER_DENIED_SOURCES` names ten sources, each with the **migration** that
refuses it, and each with a matching assertion in §7c/§16 of the RLS suite. A
TypeScript allow-list controls what a serializer emits and controls **nothing**
about what a hand-written query can fetch; only a policy does that.

---

## Why

### Why `user_role` grew a `broker` value after M-71 said it should not

M-71 wrote: *"`user_role` was deliberately NOT extended with a `broker` value …
every policy here keys off `broker_partner_memberships` + `broker_partners.
active`, never off `profiles.role` … for zero security gain."*

**That reasoning is still correct and still holds.** No policy anywhere reads
`profiles.role = 'broker'` — §16 of the RLS suite asserts it as a catalog fact
by scanning every policy expression. What the value buys is the thing M-71 had
no surface for:

* §12 requires broker partners to be *invited by an admin*, and M-58's invite
  idiom assigns a **role** server-side. An invitation that assigns no role
  cannot be the single door M-81 needs it to be.
* `portalHomeFor()` (M-54) routes on the role and nothing else. Without a
  value, an invited partner lands on `/portal/carrier`, is bounced by
  `requireCarrier` back to `portalHomeFor('broker')` → `/portal/carrier`, and
  round again. **A redirect loop is not a routing decision.**
* `requireCarrier` / `requireShipper` / `requireStaff` all redirect a
  non-matching role to its own home. Adding the value **tightens** those three
  gates for broker users rather than loosening anything.

The RLS suite proves both halves: brokers A/B/C in the fixtures keep the enum's
default role and still read their linked shipments (the role is immaterial),
while broker F carries `role = 'broker'` and reads nothing (the role grants
nothing). Neither claim is true on its own.

**0028 is one statement in its own file**, because PostgreSQL refuses to *use*
an enum value added in the same transaction — so a runner that wraps a
migration (`supabase db push`, the SQL editor, `psql -1`) would fail at 0029's
first mention of `'broker'`. Splitting it makes the chain runner-agnostic
instead of runner-lucky.

### Why verification is a column and not `active`

0017 already had `active` / `approved_by` / `approved_at`. §12 lists *"invited
by an admin"* and *"verified"* as two requirements, and the distinction earns
its keep in the ledger: `pending` (not looked at) is a different fact from
`rejected` (looked at, refused) and from `suspended` (was fine, is not now).
`active` stays the switch; `verification_status` is the decision. Both are
required, and `verify_broker_partner()` moves them together so a verified
organization with nobody's name against it is unrepresentable.

The rule lives inside **`my_broker_partner_ids()`**, replaced in 0029, for
M-71's own reason: one helper means an admin suspending an organization revokes
its access *everywhere* in one write, and a future policy cannot forget a rule
it cannot see.

### Why §12's two grant shapes are two tables

§12: *"granted access shipment by shipment or account agreement."* Collapsing
them would have meant either

* writing a grant row per shipment when an agreement is signed — which silently
  keeps granting after the agreement ends, because nothing links the rows to
  the agreement; or
* treating an agreement as a wildcard grant — which makes *"which shipments can
  this partner see?"* unanswerable without re-deriving the wildcard.

Both are the shapes §19's *"permitted by sharing policy"* exists to forbid.
`broker_account_agreements.shipper_id` is **NOT NULL** so the wildcard is
unrepresentable rather than merely unused.

`shipments.broker_partner_id` (M-71's floor) survives untouched as a third
shape. All three are OR'd inside **one** function, `broker_can_read_shipment()`,
so there is exactly one definition of "this broker may read this shipment" in
the database.

### Why M-71's policies were extended and not rewritten

0018 §3 says, of the broker shipment policy: *"M-81 layers per-shipment sharing
grants on top of this floor; it cannot widen it without a new policy that says
so."* 0029 adds four policies that say so — `"broker shared read shipments"`,
`… shipment events`, `… shipment parties`, `… shipment documents` — and leaves
0018/0019/0024's four exactly as written. Permissive policies OR together, so
the effect is *M-71's floor, plus §12's two sharing shapes, and nothing else*.
Every branch still runs through `my_broker_partner_ids()`, which is now
verification-gated, so **M-81 net-tightens the floor it extends.**

The RLS suite asserts the policy COUNT on `shipments` (5, not `>=`), so a sixth
is still a deliberate act.

### Why revocation is a column and not a DELETE

§15 wants an access history. A row that disappears when access is withdrawn
cannot answer *"who could see this shipment last March?"* — the question an
audit actually asks. Both grant tables carry `revoked_at` / `revoked_by` /
`revoke_reason`, a partial unique index enforces **one live grant per (shipment,
partner)**, and a re-grant after revocation is a NEW row, so the history is a
sequence rather than a column that keeps being overwritten.

### Why the broker list has no tenant predicate

Every other portal list adds `.eq("<tenant>_id", …)` beside the policy, for the
index and for EXPLAIN legibility. The broker list **cannot**: §12 gives three
routes in and only one of them is a column on `shipments`. Adding
`.eq("broker_partner_id", id)` would silently hide every shipment shared by
grant or agreement — a filter that looks like defence in depth and is actually a
bug. So the predicate is `.in("id", …)` over the ids the three policy-gated
reads already returned.

That trade is what made the **non-vacuity probe** necessary: with an
application-level id filter in front of the query, a policy that had lost its
`revoked_at is null` clause would still pass every module-level test. The
integration suite therefore re-issues the same query **without** the id
narrowing, and injection confirmed it: deleting that clause from 0029 fails
exactly that assertion while everything else stays green.

### Why the partner portal has one nav entry

§12 grants a broker partner a VIEW of shared shipments and nothing else. There
is no documents page (documents live on the shipment they belong to), no
billing page (§12 forbids it outright) and no company page — the organization is
administered by PickLoads, which is what "admin-invited only" means.

### Why the admin surface is admin-only but sharing is not

Deciding **who a counterparty is** — creating, verifying, inviting, signing a
standing agreement — is an account decision, and M-58 established that
dispatchers do not make account decisions. Sharing **this load** is an
operational act taken while looking at the load, and §14 makes the dispatcher
the operator. So `/portal/admin/brokers` is `requireAdmin`, and
`grantBrokerShipmentAction` / `revokeBrokerShipmentAction` go through
`resolveShipmentAccess` — which applies the §19 dispatcher scope, so a
dispatcher cannot share a shipment they could not open.

### Why sharing with an unverified partner is REFUSED rather than allowed

It would succeed and grant nothing (`my_broker_partner_ids()` filters the
organization out), leaving an operator believing the customer can see the BOL.
That is the worst available outcome, so both grant actions check
`verification_status` and refuse loudly, and the dropdown offers verified
partners only.

### The vetting fields, and what they are NOT

Plan §9.3: *"the skill's broker checklist (authority, bond, days-to-pay, MC age
<12 months + urgency = fraud pattern) is the field list for broker-partner
onboarding."* 0029 adds `dot_number`, `bond_provider`, `bond_amount_usd`,
`authority_since` and `days_to_pay` beside the existing `mc_number`.

**Nothing scores them.** The admin table surfaces "under 12 months old" as a
FACT next to the date, never as a verdict — §30 forbids implying an automated
judgement the product does not make. An admin reads the row and decides.

---

## The M-77 caveat, removed

M-77 shipped this note on the dispatcher document surface:

> *Broker partners linked to this shipment can be shown its BOL and POD once
> approved (§12). The partner portal itself is not built yet — the permission
> exists, the surface does not.*

It is **removed, not softened**. It is no longer true, and a stale hedge on an
operator screen is the same failure as a stale status on a customer one. The
replacement names the live behaviour and points at the sharing control directly
below it. `getBrokerDocumentUrlAction` — which M-77 shipped early, saying *"when
M-81 lands it calls this rather than writing a fifth copy of the same three
lines"* — is called, not re-implemented.

---

## DB changes

### Migration 0028 — `0028_broker_role_value.sql`

**Creates:** the `broker` value on `user_role`.

**ROLLBACK: there is none, and PostgreSQL is the reason** — an enum value
cannot be dropped. Reversing M-81 means rolling back 0029 (below) and demoting
every broker profile:

```sql
update profiles set role = 'carrier' where role = 'broker';
```

The unused value then sits inert in the type, referenced by nothing and read by
no policy. That is inconvenient, not dangerous: recreating the type would mean
rewriting `profiles.role` and `staff_invites.role` on shipped tables, which is
a far larger risk than the line it removes.

### Migration 0029 — `0029_broker_partner_access.sql`

**Creates:** enum `broker_verification_status`; 8 columns on `broker_partners`
(`verification_status` NOT NULL default `'pending'`, `verified_by`,
`verified_at`, `dot_number`, `bond_provider`, `bond_amount_usd`,
`authority_since`, `days_to_pay`) with a backfill marking every already-ACTIVE
organization verified (so deploying is access-neutral); tables
`broker_partner_invites`, `broker_shipment_grants`, `broker_account_agreements`;
7 indexes (2 partial-unique: one live grant per (shipment, partner), one live
agreement per (partner, shipper)); trigger
`trg_broker_account_agreements_updated_at`; functions
`broker_can_read_shipment(uuid)` (`authenticated`) and
`verify_broker_partner(uuid,uuid,boolean,text)` (**`service_role` only**);
**replaces** `my_broker_partner_ids()`; RLS + 5 policies on the three new tables
and 4 new SELECT policies on `shipments` / `shipment_events` /
`shipment_parties` / `shipment_documents`; `revoke all … from authenticated,
anon` then narrow grants — including a **column-level** grant on
`broker_partner_invites` that never names `token_hash`.

**No customer INSERT/UPDATE/DELETE policy exists on any of the three tables.** A
broker cannot invite themselves, verify themselves, grant themselves a shipment
or sign their own agreement — asserted five ways in §16 of the RLS suite.

**ROLLBACK** (full script in the migration header). Restore 0018's helper
**FIRST** or every broker policy in the chain fails on a missing function; then
drop the 4 sharing policies and the 5 table policies, the 2 functions, the 3
tables `cascade`, the 8 columns and the enum; finally demote broker profiles.
**Destructive at the table drop** — it removes the record of which shipments
were shared with which partner and under what agreement, so `pg_dump -t
broker_shipment_grants -t broker_account_agreements -t broker_partner_invites`
first. It fails **CLOSED**: with the tables gone a partner falls back to M-71's
floor (`shipments.broker_partner_id` only), which is less access, never more.

---

## Endpoints

**One new public route:** `/broker-invite/[token]` — the invite accept page.
Separate from M-58's `/invite/[token]` rather than a branch inside it: both take
a 64-hex token and both look it up by SHA-256 hash, but they read different
tables and mint different roles, and one route deciding which from the token's
shape is a route where a lookup miss on one table falls through to the other.

**Three new portal routes:** `/portal/broker` (the list, and
`portalHomeFor('broker')`), `/portal/broker/shipments/[shipmentId]` (detail),
`/portal/broker/shipments` (a redirect, so the dynamic route's parent is not a
404 a partner reaches by deleting an id off a URL). **One new admin route:**
`/portal/admin/brokers`.

**Ten server actions** in `src/app/actions/broker-partners.ts`. Nine are
admin- or dispatcher-gated; `acceptBrokerInviteAction` is public, IP
rate-limited on M-58's bucket pattern, and is the **only** path in the product
that can produce a profile with `role = 'broker'` — asserted by a unit test that
counts the `role: "broker"` literal in the file (exactly one) and locates it
inside that action.

## Env vars

**None required, and none added.** The invite email goes through M-60's
`sendEmail`, which is log-only without `RESEND_API_KEY`; the accept action
refuses honestly without `SUPABASE_SERVICE_ROLE_KEY` rather than half-creating
an account.

---

## Deployment

1. Apply **0028**, then **0029**, in that order and **as separate statements or
   separate files** — 0028 must COMMIT before 0029 names `'broker'`.
2. Deploy. Nothing changes operationally: `broker_partners` is empty in
   production, so the narrowed helper has nothing to narrow, and no profile
   holds the new role.
3. First partner: `/portal/admin/brokers` → **Add a partner organization**
   (record authority date, bond and terms) → **Verify** → **Invite** a user →
   the invitee accepts at `/broker-invite/<token>` → share a shipment from its
   dispatcher page, or record an account agreement.

**Order matters and the failure is loud**: an organization that is invited but
not verified reads nothing, and the portal says so rather than rendering an
empty table.

---

## Tests

| Lane | Added | Total | What it proves |
|---|---|---|---|
| unit | **63** | **1462** | The allow/deny matrix, cell by cell, transcribed from §12 and cross-checked against the real `toBrokerDto`; the SQL projections carry the same decision; §3's no-public-signup guarantee over the schemas public signup actually uses; the action file's gates, its single `role: "broker"` literal and its audit coverage; the five-locale catalogue; axe over the two portal components in eleven states across three locales. |
| RLS | **71** | **742** | §12's verification gate; both grant shapes; revocation and window expiry; **broker A vs broker B, re-run against the wider surface**; §12's deny list on the grant path; five ways a partner cannot grant itself anything; anon nothing; and catalog facts — the helper's two clauses read out of `pg_proc`, the policy count on `shipments`, and **no policy anywhere authorizing on `profiles.role = 'broker'`**. |
| integration | **34** | **329** | The real `src/lib/shipments/broker-access.ts` functions against the real schema as real sessions: an invited broker sees only linked shipments; broker A cannot read broker B's; an unverified broker sees nothing and becomes able to read the moment `verify_broker_partner()` runs — and stops again on suspend; revoked grant and expired/revoked agreement; no carrier packet, no billing table, no financial value in the payload; the invite token lifecycle (hash length, uniqueness, accepted-XOR-revoked CHECK, single use). |
| e2e | **13** | **283** | Every partner route session-gated in five locales, including the admin surface and four URL-manipulation shapes; the invite page renders, is `noindex`, offers no role or organization field, states §3 and §12's deny list; nothing in the sitemap; axe clean; no overflow at 320/390/768/1440. |

### Non-vacuity by injection

Three defects were injected, each failing a **different** lane, each removed:

| Injected | Failed |
|---|---|
| `carrier_pay` flipped from deny to allow in `BROKER_FIELD_POLICY` | **unit** — 4 assertions, including the key-set equality against the real DTO |
| the `verification_status = 'verified'` clause deleted from `my_broker_partner_ids()` | **RLS** — *"an ACTIVE but UNVERIFIED organization grants nothing"* |
| `revoked_at is null` deleted from `broker_can_read_shipment()`'s grant branch | **RLS** (*"brokerD sees exactly the 1 shipment GRANTED to it"*) **and integration** (*"NON-VACUITY: the POLICY refuses a revoked grant, not the app-level filter"*) |

The third injection is the reason the integration probe exists: on the first
attempt it passed, because `getBrokerShipmentSummary` narrows to a reachable-id
set before it queries and the application filter masked the policy. The probe
was added, the injection re-run, and it now fails exactly once.

### Fixture changes that were forced, and why

`my_broker_partner_ids()` is narrower, so **every existing broker fixture had to
state `verification_status = 'verified'` explicitly** — 0029's backfill runs
against an empty table at migration time and cannot reach a fixture loaded
afterwards. Three integration files and the RLS fixtures were updated; no
assertion was weakened. Count assertions moved where the new fixtures added
rows (profiles 11 → 15, shipments 2 → 3, shippers 2 → 3, events 7 → 9, documents
8 → 10, parties 3 → 5, locations 7 → 8, broker organizations 3 → 6), and each
label's wording was corrected alongside its number rather than left saying
"seven" next to an 8.

One shipped assertion was **inverted in place**: *"shipments still carries
exactly 4 policies … M-76 added none"* becomes 5, with the reason written beside
it. It is asserted as an equality rather than relaxed to `>=`, so a sixth
policy is still a deliberate act.

---

## Files

**New:** `supabase/migrations/0028_broker_role_value.sql` ·
`supabase/migrations/0029_broker_partner_access.sql` ·
`src/lib/shipments/{broker-permissions,broker-access}.ts` ·
`src/lib/validation/broker.ts` · `src/app/actions/broker-partners.ts` ·
`src/emails/BrokerInviteEmail.tsx` ·
`src/components/auth/AcceptBrokerInviteForm.tsx` ·
`src/components/portal/{BrokerShipmentListView,BrokerShipmentDetailView,BrokerPartnerAdminForms,BrokerShipmentShare}.tsx` ·
`src/app/[locale]/(auth)/broker-invite/[token]/page.tsx` ·
`src/app/[locale]/portal/broker/{page.tsx,shipments/page.tsx,shipments/[shipmentId]/page.tsx}` ·
`src/app/[locale]/portal/admin/brokers/page.tsx` ·
`tests/unit/{shipment-broker-permissions.test.ts,broker-portal-a11y.test.tsx}` ·
`tests/integration/broker-partner-access.test.ts` ·
`tests/e2e/broker-partner-access.spec.ts` · this doc.

**Changed:** `src/lib/auth.ts` (`portalHomeFor` + `requireBroker`) ·
`src/lib/memberships.ts` (`getMyBrokerPartnerId`) ·
`src/lib/supabase/database.types.ts` ·
`src/components/portal/PortalSidebar.tsx` ·
`src/components/portal/ShipmentDocumentReview.tsx` (**the M-77 caveat**) ·
`src/components/portal/ShipmentStaffDetailView.tsx` ·
`src/app/[locale]/portal/admin/shipments/[shipmentId]/page.tsx` ·
`messages/{en,es,fr,ru,ht}.json` (+37 `shipment.broker` keys ×5, +2 V4 keys ×5) ·
`supabase/tests/{10_fixtures,20_rls_isolation}.sql` ·
`tests/integration/helpers/psql-rls-supabase.ts` (`is(col, null)`, chainable
`limit`) · three integration files · `tests/unit/dispatcher-shipments-a11y.test.tsx` ·
`docs/modules/INDEX.md` · `docs/LAUNCH-RUNBOOK.md`.

---

## i18n (§24)

37 keys under `shipment.broker` in five locales. **es and fr are authored**;
**ru and ht MIRROR English and are FLAGGED pending native review**, which is
the convention M-79 recorded and M-42/M-60 set. A unit test asserts the key
sets are identical across all five and that es/fr do not simply repeat the
English body copy.

Two V4 sidebar labels (`partner_portal`, `shared_shipments`) were added to the
`v4` namespace in all five locales; `useV4` falls back to the English literal
for anything missing, so the labels degrade rather than render a key.

**The admin surface stays English**, per M-58's and M-77's scope decision: the
operator portal is one language while `/track`, the three customer portals and
the driver link are five, and mixing the vocabularies in one file is how a
`t()` ends up in a component the admin layout renders without a provider.

---

## Residual risks

- **R-1 (inherited from M-71).** RLS is row-level, so a hand-written query by a
  broker session against a shipment it CAN read still returns that row's
  financial columns. The integration suite **asserts this openly** rather than
  hiding it, and it is why `BROKER_DETAIL_COLUMNS` never names them and why
  `toBrokerDto` is an allow-list. Column-level protection is M-83's.
- **R-2.** `getBrokerShipmentIds` bounds the reachable set at
  `BROKER_REACHABLE_LIMIT = 500`. A partner with more than 500 shared shipments
  sees the newest 500 and an honest notice; the list does not silently
  truncate. A keyset resolution over the union is the fix when it matters.
- **R-3.** `getBrokerAccessBasis` reads `shipments.shipper_id` — a column
  `BROKER_FIELD_POLICY` denies — to match a shipment against the partner's own
  agreements. The value never enters a payload (`BrokerAccessBasis` has no field
  that could carry it) and the alternative was one query per live agreement,
  which is §25's N+1. Named here rather than left for a reader to find.
- **R-4.** Dispatcher scoping on the sharing actions is query-level
  (`resolveShipmentAccess` → `staff-scope.ts`), inheriting M-71's R-2. A
  restrictive policy is M-83's scope.

---

## Extension points

- **A second membership per user.** `getMyBrokerPartnerId` returns the first
  organization, matching M-57's single-company-UI-at-launch doctrine. A partner
  belonging to two organizations needs an org switcher and a `partnerId` in the
  route, and nothing below the page layer changes — every read already takes
  the id as a parameter.
- **Notification audience.** `notification-rules.ts` says *"M-81's broker
  audience … added by"* — the recipients resolver can now key off
  `broker_partner_memberships` for a verified organization. Deliberately not
  done here: §17's eleven events are the CUSTOMER's, and telling a partner
  about a delay before the shipper hears it is a business decision, not an
  engineering one.
- **A partner support thread** would reuse M-89's guest-ticket work (D-5), not
  `support_threads`, whose `profile_id` is NOT NULL against a shipper/carrier
  assumption.
- **M-82** owns the 12 breakpoints; both partner components use the audited
  `.ptable--cards` transform and stack at 640px today.
- **M-83** owns the restrictive dispatcher policies and column-level financial
  protection — R-1 and R-4 above.
- **M-88's carrier reviews** must never reach this audience: add the table to
  `BROKER_DENIED_SOURCES` in the same commit that creates it, and the RLS suite
  will want an assertion beside the existing ten.
