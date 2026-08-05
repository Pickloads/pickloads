# M-71 — Shipment Schema

**Status:** ✅ Complete (validated on PostgreSQL 16) · **Phase:** B (tracking
core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-71 —
*"`shipments` + `shipment_parties` + `shipment_assignments`; RLS for
shipper/carrier/broker/dispatcher/admin; immutability trigger on
`tracking_number`; indexes per §25"*. Authority: `docs/DIRECTIVE-tracking.md`
§§2, 3, 5, 9, 10, 12, 18, 19, 20, 25.

Specification: **`docs/modules/M-70-shipment-domain.md`, the "What M-71 must
match" table**, and the files it names —
`src/lib/shipments/types.ts` (the row types **are** the column lists) and
`src/lib/shipments/tracking-number.ts` (which exports the CHECK pattern, the
unique-index name and the trigger name used verbatim below).

**Two migrations, no routes, no UI, no server action.** The transition engine
is M-72; the public `/track` route is M-73.

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0017_shipment_schema.sql` | 17 enum types, 5 tables, 17 indexes, 4 triggers + 2 trigger functions |
| `supabase/migrations/0018_shipment_rls.sql` | `my_broker_partner_ids()`, RLS on all 5 tables, 15 policies, **zero anon policies** |
| `supabase/tests/10_fixtures.sql` | +3 identities, 3 broker organizations, 2 shipments, 3 parties, 2 assignments |
| `supabase/tests/20_rls_isolation.sql` | +107 assertions (§7 of the suite) and one new harness function |
| `src/lib/supabase/database.types.ts` | 5 tables registered; shipment rows **imported** from `src/lib/shipments/types.ts` |

Migrations **0001–0004 remain frozen and untouched**. Nothing here alters an
existing table, column, policy, trigger, enum or grant: the whole module is
additive, and the 173 pre-existing RLS assertions still pass unchanged (one
count assertion moved 8 → 11 because the fixtures add three profiles).

---

## Row type → table map

| M-70 row type | Table | Migration | Notes |
|---|---|---|---|
| `ShipmentRow` (52 fields) | `shipments` | 0017 | All 52 columns, in declaration order, with M-70's nullability |
| `ShipmentPartyRow` (11) | `shipment_parties` | 0017 | `organization_id` polymorphic, no FK — see below |
| `ShipmentAssignmentRow` (10) | `shipment_assignments` | 0017 | + partial unique index enforcing "reassignment is a new row" |
| `ShipmentEventRow` | — | **M-72** | Lands with the transition engine that writes it |
| `ShipmentDocumentRow` | — | **M-77** | Needs the §16 visibility matrix + private bucket in the same change |
| `ShipmentExceptionRow` | — | **M-78** | |
| `ShipmentEtaHistoryRow` | — | **M-78** | |
| `ShipmentLocationRow` | — | **M-80** | Retention executor ships with it (plan §4) |
| `ShipmentTrackingAccessRow` | — | **M-73** | Plan §7 already assigns it to M-73's own migration |
| `TrackingProviderConnectionRow` | — | **M-80** | |
| *(no M-70 counterpart)* | `broker_partners` | 0017 | New — see "Why broker organizations exist here" |
| *(no M-70 counterpart)* | `broker_partner_memberships` | 0017 | New — mirrors 0005's membership shape |

### Why seven tables were deliberately NOT created

The task allowed creating "only what M-71 needs" for FK integrity. Every
foreign key in the shipment cluster runs **child → `shipments`**, never the
other way: `shipments` references `shippers`, `carriers`, `profiles`,
`freight_quotes`, `loads` and `broker_partners`, all of which exist. So
omitting the seven tables above breaks no constraint and leaves no dangling
reference.

The alternative — creating them now, empty and writerless — is worse than it
looks. `shipment_events` without M-72's engine is a table whose 18 fields
nothing populates and whose `idempotency_key` semantics nothing enforces; the
first module to touch it would be free to reinterpret them. `shipment_documents`
without M-77's visibility matrix is a `visibility` column with no rule behind
it. A half-created table is a specification that has already started to rot.

**The enum types are the exception, and they ARE all created here** — all 17 of
M-70's `as const` arrays, including the ones whose tables land in M-72/M-77/
M-78/M-80. A vocabulary created twice is exactly the drift M-70 exists to
prevent, `create type` costs nothing, and later modules now add tables only.
Value lists and ORDER match `types.ts` exactly, because
`tests/unit/shipment-types.test.ts` pins those arrays and §6's lifecycle
numbering is read out of one of them.

### Why broker organizations exist here

`ShipmentRow.broker_partner_id` needs a referent, and M-71's own scope line
requires *"RLS for shipper/carrier/**broker**/dispatcher/admin"* plus a proof
that broker A cannot read broker B's shipment. Neither is expressible without
a broker organization and a membership join.

`broker_partners` + `broker_partner_memberships` are therefore created here as
the **minimum**: an organization identity and the same membership shape
`carrier_memberships` / `shipper_memberships` have used since 0005 (the M-57
doctrine — one membership pattern, one helper idiom). `active` defaults
**false**, so an organization grants nothing until an admin approves it, and
`my_broker_partner_ids()` enforces that in SQL rather than in a comment.

**M-81 still owns broker-partner access**: the invitation flow, the
verification workflow, per-shipment sharing grants, the allow/deny permission
lists of §12 and the portal itself. It adds tables *alongside* these two; it
does not rewrite them. What M-71 owns is the floor — an admin-written link, and
nothing wider.

**`user_role` was deliberately NOT extended with a `broker` value.** §12 calls
the broker "an optional role **or organization type**", and every policy here
keys off membership + approval, never off `profiles.role`. Adding an enum value
to a frozen 0001 type would break every exhaustive `Record<UserRole, …>` in the
codebase for zero security gain. The fixtures leave the broker users on the
enum's default role on purpose, to make it concrete that the assertions do not
depend on it.

---

## How

### `tracking_number` — §5's six properties

M-70 owns properties 1 and 3 (server-side generation, guessing mitigation);
M-71 owns 2 and 6, using the identifiers `tracking-number.ts` exports so the
two files cannot drift:

| §5 property | Mechanism | Name |
|---|---|---|
| unique DB constraint | unique index | `shipments_tracking_number_key` = `TRACKING_NUMBER_UNIQUE_INDEX` |
| format | CHECK | `shipments_tracking_number_format`, pattern = `TRACKING_NUMBER_SQL_PATTERN` (`^PL-[0-9]{4}-[0-9]{6}$`) |
| **immutable after creation** | BEFORE UPDATE OF trigger | `trg_shipments_tracking_number_immutable` = `TRACKING_NUMBER_IMMUTABLE_TRIGGER` |

**Does the immutability trigger hold against the service role? Yes — and here
is exactly why.** A trigger is not RLS. Supabase's `service_role` carries
`BYPASSRLS`; there is no such thing as `BYPASSTRIGGER`. The only way past a
trigger is `alter table shipments disable trigger …`, which requires table
**ownership** — migrations run as `postgres`, the API `service_role` is a
different role and cannot. So no application path, service-role included, can
change a tracking number. The suite proves this the strongest way available:
the assertion runs as the **table owner** with RLS bypassed entirely, so the
rejection can only have come from the trigger.

That is the intended reading of §5. Admin correction is not "an UPDATE an admin
is allowed to type"; §20 calls for *"controlled admin correction with mandatory
reason and audit event"*, which **M-75 owns** as an explicit, logged procedure.
If that procedure ever needs to rewrite a number rather than supersede the
shipment, it will do so by dropping and recreating the trigger inside its own
migration — visibly, in review, not by discovering the guard was never there.

`before update **of** tracking_number` narrows the trigger to statements that
actually name the column, so ordinary shipment updates pay nothing for it.

### §2 legal gate — the DB half, and why it is feasible

The plan requires shipment creation to be gated on
`company_settings.brokerage_active` **server-side, not presentationally**.
M-71 implements the database half: `trg_shipments_brokerage_gate`, a BEFORE
INSERT trigger calling `assert_brokerage_active()`.

It is feasible here for a structural reason. Plan §1 made `shipments` the
brokerage table and left `loads` as the dispatch table, so *"no shipment may be
created while brokerage is off"* is an exact statement about one table and
nothing else. Dispatch keeps working; only brokerage is dark. Had the audit's
rejected option been taken — extending `loads` — the same rule would have been
a column-value predicate over a table that carries legal dispatch work, and it
would not have been implementable.

Three deliberate design choices:

- **INSERT only.** If the flag is ever switched back off, shipments already in
  flight must stay operable — refusing their status updates would strand real
  freight, a worse outcome than the one §2 guards against. Cancelling an
  in-flight shipment must also remain possible. Both are asserted.
- **Fail closed.** A missing `brokerage_active` key reads as false. A gate that
  opens when its configuration is absent is not a gate. Asserted by deleting
  the key and retrying the insert.
- **SECURITY DEFINER.** The read of `company_settings` must not be filtered by
  the caller's RLS. It is publicly readable today; the gate must not depend on
  that staying true.

**This is one layer, not the whole control.** M-75 must still refuse in the
service layer with a human error message, and M-73/M-74 must still render the
honest waitlist state (§2). A `P0001` at the bottom of the stack is a safety
net, not a user experience — but it is the layer that a forgotten `if` in a
future server action cannot bypass.

### `shipment_parties.organization_id` has no FK, on purpose

The referent is `shippers` for a shipper party, `carriers` for a carrier
party, `broker_partners` for a broker party, and **nothing at all** for a
consignee or third party — which is the common case, because a receiving
warehouse has no PickLoads account. A foreign key would force inventing
account rows for every dock in the country. `party_role` says which table to
look in; integrity is the writer's job (M-75).

### One active assignment per shipment

M-70 states *"reassignment is a new row, never an edit."* That sentence is
only true if the database refuses a second open assignment — otherwise two
carriers can hold one shipment and §20's *"`carrier_assigned` requires a
carrier assignment"* becomes ambiguous. `shipment_assignments_one_active` is a
partial unique index on `(shipment_id) where released_at is null`: at most one
unreleased assignment, unlimited released history. Both halves are asserted
(the second insert is rejected; after a release it succeeds).

### §20's one schema invariant

`shipments_cancellation_reason_present` — `status <> 'cancelled' or
cancellation_reason is not null`. §20 is a transition graph and M-72 owns it,
but this single clause is a *state* invariant rather than an edge rule, and an
invariant the database holds is worth more than one the application remembers.
Nothing else from §20 is implemented here.

### Defaults chosen for privacy, not convenience

- `public_tracking_enabled` **false** — §4/§19 make public tracking opt-in per
  shipment. A default of true would publish every shipment the moment a
  tracking number exists.
- `location_visibility` **`approximate`** — city/state, never coordinates.
  `exact` must be a deliberate per-shipment decision, never an inherited one
  (§9).
- `shipment_parties.public_contact` **false** — §8 forbids exposing a driver's
  personal number by default and §4 forbids private carrier contact on the
  public page outright.
- `broker_partners.active` **false** — §12's admin-approval gate.

### `updated_at`

`shipments` and `broker_partners` get `trg_*_updated_at` on the existing
`set_updated_at()` function (0001). `shipment_parties` and
`shipment_assignments` carry no `updated_at` in M-70's row types — an
assignment is an append-only fact, not a mutable record — so they get no
trigger, and the schema does not invent a column the specification does not
have.

---

## DB changes

### Migration 0017 — `0017_shipment_schema.sql`

**Creates:** 17 enum types (`shipment_status`, `shipment_event_type`,
`shipment_event_source`, `shipment_event_visibility`,
`shipment_tracking_mode`, `shipment_location_visibility`, `tracking_provider`,
`tracking_consent_status`, `eta_source`, `eta_confidence`, `eta_kind`,
`shipment_document_type`, `shipment_document_visibility`,
`shipment_exception_type`, `shipment_exception_severity`,
`shipment_party_role`, `tracking_access_outcome`); tables `broker_partners`,
`broker_partner_memberships`, `shipments`, `shipment_parties`,
`shipment_assignments`; functions `guard_tracking_number_immutable()` and
`assert_brokerage_active()`; triggers `trg_broker_partners_updated_at`,
`trg_shipments_updated_at`, `trg_shipments_tracking_number_immutable`,
`trg_shipments_brokerage_gate`; 17 indexes.

**ROLLBACK** (run **after** 0018's rollback — reverse numeric order):

```sql
drop trigger if exists trg_shipments_tracking_number_immutable on shipments;
drop trigger if exists trg_shipments_brokerage_gate on shipments;
drop trigger if exists trg_shipments_updated_at on shipments;
drop trigger if exists trg_broker_partners_updated_at on broker_partners;
drop function if exists public.guard_tracking_number_immutable();
drop function if exists public.assert_brokerage_active();
drop table if exists shipment_assignments, shipment_parties, shipments,
                     broker_partner_memberships, broker_partners cascade;
drop type if exists shipment_status, shipment_event_type,
  shipment_event_source, shipment_event_visibility, shipment_tracking_mode,
  shipment_location_visibility, tracking_provider, tracking_consent_status,
  eta_source, eta_confidence, eta_kind, shipment_document_type,
  shipment_document_visibility, shipment_exception_type,
  shipment_exception_severity, shipment_party_role, tracking_access_outcome;
```

**Destructive** — drops every shipment, party and assignment row. Take a dump
first (`pg_dump -t shipments -t shipment_parties -t shipment_assignments
-t broker_partners -t broker_partner_memberships`). Otherwise inert: at M-71
no route, server action or page reads these tables, so `loads`, `carriers`,
`shippers`, `freight_quotes` and every shipped surface are unaffected. Roll
back `src/lib/supabase/database.types.ts` in the same deploy or the build will
reference tables that no longer exist.

### Migration 0018 — `0018_shipment_rls.sql`

**Creates:** `my_broker_partner_ids()`; RLS enabled on all five 0017 tables;
15 policies. **No anon policy on any table.**

**ROLLBACK** (run **first**, before 0017's):

```sql
drop policy if exists "staff manage shipments" on shipments;
drop policy if exists "shipper member read shipments" on shipments;
drop policy if exists "carrier member read shipments" on shipments;
drop policy if exists "broker member read shipments" on shipments;
drop policy if exists "staff manage shipment parties" on shipment_parties;
drop policy if exists "shipper member read shipment parties" on shipment_parties;
drop policy if exists "carrier member read shipment parties" on shipment_parties;
drop policy if exists "broker member read public shipment parties" on shipment_parties;
drop policy if exists "staff manage shipment assignments" on shipment_assignments;
drop policy if exists "shipper member read shipment assignments" on shipment_assignments;
drop policy if exists "carrier member read shipment assignments" on shipment_assignments;
drop policy if exists "staff manage broker partners" on broker_partners;
drop policy if exists "member read own broker partner" on broker_partners;
drop policy if exists "staff read broker partner memberships" on broker_partner_memberships;
drop policy if exists "own broker partner memberships" on broker_partner_memberships;
alter table shipments                  disable row level security;
alter table shipment_parties           disable row level security;
alter table shipment_assignments       disable row level security;
alter table broker_partners            disable row level security;
alter table broker_partner_memberships disable row level security;
drop function if exists public.my_broker_partner_ids();
```

**Dangerous in isolation.** Rolling this back leaves five populated tables with
no tenant isolation — every authenticated session could read every shipment.
Only ever run it immediately before rolling back 0017 as well.

---

## Security review

### The policy matrix

| Table | staff | shipper member | carrier member | broker member | anon |
|---|---|---|---|---|---|
| `shipments` | ALL | SELECT own org | SELECT assigned | SELECT explicitly linked | **none** |
| `shipment_parties` | ALL | SELECT own shipments | SELECT assigned shipments | SELECT `public_contact` rows only | **none** |
| `shipment_assignments` | ALL | SELECT own shipments | SELECT own `carrier_id` | **none** | **none** |
| `broker_partners` | ALL | — | — | SELECT own org | **none** |
| `broker_partner_memberships` | SELECT all | — | — | SELECT own rows | **none** |

Five decisions worth arguing rather than assuming:

- **No anon policy anywhere.** §19: *"Do not use direct anonymous table SELECT
  access."* The anon key ships in the browser bundle, so any anon policy —
  however narrow — makes M-73's tracking-number validation, secondary
  credential, rate limit, enumeration protection and public DTO all optional.
  M-73's route holds the service-role key behind a server-side gate.
- **Customers get SELECT only — no INSERT, UPDATE or DELETE policy exists on
  any of these tables.** This is what makes §19's *"carrier users cannot edit
  financial fields"* and *"unauthorized status transitions fail"* true by
  construction rather than by maintaining a column list: there is no field a
  carrier session can write. Carrier operational updates arrive in M-76 as
  server actions with an explicit transition whitelist.
- **Broker reads `public_contact` parties only.** §12 permits "approved
  contact channels" and nothing broader — not the shipper's buyer, not the
  driver's mobile.
- **Broker reads no `shipment_assignments` at all.** §12's must-not-see list
  starts with "carrier's private packet"; which truck, which driver, released
  when and why is carrier operational data. Silence here is a decision; M-81
  adds a policy naming exactly what an account agreement shares.
- **`my_broker_partner_ids()` filters on `active`.** §12's approval gate lives
  in the helper, so every policy built on it inherits the rule and an admin
  de-activating an organization revokes access everywhere in one write.

### Residual risks, stated plainly

**R-1 — RLS is row-level; the three staff-only financial columns are not
column-protected.** A shipper or carrier reading *their own* shipment row
through raw PostgREST receives `gross_shipper_amount`, `carrier_pay` and
`margin` in the payload. §18's requirement (*"sensitive financial data must
never be included in public shipment queries"*) is met — the public audience
has no policy at all — but the authenticated-customer case rests on M-70's DTO
allow-list plus server components selecting explicit column lists, not on the
database.

The obvious fix, `revoke select (margin, …) on shipments from authenticated`,
is **not available**: staff surfaces run on the *authenticated* session too
(`src/lib/staff-scope.ts`, every `/portal/admin` page uses
`createClient()`, not the admin client), and Postgres cannot distinguish staff
from customer at the GRANT level. Making it real needs either a `shipments`
customer view or a separate DB role for staff reads — both touch shipped
surfaces and belong to **M-83** (RLS + security), whose scope already includes
public-DTO key-set tests and financial-write rejection. Recorded here so M-83
inherits a named risk rather than rediscovering it.

**R-2 — dispatcher scoping is query-level, not database-level.** `"staff
manage shipments"` does not distinguish dispatcher from admin, exactly as
`loads`, `carriers` and `documents` have not since 0002. Dispatcher
least-privilege is `src/lib/staff-scope.ts` (M-58). Plan §4 already records
this and assigns the database-level version (RESTRICTIVE policies that would
also constrain admins) to **M-83**. The policy names here deliberately say
"staff", not "dispatcher", so nothing implies a guarantee the schema does not
give.

**R-3 — `public_access_hash` is a hash of a low-entropy secondary value**
(a recipient ZIP is ~40 000 possibilities). It is a *second factor* behind a
rate limit, not a password; §5 says as much. M-73 owns the rate limit and the
enumeration ledger that make it meaningful. Nothing reads the column back: no
DTO serializes it at any audience, staff included.

---

## Performance review — the §25 index table

§25 asks for *"indexed status/date/organization columns"* and *"database
indexes documented"*. Seventeen indexes, each written for a named query:

| Index | Columns | Query it serves |
|---|---|---|
| `shipments_tracking_number_key` | `(tracking_number)` UNIQUE | §5 uniqueness; M-73 public lookup; M-75 staff search |
| `idx_shipments_shipper` | `(shipper_id, status, created_at desc)` | §11 shipper list + status filter, newest first (M-74) |
| `idx_shipments_carrier` | `(carrier_id, status, created_at desc)` partial | Carrier portal list (M-76). Partial: the lifecycle's first four statuses have no carrier |
| `idx_shipments_broker` | `(broker_partner_id, status, created_at desc)` partial | §12 broker list (M-81). Partial: a broker partner is the exception |
| `idx_shipments_dispatcher` | `(dispatcher_id, status)` partial | §14 dispatcher "my shipments" |
| `idx_shipments_status_board` | `(status, created_at desc)` | §14 operational board — 8 status columns, no org filter |
| `idx_shipments_pickup_appointment` | `(pickup_appointment_at)` partial | §14 "today's pickups"; unscheduled rows can never match a range |
| `idx_shipments_delivery_appointment` | `(delivery_appointment_at)` partial | §14 "today's deliveries" + late-delivery sweep |
| `idx_shipments_quote` | `(quote_id)` partial | M-75 quote→shipment conversion: "already converted?" |
| `idx_shipments_load` | `(load_id)` partial | Plan §1 bridge: "which shipment covers this load?" |
| `idx_shipment_parties_shipment` | `(shipment_id, party_role)` | Detail-page party fetch, grouped by role |
| `idx_shipment_parties_organization` | `(organization_id)` partial | Reverse lookup: "which shipments is this org a party to?" |
| `idx_shipment_assignments_shipment` | `(shipment_id, assigned_at desc)` | Assignment history for one shipment |
| `idx_shipment_assignments_carrier` | `(carrier_id, assigned_at desc)` | Carrier's own assignment list |
| `idx_shipment_assignments_driver` | `(driver_id)` partial | M-76 driver update link → open assignments |
| `shipment_assignments_one_active` | `(shipment_id) where released_at is null` UNIQUE | Integrity, not speed — see above |
| `idx_broker_partner_memberships_profile` | `(profile_id)` | Mirrors 0005; the helper's join direction |

Seven of these are **partial**, which is the point: `carrier_id`,
`broker_partner_id`, `dispatcher_id`, `quote_id`, `load_id`, `driver_id` and
both appointment columns are null on a large share of rows, and a partial
index neither stores nor scans them.

`broker_partners` gets no index beyond its primary key — it is a table of tens
of rows, and an index on `active` would cost more to maintain than a sequential
scan costs to run.

§25's other requirements (server-side pagination, no N+1, event-timeline
limits, summary-vs-history split, cache rules, lazy map, background
notification processing) are query-shape and route concerns and belong to
M-74/M-75/M-79/M-82. M-71 owns the indexes those queries will need.

