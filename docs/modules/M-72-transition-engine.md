# M-72 — Status-Transition Engine + `shipment_events`

**Status:** ✅ Complete (validated on PostgreSQL 16) · **Phase:** B (tracking
core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-72 —
*"Status-transition engine (server-side, preconditions per §20,
impossible-transition list) + `shipment_events` (all 18 fields incl.
`idempotency_key`, `external_event_id`, `metadata`) + event-sourced
appointments; corrections as additional audit events, never deletes."*
Authority: `docs/DIRECTIVE-tracking.md` §§6, 7, 14, 15, 19, 20, 21, 25, 26, 27.

Vocabulary: **`docs/modules/M-70-shipment-domain.md`** and
`src/lib/shipments/types.ts` — `ShipmentEventRow` **is** the column list.
Schema baseline: **`docs/modules/M-71-shipment-schema.md`** (0017–0018).

**One migration, no UI, no routes, no server action.** The dispatcher board is
M-75, the public `/track` route is M-73, the carrier update surface is M-76.

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0019_shipment_events.sql` | `shipment_events` (all 18 §7 fields), 6 indexes, append-only trigger, 4 RLS policies, **5 SECURITY DEFINER functions** granted to `service_role` only |
| `src/lib/shipments/transitions.ts` | The §20 engine: 47-edge graph, 7 preconditions, the impossible-transition list, the §19 actor gate. Pure, no DB, no `server-only` |
| `src/lib/shipments/apply-transition.ts` | The server layer: resolve facts → evaluate → atomic write → audit. The only caller of 0019's functions |
| `src/lib/shipments/observability.ts` | §26's nine signals, structured shape, never-log enforcement |
| `tests/unit/shipment-transitions.test.ts` (45) | Full matrix, preconditions, actor gate, exhaustiveness, SQL↔TS drift guard |
| `tests/unit/shipment-apply-transition.test.ts` (29) | Validation-before-write, idempotency, corrections, audit, SQLSTATE mapping |
| `tests/unit/shipment-observability.test.ts` (11) | The nine signals, redaction, fail-closed transport |
| `tests/integration/**` + `scripts/run-integration-tests.sh` | **New lane** — §27's restored tier, 33 tests against local PG16 |
| `supabase/tests/*` | +59 RLS assertions (§8 of the suite) |

Migrations **0001–0004 remain frozen and untouched**; 0017/0018 are untouched
too. The whole module is additive: one new table, one new trigger, five new
functions, four new policies. The 280 pre-existing RLS assertions still pass
unchanged.

---

## Why

### Why the graph is TypeScript and the guarantees are SQL

`src/lib/loads.ts` set the idiom in M-30: `LOAD_TRANSITIONS` is a
`Record<LoadStatus, readonly LoadStatus[]>` in a plain module that server
actions, RSC pages and client components all share. The reasons get stronger
at 18 statuses: M-75's board needs to know which buttons to render, M-76's
carrier surface needs its permitted subset, M-73's page needs the vocabulary. A
second copy of the graph in PL/pgSQL would be a second specification, and the
first divergence would be silent.

What the database owns is what TypeScript **cannot** guarantee:

| Guarantee | Where | Why it cannot live in TS |
|---|---|---|
| Status change + event are one write | `apply_shipment_transition()` | PostgREST has no multi-statement transaction |
| No lost update | compare-and-swap in the same function | Two dispatchers, one row |
| Idempotency | partial unique index + a pre-write lookup | A retry may arrive at a different process |
| History is append-only | `trg_shipment_events_append_only` | `BYPASSRLS` is not `BYPASSTRIGGER` |
| Audience bands | 4 RLS policies | An app-level filter is one forgotten `where` from a leak |

### Why an RPC and not `.update()` + `.insert()`

§6 requires *"a separate event history instead of overwriting the shipment
record without history"*; §7 requires the timeline. Through PostgREST those are
two HTTP round trips in two transactions. A crash between them leaves a
shipment whose status has no event explaining it — the exact state both
sections forbid — and no amount of client-side care prevents it.

One `plpgsql` function is one statement, one transaction. It also buys the
thing a two-step client cannot have: a **compare-and-swap**. The update carries
`where status = p_expected_status`, so two dispatchers who both read
`in_transit` produce one winner and one typed `PL409` conflict, rather than a
lost update plus an event describing a transition that never happened.

The functions are `security definer` with **EXECUTE granted to `service_role`
alone**. 0018's doctrine gave customer roles SELECT and no write policy; 0019
keeps it. A browser session — anon, shipper, carrier, broker, *even an admin* —
cannot call them, which is asserted in the RLS suite. That is what makes §19's
*"unauthorized status transitions fail"* structural rather than enumerated.

---

## How

### The graph (§6 → §20)

47 edges over M-70's 18 statuses. **Not** the declaration order — M-70's own doc
warns that `SHIPMENT_STATUSES` is a lifecycle numbering, not a transition graph,
because `delayed` and `cancelled` are *states*, not milestones. Two consequences
shape the table:

- **`delayed` is a detour.** Reachable from every operational status from
  `dispatched` onward, and returning to any of them: a truck delayed before
  pickup resumes `en_route_to_pickup`; one delayed at the receiver resumes
  `unloading`. An ordinal reading would have a delayed shipment "past"
  `in_transit`, which is the opposite of what happened.
- **`cancelled` is terminal and reachable from everything not yet delivered.**

Three edges are decisions worth stating:

| Edge | Why |
|---|---|
| `carrier_assigned → carrier_search`, `dispatched → carrier_search` | §6 requires carrier reassignment. The assignment row is released (M-71's partial unique index makes that a new row, never an edit) and both survive in history |
| `delivered → completed` without `pod_uploaded` | §6: "not every shipment must use every status", and it lists **missing POD** among the supported scenarios. The edge exists; `completed`'s precondition is what stops it being used carelessly |
| **no** `delivered → cancelled` | Delivered freight cannot be un-shipped. A delivery recorded in error is a §20 **correction**, not a transition |

### §20's preconditions, and the two that are honestly incomplete

| §20 sentence | Code | Fact, and where it comes from |
|---|---|---|
| `carrier_assigned` requires a carrier assignment | `carrier_assignment_required` | `shipment_assignments` where `released_at is null` — real, in `shipment_transition_facts()` |
| `picked_up` should require pickup confirmation | `pickup_confirmation_required` | The most recent recorded `arrived_at_pickup`/`loading` event. `picked_up` itself is **excluded** — a precondition its own outcome satisfies is not a precondition |
| `delivered` may require delivery timestamp | `delivery_timestamp_required` | The `event_time` the transition asserts |
| `pod_uploaded` requires an approved POD document | `approved_pod_required` | **M-77.** See below |
| `completed` requires delivery **and** closeout | `delivery_required` + `closeout_required` | Delivery is the recorded `delivered` event; closeout is a human assertion M-75 supplies |
| `cancelled` must record a reason | `cancellation_reason_required` | The request. Blank counts as absent |

**`pod_uploaded` is refused today, and that is the correct behaviour.** M-77
owns `shipment_documents`; there is no table to select from, so
`shipment_transition_facts()` returns `approved_pod_document_id` as a literal
`null` — *in SQL, with the replacement expression written out in the comment
beside it* — and the engine refuses every transition into `pod_uploaded`. A
precondition that cannot be evaluated must fail, never pass; the alternative is
a status asserting an approved POD exists when no document table does.

**How M-77 completes it:** replace the literal in `shipment_transition_facts()`
with

```sql
(select d.id from shipment_documents d
  where d.shipment_id = s.id and d.doc_type = 'pod'
    and d.approved_at is not null
  order by d.approved_at desc limit 1)
```

Nothing in `transitions.ts` or `apply-transition.ts` changes. The unit test
that pins the refusal stays true — it asserts that a shipment with **no**
approved POD is refused.

**Closeout** is deliberately not derivable: paperwork received, detention
settled, invoice raised is a human judgement, so M-75's surface asserts it and
an absent assertion means "not closed out".

### §19's actor gate

§19: *"Carrier updates must be limited to approved fields and transitions."*
The "approved fields" half is structural — the engine writes a status and an
event, nothing else, and `gross_shipper_amount`/`carrier_pay`/`margin` are not
parameters of any function in 0019. The "approved transitions" half is
`ACTOR_PERMITTED_TARGETS`:

| Actor | May set |
|---|---|
| `admin`, `dispatcher` | anything the graph allows |
| `carrier`, `driver` | `en_route_to_pickup` … `delivered` + `delayed` — what is happening to the truck |
| `shipper` | `quote_accepted` only |
| `system` | `delayed` only (M-79's late sweep) |

`driver` is deliberately not a `profiles.role` — M-76 reaches drivers through a
scoped token — and `eld`/`gps` are event *sources* that never assert a status.
M-77 and M-79 widen this table in a reviewed diff when they need to.

### §20's impossible-transition list

Enumerated in `IMPOSSIBLE_TRANSITIONS` (17 pairs, §20's own
`delivered → carrier_search` first) and asserted pair-by-pair, because "it is
absent from the graph" is a claim worth testing. The suite additionally proves
the **complement**: all 259 ordered pairs the graph does not declare are
refused, and all 47 it does are accepted.

§20 names three prohibitions that are **not** graph edges, recorded in
`OUT_OF_GRAPH_PROHIBITIONS` so nobody looks for them there and concludes they
were missed:

- *public user marking a shipment paid* — there is no `paid` status on a
  shipment at all (it belongs to `loads`, a different table and a different
  legal activity per plan §1), and anon has no policy and no EXECUTE grant;
- *carrier changing shipper financial data* — no financial column is a
  parameter of any 0019 function, and 0018 gives carriers no UPDATE policy;
- *driver marking another carrier's shipment delivered* — the actor gate plus
  M-76's shipment-scoped token, with the cross-carrier write already proved to
  touch zero rows in the M-71 RLS suite.

### Every rejection is typed

`evaluateTransition` never throws and never returns a bare boolean. A refusal
carries a machine code (`same_status` · `terminal_status` ·
`illegal_transition` · `actor_not_permitted` · `precondition_failed`), the
edge, the actor, an operator sentence and — for precondition failures — exactly
which preconditions were unmet. The server layer widens that union with
`not_configured` · `shipment_not_found` · `status_conflict` · `invalid_input` ·
`write_failed`, mapped from 0019's custom SQLSTATEs:

| SQLSTATE | Meaning | Typed code |
|---|---|---|
| `PL404` | shipment does not exist | `shipment_not_found` |
| `PL409` | compare-and-swap lost | `status_conflict` |
| `PL422` | invalid argument (blank reason, wrong event type, no-op reschedule) | `invalid_input` |
| `23514` | a CHECK refused it | `invalid_input` |
| anything else | uninterpreted | `write_failed` |

Order matters: the engine checks the edge **before** the actor and the actor
**before** the preconditions, so a dispatcher attempting `in_transit →
completed` is told the edge does not exist rather than that closeout is
missing. A silent no-op on a dispatcher board is how freight ends up in a status
nobody chose.

### Event-sourced appointments (§6, plan §4)

Plan §4 restores this with the diagnosis attached: *"appointments modelled as
plain columns."* M-71 shipped the columns; an UPDATE destroys the previous
value and "you told me Tuesday, what happened?" has no answer.

`set_shipment_appointment()` writes the column and the event in one statement.
The first set emits `appointment_set`; every change after emits
`appointment_rescheduled` with `previous_at`, `new_at`, `appointment_kind` and
`reason` in `metadata`. The row is locked `for update` while the old value is
read, so two dispatchers rescheduling at once cannot both record the same
"previous". Default visibility is **`shipper`**, not `staff_only` — an
appointment is the customer's own logistics and §17 lists it among the events
they are notified about. Rescheduling to the identical time is refused
(`PL422`): a customer timeline is not a place for events that assert nothing.

### §14's dispatcher actions that are engine concerns

`record call`, `record email`, `add public update`, `add internal note`,
`request POD`, assignment created/released, notification sent — all
`append_shipment_event()`. §14's **UI is M-75's**; what belongs here is the
vocabulary and the write path, so M-75 renders forms rather than inventing
event semantics. M-70 already gave each one an `event_type`; a board that typed
them as free text would re-open exactly the hole §6 closes for statuses.

§14's public-vs-internal distinction is a **visibility, not a table**:
`public_update` carries `visibility: 'public'` + a `public_message`,
`internal_note` carries `staff_only` + an `internal_message`. The column default
is `staff_only`, so a writer who forgets to choose publishes nothing.

`append_shipment_event()` refuses `status_change` and `correction` outright
(`PL422`): a status change that did not go through the compare-and-swap is the
un-validated write §20 forbids.

### §20 controlled admin correction

Three properties make it a correction rather than a back door:

- **Admin only** — `actorMayCorrect()` refuses everyone else before any write.
- **Mandatory reason** — refused in the server layer on a blank string, refused
  again by `PL422` in the function, refused a third time by the
  `shipment_events_correction_has_reason` CHECK. Three layers, because a
  correction with no stated reason is indistinguishable from tampering.
- **Additive** — the wrong event is untouched, and *cannot* be touched: the
  append-only trigger refuses UPDATE and DELETE for every role including the
  service role. The correction is a **new** `correction` event carrying
  `corrected_from`/`corrected_to` in `metadata`, **plus** an `audit_events` row
  through the M-69 single writer. Two ledgers, because §7's is about the
  shipment and §15's is about the operator.

It bypasses the transition **graph** by design — the graph describes freight
moving, and a mis-keyed status is not freight moving backwards — but not the
reason, the audit entry or the compare-and-swap. Correcting away from a terminal
status clears that status's timestamp (`completed_at` / `cancelled_at`), because
a `cancelled_at` on a shipment that is no longer cancelled makes every
downstream report wrong; the original assertion survives in the timeline, which
is where §7 keeps it.

### §26 observability, without inventing a framework

Plan §2 correction **C-5** is blunt: Sentry is a DSN in `.env.example` and
nothing else, so §26's "use existing infrastructure" rests on a false premise
and real observability is **M-84b**. M-72 ships the **call-site shape** only —
one function, a closed nine-signal vocabulary (§26's own list), a fixed record
— so M-84b edits one file and no call sites.

The never-log list is enforced by construction: `logShipmentSignal` takes named
fields with **no `payload`, no rest parameter, no spread**, so passwords, bank
details, EIN plaintext, document contents and access tokens have no parameter to
arrive through. There is no coordinate field at all (§26 forbids "exact location
beyond operational need"). The one free-text field is swept for credential
shapes (`eyJ`, `Bearer `, `sk_`, `whsec_`, `-----BEGIN`, `token=`,
`access_token`, `X-Signature`) and **fails closed** — the whole string is
dropped, not partially masked, because a partial mask still discloses length and
context. It never throws: a logger that can break the operation it observes is
worse than none.

`status_update_error` is emitted on **every** failure path in
`apply-transition.ts`, including the ones the engine refuses before any write.

---

## DB changes

### Migration 0019 — `0019_shipment_events.sql`

**Creates:** table `shipment_events`; indexes
`shipment_events_idempotency_key` (unique, partial),
`shipment_events_external_event_id_key` (unique, partial),
`idx_shipment_events_timeline`, `idx_shipment_events_audience`,
`idx_shipment_events_status_history` (partial),
`idx_shipment_events_recorded_at`; function
`guard_shipment_events_append_only()` + trigger
`trg_shipment_events_append_only`; RLS + 4 policies; functions
`shipment_transition_facts()`, `apply_shipment_transition()`,
`append_shipment_event()`, `set_shipment_appointment()`,
`apply_shipment_correction()` — all `security definer`, EXECUTE to
`service_role` only.

**ROLLBACK:**

```sql
drop policy if exists "staff manage shipment events" on shipment_events;
drop policy if exists "shipper member read shipment events" on shipment_events;
drop policy if exists "carrier member read shipment events" on shipment_events;
drop policy if exists "broker member read shipment events" on shipment_events;
alter table shipment_events disable row level security;
drop function if exists public.apply_shipment_transition(uuid, shipment_status, shipment_status, shipment_event_source, uuid, shipment_event_visibility, timestamptz, text, text, text, text, numeric, numeric, jsonb, text, text, text, shipment_event_type);
drop function if exists public.apply_shipment_correction(uuid, shipment_status, shipment_status, text, uuid, shipment_event_visibility, text, timestamptz, jsonb, text);
drop function if exists public.set_shipment_appointment(uuid, eta_kind, timestamptz, shipment_event_source, uuid, shipment_event_visibility, text, text, text, text);
drop function if exists public.append_shipment_event(uuid, shipment_event_type, shipment_event_source, uuid, shipment_event_visibility, timestamptz, text, text, text, text, numeric, numeric, jsonb, text, text, shipment_status);
drop function if exists public.shipment_transition_facts(uuid);
drop trigger if exists trg_shipment_events_append_only on shipment_events;
drop function if exists public.guard_shipment_events_append_only();
drop table if exists shipment_events cascade;
```

**Destructive** — drops the entire timeline of every shipment. Take a dump
first (`pg_dump -t shipment_events`). **Mind the order**: the append-only
trigger goes before the table, because `drop table` is DDL and does not fire it
while any attempt to clear rows first would. Roll back
`src/lib/supabase/database.types.ts` and delete
`src/lib/shipments/apply-transition.ts` in the same deploy, or the build
references functions that no longer exist. `shipments`, `shipment_parties` and
`shipment_assignments` are untouched and keep working — statuses simply stop
being writable through the engine.

No rollback is needed for 0017/0018; this migration adds to them and modifies
nothing they created.

### The append-only trigger has one documented consequence

`shipment_events.shipment_id` carries `on delete cascade`, so **a shipment that
has any event can no longer be deleted** — the cascade fires the trigger and the
statement aborts. That is intentional. §15's admin capabilities are suspend
tracking, revoke public codes, mark sensitive and manage retention; "delete a
shipment" is not among them, and a brokerage record holding a real customer's
freight is not a row anybody should be able to make disappear. §26's retention
purger (M-84b) targets `shipment_locations`, not the timeline. If a lawful
erasure requirement ever lands, it arrives as a visible migration that drops and
recreates this trigger inside an audited procedure — reviewed as such, not
discovered as an absent guard. The RLS suite asserts the refusal explicitly.

---

## Security review

### The policy matrix

| Table | staff | shipper member | carrier member | broker member | anon |
|---|---|---|---|---|---|
| `shipment_events` | ALL | SELECT bands `public`+`shipper` on own shipments | SELECT bands `public`+`carrier` on assigned shipments | SELECT bands `public`+`broker` on linked shipments | **none** |

| Function | anon | authenticated (incl. admin) | service_role |
|---|---|---|---|
| all five | ✖ | ✖ | ✔ |

Five decisions worth arguing:

- **No anon policy.** §19: *"Do not use direct anonymous table SELECT access."*
  The anon key ships in the browser bundle; any anon policy would make M-73's
  tracking-number validation, secondary credential, rate limit, enumeration
  protection and public DTO all optional.
- **No customer write policy, and no customer EXECUTE grant.** Carrier updates
  (M-76) go through a server action calling these functions with the service
  role, after the actor gate. The RLS suite asserts that even an **admin**
  session is refused `42501` on all five functions.
- **The band lists are `AUDIENCE_EVENT_VISIBILITY` verbatim.** §7's model is
  written twice — once in `dto.ts` for serialization, once in SQL for row
  access — and `tests/unit/shipment-transitions.test.ts` **parses migration
  0019** and compares the two. A widening on either side fails the unit suite.
- **`staff_only` appears in no customer policy.** §7's one absolute sentence,
  asserted per audience plus anon, and also asserted structurally by the parse
  test above.
- **`visibility` defaults to `staff_only`.** Privacy-first, the same defaulting
  M-71 used for `public_tracking_enabled` and `location_visibility`. A writer
  that forgets to choose publishes nothing.

### Residual risks, stated plainly

**R-1 (inherits M-71's R-1) — RLS is row-level, so `metadata` and
`internal_message` on a row a customer *may* read are in the payload.** A
shipper reading their own shipper-band event through raw PostgREST receives
those columns. §7's rule that a staff-only note never reaches a customer is met
(the *row* is unreachable), but a shipper-band event that carelessly carries
internal commentary would be visible. The DTO layer (`CustomerEventDto`, M-70)
excludes both fields by construction and is pinned by
`tests/unit/shipment-dto.test.ts`; a column-level fix needs either a customer
view or a separate DB role for staff reads, both of which touch shipped
surfaces. **M-83** already owns exactly this, for the financial columns.

**R-2 (inherits M-71's R-2) — dispatcher scoping is query-level.** `"staff
manage shipment events"` does not distinguish dispatcher from admin, exactly as
0002/0009/0018 do not. `src/lib/staff-scope.ts` is the control. Plan §4 assigns
the database-level version to **M-83**.

**R-3 — the two incomplete preconditions are caller-supplied.**
`approvedPodDocumentId` and `closeoutCompletedAt` come from the caller, so a
caller could assert them falsely. For POD that is currently impossible in
practice (no document table exists to produce an id from), and M-77 replaces it
with a real lookup. For closeout it is inherent — it is a human judgement — and
the mitigation is that the assertion is made by a staff surface and journalled
in `audit_events`.

**R-4 — the compare-and-swap is optimistic, not a lock.** Two writers do not
corrupt each other, but the loser must retry with fresh facts. M-75's UI must
surface `status_conflict` as "somebody else moved this shipment; reload" rather
than as a generic error, or dispatchers will retry blindly.

---

## Performance review — the §25 index table

§25 asks for *"event timeline pagination or sensible limits"*, *"indexed
status/date/organization columns"*, *"no N+1"* and *"database indexes
documented"*.

| Index | Columns | Query it serves |
|---|---|---|
| `idx_shipment_events_timeline` | `(shipment_id, event_time desc, id desc)` | THE timeline query. `id desc` is the tiebreaker that makes **keyset pagination stable** — two events can share an `event_time` to the microsecond after a provider backfill, and an unstable sort key makes page 2 skip or repeat rows |
| `idx_shipment_events_audience` | `(shipment_id, visibility, event_time desc)` | The audience-filtered timeline every customer surface runs (M-73/M-74/M-76). With it, a shipper's page never touches a `staff_only` row at all |
| `idx_shipment_events_status_history` | `(shipment_id, status, event_time desc)` partial | §15 "view status history" / "audit who changed each status", and the engine's own `pickup_confirmed_at` / `delivered_at` fact lookups |
| `idx_shipment_events_recorded_at` | `(recorded_at desc)` | §14's cross-shipment operational sweeps and M-84b's observability queries |
| `shipment_events_idempotency_key` | `(idempotency_key)` unique, partial | The retry lookup. **Global**, not per shipment: an idempotency key is a property of the *attempt*, so a retry carrying a corrupted shipment id must still be recognised as a retry |
| `shipment_events_external_event_id_key` | `(shipment_id, external_event_id)` unique, partial | §9 Mode C provider dedupe. **Per shipment**, because provider event ids are unique within a provider's stream and M-80 connects one provider per shipment |

**No N+1:** `shipment_transition_facts()` returns every §20 fact plus the
current status in one query. Fetching five facts as five selects from a server
action is exactly the shape §25 names.

§25's remaining requirements (server-side pagination, cache rules, lazy map,
summary-vs-history split, background notification processing) are route and
query-shape concerns belonging to M-73/M-74/M-79/M-82. M-72 owns the indexes
those queries will need, and the DTO split M-70 already provides
(`ShipmentDtoInput.events` is optional, so a header render costs no second
query).

---

## Endpoints

**None.** No route, no server action, no API handler. `apply-transition.ts` is
a library M-75/M-76 will call.

## Env vars

**None.** `SUPABASE_SERVICE_ROLE_KEY` is already required; without it every
entry point returns `not_configured` and writes nothing, the M-14
graceful-degradation idiom the repo uses everywhere. The build is unchanged at
**343 pages**.

---

## Deployment

Apply `0019` after `0017` and `0018`. Pure DDL plus five function definitions;
milliseconds on an empty schema, no backfill, no lock on an existing table.

Nothing changes operationally on deploy: `brokerage_active` stays `false`, so
0017's §2 gate refuses every shipment insert and there is nothing for the
engine to move. The tracking system continues to ship **ready and dark**.

Verify with the three commands CI uses:

```bash
npm test                 # 353 unit
npm run test:rls         # 339 assertions — rebuilds from 0001 → 0019 + seed + fixtures
npm run test:integration # 33 tests — rebuilds from 0001 → 0019 + seed, engine ↔ SQL
```

---

## Tests

| Suite | Count | New in M-72 |
|---|---|---|
| `npm test` (vitest) | **353** (was 268) | **+85** |
| `npm run test:rls` | **339** (was 280) | **+59** assertions |
| `npm run test:integration` | **33** | **new lane** |
| `npx playwright test` | 160 (unchanged) | No surface exists to exercise |

### Unit — 85 across three files

- **`shipment-transitions.test.ts` (45)** — exhaustiveness (every status has a
  transition list, a precondition list, and only real targets; every actor has a
  permitted-target list); the **full matrix** (all 47 declared edges accepted,
  all 259 undeclared ordered pairs refused, all 18 self-transitions refused with
  `same_status`, both terminal statuses proved terminal); a guard that the graph
  is **not** the declaration order; each of the seven preconditions independently
  with a positive control; the §19 actor gate per actor; `availableTransitions`;
  and a proof that every refusal for every (from, to, actor) triple returns
  rather than throws. Plus the **SQL↔TS drift guard** that parses migration 0019.
- **`shipment-apply-transition.test.ts` (29)** — the client is mocked, so what
  is proved is the layer: validation runs before any write (an illegal edge
  costs one read and zero mutations), preconditions and the actor gate
  short-circuit, replays are surfaced and receive **no** audit row, all five
  SQLSTATEs map to distinct typed codes, the correction flow demands an admin
  and a non-blank reason before touching the database, appointments emit
  set-vs-rescheduled with old→new, and every failure emits a §26 signal.
- **`shipment-observability.test.ts` (11)** — §26's nine signals exactly; the
  record shape (allow-list, no coordinate field); eight credential shapes each
  redacted; fail-closed rather than partially masked; truncation; and that the
  logger never throws even when the transport does.

### Integration lane — the restored §27 tier

`npm run test:integration` builds a throwaway database from the shim + the
whole migration chain + the seed (**not** the RLS fixtures — this lane creates
its shipments *through the engine*), loads a small harness and runs vitest
against it.

**Why vitest reaching psql rather than a Node driver:** the tests import
`src/lib/shipments/transitions.ts` directly, so the engine's real verdict drives
the real SQL. `pg` would be a new devDependency to keep `npm audit` at zero for,
doing what a subprocess already does, and `scripts/run-integration-tests.sh`
needs `psql` regardless to build the database. The lane is single-threaded:
parallel workers would interleave transitions on one shipment and turn the
compare-and-swap conflict — the thing being proved — into a flake.

Four of §27's eleven named tests are provable today and are proved end to end:

| §27 test | Covered |
|---|---|
| create shipment | ✅ incl. the §2 gate refusing while `brokerage_active` is false |
| assign carrier | ✅ precondition fails without an assignment, holds with one |
| create shipment event | ✅ every status change writes its event atomically |
| update status | ✅ the full walk `quote_requested` → `completed` |
| public tracking lookup · shipper portal lookup · carrier update · document upload · POD upload · notification generation · exception lifecycle | **M-83b**, as M-73/M-74/M-76/M-77/M-78/M-79 land |

Plus, beyond §27's list: idempotent replay (the original event returned, **no**
second event, **no** status change), provider dedupe per shipment and its
non-vacuous cross-shipment control, `PL409`/`PL404`/`PL422` each raised for its
own cause, the event-sourced appointment set → reschedule → clear sequence with
old→new in `metadata`, §14's call/email/public/internal events, the correction
flow (history grows, the original event is byte-identical afterwards, the graph
is bypassed but the reason and the CAS are not), and the append-only refusal
asserted as the database owner.

### RLS — 59 new assertions (§8 of the suite)

Fixtures put **one event of each of the five visibility bands** on shipment A.
That shape is the point: with a single event per shipment, "shipper A sees 1
row" would be true whether the band filter worked or not.

- **Shipper A/B (14)** — sees exactly the `public`+`shipper` bands; reads zero
  `staff_only`, zero `carrier`, zero `broker`; reads nothing of the other
  shipper's timeline **including its public event**; no row it can read carries
  an `internal_message`; cannot insert, edit or delete.
- **Carrier A/B (8)** — exactly `public`+`carrier`; **zero shipper-band**;
  membership (not ownership) grants the same rows; carrier B sees nothing of A.
- **Broker A/B/C (9)** — exactly `public`+`broker`; zero shipper, carrier and
  staff_only bands (§12's must-not-see list); broker B isolated; a member of an
  **unapproved** organization reads nothing at all.
- **Non-member + anon (4)** — `reads_nothing`, plus insert refusals.
- **Staff (4)** — dispatcher and admin read all 7 rows and both `staff_only`
  notes (which is what makes every zero above a policy result rather than an
  empty table), staff **can** append, and staff **cannot** edit.
- **Table guarantees as the table OWNER (16)** — append-only refuses UPDATE,
  single DELETE and bulk DELETE; a shipment with events cannot be deleted;
  every row survives; duplicate idempotency key rejected `23505` (globally, and
  a different key inserts normally); many NULL keys allowed (partial index);
  provider id duplicate rejected per shipment but allowed across shipments;
  `status_change` without a status rejected `23514`; `correction` without a
  reason rejected `23514`, with one accepted.
- **Function grants (4)** — an **admin** session, and anon, each refused
  `42501` on the write functions and on the facts read.

### Anti-vacuity — proven, not asserted

Five defects were injected one at a time and the suites re-run; each failed
loudly, then the tree was restored and the suites returned to green.

| Injected defect | Suite | Assertion that caught it |
|---|---|---|
| Shipper policy band list widened to include `staff_only` | RLS | *shipperA sees exactly 2 events* (expected 2, got 3) |
| Carrier policy widened to include the `shipper` band | RLS | *carrierA sees exactly 2 events* (expected 2, got 3) |
| `trg_shipment_events_append_only` removed | RLS | *even STAFF cannot edit an event* — write changed 1 row |
| `shipment_events_idempotency_key` made non-unique | RLS | *a duplicate idempotency_key is rejected* — statement was ALLOWED |
| Broker policy widened to include the `shipper` band | **unit** | *0019's broker policy matches AUDIENCE_EVENT_VISIBILITY.broker* |

The last one is worth noting: the SQL↔TS drift guard catches a policy widening
**without a database**, in `npm test`, which is the lane that runs on every
commit.

**Honest limitation.** The RLS suite proves what a *session* can reach; the
integration lane proves the engine and the SQL agree; neither proves that M-74
selects the right columns or that M-73 calls `toPublicTrackingDto` — those are
M-83's DTO tests. And the two caller-supplied preconditions (R-3) are trusted by
construction until M-77 lands.

---

## Files

**New:** `supabase/migrations/0019_shipment_events.sql` ·
`src/lib/shipments/transitions.ts` · `src/lib/shipments/apply-transition.ts` ·
`src/lib/shipments/observability.ts` ·
`tests/unit/shipment-transitions.test.ts` ·
`tests/unit/shipment-apply-transition.test.ts` ·
`tests/unit/shipment-observability.test.ts` ·
`tests/integration/00_harness.sql` · `tests/integration/helpers/db.ts` ·
`tests/integration/shipment-lifecycle.test.ts` ·
`scripts/run-integration-tests.sh` · `vitest.integration.config.ts` · this doc.

**Changed:** `package.json` (the `test:integration` script) ·
`src/lib/supabase/database.types.ts` · `supabase/tests/10_fixtures.sql` ·
`supabase/tests/20_rls_isolation.sql` · `docs/modules/INDEX.md` ·
`docs/LAUNCH-RUNBOOK.md`.

---

## Extension points

- **M-73** (public `/track`) reads the timeline through the **service role** —
  there is no anon policy and adding one defeats §19's whole model. Filter with
  `filterEventsFor("public", …)` and serialize with `toPublicTrackingDto`; the
  `idx_shipment_events_audience` index is written for that query shape.
- **M-75** (dispatcher operations) is the UI for everything here. It must
  render `availableTransitions(status, actor, facts)` rather than the raw graph,
  surface `status_conflict` as "somebody else moved this shipment; reload"
  (R-4), supply the **closeout assertion** for `completed`, and enforce §2's
  gate in the service layer with a human message. §14's `record call` /
  `record email` / public-update / internal-note forms all call
  `appendShipmentEvent` — do not invent new event types.
- **M-76** (carrier + driver updates) calls `applyShipmentTransition` with
  `actor: "carrier"` or `"driver"`. The gate is already narrow; widening it
  means editing `ACTOR_PERMITTED_TARGETS` in a reviewed diff, not passing
  `actor: "dispatcher"` from a carrier surface.
- **M-77** (documents) completes the `approved_pod_required` precondition by
  replacing one literal in `shipment_transition_facts()` — the exact expression
  is in 0019's comment. It should also widen `ACTOR_PERMITTED_TARGETS.system`
  to include `pod_uploaded` if approval is to move the status automatically.
- **M-78** (ETA + exceptions) already has its `eta_update`,
  `exception_opened` and `exception_resolved` event types; it appends through
  `appendShipmentEvent` and adds its own tables. `shipment_eta_history.event_id`
  now has a real referent.
- **M-79** (notifications) gets idempotency for free: pass the notification's
  dedupe key as `idempotencyKey` on a `notification_sent` event and a retried
  worker cannot double-send.
- **M-80** (providers) writes `location_update` events with
  `external_event_id`; the per-shipment unique index is the Mode C dedupe §9
  requires, and it exists from the first migration rather than being retrofitted
  onto history it could not deduplicate.
- **M-83** inherits R-1 (row-level RLS does not hide `metadata` /
  `internal_message` from a readable row) and R-2 (dispatcher scoping stays
  query-level), alongside M-71's identically-named risks.
- **M-83b** extends `tests/integration/` with §27's remaining seven tests. The
  lane, the runner, the harness and the npm script exist; adding a file is the
  whole cost.
- **M-84b** replaces the body of `logShipmentSignal` with a Sentry capture. No
  call site changes — that is why the shape is fixed here.
