# M-83 — RLS, security and public-enumeration audit

**Phase:** C (tracking completion) · **Plan:** `docs/FINAL-IMPLEMENTATION-PLAN.md`
§7 · **Directive:** `docs/DIRECTIVE-tracking.md` §§4, 19, 20, 25
**Migration:** `0030_dispatcher_scope_and_column_privileges.sql`
**Baseline:** M-82 (`a275611`)

---

## 1. What this module is

The plan's scope line is *"RLS + security: **all 7** proofs (incl. dispatcher
scoping), enumeration audit, public-DTO key-set tests, financial-write
rejection, token expiry/revocation"*, and §4 of the plan restores one row in
particular:

> **§19 test 6 of 7 missing: *dispatcher permissions are limited* — the one
> proof the architecture cannot currently pass is the one dropped.**

That sentence is the module. Six of §19's seven proofs have been provable
since M-71…M-81; the seventh could not be proved because it was not true at
the database — `"staff manage shipments"` says `is_staff()`, which does not
distinguish a dispatcher from an admin, so dispatcher least-privilege lived
entirely in `src/lib/staff-scope.ts`. M-71 recorded that as **R-2** and five
later modules inherited it. M-71 also recorded **R-1**: RLS is row-level, so
the three §18 financial columns were in the PostgREST payload of any row a
customer could read.

M-83 does not carry either one forward. It closes both in the schema, proves
all seven §19 proofs, audits the enumeration surface adversarially, adds
route-level public-DTO key-set tests, and consolidates every residual risk
M-71…M-82 raised into **one** ledger (§9).

**Two defects were found and fixed** (§6), one of them a live
non-enumerability failure on the driver credential.

---

## 2. §19's seven proofs — the evidence table

Each row names the proof, the mechanism that makes it true, and the assertion
that would fail if it stopped being true. "Genuine" means the proof holds at
the layer the directive is about; where it does not, the row says so.

| # | §19 proof | Mechanism | Evidence | Genuine? |
|---|---|---|---|---|
| 1 | Shipper A cannot view Shipper B's shipment | 0018 `"shipper member read shipments"` scoped by `my_shipper_ids()` | RLS §7a (`shipperA cannot select shipperB shipment`, + by tracking number, + parties, + assignments); roll-call `1/7`; `tests/integration/shipper-shipments.test.ts` through the real reader | **Yes — database** |
| 2 | Carrier A cannot view Carrier B's shipment | 0018 `"carrier member read shipments"` scoped by `my_carrier_ids()` | RLS §7b + §12 (documents) + §14 (ETA/exceptions) + §15 (notifications) + §16; roll-call `2/7`; integration `§13 — no access to other carrier records` | **Yes — database** |
| 3 | Broker A cannot view Broker B's shipment | 0029's four `"broker shared read …"` policies + `my_broker_partner_ids()` (active **and** verified) | RLS §7c + §16 (`§19 RESTATED`); roll-call `3/7`; `tests/integration/broker-partner-access.test.ts` | **Yes — database** |
| 4 | Public tracking cannot expose private fields | **No anon policy exists on any shipment table** (so there is no anonymous read to filter), plus 0030 §4 revoking every privilege `anon` held, plus M-73's strict DTO | RLS §7e + roll-call `4/7`; **`tests/unit/shipment-public-dto-routes.test.ts`** (exact key sets + structural route scan, 20 assertions); **`tests/integration/tracking-security.test.ts` §1** — the real action, the real database, a row carrying seven sentinels, key set compared exactly and the whole payload swept for values | **Yes — database + route** |
| 5 | Carrier users cannot edit financial fields | **0030 §4**: `revoke all on shipments from authenticated, anon`, then `grant select (…)` naming neither `gross_shipper_amount`, `carrier_pay`, `margin` nor `public_access_hash`. Not the absence of a policy — a **column privilege**, checked in addition to RLS | RLS §7a/§7b/§7c (`42501` on read *and* write) + §17f catalog facts + roll-call `5/7`; integration `§19 PROOF 5` (five roles × direct UPDATE, three roles × direct SELECT, the RPC signatures, the single writer) | **Yes — database** |
| 6 | **Dispatcher permissions are limited** | **0030 §2**: 14 RESTRICTIVE `for all` policies keyed on `staff_scope_ok()`, plus **0030 §3** narrowing the one SECURITY DEFINER function a restrictive policy cannot reach | RLS §17a–§17e (read, write, both scope arms, the mirror case, an unscoped admin as the non-vacuity control, catalog shape) + roll-call `6/7`; integration `§19 PROOF 6` through `getStaffShipment`, the §5 search and the document row | **Yes — database.** See §4 for what remains query-level and why |
| 7 | Unauthorized status transitions fail | M-72's engine (47 edges, 7 preconditions, 17 impossible pairs, actor gate) + `apply_shipment_transition`'s compare-and-swap + 0030 §4 (no browser session may write `status` at all) | `tests/unit/shipment-transitions.test.ts`; `tests/integration/shipment-lifecycle.test.ts`; RLS roll-call `7/7` | **Yes — engine + database** |