---

## Endpoints

**None.** No route, no server action, no API handler.

## Env vars

**None.** The build is byte-identical apart from the hash; the page count is
unchanged at 343.

---

## Deployment

Apply `0017` then `0018`, **in that order** — 0018's policies reference tables
0017 creates. Both are pure DDL and take milliseconds on an empty schema; there
is no backfill, no data migration and no lock on an existing table.

Nothing changes operationally on deploy: `brokerage_active` stays `false`, so
the §2 gate refuses every shipment insert until the day an admin flips it. That
is the intended launch state — the whole tracking system ships **ready and
dark**.

Verify with the same command CI uses:

```bash
npm run test:rls    # rebuilds a throwaway DB from 0001 → 0018 + seed + fixtures
```

---

## Tests

| Suite | Count | New in M-71 |
|---|---|---|
| `npm run test:rls` | **280** (was 173) | **+107** assertions |
| `npm test` (vitest) | 268 (unchanged) | No TypeScript behaviour changed |
| `npx playwright test` | 160 (unchanged) | No surface exists to exercise |

The 107 new assertions cover, in §7 of `supabase/tests/20_rls_isolation.sql`:

- **Shipper A vs B** (19) — including a lookup **by tracking number**, proving
  §5's identifier is not an access grant; and that a shipper cannot edit
  `margin` on its own shipment, change its own status, publish another
  shipper's shipment, delete a shipment or flip a private contact to public.
