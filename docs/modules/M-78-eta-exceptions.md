# M-78 — ETA Architecture + Exceptions/Delays

**Status:** ✅ Complete · **Phase:** B (tracking core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-78 —
*"ETA architecture (8 fields incl. `eta_confidence`, public/internal delay
reasons), ETA-change events, previous-value history; exceptions (13 types, 10
fields, open/resolve lifecycle)"*. Authority: `docs/DIRECTIVE-tracking.md` §10
(the ETA field list and the three obligations when an ETA changes), §21 (the 13
types, the 10 fields, the customer-honesty rule), §6, §7, §17, §19, §24, §25,
§26, §30.

Migration **0025**. Migrations 0001–0004 remain frozen; 0017–0024 are untouched
except for the `create or replace` of `set_shipment_eta()` that M-75 assigned to
this module by name.

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0025_shipment_eta_exceptions.sql` | `shipment_eta_history` + `shipment_exceptions`, their triggers and policies, `my_shipment_exceptions()`, `open_/resolve_/update_shipment_exception()`, `backfill_shipment_exceptions()`, and the replaced `set_shipment_eta()`. |
| `src/lib/shipments/eta-estimate.ts` | The distance/HOS transit estimator. The one thing that makes `eta_source = 'calculated'` an honest label. Pure, no `server-only`. |
| `src/lib/shipments/exceptions.ts` | §21's server half: the staff read, the customer read through the accessor, and open / triage / resolve over the 0025 functions. |
| `src/lib/shipments/eta.ts` | Rewritten: the calculated path, §10's customer notification, and the history row in the result envelope. |
| `src/lib/shipments/phrases.ts` | D-6 extended — a fourth group (`resolution.*` ×8) and three new `delay.*` phrases, plus `PHRASE_GROUPS` / `phrasesInGroup()`. |
| `src/lib/shipments/public-lookup.ts` | The §21 banner, wired. |
| `src/lib/shipments/types.ts` | `DISPATCHER_ETA_SOURCES` widened by one; `UNREACHABLE_ETA_SOURCES` added; `ShipmentExceptionRow` +2 fields; three new `@staffOnly` tags. |
| `src/lib/shipments/dto.ts` | `StaffExceptionDto` carries the two new provenance fields. Customer DTOs unchanged, which is the point. |
| `src/app/actions/dispatcher-shipments.ts` | `logExceptionAction` now writes a row; `resolveExceptionAction` and `triageExceptionAction` are new. |
| `src/app/actions/{carrier-shipments,driver-updates}.ts` | §13's "submit exception" opens a real row. |
| `src/components/portal/ShipmentOpsForms.tsx` | `ResolveExceptionForm`, `TriageExceptionForm`, the calculated-ETA copy. |
| `src/components/portal/ShipmentStaffDetailView.tsx` | The exception register — §21's ten fields on one surface. |
| `messages/{en,es,fr,ht,ru}.json` | 16 keys × 5 locales. |
| Tests | 3 new/extended unit files (69 new assertions), 1 new integration file (28), a new RLS section (50), a new e2e spec (13). |

---

## The honest statement this module owes: which ETA sources are real

§10 names four ETA sources and §30 forbids claiming capabilities that do not
exist. M-75 read those two sentences together and shipped
`DISPATCHER_ETA_SOURCES` with **two** members, writing down why: *"`calculated`
and `provider` describe machinery that does not exist yet … a dropdown offering
them would let an operator label a typed guess as a computed prediction."*

M-78 widens it by **exactly one**, and only because the machinery now exists.

| Source | State | What it means, exactly |
|---|---|---|
| `manual` | **Real** | A human typed it. Rendered to the customer as §30's *"ETA provided by dispatcher"*. |
| `dispatcher_adjusted` | **Real** | A human revised it. Same label, same claim. |
| `calculated` | **Real, as of this module** | The **server** computed it from `shipments.distance_miles` by the stated method below. The submitted datetime is **discarded**. Rendered as *"Estimated from distance and standard transit times"* — a different sentence, because it is a different claim. |
| `provider` | **Deliberately unreachable** | Nothing in this codebase receives an ETA from Motive, Samsara, Geotab or Verizon Connect. M-80 owns those adapters. No form offers it, no code path writes it, and a unit test asserts nothing in `eta.ts` sets it. |

### The method, in full, so it can be argued with

```
driving hours  = distance ÷ 50 mph            planning speed, not a limit
resets         = ⌈driving hours ÷ 11⌉ − 1     49 CFR §395.3(a)(3)(i)
rest hours     = resets × 10                  49 CFR §395.3(a)(1)
dwell          = 2 h pickup + 2 h delivery    standard free time before detention
eta            = departure + driving + rest + dwell,  rounded UP to 5 minutes
```

Every constant is sourced in the file. There is no fitted parameter, no fudge
factor, and the only rounding rounds **late** — an early arrival is a good
surprise and a late one is a complaint.

**What it is not**, said out loud because §30 requires it and because a reader
six months from now will want to know: it is not a prediction (it does not
learn, has no model, and returns the same answer for the same inputs forever);
it is not traffic-, weather- or route-aware (it has no map, only a mileage
number somebody else supplied); it is not live (nothing recomputes it as the
truck moves); and it is not AI. `describeEstimate()` says all of that on the
staff record, and a test asserts the word "AI" never appears in what it writes.

**Confidence is capped at `medium`.** `high` belongs to an *observed* ETA — a
provider feed, a driver at the dock — and nothing in this product produces one.
A calculator that graded its own output high-confidence would be making exactly
the claim §30 forbids, in a field instead of in a sentence. `medium` inside one
driving day, `low` beyond it, because past 550 miles every extra day compounds a
reset the driver takes when *they* choose.

**Refusal, not fallback.** No mileage means no estimate: `estimateEta` returns
`{ ok: false, reason: "no_distance" }`, `setShipmentEta` returns
`cannot_calculate` with an operator-readable message, and §26's
`eta_calculation_failure` signal fires. There is no "assume 500 miles" branch,
and a unit test greps the module to prove it.

**Which source is offered is DATA, not prose.** `DISPATCHER_ETA_SOURCES` and
`UNREACHABLE_ETA_SOURCES` must partition `ETA_SOURCES` exactly, asserted by
test. A future provider adapter has to move `provider` between the two lists in
the same commit that makes it true.

---

## §10's three obligations when an ETA changes

> *"create a shipment event; notify the customer according to preferences;
> preserve previous ETA values in history or metadata."*

### 1 · The event — unchanged, and deliberately so

0022's `eta_update` event still fires, still carries the previous value in its
`metadata`. M-78 did **not** remove that copy. §7 is append-only, and deleting
what past events said would rewrite history to tidy up a duplication.

### 2 · The history — the table M-71 deferred

`shipment_eta_history` now exists, matching M-70's `ShipmentEtaHistoryRow`
column for column, and `set_shipment_eta()` inserts a row in the **same
transaction** as the column write and the event. An ETA that moved without a
history row is not a state the system can reach.

It is append-only (a trigger refuses UPDATE and DELETE for every role including
the owner) — the single purpose of the table is to be the record of what the ETA
*used to be*, and an UPDATE would destroy the one fact it exists to keep.

It is **staff-only**. `reason_internal` lives there. A customer's ETA history is
the `eta_update` events already on their timeline, which is §10's *"history **or**
metadata"* satisfied for them.

### 3 · The notification — the decision, and the argument

**Decided: call the existing `notifyCustomer` fan-out, with `email` omitted.**

§17 names two launch channels: email and in-app notifications.
`src/lib/notify.ts` is M-60's shipped fan-out — used by five existing flows,
already resolving the recipient's locale from `profiles.preferred_language`. It
writes the in-app row and, *when given a built email*, sends it.

So this module calls it and passes no email. That is the honest reuse:

- the **in-app notification is real today** — the row appears in the shipper's
  portal feed, linked to the shipment, the moment the delivery ETA moves;
- the **localized email is not**, because there is no shipment email template in
  `src/emails/`, and inventing one here would be M-79's eleven customer events,
  idempotency, dedupe, retry-with-backoff and preference matrix built badly in
  one file. `email: null` sends nothing and claims nothing.

The alternative considered and rejected was "emit a trigger and hand off
cleanly" with no notification at all. It was rejected because the hand-off
**already exists** — the `eta_update` event is what M-79's worker selects on,
and it is already written, already carries the previous and new values, and
already takes an idempotency key. Writing a second, dormant queue row beside it
would be a queue with no consumer; writing nothing at all would mean a customer
whose ETA moved learns nothing until M-79 ships, when a real channel is sitting
there unused.

**"According to preferences", stated exactly.** The only customer preference
that exists today is `profiles.preferred_language`, and `notifyCustomer` honours
it. There is no per-event opt-out table; M-79 owns it. This module does not
pretend to consult one.

Two rules it *does* apply, because they are §10's own logic and not M-79's:

- a **pickup** ETA change notifies nobody. §17's customer list names *"delivery
  ETA updated"*; a pickup ETA is operational scheduling between dispatch and the
  carrier, and the shipper sees it on their timeline where it belongs.
- a **replayed** write notifies nobody. A retried form submission must not
  produce a second notification — the one dedupe rule that can be honoured
  without M-79's infrastructure.

The notification title carries the tracking number and nothing else. §17: *"do
not expose sensitive data"* — a feed row may be summarised in a push payload
later and has no business carrying a delay reason or a customer's own reference.

---

## §21 — exceptions

### Why the customer bands are a FUNCTION and not four policies

0024 gave `shipment_documents` a policy per audience, because every column of a
document row is safe for whoever may read the row at all. That is not true here.
§21 is emphatic about one column:

> *"Do not expose blame, legal conclusions or sensitive internal commentary."*

`internal_description` and `resolution` are exactly that, and **a row-level
policy cannot restrict a column**. A `select *` from a shipper session under a
permissive row policy would hand the shipper the dispatcher's account of whose
fault the delay was. A column-level `REVOKE` cannot help either: staff and
customers are both the `authenticated` role, so a revoke that protects the
shipper also blinds the dispatcher.

So the base table carries the **staff policy and nothing else** — a customer
session reads zero rows, and zero rows is zero columns — and the customer path
is `my_shipment_exceptions()`, a `security definer` function whose
`returns table (…)` clause is a **seven-column allow-list with no internal field
in it**. The projection is enforced by the function's *type*, which no future
`select *` can widen.

**The audience is resolved inside the function, never passed in.** A parameter
would be privilege escalation by argument: a shipper passing `'staff'` would
read the internal commentary. The function asks the caller's own memberships
through 0018's three shipped helpers.

`/track` does not use it — that path already runs under the service-role client
behind §4's two-factor check, and §4 gives anonymous visitors no table access at
all. Its projection (`PUBLIC_EXCEPTION_COLUMNS`) names neither forbidden column,
and the widener writes both as literal `null`, so the values are not in the Node
process on a customer request.

Three independent constructions of one guarantee, none relying on the others:
the accessor cannot return them · the widener nulls them · `CustomerExceptionDto`
names neither. A bug in any one is caught by the other two.

### The ten fields, and the two beyond them

§21's ten are all present: severity · public description · internal description
· `opened_at` · `resolved_at` · `opened_by` · `assigned_to` · customer notified ·
resolution — plus `exception_type` over the 13-value enum 0017 already created.

`customer_notified_at` is a **timestamp, not a boolean**. A boolean answers "did
we tell them"; §17's duplicate suppression and every "when did they find out?"
conversation need "when". A null is the same false a boolean would have carried.

Two columns beyond the list, each argued rather than assumed:

- **`source_event_id`** — the `exception_opened` event this row was opened by, or
  *backfilled from*. Unique, which is what makes the backfill idempotent, and
  what lets §7's ledger and this lifecycle table be reconciled by a join rather
  than by a timestamp heuristic.
- **`resolution_event_id`** — the `exception_resolved` event that closed it.
  Chosen over a `resolved_by` + resolution-timestamp pair: the event already
  records the actor, the time and the wording under §7's append-only guarantee,
  and a pointer to it cannot disagree with it the way a copy can.

### The lifecycle, enforced in the database

§21 describes a lifecycle but not its rules. These are the ones that must hold
whatever writes the row, and each exists because its absence is a real failure:

- **What the exception IS cannot change.** `shipment_id`, `exception_type`,
  `opened_at`, `opened_by` and `source_event_id` are frozen after insert.
  Re-typing a `damaged_freight` into a `traffic` after the claim is filed
  rewrites history; opening a second exception does not.
- **Resolution is one-way.** Once set, `resolved_at` cannot be cleared or moved.
  Re-opening is a NEW exception, which is also what leaves the reopen visible.
- **Notification is one-way.** `customer_notified_at` cannot be cleared: the
  customer either was told or was not.
- **A resolved exception is closed to triage.** Re-assigning or re-severitying a
  closed exception is almost always somebody operating on the wrong row.
- **A resolution needs words** (CHECK), and **an exception needs at least one
  description** (CHECK).

Visibility is **not** a caller's choice. 0025 decides it: a public description
means the customer is being told, so the event is `public`; none means
`staff_only`. "The customer was told" and "there is a customer-facing sentence
on the record" must be the same fact.

### Server-side authorization on the lifecycle actions

`resolveExceptionAction` and `triageExceptionAction` run **two** checks.
`gate()` establishes that this staff member may act on this *shipment* (§19's
dispatcher scope, re-read from the session and not from the form). The second
checks that the chosen *exception* belongs to that shipment — without it, a
dispatcher legitimately scoped to shipment A could resolve an exception on
shipment B by editing one hidden field. Both refusals are asserted, and the RPC
is asserted **not** to have been issued.

---

## The M-75/M-76 backfill

M-75 shipped exceptions as structured `exception_opened` events carrying
`metadata.exception_source = "m75_event_only"` and said in its own doc:
*"M-78 backfills from"* them. M-76 added `m76_carrier_report` and
`m76_driver_report` on the same contract. `backfill_shipment_exceptions()`
honours it.

**Nothing is deleted.** The backfill INSERTs and never updates or removes a
`shipment_events` row — and 0019's append-only trigger refuses an UPDATE or
DELETE from every role including the service role, so this is guaranteed rather
than merely intended. After it runs, both the event and the exception row exist
and point at each other. The event ledger is still the history; the table is the
**lifecycle**, which an append-only ledger cannot express (a row that closes is
not an event).

**Field for field:** the §21 type and severity out of `metadata`, the customer
wording out of `public_message`, the operational truth out of
`internal_message`, the time out of `event_time`, the actor out of `created_by`.
A backfilled exception is **open** — nobody resolved it, and inventing a
resolution would be worse than leaving the work visible.

**Idempotent by construction**: `source_event_id` is unique and the insert is
`on conflict do nothing`. The integration suite runs it twice and asserts the
second run inserts zero and duplicates nothing, because a migration that
duplicates on re-run is a migration nobody can safely re-run.

**Two events are deliberately skipped**, each a decision: one whose
`metadata.exception_type` is not a legal §21 value (it cannot be coerced
honestly, and filing it as `other` would be a fiction — it stays readable on the
timeline, which is where it already was), and one with neither description.

It ships as a **function that is then called**, not a bare INSERT, so an
operator can re-run it after a lagging replica or a rolled-back-and-reapplied
surface. `LAUNCH-RUNBOOK` records the command.

---

## D-6 — the phrase library, extended rather than duplicated

M-73 built the curated library for decision D-6: 29 phrases in three groups
(`update.*`, `delay.*`, `exception.*`), translated ×5, stored as a token
(`phrase:delay.traffic`) that `/track` renders in the visitor's own language.

M-78 adds a **fourth group and three delay phrases** to the *same object*, with
the same token prefix, the same resolver and the same `shipment.phrase.*` key
space — so `/track`, the shipper detail page and every dispatcher picker pick
them up with **no code change at all**.

- **`resolution.*` (8 new).** §21's lifecycle has two ends and D-6 furnished
  one. An exception that opens in the reader's own language and then closes in
  English — or, worse, closes silently and leaves a stale warning banner — is
  the failure D-6 exists to prevent, arriving one step later.
- **`delay.customs`, `delay.detention`, `delay.reroute`.** Three things
  dispatchers were reaching for free text to say. A curated phrase renders in the
  reader's language; free text renders in English under an honest label. Adding
  the phrase is strictly better.

`PHRASE_GROUPS` is now data, and `PhrasePicker`'s prop type reads from it — which
is why the fourth group was a one-line edit and a fifth will be too. A test
asserts every id belongs to exactly one group, so a phrase no picker can reach is
a failure rather than a dead translation in five catalogues.

**`exception.other` still does not exist**, deliberately, and the test re-asserts
it: §21's thirteenth type is the catch-all, and a canned sentence for "something
else happened" would either say nothing or say something untrue.

**Locales:** `en`/`es`/`fr` authored; `ru`/`ht` mirror English and are flagged in
the runbook for native review — the M-42/M-55/M-69/M-73/M-76 precedent, and the
only alternative to the machine translation §24 forbids. A test asserts `es`/`fr`
genuinely differ from `en` for every new phrase.

---

## §30 — a seventh honest label

§30 lists six honest labels and M-73 shipped all six ×5. M-78 adds one:
`shipment.label.eta_estimated` — *"Estimated from distance and standard transit
times"*.

This is not label inflation. A **calculated** ETA rendered under §30's *"ETA
provided by dispatcher"* would be a lie in the other direction — attributing a
machine's arithmetic to a human's judgement. Two different claims need two
different sentences, and a test asserts the two strings differ in all five
catalogues.

---

## §26 — ETA calculation failures

§26 names *"ETA calculation failures"* among its nine tracked signals, and until
this module nothing calculated. `eta_calculation_failure` now fires on the case
it was named for: the pipeline was asked for a number and honestly could not
produce one (`no_distance`, `distance_out_of_range`, `invalid_departure`). It
also still fires on a write failure, because the signal is about the ETA
pipeline failing to produce a value and a tenth string would fragment the
dashboard.

A **refused exception write** deliberately uses `unauthorized_access_attempt`
instead. A rejected write is an authorization or validation outcome, and reusing
the ETA signal would make the ETA pipeline's health dashboard lie about itself.

---

## DB changes

Migration **0025**. Two tables, five functions, one replacement, three triggers,
two policies, four indexes. No new enum — every one it needs
(`shipment_exception_type` ×13, `shipment_exception_severity` ×4, `eta_source`,
`eta_confidence`, `eta_kind`) was created by 0017.

```
shipment_eta_history      §10's previous values. Append-only. STAFF ONLY.
shipment_exceptions       §21's 10 fields + 2 provenance columns. STAFF ONLY at
                          the table; customers read my_shipment_exceptions().