`supabase/tests/20_rls_isolation.sql` §17g is a **roll-call**: seven
assertions, one per proof, in one place, so a reader can see all seven pass or
fail together. It does not replace the detailed proofs in §7, §8, §12, §14,
§15, §16 and §17a–§17f — it anchors them.

---

## 3. Migration 0030, section by section

### §1 — the scope helpers

Four SECURITY DEFINER, STABLE functions with pinned `search_path`:

| Function | Answers |
|---|---|
| `is_dispatcher()` | The one thing `is_staff()` deliberately cannot tell you |
| `dispatcher_may_see(dispatcher_id, carrier_id)` | The **two-arm** scope: own shipment **or** assigned carrier |
| `staff_scope_ok(dispatcher_id, carrier_id)` | `not is_dispatcher() or dispatcher_may_see(…)` — the restrictive predicate |
| `shipment_in_staff_scope(shipment_id)` | The same question for a child table |

**Why two arms.** `carriers.assigned_dispatcher_id` (M-58) is the existing
least-privilege key, and it is the right one for freight already covered. But
§6's first four statuses have **no carrier at all**, so a carrier-only rule
would hide from a dispatcher every shipment they are sourcing a truck for —
including the ones they created. `dispatcher_id` is the arm that makes "Needs
Carrier" a workable column. This is `shipmentScopeExpression()` restated in
SQL, not a second rule: an injection that removes either arm fails a named
assertion (§8, injection 2).

**Why EXECUTE goes to `anon` as well.** A restrictive policy is evaluated for
every role that reaches the table. An anon caller refused with *"permission
denied for function staff_scope_ok"* instead of "no rows" would be a **new**
oracle, not a control — 0013's precedent, applied deliberately.

`shipment_restricted_fields()` (§5) is the exception: it is never reached by a
policy evaluation, so `anon` has no business executing it and does not.

### §2 — 14 RESTRICTIVE policies

PostgreSQL ORs permissive policies and ANDs restrictive ones on top. One
restrictive policy therefore constrains **every** existing policy on a table
at once — including the `"staff manage …"` ones — without editing any of them
and without widening anything. That is what made this available now when
M-71/M-75 judged it unavailable: no shipped policy is touched.

`for all`, not `for select`, with `with check` as well as `using`: §19 is
about *permissions*, and a scoped read with an unscoped write is not a limit.

Tables: `shipments`, `shipment_parties`, `shipment_assignments`,
`shipment_events`, `shipment_documents`, `shipment_eta_history`,
`shipment_exceptions`, `shipment_locations`, `shipment_driver_tokens`,
`shipment_notification_queue`, `tracking_provider_connections`,
`broker_shipment_grants`, plus the **two enumeration ledgers**.

**The ledgers are the deliberate exception**, and it is the one judgment call
in the migration. `shipment_tracking_access` and
`shipment_driver_token_access` record MISSES as well as hits, and a miss has
no shipment by definition (both columns are nullable for exactly that). A bare
`shipment_in_staff_scope(shipment_id)` evaluates NULL → false and would hide
every failed lookup from every dispatcher — blinding the operators watching
for the attack the tables exist to detect. So the predicate is
`shipment_id is null or shipment_in_staff_scope(shipment_id)`: unattributed
attempts stay visible to all staff, attempts against a *specific* shipment
follow that shipment's scope. Two assertions pin both halves.

`invoices` also carries a `shipment_id` (0021) but is M-31 billing under
0008's own staff policy, outside §19's tracking scope. Named in the ledger
(§9, **RL-6**) rather than silently included.

### §3 — the function a restrictive policy cannot reach