- **Carrier A vs B** (14) — including the §19 financial-write rejection
  (`carrier_pay`, `margin`, `gross_shipper_amount` all touch 0 rows), the §20
  "driver marking another carrier's shipment delivered" case, and a non-owner
  member reaching the shipment through membership.
- **Broker A vs B** (22) — including §12's must-not-see list (no carrier
  records, no carrier documents, no shipper billing, no freight quotes, no
  assignment detail), the `public_contact`-only party rule, and the
  **unapproved organization** case: broker C's member can see that the
  membership row exists but `my_broker_partner_ids()` returns nothing.
- **Non-member** (5) and **anon** (8) — `reads_nothing` on all five tables plus
  write attempts. The shim grants `anon` the same privileges a real Supabase
  project does, so these prove the *policy* blocks it, not a missing grant.
- **Staff** (10) — dispatcher and admin read everything, a dispatcher **can**
  advance a status (which is what makes every zero above a policy result rather
  than an empty table), and a dispatcher still cannot rewrite a tracking number.
- **INSERT rejection** (9) — run with the §2 gate deliberately **open**,
  because a BEFORE INSERT trigger fires before RLS `WITH CHECK`: with the gate
  closed every one of these would be rejected by the gate and would prove
  nothing about the policies. Includes the non-member insert, self-registering
  a broker organization, and joining someone else's.