my_shipment_exceptions()  the 7-column customer projection, audience resolved
                          from the caller's memberships. authenticated.
open_shipment_exception() row + exception_opened event, one transaction.
resolve_shipment_exception()  row + exception_resolved event, one transaction.
update_shipment_exception()   triage only, only while open, one-way rules.
backfill_shipment_exceptions()  M-75/M-76 events → rows. Idempotent.
set_shipment_eta()        REPLACED: same 13-parameter signature, +1 INSERT.
```

The `set_shipment_eta()` replacement is byte-identical in signature, so
`create or replace` preserves 0022's grants and neither
`src/lib/shipments/eta.ts` nor `database.types.ts` changes shape.

### Privileges

`revoke all … from authenticated, anon` then `grant select … to authenticated`
on both tables. The SELECT grant is required because `is_staff()` evaluates
inside an `authenticated` session and the policy needs something to filter; the
customer holds the same grant and reads zero rows. `anon` holds nothing at all.
Every write function is `security definer` with EXECUTE to `service_role` alone.

---

## Endpoints

No new route. Three new server actions on the existing dispatcher surface
(`resolveExceptionAction`, `triageExceptionAction`, plus `logExceptionAction`
rewritten), and the carrier/driver "submit exception" actions repointed.

## Env vars

**None.** Nothing in this module reads `process.env`, so it behaves identically
in the secretless build and e2e lanes.

---

## Deployment

1. Apply migration **0025**. It runs the backfill once and `RAISE NOTICE`s the
   count.
2. Deploy the application in the same release. The two must move together — see
   ROLLBACK.
3. Nothing to configure. No env var, no `company_settings` key, no feature flag.

Page count unchanged at **368**.

### ROLLBACK

**Order matters.** Restore M-75's `set_shipment_eta()` **first**, then drop:

```sql
-- 1. Re-run the `create or replace function public.set_shipment_eta(...)` block
--    from 0022 VERBATIM. Same body minus the history INSERT. Do this BEFORE
--    dropping the table, or every ETA update fails on a missing relation.
drop policy if exists "staff manage shipment exceptions" on shipment_exceptions;
drop policy if exists "staff manage shipment eta history" on shipment_eta_history;
drop function if exists public.backfill_shipment_exceptions();
drop function if exists public.my_shipment_exceptions(uuid);
drop function if exists public.update_shipment_exception(uuid, uuid, boolean, shipment_exception_severity, text, uuid);
drop function if exists public.resolve_shipment_exception(uuid, text, uuid, shipment_event_source, text, text, text);
drop function if exists public.open_shipment_exception(uuid, shipment_exception_type, shipment_exception_severity, text, text, uuid, uuid, shipment_event_source, text, jsonb);
drop trigger  if exists trg_shipment_exceptions_lifecycle on shipment_exceptions;
drop function if exists public.guard_shipment_exception_lifecycle();
drop trigger  if exists trg_shipment_eta_history_append_only on shipment_eta_history;
drop function if exists public.guard_shipment_eta_history_append_only();
drop table if exists shipment_exceptions cascade;
drop table if exists shipment_eta_history cascade;
```

**Destructive for the LIFECYCLE, not for the HISTORY.** Every exception ever
opened still exists as an `exception_opened` event and every resolution as an
`exception_resolved` event — that is the whole reason both functions write an
event as well as a row. What is lost is `assigned_to`, `customer_notified_at`,
the resolution text and the open/closed state. **Take a dump first**
(`pg_dump -t shipment_exceptions -t shipment_eta_history`). ETA history reverts
to the event metadata M-75 already wrote, which is where it lived before.

Roll back `src/lib/shipments/{exceptions,eta,eta-estimate}.ts`, the four
surfaces and the three server-action files in the **same deploy**. It fails
CLOSED either way: with the table gone, `my_shipment_exceptions()` is gone too,
the customer DTOs receive an empty exception list, and the banner disappears
rather than rendering an error.

`shipments`, `shipment_events`, `shipment_documents`, assignments and driver
tokens are untouched and need no rollback of their own.

---

## Tests

| Suite | Count | New in M-78 |
|---|---|---|
| `npm test` (vitest) | **1148** (was 1061) | 87 |
| `npm run test:rls` | **552** (was 502) | 50 |
| `npm run test:integration` | **222** (was 194) | 28 |
| `npx playwright test` | **253** (was 240) | 13 |
| `npm run build` | **368 pages** (unchanged) | — |

`tests/unit/shipment-eta-estimate.test.ts` (30) — the stated method at four
distance bands including both sides of the 11-hour boundary; the `ceil − 1`
reset count; late rounding; determinism; five refusals with no fallback branch
(proved by grepping the module); confidence never `high` across the whole
estimable range; the internal description naming its method and its legal basis
and never a word claiming intelligence; and **the partition proof** —
`DISPATCHER_ETA_SOURCES ∪ UNREACHABLE_ETA_SOURCES = ETA_SOURCES` with no
overlap, plus a grep asserting nothing in `eta.ts` writes `provider`.

`tests/unit/shipment-exceptions.test.ts` (33) — the §21 sentinel sweep across
all four customer serializers with the staff DTO and a naive passthrough as the
two non-vacuity controls; the seven-key customer exception; the null-description
omission; the widener nulling every withheld field; all 13 types × 4 severities
through the schema; the blank-resolution refusal with its message; triage
treating blank as "leave it alone"; and the D-6 extension — four groups, every
id in exactly one, every phrase present in all five catalogues, `es`/`fr`
genuinely differing from `en`, no blame vocabulary in any resolution phrase, and
`exception.other` still absent.

`tests/unit/shipment-public-lookup.test.ts` (+6) — the banner surfaces on the
public DTO; the projection names neither forbidden column; the read is bounded
below the event cap; and it **fails soft** where the timeline read fails hard,
which is asserted with the reasoning in the test.

`tests/unit/shipment-dto.test.ts` — the `@staffOnly` static scan now covers
`delay_reason_internal`, `internal_description` and `resolution` as well as the
three money columns. Those three were always swept; they were not covered by the
scan that guarantees a *new* forbidden column gets a sentinel. They are now.

`tests/integration/shipment-eta-exceptions.test.ts` (28) — §27's eleventh named
test, *exception lifecycle*, plus the backfill walk (field for field, event
count unchanged, second run inserts zero, `m78_*` events not re-migrated, an
illegal type skipped rather than coerced, and a non-vacuity case proving the
backfill does insert), the ETA history chain (first ETA, previous value, cleared
ETA, no-op refusal, pickup/delivery separation, append-only), the TS estimator
agreeing with the stored value, and the customer surfaces through the **real
session client**.

`supabase/tests/20_rls_isolation.sql` (+50) — catalog facts (RLS on, exactly one
policy each, write grants revoked, SELECT retained as the non-vacuity control);
shipper, carrier and broker all reading nothing from the base tables while a
dispatcher reads everything; the accessor per audience including an unapproved
broker and an unaffiliated user; **the return type read out of `pg_proc`**, so a
future `alter function` that added `internal_description` fails here even though
every row assertion would still pass; a SQL sentinel sweep with a staff mirror;
the four 42501 refusals with the service-role control; and six lifecycle
refusals with a legal triage UPDATE as the non-vacuity control.

`tests/e2e/shipment-eta-exceptions.spec.ts` (13) — gating in five locales, the
public refusal carrying no banner and no internal vocabulary, §30's two ETA
claims present in the **built** app and six forbidden claims absent, the labels
translated in all five locales (a key added to `en.json` alone renders as the
key and fails), axe with zero violations, and five viewports from 320px.

### Non-vacuity by injection

Each of these was injected, the suite was run, and the named test failed:

| Injected defect | Caught by |
|---|---|
| `toCustomerExceptionRows` passes `internal_description` through | unit sentinel sweep ×4 audiences |
| `my_shipment_exceptions()` gains an `internal_description` OUT column | RLS `pg_proc` assertion |
| the customer policy is widened to `shipper_id in (select my_shipper_ids())` | RLS `reads_nothing` ×3 |
| `estimateEta` falls back to 500 miles when distance is null | unit grep + refusal cases |
| `provider` added to `DISPATCHER_ETA_SOURCES` | unit partition proof |
| the backfill drops its `on conflict` clause | integration idempotency + duplicate check |
| the backfill deletes its source events | integration event-count assertion |
| `resolveExceptionAction` skips the shipment-ownership check | unit action test, RPC asserted not issued |

### Honest limitations

The e2e lane runs on placeholder credentials, so *"a dispatcher logs a delay →
the shipper and the public page both show it"* cannot be walked in a browser
without seeding a fabricated shipment — which §30 forbids beside fake GPS and
fake ETAs. The flow is proved where it can be: the write and the lifecycle in the
integration lane against real PG16, the per-audience visibility in the RLS lane
and the integration lane as real sessions, the wording and the banner in the unit
lane against the real components. The e2e spec says so at the top rather than
implying a coverage it does not have.

The estimator's accuracy is not tested, because accuracy is not a property of
arithmetic — what is tested is that it computes what it says it computes, refuses
when it cannot, and never grades itself higher than the method deserves.

---

## Files

**New:** `supabase/migrations/0025_shipment_eta_exceptions.sql` ·
`src/lib/shipments/eta-estimate.ts` · `src/lib/shipments/exceptions.ts` ·
`tests/unit/shipment-eta-estimate.test.ts` ·
`tests/unit/shipment-exceptions.test.ts` ·
`tests/integration/shipment-eta-exceptions.test.ts` ·
`tests/e2e/shipment-eta-exceptions.spec.ts` · this doc.

**Changed:** `src/lib/shipments/{eta,types,dto,phrases,public-lookup}.ts` ·
`src/lib/supabase/database.types.ts` ·
`src/lib/validation/dispatcher-shipments.ts` ·
`src/app/actions/{dispatcher-shipments,carrier-shipments,driver-updates}.ts` ·
`src/components/portal/{ShipmentOpsForms,ShipmentStaffDetailView}.tsx` ·
`src/app/[locale]/portal/{admin,shipper}/shipments/[shipmentId]/page.tsx` ·
`messages/{en,es,fr,ht,ru}.json` · `supabase/tests/{10_fixtures,20_rls_isolation}.sql`
· `tests/integration/helpers/{psql-supabase,psql-rls-supabase}.ts` ·
`tests/integration/dispatcher-operations.test.ts` ·
`tests/unit/{shipment-dto,shipment-public-lookup,dispatcher-shipment-actions,carrier-shipment-actions,dispatcher-shipments-a11y,shipment-public-tracking-ui,shipper-shipments-a11y,tracking-result-a11y}.test.*`
· `docs/modules/INDEX.md` · `docs/LAUNCH-RUNBOOK.md`.

### Assertions that were TRUE and are now FALSE, by design

Three, each inverted rather than deleted, with the reason recorded in place:

- `supabase/tests/20_rls_isolation.sql` — *"M-75 did NOT create
  `shipment_exceptions` or `shipment_eta_history`"* → both exist.
- `tests/integration/dispatcher-operations.test.ts` — the same absence, plus a
  new walk proving the event M-75 writes is backfillable and survives.
- `tests/unit/dispatcher-shipments-a11y.test.tsx` — the "Not here yet" list no
  longer names exception resolution or the ETA history, and now names the two
  things M-79 and M-80 own.

---

## Extension points

- **M-79** consumes the `eta_update` and `exception_opened` / `exception_resolved`
  events as its queue. Both already carry idempotency keys and previous values.
  Its preference table replaces the "language only" note in `eta.ts`, and its
  email builders replace the `email: null` argument — one line, one file.
- **M-80** moves `provider` out of `UNREACHABLE_ETA_SOURCES` and into
  `DISPATCHER_ETA_SOURCES` **in the same commit** that lands a real adapter. The
  partition test fails until both halves are done, which is the point.
- **M-81** already has the broker band: `my_shipment_exceptions()` resolves
  broker membership today and the RLS suite exercises it against a real broker.
- **M-82** takes the exception banner into §22's mobile priority order; it sits
  above the fold today and is asserted at 320px.
- **M-84b** replaces the body of `logShipmentSignal`, and
  `eta_calculation_failure` finally has a real producer to route.
- A **fifth phrase group** is a one-line addition to `PHRASE_GROUPS` plus its
  entries; every picker and every renderer already read from the data.