`my_shipment_exceptions()` (0025) is SECURITY DEFINER, so RLS — restrictive
policies included — does not apply inside it. Its `is_staff()` arm was an
unscoped read of any shipment's exceptions for any dispatcher. Replaced with
`is_staff() and staff_scope_ok(…)`. The customer arms are byte-identical to
0025's.

A catalog sweep confirmed this was the **only** such function: one
SECURITY DEFINER function in `public` mentions `is_staff()`, and the other
definer functions executable by `authenticated` are all customer-scoped.

### §4 — column privileges on `shipments` — R-1, closed

```sql
revoke all on public.shipments from authenticated, anon;
grant select (…49 operational columns…) on public.shipments to authenticated;
```

M-76 proved the shape on `shipment_driver_tokens.token_hash`; the order is
load-bearing (a table-level SELECT overrides a column-level revoke, so the
table grant has to go first).

M-71's R-1 said this was unavailable because staff run on the *authenticated*
session too, and Postgres cannot distinguish staff from customer at the GRANT
level. That diagnosis is correct. The resolution is not a cleverer grant: it
is to take the four columns **away from the table** for every browser role and
hand three of them back through an accessor that applies the audience rule in
SQL. **Two call sites** needed changing, both server-side.

| Column | Why it is gone |
|---|---|
| `gross_shipper_amount`, `margin` | §18 staff-only. No customer serializer named them; now no customer **role** can |
| `carrier_pay` | §18 staff-only, with M-70's one deliberate crossing (the hauling carrier sees their own contract rate). That crossing now happens in `shipment_restricted_fields()`, where the rule is written down, instead of in a projection string |
| `public_access_hash` | §4's second factor. M-70: *"a CREDENTIAL, not data."* Every projection already omitted it; now the privilege does |

**Writes.** `authenticated` and `anon` lose INSERT/UPDATE/DELETE on
`shipments` outright. Nothing in `src/` writes this table through a browser
session — every write is an 0019/0022 SECURITY DEFINER RPC or a service-role
client, including the sole `.update()` (§14's dispatcher reassignment, which
uses `tryCreateAdminClient()`). So §19's proof 5 stops being *the absence of a
policy* — a fact one `for all` policy written in 2027 could erase everywhere
at once — and becomes a catalog fact that survives any policy anyone writes
later.

`anon` now holds **no privilege of any kind** on `shipments`. It never had a
policy; the grant it held was dead weight that only RLS was standing on.

### §5 — `shipment_restricted_fields()`

One row, or none:

| Caller | Gets |
|---|---|
| staff, in dispatcher scope | all four |
| the hauling carrier | `carrier_pay` only; three nulls |
| anyone else | **no row at all** |

The "no row" arm is not cosmetic: a caller who may not see the shipment must
not learn that it exists, so an out-of-scope dispatcher and a shipper both get
an empty result rather than a row of nulls — which would have been an
existence oracle sitting behind a privacy control. Asserted in both database
lanes.

`src/lib/shipments/restricted-fields.ts` is its only reader. Failure is empty,
never loud: a missing row and an error both resolve to `NO_RESTRICTED_FIELDS`,
so a page renders "—" for a rate it could not read rather than 500ing.

---

## 4. What is still query-level, stated unambiguously

The task's requirement was: implement restrictive policies **or** prove it at
the layer where it holds *and* state plainly that a compromised dispatcher
session bypasses it at PostgREST. M-83 took the first option, so the plain
statement is now much shorter — but it is not empty.

**Closed at the database (a compromised dispatcher access token used directly
against PostgREST is refused):** `shipments`, `shipment_parties`,
`shipment_assignments`, `shipment_events`, `shipment_documents`,
`shipment_eta_history`, `shipment_exceptions`, `shipment_locations`,
`shipment_driver_tokens`, `shipment_notification_queue`,
`tracking_provider_connections`, `broker_shipment_grants`, both enumeration
ledgers (for attributed rows), and `my_shipment_exceptions()`.

**Still query-level only, and therefore bypassable by a compromised dispatcher
token at PostgREST:**