- **Constraints and triggers** (20) — asserted as the **table owner**, with RLS
  bypassed, so anything that still fails can only be a CHECK, a unique index or
  a trigger: the format CHECK (malformed, lowercase, seven-digit), uniqueness
  (the 23505 the generator retries on), §20's cancellation-reason invariant,
  tracking-number immutability (single-row, null, **and bulk**), the
  column-scoped non-vacuity update, `updated_at` stamping, the one-active-
  assignment index and the release-then-reassign path, and the §2 gate:
  refuses INSERT while off, does **not** block updates or cancellation of
  in-flight freight, and **fails closed** when the key is deleted entirely.

A new harness function, `rls_test.rejects_with(stmt, sqlstate, label)`, demands
an **exact** SQLSTATE. `rls_test.denied()` accepts any of three codes, which is
right for RLS but too loose here: a CHECK test that passes because a *trigger*
fired first proves nothing about the CHECK. Every database guarantee above is
attributed to the object that actually produced it.

### Anti-vacuity — proven, not asserted

Four defects were injected one at a time and the suite was re-run; each failed
loudly, then the tree was restored and the suite returned to 280 green:

| Injected defect | Assertion that caught it |
|---|---|
| `"shipper member read shipments"` widened to `using (true)` | *shipperA sees exactly 1 shipment* (expected 1, got 2) |
| `trg_shipments_tracking_number_immutable` removed | *dispatcher cannot rewrite a tracking number either (§5 immutability)* — statement was ALLOWED |
| `trg_shipments_brokerage_gate` removed | *trg_shipments_brokerage_gate refuses INSERT while brokerage_active is false* — statement was ALLOWED |
| `public_contact` dropped from the broker party policy | *brokerA sees ONLY the public_contact party (§12)* (expected 1, got 2) |

The suite also carries its own positive controls inline — a dispatcher status
update, a well-formed insert, a release-then-reassign, an admin approving and
revoking a broker organization — so a zero is never mistaken for an empty
table.

**Honest limitation.** These are database proofs. They show that a *session*
cannot cross a tenant boundary. They cannot show that M-74 selects the right
columns, that M-73 calls `toPublicTrackingDto`, or that R-1's financial columns
never reach a customer payload — those are M-83's DTO tests and M-83b's
integration tier, both already scoped by the plan.

---

## Files

**New:** `supabase/migrations/0017_shipment_schema.sql` ·
`supabase/migrations/0018_shipment_rls.sql` · this doc.

**Changed:** `supabase/tests/10_fixtures.sql` ·
`supabase/tests/20_rls_isolation.sql` · `src/lib/supabase/database.types.ts` ·
`docs/modules/INDEX.md` · `docs/LAUNCH-RUNBOOK.md`.

### One note on `database.types.ts`

The three shipment row types are **imported** from
`src/lib/shipments/types.ts`, never re-declared — a second copy is exactly the
duplicate DTO the executive directive forbids, and the first `ALTER` would
silently make one of them wrong.

That import needed one adapter. `types.ts` declares its rows as `interface`,
and a TypeScript interface does **not** carry the implicit index signature that
supabase-js's `GenericTable` constraint (`Row: Record<string, unknown>`)
requires — a mismatch that collapses *every* table in the file to `never`, not
just the new ones (17 unrelated type errors on the first attempt). `AsRow<T> =
{ [K in keyof T]: T[K] }` is the standard homomorphic-mapped-type adapter: it
derives each property from the source and restates nothing, so it cannot drift.
Changing the upstream interfaces to type aliases would have worked equally
well, but M-70's file is the published specification M-71's DDL was written
against and is better left byte-identical.