| Surface | What a stolen dispatcher token still reaches | Ledger |
|---|---|---|
| `carriers`, `documents`, `loads`, `trucks`, `drivers`, `invoices`, CRM tables | Everything, as since 0002. `src/lib/staff-scope.ts`'s `carrierIds` filter is the only control | **RL-2** |
| `shipment_tracking_access` / `shipment_driver_token_access`, rows with `shipment_id is null` | All of them — deliberate (§3 above) | **RL-7** |
| `invoices` rows carrying a `shipment_id` | All of them (0008's staff policy) | **RL-6** |

The tracking directive's §19 is about shipments, and shipments are closed.
The rest is M-58's original scope and is named here rather than left implied.

---

## 5. Enumeration audit

M-73 built the two-factor lookup, the decoy HMAC, the 350 ms timing floor and
the access ledger. This is the adversarial re-audit now that six more modules
have added surfaces.

### 5.1 What was probed

| Surface | 404-vs-403 shape | Error text | Timing | Redirect target | Verdict |
|---|---|---|---|---|---|
| `/track` (M-73) | n/a (POST action) | ONE refusal for six internal outcomes — asserted **byte-identical** as serialized JSON | 350 ms floor, unconditional decoy comparison | none (no URL is created) | Clean |
| `/portal/shipper/shipments/[id]` | `notFound()` for malformed id, unknown id, and another tenant's id | n/a | n/a | none | Clean |
| `/portal/carrier/shipments/[id]` | same | `SHIPMENT_MISSING_MESSAGE` for every case | n/a | none | Clean |
| `/portal/broker/shipments/[id]` (M-81) | same, incl. unverified partner | n/a | n/a | none | Clean |
| `/portal/admin/shipments/[id]` | `notFound()` incl. out-of-scope | n/a | n/a | none | Clean (and now DB-backed) |
| `/driver/update/[token]` (M-76) | one card for five refusal reasons | — | — | none | **DEFECT — fixed, §6.1** |
| M-75 tracking-number search | zero results for out-of-scope, identical to "does not exist" | n/a | n/a | none | Clean (and now DB-backed) |
| Document download actions ×4 | one `"Document not found."` for every failure | shared constant | n/a | none | **DEFECT — fixed, §6.2** |

### 5.2 Assertions added

`tests/integration/tracking-security.test.ts` §2 runs six refusal classes —
unknown number, correct number with the wrong second factor, admin-suspended
tracking, malformed number, impossible year, empty second factor — and asserts
**one distinct serialized payload** across all six. Not "similar": a
difference in one nullable field is an existence oracle, so the comparison is
`new Set(JSON.stringify(…)).size === 1`.

Three companions:

* the ledger still records the **true** outcome for each (indistinguishable to
  the caller, fully attributed to the operator — if it were indistinguishable
  to both, the control would be invisible during an incident);
* the ledger stores the attempted second factor in **no form at all**, swept
  at value level over the whole table after the probes have run (M-73's
  Attack 5, re-run);
* an **unconfigured environment** answers identically for a known and an
  unknown number, so "cannot verify" is not distinguishable from "wrong
  credential".

---

## 6. The two defects found

### 6.1 A malformed driver token was distinguishable (and free)

`redeemDriverToken` documented its own contract:

> *"A malformed token still calls the RPC — with a well-formed hash of the
> empty string, which cannot match any row. Short-circuiting on shape would
> make 'not a token at all' the fast path and leave the ledger blind to
> exactly the scripted scan §26 wants counted."*

**It did not do that.** The fallback was `hashDriverToken("")`, which is
itself `null` — the empty string is malformed too — so the guard collapsed to
`if (hash === null) return UNAVAILABLE` and the request never reached the
database.

Three consequences, all live before M-83:

1. an unknown, expired, revoked or released token answered `expired`; a
   **malformed** one answered `unavailable`, and
   `/driver/update/[token]` renders those as **different cards**. §13 requires
   the link to be non-enumerable and M-76's doc claims all five refusals are
   identical. They were not.
2. the malformed case never reached `shipment_driver_token_access`, so a
   scripted scan of garbage tokens was invisible to §26's counter;
3. it never spent rate-limit budget, so the scan was also free.

**Fix:** `decoyDriverTokenHash()` in `src/lib/shipments/driver-token.ts` — a
well-formed, keyed digest of a constant that is not a valid token (it contains
a `:`, which no minted token can). Satisfies 0023's `token_hash` CHECK, cannot
collide with any issued token, and makes the RPC call unconditional as
intended. This is M-73's `DECOY_ACCESS_HASH` pattern, applied to the second
credential in the system.

**How it was found:** the new identical-refusal assertion, on its first run:

```
AssertionError: driver refusals differed:
  {"ok":false,"code":"expired"} | … | {"ok":false,"code":"unavailable"}
```

### 6.2 The staff document-download action had no scope check

`getStaffDocumentUrlAction` calls `resolveStaffActor()` — **not**
`resolveShipmentAccess()`, which every other §14 action calls first. So a
dispatcher could mint a 300-second signed URL for any shipment's document,
including shipments outside their scope. M-77's own doc named the risk
(*"dispatcher scoping stays query-level … M-83 owns restrictive policies"*)
without noticing that this particular path had no query-level control either.

**Fix:** 0030's restrictive policy on `shipment_documents`. The action reads
the document row through the **cookie-bound** client, so the row is now simply
invisible and the shared `"Document not found."` is what the operator sees —
the same answer a nonexistent id produces. Pinned by
`tests/integration/tracking-security.test.ts` (`scopes the DOCUMENT row a
staff download action reads`), which fails with the policy neutralised
(injection 9).

---

## 7. Public-DTO key-set tests at the ROUTE level

M-70's doc states the limit of its own tests: they prove the serializers and
*"cannot show that M-73 calls `toPublicTrackingDto` rather than returning the
row."* Two lanes close it, and neither is sufficient alone.

**`tests/unit/shipment-public-dto-routes.test.ts` (20 assertions)** — reads
every customer-facing route module and asserts, on code with comments
stripped (these modules document their own security rules at length, so a raw
scan finds every forbidden token in the prose explaining why it is
forbidden):

* the four customer serializers carry no sentinel value and no forbidden key
  **at any depth** — `internal_message` and `metadata` included, because §7's
  rule is about the *note*, not only the row;
* public tracking exposes **no internal identifier** of any kind;
* `carrier_pay` is the one deliberate crossing and reaches only the carrier;
* each detail route actually calls its serializer; none spreads a raw row,
  names a staff-only column, uses `select("*")`, or imports the service-role
  client; every customer refusal is `notFound()` and never a 403;
* the revoked-column list in the **migration** and the one in TypeScript agree
  — a drift between them is a page rendering "—" for a rate a dispatcher is
  entitled to.

**`tests/integration/tracking-security.test.ts` §1** — the real
`lookupPublicTracking` against the real database, on a shipment carrying seven
sentinels, asserting the **exact** key set, no forbidden key at any depth, and
no forbidden value anywhere in the serialized response, with a non-vacuity
check that the sentinels really are in the row. The driver route gets the same
treatment through `redeemDriverToken`.

---

## 8. Non-vacuity — the injection list

Every new proof was written, then broken, then confirmed to fail loudly, then
restored. **Ten injections**; a proof that cannot fail is not a proof.

| # | Injection | Caught by | Message |
|---|---|---|---|
| 1 | `dispatcher scope shipments` → `using (true)` | RLS §17a | `§19 PROOF 6: DISPATCHER 1 CANNOT READ ANOTHER DISPATCHER'S SHIPMENT … (expected 0 row(s), got 1)` |
| 2 | `dispatcher_may_see()` loses the assigned-carrier arm | RLS §17c | `dispatcher2 reads carrierB's shipment through its ASSIGNMENT … (expected 1 row(s), got 0)` |
| 3 | `margin`, `gross_shipper_amount` added back to the grant | RLS §7a | `§19 PROOF: shipperA cannot SELECT margin on its own shipment — statement was ALLOWED` |
| 4 | `grant update on shipments to authenticated` | RLS §7a | `shipperA cannot edit financial fields on its OWN shipment — statement was ALLOWED` |
| 5 | `my_shipment_exceptions()` back to a bare `is_staff()` | RLS §17a | `§19 PROOF 6: the SECURITY DEFINER accessor is scoped too … (expected 0, got 1)` |
| 6 | `shipment_restricted_fields()` drops its audience clause | RLS §7a | `the accessor returns NO ROW to a shipper — not a row of nulls … (expected 0, got 1)` |
| 7 | `toPublicTrackingDto` returns `margin` | unit route test | `public exposed margin` + the value sweep |
| 8 | `lookupPublicTracking` spreads the row over the DTO | integration §1 **and** M-73's own §27 test | `expected [ 'broker_partner_id', …(54) ] to deeply equal [ …(34) ]`; `public_access_hash reached the public response` |
| 9 | `dispatcher scope shipment documents` → `using (true)` | integration §4 | `expected { Object (id) } to be null` |
| 10 | the public refusal carries a `hint` field for unknown numbers | integration §2 | `payloads differed: {"ok":false,"code":"refused","hint":"no such number"} \| …` |

One injection **failed to fail**, and it is worth recording: returning a fresh
`{ ok: false, code: "refused" }` object instead of the frozen `REFUSED`
constant changed nothing, because the assertion compares serialized payloads
rather than object identity. That is the assertion measuring the right thing.

Defect 6.1 was found by the assertion itself before any injection — the
strongest form of the same evidence.

---

## 9. THE CONSOLIDATED RESIDUAL-RISK LEDGER

Every `R-n` raised by M-71…M-82 is resolved here: **closed**, or **restated
once, in this table, with a severity and the thing that would close it**. No
module after M-83 should re-declare any of them; a new risk gets a new `RL-n`
here. `docs/SECURITY-REVIEW.md` §7 (M-61's R-1…R-8) remains the ledger for the
pre-tracking product and is cross-referenced, not duplicated.

### 9.1 Closed by M-83

| Was | Raised by | Closed how |
|---|---|---|
| **R-1** — financial columns not column-protected | M-71; inherited by M-72, M-74, M-75, M-77, M-81 | 0030 §4 revokes `gross_shipper_amount`, `carrier_pay`, `margin`, `public_access_hash` from `authenticated` and `anon`; 0030 §5 returns three of them behind an audience rule. `42501` asserted for shipper, carrier, broker and anon |
| **R-2** — dispatcher scoping query-level | M-71; inherited by M-72, M-75, M-77; M-81's R-4 | 0030 §2's 14 restrictive policies + §3's function fix. Proved against a **second** dispatcher, both scope arms, read and write, with an unscoped admin as the non-vacuity control |
| **R-3** (M-72) — `internal_message` / `metadata` reachable on a customer-band event row | M-72 | Partially. The DTO exclusion is now asserted **at every route** and at depth (§7). The columns themselves are not revoked — see **RL-1** |
| **R-4** (M-72) — compare-and-swap is optimistic | M-72 | Closed by M-75's `PL409` surface (M-75 recorded this); restated nowhere |

### 9.2 Open, restated ONCE

| ID | Risk | Severity | What would close it |
|---|---|---|---|
| **RL-1** | `shipment_events.internal_message` and `.metadata` are readable by a customer whose *row* is visible (a `shipper`/`carrier`/`broker`-band event carrying an internal note). The DTOs exclude both at every audience and every route, and the RLS suite proves `staff_only` **rows** are unreachable — but the columns are not revoked | **Low** | Either the same treatment as the financial trio (revoke + accessor), or a CHECK forbidding `internal_message` on a non-`staff_only` event. The second changes how staff write and belongs to a module that owns the write surface, not to a security audit |
| **RL-2** | Dispatcher least-privilege on the **pre-tracking** tables (`carriers`, `documents`, `loads`, `trucks`, `drivers`, `invoices`, CRM) is still `src/lib/staff-scope.ts` only. A compromised dispatcher token reaches all of it through PostgREST | **Medium** | The same restrictive-policy pattern 0030 proves, applied to 0002/0003/0006/0008's tables. Deliberately out of M-83's scope: §19 is about shipments, and those tables carry no shipment | 
| **RL-3** | RLS is not AAL-aware (M-61 **R-1**): a stolen **AAL1** staff token passes `is_staff()`. MFA gates the app surface, not the database | **High** | `auth.jwt() ->> 'aal'` policies authored against a live project. Unchanged by M-83 and not guessable blind |
| **RL-4** | Both database lanes run against local PG16 with a **shim** for `auth`/`storage` (M-61 **R-6**). Policy logic and column privileges are proved; JWT claim shapes, storage policies and PostgREST's own behaviour are not | **Medium** | Re-run both lanes against a staging project. Both are portable (`PGHOST`/`PGPORT`) |
| **RL-5** | `service_role` in the shim lacks `BYPASSRLS` (M-61 **R-7**), so neither lane proves the service-role path itself. 0030 revokes **only** from `authenticated`/`anon`, so production's service-role grants are untouched — but that is reasoned, not asserted | **Low** | A staging run. Note the direction of failure: if the assumption were wrong, every service-role write would fail loudly on deploy, not silently |
| **RL-6** | `invoices` carries a `shipment_id` (0021) and has **no** dispatcher-scope policy — it is 0008's billing table under M-31's staff policy | **Low** | A restrictive policy keyed on `shipment_id is null or shipment_in_staff_scope(shipment_id)`, when M-96 gives shipper invoices a surface |
| **RL-7** | Unattributed rows in the two enumeration ledgers (`shipment_id is null`) are readable by **every** dispatcher, by design (§3) | **Low — accepted** | Nothing. Scoping them would blind the operators watching for the attack the tables exist to detect. Recorded so the asymmetry is a decision |
| **RL-8** | 0030 §4 makes `shipments` **fail-closed for new columns**: a future migration that adds one must `grant select` on it to `authenticated`, or every customer read of that column errors | **Low — operational** | Nothing to fix; it is the intended direction. In the launch runbook and in the migration header |
| **RL-9** | `shipment_documents` object-level storage policy (0024) is applied but not exercised — no lane has object storage (M-61 **R-8**, M-77's honest limitation) | **Medium** | Real storage. The folder-prefix policy is the only thing between carrier A and carrier B's POD at the object layer |
| **RL-10** | M-73's timing floor flattens the granted-vs-refused signal, it does not erase it. The rate limit is what makes measurement impractical, and Upstash **fails open** without credentials | **Medium** | Production traffic with Upstash configured; the ledger is what makes an attempt visible either way |
| **RL-11** | `public_access_hash` is a hash of a low-entropy secondary value (~41 000 ZIPs). A second factor behind a rate limit, not a password (M-71 **R-3**) | **Low — accepted** | An issued access code instead of a ZIP, if a customer ever wants one. §5 already says this is what it is |
| **RL-12** | Broker reach is bounded at `BROKER_REACHABLE_LIMIT = 500` (M-81 **R-2**); `getBrokerAccessBasis` reads `shipments.shipper_id`, a column the broker field policy denies, without ever putting it in a payload (M-81 **R-3**) | **Low** | Keyset resolution over the union. Both are M-81's, unchanged, restated here so M-81's doc is not a second ledger |
| **RL-13** | `audit_events` writes are best-effort (M-61 **R-3**); Postgres error text renders on 4 staff list pages (M-61 **R-4**); MFA has no self-service recovery (M-61 **R-5**) | **Low / Low / Medium (operational)** | Unchanged from M-61 §7; listed so this table is the single index |

---

## 10. DB changes

`supabase/migrations/0030_dispatcher_scope_and_column_privileges.sql`.
Additive in the sense that matters (no shipped policy edited, no column
dropped, migrations 0001–0004 frozen, 0017–0029 untouched) — but it **removes
privileges** `authenticated` and `anon` hold today, which is the point.

| Object | Change |
|---|---|
| `is_dispatcher()`, `dispatcher_may_see()`, `staff_scope_ok()`, `shipment_in_staff_scope()` | New; SECURITY DEFINER, STABLE, `search_path` pinned; EXECUTE to `anon`, `authenticated`, `service_role` |
| `shipment_restricted_fields()` | New; SECURITY DEFINER; EXECUTE to `authenticated`, `service_role` (**not** `anon`) |
| `my_shipment_exceptions()` | Replaced — staff arm gains `staff_scope_ok()`; customer arms byte-identical |
| 14 tables | One RESTRICTIVE `for all` policy each |
| `shipments` | `revoke all from authenticated, anon`; `grant select (49 columns)` to `authenticated` |
| `carriers(assigned_dispatcher_id)` | **Asserted**, not created — the migration raises if 0005's index is ever dropped, because the predicate now runs once per row instead of once per request |

**Rollback.** Drop the 14 policies, drop the five functions, restore
`my_shipment_exceptions()` from 0025, and
`grant select, insert, update, delete on public.shipments to authenticated,
anon`. Then revert `staff-detail.ts` and `carrier-shipments.ts` to their
pre-M-83 projections — the app half must go back with the database half, or
staff pages render "—" for every rate.

---

## 11. Endpoints · env vars · deployment

**No new route, no new env var.** M-83 adds one server module
(`src/lib/shipments/restricted-fields.ts`), changes two readers, fixes one
credential path and adds a migration.

Deployment order matters in one direction only: **apply 0030 before deploying
the code**, or `staff-detail.ts`'s old projection names revoked columns and
every staff detail page errors. The reverse (0030 applied, old code deployed)
is the same failure. Deploy them together; the runbook says so.

---

## 12. Tests

| Lane | Before | After | Added |
|---|---|---|---|
| Unit (`npm test`) | 1468 | **1488** | 20 — `tests/unit/shipment-public-dto-routes.test.ts` |
| RLS (`npm run test:rls`) | 742 | **806** | 64 — §17a–§17g plus the rewritten §7a/§7b/§7c financial assertions |
| Integration (`npm run test:integration`) | 329 | **354** | 25 — `tests/integration/tracking-security.test.ts` |
| E2E (`npx playwright test`) | 360 | **360** | none — M-83 adds no surface a browser can reach |
| Build | 388 pages | **388** | — |

Two lane capabilities were added because the proofs needed them:

* **`PgError.code`** — `tests/integration/helpers/psql-rls-supabase.ts` now runs
  psql with `-v VERBOSITY=verbose` and parses the SQLSTATE. Without it a test
  can only match English prose, and "the row was filtered by RLS" (no error)
  versus "the column privilege was revoked" (`42501`) is precisely the
  distinction M-83 exists to assert.
* **`rpc()` on the admin adapter** — `tests/integration/helpers/psql-supabase.ts`
  previously threw. `redeemDriverToken` reaches the database that way, so the
  lane could exercise 0023's SQL and never the TypeScript that shapes the
  driver page's props. The encoder is the RLS adapter's, deliberately: two
  encoders that drifted would make one lane's passing test meaningless in the
  other.

### Assertions that were TRUE and are now FALSE, by design

Four, each inverted in place with the reason recorded beside it:

* `supabase/tests/20_rls_isolation.sql` §7f — *"dispatcher CAN advance a
  shipment status"* → refused with `42501`. It was the non-vacuity control for
  every zero in §7; the replacement is *"the SAME dispatcher session CAN write
  `carriers`"*, which proves the session is live without pretending
  `shipments` is writable.
* §7a/§7b/§7c — six `affects(…, 0)` assertions → `rejects_with('42501')`. The
  refusal moved from "RLS filtered it to zero rows" to "the privilege does not
  exist", and the assertion says which.
* `tests/integration/broker-partner-access.test.ts` — *"the row DOES come back
  with its financial columns to a hand-written query … M-71 recorded the same
  residual risk as R-1"* → the column is now a `42501`, with a non-vacuity
  check that the **row** is still readable.
* Six policy-count assertions across four files gained
  `permissive = 'PERMISSIVE'`. A restrictive policy can only subtract, so
  counting them would have turned a "did anyone open a write surface?"
  detector into a "did anything change?" detector.

---

## 13. Files

**New:** `supabase/migrations/0030_dispatcher_scope_and_column_privileges.sql`
· `src/lib/shipments/restricted-fields.ts` ·
`tests/unit/shipment-public-dto-routes.test.ts` ·
`tests/integration/tracking-security.test.ts` · this doc.

**Changed:** `src/lib/shipments/{driver-token,driver-access,staff-detail,carrier-shipments}.ts`
· `src/lib/supabase/database.types.ts` · `supabase/tests/20_rls_isolation.sql`
· `tests/integration/00_harness.sql` ·
`tests/integration/helpers/{psql-supabase,psql-rls-supabase}.ts` ·
`tests/integration/{broker-partner-access,shipment-notifications}.test.ts` ·
`docs/SECURITY-REVIEW.md` · `docs/LAUNCH-RUNBOOK.md` · `docs/modules/INDEX.md`.

---

## 14. Extension points

* **RL-2 is the obvious next module.** 0030 is a working template: a helper
  pair, one restrictive policy per table, `permissive = 'PERMISSIVE'` on any
  policy-count assertion that already exists. The tables are 0002's.
* **A fifth restricted column** = add it to the `revoke`/`grant` pair, to
  `shipment_restricted_fields()`'s `case` list, to
  `SHIPMENT_RESTRICTED_COLUMNS`, and to `ShipmentRestrictedFields`. The
  compiler names the last two; `tests/unit/shipment-public-dto-routes.test.ts`
  parses the migration and names the first.
* **A new `shipments` column** must be granted to `authenticated` in the same
  migration that adds it, or reads of it fail closed (**RL-8**).
* **M-84b (observability)** should count `shipment_tracking_access` and
  `shipment_driver_token_access` rows by outcome — the malformed-token case
  now reaches the ledger, so §26's `repeated_invalid_tracking_attempts` signal
  is finally counting everything it claims to.
* **M-88's carrier reviews** must never reach a broker partner or a customer:
  add the table to `BROKER_DENIED_SOURCES`, give it a restrictive policy in
  the same migration, and add a key-set assertion beside the four in
  `shipment-public-dto-routes.test.ts`.