`broker_partners` / `broker_partner_memberships` have no M-70 counterpart, so
they are declared in `database.types.ts` beside the 0005-era membership rows
they mirror.

---

## Extension points

- **M-72** adds `shipment_events` (all 18 §7 fields) and the transition engine.
  Every enum it needs already exists; its migration is a table, not a
  vocabulary. §20's graph, preconditions and impossible-transition list belong
  there — M-71 implemented exactly one §20 clause, the
  cancellation-reason invariant, and left the rest alone.
- **M-73** adds `shipment_tracking_access` and the public route. It must reach
  `shipments` through the **service role**: there is no anon policy and adding
  one would defeat the whole §19 model.
- **M-75** owns the §20 admin-correction flow. If it ever needs to rewrite a
  tracking number rather than supersede a shipment, that is a visible migration
  dropping and recreating `trg_shipments_tracking_number_immutable`, reviewed
  as such. It must also enforce the §2 gate in the service layer with a human
  error message — the trigger is the net, not the message.
- **M-76** adds the carrier update path. Today carriers have **no** write
  policy; a carrier write surface means a narrow, explicitly-scoped policy or
  (better) a server action with a transition whitelist. Do not widen
  `"carrier member read shipments"` into a `FOR ALL`.
- **M-77 / M-78 / M-80** add the five remaining tables. Their enums are already
  created; their `shipment_id` FKs land against a table that exists.
- **M-81** builds broker-partner access on `broker_partners` +
  `broker_partner_memberships`: the invite flow, verification, per-shipment
  sharing grants and §12's allow/deny lists. The floor here — an admin-written
  `broker_partner_id` link, an `active` organization, `public_contact` parties
  only, no assignment detail — is a floor, not a ceiling; widening it means a
  new policy that says what it widens and why.
- **M-83** inherits R-1 (financial columns are not column-protected) and R-2
  (dispatcher scoping is query-level). Both are named above so they arrive as
  scope, not as a discovery.
