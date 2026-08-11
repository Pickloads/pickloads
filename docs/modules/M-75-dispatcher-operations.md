# M-75 — Dispatcher Shipment Operations

**Status:** ✅ Complete (validated on PostgreSQL 16) · **Phase:** B (tracking
core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-75 —
*"Dispatcher operations: create shipment, quote→shipment conversion,
assignments, appointments, status/ETA updates, public update vs internal note,
**record call / record email**, exception logging, POD request, notification
resend, update history; operational board (8 columns) with server-side queries;
admin+dispatcher tracking-number search"* — with `record call` / `record email`
restored per the plan's §4 table (§14) and §5's search restored per the same
table. Authority: `docs/DIRECTIVE-tracking.md` §§2, 3, 5, 7, 11, 14, 15, 19, 20,
21, 22, 23, 24, 25.

Engine and correction RPC: **M-72, called, never reimplemented.** Vocabulary and
DTOs: **M-70**. Schema: **M-71** (0017–0018), **M-72** (0019), **M-73** (0020),
**M-74** (0021). One new migration, **0022** — four functions and nothing else.
Query idiom and filter builder: **M-74's, reused verbatim.**

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0022_shipment_operations.sql` | 4 `security definer` functions, EXECUTE to `service_role` only. **No table, no policy, no enum, no trigger.** |
| `src/lib/shipments/board.ts` | §14's eight columns as data, the bounded/scoped/counted column query, the Realtime decision |
| `src/lib/shipments/create.ts` | §2's **service-layer** gate, §5's 23505 retry, the pure quote→shipment mapping |
| `src/lib/shipments/assignments.ts` | Carrier/driver/truck assignment + release, atomic |
| `src/lib/shipments/eta.ts` | §14's ETA update over M-71's columns, with the M-78 deferral stated |
| `src/lib/shipments/search.ts` | §5's admin+dispatcher search, scoped |
| `src/lib/shipments/staff-access.ts` | The §19 gate every action passes through |
| `src/lib/shipments/staff-detail.ts` | §25's summary/history split for staff, option lists, advisory §20 facts |
| `src/lib/validation/dispatcher-shipments.ts` | 15 Zod schemas over M-70's enums |
| `src/app/actions/dispatcher-shipments.ts` | §14's **15 server actions** |
| `src/components/portal/ShipmentBoardView.tsx` | The board + §5 search, server-rendered |
| `src/components/portal/ShipmentOpsForms.tsx` | The §14 forms + the D-6 phrase picker |
| `src/components/portal/ShipmentStaffDetailView.tsx` | Summary · update history · assignments · contacts · operations |
| `src/app/[locale]/portal/admin/shipments/{page,new/page,[shipmentId]/page}.tsx` | Three routes |

Changed in place: `src/lib/staff-scope.ts` (+`shipmentScopeExpression`,
+`dispatcherMayActOn`), `src/lib/shipments/types.ts`
(+`DISPATCHER_ETA_SOURCES`), `src/lib/supabase/database.types.ts` (0022's four
functions), `src/components/portal/PortalSidebar.tsx` (one nav entry),
`src/app/[locale]/portal/admin/quotes/page.tsx` (the "→ Shipment" link).

Tests: `tests/unit/shipment-board.test.ts` (32) ·
`tests/unit/shipment-create.test.ts` (27) ·
`tests/unit/shipment-search.test.ts` (20) ·
`tests/unit/dispatcher-shipment-actions.test.ts` (110) ·
`tests/unit/dispatcher-shipments-a11y.test.tsx` (32) ·
`tests/integration/dispatcher-operations.test.ts` (50) ·
`supabase/tests/20_rls_isolation.sql` §11 (+11) ·
`tests/e2e/dispatcher-shipments.spec.ts` (8) + both new-route lists in the axe
and responsive suites.

**`src/app/portal.css` is untouched. M-75 adds no CSS and no colour** — every
class it renders is an existing, already-audited `portal.css` class, and a unit
test walks the rendered DOM and asserts exactly that. Migrations **0001–0004
remain frozen**; 0017–0021 are untouched.

---

## Why

### Why migration 0022 exists at all

M-72 settled the doctrine and 0019 is the precedent: a change to a `shipments`
column and the `shipment_events` row that explains it must be **one statement**,
because PostgREST has no multi-statement transaction and a crash between two
supabase-js calls leaves a shipment whose state has no event explaining it —
the condition §6 and §7 both forbid.

M-75 introduces exactly four writes with that shape:

| Function | Writes it makes atomic | The state a split would produce |
|---|---|---|
| `create_shipment` | `shipments` row + `shipment_created` event | A shipment whose history begins nowhere |
| `assign_shipment_carrier` | assignment row + `shipments.carrier_id` + `assignment_created` | **An assignment exists but the carrier cannot see the shipment** — 0018's `"carrier member read shipments"` keys on `carrier_id`, so a crash between writes manufactures a permission bug |
| `release_shipment_assignment` | `released_at` + carrier clear + `assignment_released` | A released carrier who still reads the shipment |
| `set_shipment_eta` | 7 ETA columns + `eta_update` carrying the PREVIOUS value | §10's "preserve previous ETA values" lost to an UPDATE |

Nothing else M-75 needs is added. `record call`, `record email`, `public
update`, `internal note`, `request POD`, `log exception` and `notification sent`
are single event appends and already have `append_shipment_event()`; status
changes are `apply_shipment_transition()`; appointments are
`set_shipment_appointment()`; the §20 correction is
`apply_shipment_correction()`. **M-75 calls all four of those and reimplements
none of them.**

### Why the insert in `create_shipment` is dynamic, and why that is safe

The obvious form —

```sql
insert into shipments select (jsonb_populate_record(null::shipments, payload)).*
```

— is wrong. `jsonb_populate_record` yields NULL for every key the payload omits,
so an omitted `public_tracking_enabled` becomes an explicit NULL that
**overrides the column default** and violates its NOT NULL. Restating 0017's
defaults inside the function would work and would put a second copy of the DDL
where it can drift.

So the column list is the intersection of the payload's keys and
`information_schema.columns` for `shipments`, and only those columns are named
in the INSERT — every absent column takes its own default, once, where it is
declared. The identifiers come from the **catalog**, never from the payload (a
key that is not a real column is dropped by the `where … in` before `format`
sees it) and every value travels as a bound `jsonb` parameter. There is no
injection surface in either half, and the integration lane asserts the defaults
land (`public_tracking_enabled` false, `tracking_mode` manual,
`location_visibility` approximate) rather than nulls.

Five keys are stripped unconditionally, in **both** TypeScript and SQL —
`id`, `created_at`, `updated_at`, `completed_at`, `cancelled_at`. A
caller-chosen primary key lets a retry overwrite an unrelated shipment; a
creation that can backdate itself makes every §15 "who changed what, when"
answer negotiable; a shipment created already-completed carries a timestamp no
event ever produced. Both layers are asserted, the SQL one by sending the keys
*past* the TypeScript builder.

### Why the board reuses the CRM kanban and drops its drag-and-drop

`src/components/portal/KanbanBoard.tsx` (M-23) established what a PickLoads
board is: `.kanban` / `.kcol` / `.kcard`, a `.kfilters` bar, a count in each
heading. M-75 renders the same vocabulary and adds no CSS.

What it deliberately does **not** copy is the drag-to-move. A lead's status is
free-form pipeline bookkeeping. A shipment's status is §20's transition graph
with preconditions, an actor gate and a compare-and-swap: a drag gesture cannot
carry a cancellation reason, cannot assert operational closeout, and has nowhere
to surface a refusal — so a dragged card would either fail silently or bypass
the engine. Status moves live on the shipment page as explicit controls over
`availableTransitions(status, actor, facts)`, which is M-72's own instruction to
M-75, verbatim. A unit test asserts the board renders **zero** `[draggable]`
elements.

### §14's Realtime sentence, answered with a reason rather than a preference

§14: *"Use real-time updates only where useful. Do not use Realtime for every
table without need."* **This board does not subscribe to anything**, for three
specific reasons:

1. **It would leak across the dispatcher scope.** Supabase Realtime filters
   broadcast rows through RLS, and 0018's policy is `"staff manage shipments"` —
   every staff row. Dispatcher least-privilege here is **query-level** (M-71's
   residual risk R-2, inherited by M-72 and honoured below), so a subscription
   would push dispatcher B's freight into dispatcher A's browser even though the
   board query excludes it. A control a websocket walks around is not a control.
2. **The expensive part is the eight counts, not the rows.** A change event
   would have to re-run them, so the "cheap live update" is a full page's work
   triggered by every keystroke of every dispatcher.
3. **Stale is already SAFE, not merely tolerable.** M-72's compare-and-swap
   returns `PL409` when somebody else moved a shipment, and this module renders
   it as *"Somebody else moved this shipment while you were working on it.
   Reload the page…"* — M-72's residual risk **R-4**, closed. A write from a
   stale page is refused, not lost.

Where realtime *would* be useful is one shipment worked by two people at once —
a per-row subscription on one detail page, a much narrower thing than a board.
Nothing here forecloses it.

### The two board decisions worth arguing

**"Needs Carrier" holds all four carrier-less statuses**, not just
`carrier_search`. §6's first four statuses have no carrier by construction, and
a shipment created in `quote_requested` that appeared in **no** column would be
findable only by search — the "where did it go?" failure that makes people stop
trusting a board. The quotes desk (`/portal/admin/quotes`, M-60) still owns the
quote *conversation*; this column owns the freight.

**`cancelled` is in no column at all.** A cancelled shipment is not operational
work, and an eight-column board with a growing ninth pile of dead freight stops
being read. It stays reachable through the status filter and through §5 search,
both on the same page — the rule is "not surfaced by default", never "hidden",
and the integration lane asserts both halves.

Every non-terminal status appears in at least one column; a unit test walks
`SHIPMENT_STATUSES` and proves it, so a nineteenth status cannot become
invisible.

---

## §2 — the service-layer gate M-71 assigned to M-75

M-71's doc is explicit that its trigger is **one layer, not the whole control**:

> *"M-75 must still refuse in the service layer with a human error message… A
> `P0001` at the bottom of the stack is a safety net, not a user experience."*

Implemented, in four places, each doing a different job:

| Layer | Where | What it gives |
|---|---|---|
| **Presentational** | `/portal/admin/shipments/new` renders the honest card instead of the form | A dispatcher does not type a shipment nobody can accept |
| **Service (this module's own)** | `assertBrokerageOpen()` in `create.ts`, before a tracking number is minted | A typed refusal carrying `BROKERAGE_CLOSED_MESSAGE` — the business fact, the switch that changes it, and what still works |
| **Error mapping** | `P0001` → the same staff message | The operator never learns what a P0001 is |
| **Database** | 0017's `trg_shipments_brokerage_gate` | The layer a future action that forgets the first three cannot bypass |

It **fails closed**: `getBooleanSetting` resolves an unreadable switchboard to
its fallback and the fallback here is `false`. A gate that opens when its
configuration is absent is not a gate.

The staff message is asserted, not just written:

> *"Brokerage operations are switched off, so no shipment can be created.
> PickLoads is not operating as a licensed freight broker until the MC authority
> and BMC-84 bond are active; an admin turns this on with the `brokerage_active`
> switch in Settings once they are. **Dispatch loads are unaffected** — book
> those on the Loads board."*

**Testable, and tested three ways.** Unit: the gate closed → `rpc` never
called, no audit row, typed `brokerage_closed`; the gate unreadable → closed;
the gate open → created (the non-vacuity control). Integration: `create_shipment`
raises `P0001` against a real closed gate and inserts zero rows; deleting the key
entirely still refuses; an in-flight shipment's status still moves while the gate
is closed, which is M-71's INSERT-only rule proved rather than assumed.

---

## §5 — search, and the reconstruction M-70's normaliser cannot do

M-70 owns the format and the tolerant normaliser; M-71 owns the unique index;
M-75 owns the search. It is a module rather than an `ilike` in a page because
what a dispatcher types is not what the database stores.

| Input | Kind | Query |
|---|---|---|
| `PL-2026-000458` | `exact` | `=` on `shipments_tracking_number_key` — one index probe |
| `  pl-2026-000458 `, `PL‑2026‑000458` (en dash, NBSP) | `exact` | M-70's normaliser folds it first |
| `2026-000458`, `PL 2026 000458`, `2026000458` | `exact` | **reconstructed**, then re-validated through the same normaliser |
| `000458`, `458`, `no. 000458` | `pattern` | bounded `ilike 'PL%000458'` |
| `PL-2026-0004` | `pattern` | `ilike 'PL-2026-%0004'` |
| anything else | `none` | **no query at all** |

The reconstruction closes a real gap: M-70's normaliser folds separators but
does not **insert** them, so `PL 2026 000458` — which people genuinely type —
normalises to a string that fails the pattern. Reconstructing costs nothing and
is re-validated through the same function, so `PL-2025-000458` (a year before
the programme existed) still falls through rather than becoming a lookup key.

**The tail case is checked before the year case, and the order is load-bearing.**
Six digits IS a whole sequence, so reading `000458` as "year 0004 plus 58" would
send the commonest search to a pattern matching nothing. That ordering was wrong
in the first draft and the integration lane caught it.

**Only digits survive the parser**, so `%` and `_` cannot reach a pattern and
`'; drop table shipments; --` becomes `none`. Asserted, with the table still
standing afterwards as the control.

**The search is SCOPED** (§3/§19). §5 says a dispatcher may search; it does not
say outside their scope, and §19 says the opposite. Without this, search would
be the hole in the least-privilege model — every scoped board defeated by a
search box. A dispatcher searching a real number outside their scope gets **zero
results**, exactly as if it did not exist, because "this exists but is not
yours" answers the question an enumerating insider is asking.

**Honest performance note.** The exact path is an index probe at any table size.
The tail path is a **bounded sequential scan** (≤ 25 rows returned), and it is
documented as such rather than presented as free. When brokerage volume makes
that wrong, the trigram index belongs to **M-98** (global search), not here.

---

## §19 — dispatcher least-privilege, honoured and not widened

M-71 recorded **R-2** and M-72 inherited it verbatim: `"staff manage shipments"`
does not distinguish dispatcher from admin, exactly as `loads`, `carriers` and
`documents` have not since 0002, and the database-level version (RESTRICTIVE
policies that would also constrain admins) is **M-83's**. M-75 does not widen
that risk, does not pretend to close it, and adds **no policy at all**.

The control is `src/lib/staff-scope.ts`, extended with two functions:

```
shipmentScopeExpression(scope, userId)  →  "dispatcher_id.eq.<uid>,carrier_id.in.(…)"
dispatcherMayActOn(scope, userId, {dispatcher_id, carrier_id})  →  boolean
```

**Two arms, not one.** `carriers.assigned_dispatcher_id` (M-58) is the existing
least-privilege key and it is right for freight already covered — but §6's first
four statuses have **no carrier at all**, so a carrier-only rule would make every
shipment a dispatcher is sourcing a truck for invisible to them, including ones
they created. The `dispatcher_id` arm is what makes "Needs Carrier" workable;
M-71 built `idx_shipments_dispatcher` for exactly this predicate. A dispatcher
with zero assigned carriers still gets that arm, so the expression is never
empty and never degrades into "no filter".

**The same rule applies to writes.** `resolveShipmentAccess` re-reads the
session (a server action is a public HTTP endpoint; the page that rendered its
form is not a control), re-reads the shipment through the **cookie-bound**
client so 0018's policy applies, and then applies `dispatcherMayActOn`. §19's
*"dispatcher permissions are limited"* is a claim about writes at least as much
as about reads, and a scoped board with an unscoped action is not a control.

**Three places it is applied that are easy to miss:**

- the **carrier dropdown** on the assignment form is scoped
  (`getAssignableCarriers`) — and the action re-checks, because an unscoped
  dropdown would let a dispatcher assign a carrier they do not manage, creating
  a shipment they then *can* see through the `carrier_id` arm: privilege
  escalation through a `<select>`;
- **search**, above;
- the **detail route**, which `notFound()`s an out-of-scope id.

**The actions answer differently from the page, deliberately.** M-74's shipper
detail 404s an out-of-tenant id because a shipper asking "does this exist?" must
not be answered. A dispatcher is inside the company, the shipment demonstrably
exists, and *"outside your dispatcher assignment — ask an admin"* is the message
that leads to the right next action. The attempt is journalled as an
`unauthorized_access_attempt` §26 signal either way.

---

## §14's nineteen functions, one by one

| §14 item | Where | Notes |
|---|---|---|
| create shipment | `createShipmentAction` → `create_shipment` | §2 gate first; §5 number minted server-side with a 23505 retry; the creating dispatcher becomes `dispatcher_id` so it is on their board |
| convert accepted quote | `convertQuoteAction` | Pure `mapQuoteToShipmentDraft`; the quote's `shipper_id` becomes the shipment's; already-converted guard on `idx_shipments_quote`; link on the quotes desk, offered only from a **Quoted/Booked** stage |
| assign carrier | `assignCarrierAction` → `assign_shipment_carrier` | Atomic; does **not** change status |
| assign dispatcher | `assignDispatcherAction` | The one §14 action that is a plain column write — see below |
| assign driver/truck | same call, optional | M-50's `drivers`/`trucks`; another carrier's driver refused `PL422` |
| set appointments | `setAppointmentAction` → **M-72's** `set_shipment_appointment` | Event-sourced; reschedule carries previous→new |
| update status | `updateStatusAction` → **M-72's** `apply_shipment_transition` | Never a raw UPDATE. Compare-and-swap on what the PAGE believed |
| update ETA | `updateEtaAction` → `set_shipment_eta` | M-71's columns only — see the M-78 deferral |
| add public update | `addNoteAction` (band `public`) | `public_update` + `visibility: public` + `public_message` |
| add internal note | `addNoteAction` (band `internal`) | `internal_note` + `staff_only` + `internal_message` |
| upload documents | **M-77** | Named as absent on the page, not silently missing |
| **record call** | `recordCallAction` → `call_logged` | Direction/party/contact in `metadata`; `event_time` is when the CALL happened |
| **record email** | `recordEmailAction` → `email_logged` | Direction/party/counterparty/subject in `metadata` |
| log exception | `logExceptionAction` → `exception_opened` | See "the exceptions deferral" |
| resolve exception | **M-78** | Explicitly not shipped — resolving needs a row and a lifecycle |
| request POD | `requestPodAction` → `pod_requested` | `carrier` band, not `public` |
| resend customer notification | `resendNotificationAction` | Portal feed + idempotency key; **emails are M-79**, and the UI says so |
| view update history | the detail page's second block | All five bands, with the band as a labelled badge |
| operational board | `/portal/admin/shipments` | Eight columns, server-side, filtered, paginated |

### The public-vs-internal distinction is a visibility, not a table

§7 made it one and M-72 shipped both event types for it. One form, one
`<select>`: `public` writes `public_update` with `visibility: "public"` and the
text in `public_message`; `internal` writes `internal_note` with `staff_only`
and the text in `internal_message`. A public update never lands in
`internal_message` and vice versa — which is what keeps M-74's shipper
projection (which selects one and not the other) correct by construction. The
integration lane asserts both shapes against real rows.

The status form carries the same choice as an explicit checkbox, and the default
is **unticked**: a forgotten checkbox publishes nothing, matching 0019's
`staff_only` column default.

### Record call / record email: the structured half matters

Plan §4 restores both with the diagnosis attached (*"absent from M-75"*). M-72
gave each an event type with the instruction not to invent new ones, so this is
the write path and the form is the surface.

Direction, party, counterparty, subject and contact name go in `metadata`, **not
into the prose**. A dispatcher asking "who called the receiver on Tuesday?" is
asking a structured question, and burying the answer in free text makes it
unanswerable the moment a shipment has twenty notes on it.

`event_time` is when the call happened; `recorded_at` is when it was typed up.
§7 keeps both on purpose and this is the action that makes the distinction real
— the integration lane asserts `event_time < recorded_at` on a call written up
three hours later, which is the "how late were we told?" question §7 exists to
answer.

**Never the contents.** A summary is operational; a recording, or a card number
read out over the phone, is not — and there is no field here for either.

### Why "assign dispatcher" is a plain column write

It changes no status, creates no assignment and moves no freight; it changes
**who owns the shipment operationally**, which is a §19 scope fact rather than a
§7 timeline fact. So it is a scoped UPDATE plus an `internal_note` plus an audit
row — and the note is what makes the change visible in "view update history",
which is exactly where a dispatcher looks when a shipment leaves their board.

---

## The two honest deferrals, argued rather than announced

### The exceptions deferral

§21's `shipment_exceptions` **table does not exist**. M-71 listed it among the
seven tables it deliberately did not create, and the plan assigns it to **M-78**
with §21's 13 types, 10 fields and open/resolve lifecycle.

M-75 **does not create half of it.** M-71's own argument applies exactly: *"a
half-created table is a specification that has already started to rot."* An
`exception_opened` row with no `resolved_at`, no `assigned_to` and no
`customer_notified_at` is a schema M-78 would have to migrate rather than write,
and the first module to touch it would be free to reinterpret the columns.

**What ships instead is real, and uses M-70's existing vocabulary.** An
exception is an `exception_opened` event carrying `exception_type` and
`severity` — both §21 enums, both Zod-validated against M-70's arrays — in
`metadata`, its customer-safe wording in `public_message` under the `public`
band, and its operational truth in `internal_message` under `staff_only`. A
dispatcher can log one today; a shipper sees the calm version on their timeline
today; M-74's detail view already renders exceptions and is already tested
against them.

**What M-78 inherits, named rather than implied:** `resolve exception` (§14's
other half — **not** shipped here), `assigned_to`, `customer_notified_at`,
`resolution`, and a backfill from these events. The backfill is possible
*because* the type and severity are structured rather than typed into prose, and
every M-75 exception event carries `metadata.exception_source =
"m75_event_only"` as the marker to select on. The RLS suite asserts the table
does not exist, so this stays a deferral rather than becoming a drift.

### The ETA deferral

The plan assigns the **ETA architecture** to M-78: eight fields, ETA-change
events, previous-value history, `shipment_eta_history`. The task's instruction
was *"wire what M-71's columns already have and defer the rest honestly."*

**Wired:** `estimated_pickup_at`, `estimated_delivery_at`, `eta_source`,
`eta_confidence`, `eta_updated_at`, `delay_minutes`, `delay_reason_public`,
`delay_reason_internal` — plus an `eta_update` event carrying the **previous**
value in `metadata`, because §10 requires "preserve previous ETA values in
history" and an UPDATE destroys exactly that. M-78 therefore arrives to a real
history it can backfill from rather than to a column populated from nothing.

**Deferred, and stated in the code:** `shipment_eta_history` as a table;
calculated and provider ETAs; confidence decay; ETA recomputation on a location
update; M-79's late-delivery sweep.

**§30 is the reason `eta_source` is a required argument with no default.**
`EtaSource` has `calculated`, `provider` and `dispatcher_adjusted` values;
`DISPATCHER_ETA_SOURCES` (in `types.ts`, beside the full list) is the strict
subset a form may offer — `manual` and `dispatcher_adjusted` only. Offering
"calculated" from a form that does no calculation is precisely the fake
capability §30 forbids, and M-73/M-74 both render `label.eta_dispatcher` off
this column, so the label is only honest if this write path never sets a source
it cannot justify. The detail page says *"PickLoads does not predict ETAs"* in
those words, asserted.

### The notification-resend deferral

**M-79 owns notifications** — the 11 customer events, idempotency, dedupe, retry
with backoff, preference respect, ×5 localisation and the background worker.
None of it exists yet and there is no shipment email builder in `src/emails/`.

So `resendNotificationAction` does exactly what it says on the card: it writes
the shipper's **in-portal notification** row pointing at their shipment, and
records a `notification_sent` event with an idempotency key of
`m75:notify:<shipment>:<kind>:<day>`. The UI reads *"Sends an in-portal
notification to the shipper's account now. Localized emails, delivery retry and
customer preferences are the notifications module — call them if it is
urgent."* It does not send an email and does not claim to.

The idempotency key is the useful part for M-79: a repeat of the same kind on
the same day is absorbed by 0019's global unique index rather than producing a
second notification, which is the dedupe behaviour M-79 will generalise. The
mandatory reason is on the record because a duplicate customer notification is a
thing somebody will ask about.

---

## §20 — the admin correction flow

**M-72 owns it and M-75 calls it.** `applyShipmentCorrection` already refuses a
non-admin, refuses a blank reason, writes an additive `correction` event with
`corrected_from`/`corrected_to`, journals to `audit_events` through the M-69
single writer, and keeps the compare-and-swap. None of that is reimplemented
here.

What the action adds is the two things a surface has to add:

- **the admin-only gate at the surface**, so a dispatcher never sees the form
  and never reaches the endpoint. The engine refuses independently — this check
  is the *message*, not the control, and the unit suite proves the refusal
  happens with `rpcCalls` empty;
- **a reason bound a human reads**: `min(10)`, not `min(1)`. §20 requires a
  reason; a one-character reason satisfies the letter and defeats the purpose.
  The database still refuses a blank independently, at two further layers.

It corrects a **status**. It cannot rewrite a tracking number: §5 makes that
immutable, 0017's trigger enforces it against every role including the service
role, and M-71 recorded that changing it would take a visible migration dropping
and recreating the trigger. Nothing here does — the RLS suite re-asserts the
refusal as the table owner *after* 0022, and the detail page says so in plain
words where somebody would otherwise look for an edit button.

The integration lane proves the whole shape end to end: a blank reason is
`PL422`; a reasoned correction changes the status and leaves the original event
**byte-identical** (md5 before and after); the correction is a NEW event
carrying from→to and the reason; a stale expected status is `PL409`.

---

## §25 — what is bounded, and how it is proved

| Requirement | Implementation | Proof |
|---|---|---|
| server-side pagination | `pageRange` + `range()` on every column read, `MAX_PAGE_SIZE` **re-exported from M-74** so a second ceiling cannot exist | Unit: every one of the eight columns bounded even when the caller passes `pageSize: 100_000` |
| no unbounded read | `SEARCH_LIMIT` 25, `ASSIGNMENT_HISTORY_LIMIT` 20, `PARTY_LIMIT` 20, `OPTION_LIMIT` 500, timeline 25+1 | Unit + integration |
| indexed columns | `idx_shipments_status_board`, `idx_shipments_dispatcher`, both appointment indexes, `idx_shipments_quote`, `idx_shipment_events_timeline` — **all M-71's and M-72's**; 0022 adds none because it needs none | The board's predicates are exactly the shapes those indexes were written for |
| no N+1 | 8 fixed column queries in one `Promise.all`; the detail page is 6 fixed reads in one | Unit: `getBoard` issues exactly 8 queries against exactly 1 table |
| summary vs history | `getStaffShipment` touches `shipments` only; `getStaffTimelinePage` is keyset with a lookahead | Reuses M-74's cursor parser and bound rather than declaring a second pair |
| `?page=1e9` | `parsePage` clamps at 10 000 | Unit |

The lean board projection names **none** of `gross_shipper_amount`,
`carrier_pay`, `margin`, `delay_reason_internal`, `public_access_hash` — a board
renders none of them, and a column that never enters process memory cannot be
leaked by a future component that spreads its props. The **detail** page does
select the financial trio (§18 marks it staff-only, not nobody-only; a
dispatcher cannot quote a rate they cannot see) but still withholds
`public_access_hash` **from staff too**, by type: `StaffShipmentRow` is
`Omit<ShipmentRow, "public_access_hash">`, so rendering it is a compile error.
M-70 is unambiguous — *"no DTO in this module serializes it at any audience,
including staff"* — and a staff page that rendered it would turn a §4 second
factor into something that leaks through a screen share.

---

## §22 responsive · §23 accessibility · §24 i18n · §30 honest labels

- **No new CSS.** `.kanban` scrolls horizontally at every breakpoint already;
  `.ptable--cards` with a `data-th` on every body cell is M-59's transform. A
  unit test walks the rendered DOM of both views and asserts every class it uses
  is declared in `portal.css` (or is one of nine global button/field classes),
  and that no inline style contains a raw hex colour.
- **Every column is a `<section>` with an `aria-label` carrying its name AND its
  count** — a screen-reader user hears "Delayed — 3 shipments" rather than
  counting cards.
- **Filters are a plain `<form method="get" role="search">`.** Keyboard-usable
  with nothing to get wrong, shareable as a URL, and — the §25 point — they
  narrow the *query*. Every one of the seven controls has a `<label for>`,
  asserted by walking the DOM.
- **Column expansion and pagination are links** (`?col=…&page=…`) with `rel`
  attributes, carrying the active filters forward.
- **State is text, never colour.** Status badges render the status word; the
  audience band renders "Public" / "Staff only"; a card with no carrier says so.
- **The result summary is `role="status"`; every form's error is
  `role="alert"`** — so a refusal (`status_conflict`, a precondition, an
  out-of-scope shipment) is *announced*, not discovered.
- **`<ol>`-equivalent semantics for history**: `<time datetime>` on both the
  happened and the recorded instant of every event.
- **axe-core, seven states**: board, scoped board with search results, expanded
  paginated column, failed column, full admin detail, dispatcher detail (no
  correction form), terminal detail with no transitions. Zero violations, with
  the scanner shown to report `image-alt` as the capability control.
- **§24**: the staff surface is English, matching every other `/portal/admin`
  page (an existing scope decision, M-23). What M-75 adds to the **customer**
  side is D-6 tokens, not prose: the phrase picker writes `phrase:<id>` into the
  same column free text uses, so `/track` and the shipper portal render it in
  the reader's own language. **No new i18n key was added and no catalogue was
  regenerated** — M-74 recorded that the generator can overwrite the V4
  prototype's ru/ht wording, and M-75 needed nothing new.
- **§30 applies to staff surfaces too.** The detail page names what is *not*
  built ("Documents and POD upload, exception resolution, the full ETA history
  and localized customer emails are not built yet") rather than leaving a
  dispatcher to discover it mid-shift, and a test asserts the page never
  contains "live tracking", "real-time", "AI-powered", "artificial
  intelligence", "machine learning" or "predicted ETA".

---

## DB changes

### Migration 0022 — `0022_shipment_operations.sql`

**Creates:** functions `create_shipment(jsonb, uuid, shipment_event_source,
text, text)`, `assign_shipment_carrier(uuid, uuid, uuid, uuid, uuid, uuid,
shipment_event_source, shipment_event_visibility, text, text, text)`,
`release_shipment_assignment(uuid, text, uuid, shipment_event_source,
shipment_event_visibility, text, text, boolean, text)` and
`set_shipment_eta(uuid, eta_kind, timestamptz, eta_source, eta_confidence,
integer, text, text, uuid, shipment_event_source, shipment_event_visibility,
text, text)` — all `security definer`, `set search_path = public`, `revoke all
… from public` then `grant execute … to service_role`.

**Creates nothing else.** No table, no policy, no enum, no trigger, no index, no
grant on any table.

**ROLLBACK:**

```sql
drop function if exists public.set_shipment_eta(uuid, eta_kind, timestamptz, eta_source, eta_confidence, integer, text, text, uuid, shipment_event_source, shipment_event_visibility, text, text);
drop function if exists public.release_shipment_assignment(uuid, text, uuid, shipment_event_source, shipment_event_visibility, text, text, boolean, text);
drop function if exists public.assign_shipment_carrier(uuid, uuid, uuid, uuid, uuid, uuid, shipment_event_source, shipment_event_visibility, text, text, text);
drop function if exists public.create_shipment(jsonb, uuid, shipment_event_source, text, text);
```

**NOT destructive.** No row is deleted and no column changes. After a rollback,
shipments already created stay readable and their statuses stay writable through
0019's engine; what stops working is *creating* one, assigning a carrier and
updating an ETA. Roll back the M-75 surface in the same deploy — delete
`src/lib/shipments/{create,assignments,eta}.ts` and the three
`/portal/admin/shipments` routes — or the build calls functions that no longer
exist. 0017–0021 are untouched and need no rollback of their own; 0022 rolls
back **before** them and after nothing.

---

## Security review

### The grant matrix

| Function | anon | authenticated (incl. **admin**) | service_role |
|---|---|---|---|
| all four 0022 functions | ✖ 42501 | ✖ 42501 | ✔ |

0022 adds no row-access surface, so the whole security question is *who may
EXECUTE*. An admin session that could call `create_shipment` directly would
bypass M-75's §2 service-layer gate, its Zod validation and its audit writer in
one step — which is exactly the hole the grant model closes. `security definer`
functions are EXECUTE-able by PUBLIC by default, so the migration **revokes
first** and grants to one role; the RLS suite proves the refusal from both a
browser-reachable roles *and* reads the grants out of `pg_proc` directly, so a
future `grant … to authenticated` fails even if the four refusals were somehow
satisfied for another reason.

### Residual risks, stated plainly

**R-1 (inherits M-71/M-72) — dispatcher scoping is query-level.** M-75 is the
first module to *depend* on it operationally, so the exposure is worth restating
precisely: a dispatcher who obtains another dispatcher's shipment id and issues
a raw PostgREST read with their own session **can read it**, because 0018's
`"staff manage shipments"` does not distinguish the two staff roles. What M-75
guarantees is that no PickLoads *surface* offers it — board, search and every
one of the fifteen actions apply the same rule, and the write path additionally
journals the attempt. The database-level version is **M-83's**, and M-75 adds no
policy that would have to be unpicked.

**R-2 (inherits M-71) — the financial trio is not column-protected.** The staff
detail page selects it deliberately (§18 staff-only). The mitigation for
*customer* surfaces is M-74's projection layer; M-75 changes nothing about it,
and the board projection omits the trio anyway.

**R-3 — `closeout_completed_at` is a caller assertion.** M-72 recorded this and
called it inherent: operational closeout is a human judgement (paperwork in,
detention settled, invoice raised), not a derivable fact. M-75 makes it an
explicit checkbox on the status form with the three conditions written beside
it, supplied only when ticked on that submission, and the resulting
`shipment.status_change` audit row records who asserted it. That is the
mitigation M-72 named; it is not a proof.

**R-4 — the advisory transition facts.** The detail page derives §20 facts from
data it already read rather than calling `shipment_transition_facts()`, which is
service-role-only. So the *offered* list can in principle differ from the
*allowed* list — for instance if an assignment is released in another tab. The
server action re-resolves the real facts through the RPC before writing, so the
worst outcome is a button that returns a typed refusal, which is exactly what
the `role="alert"` region is for. A page holding a service-role key to decide
which buttons to draw would be the worse trade.

---

## Endpoints

| Surface | Kind | Auth | Notes |
|---|---|---|---|
| `/{locale}/portal/admin/shipments` | page (5 locales, `force-dynamic`) | staff session + M-61 MFA | board, filters, §5 search, expandable columns |
| `/{locale}/portal/admin/shipments/new` | page (5 locales, `force-dynamic`) | staff | create; `?quote=<id>` switches to conversion |
| `/{locale}/portal/admin/shipments/[shipmentId]` | page (dynamic) | staff, scoped | detail + the §14 actions |

**15 server actions**, all in `src/app/actions/dispatcher-shipments.ts`, all
gated by `resolveShipmentAccess` (or `resolveStaffActor` for the two that have
no shipment yet). No route handler, no API addition.

## Env vars

**None.** No new variable, no new `company_settings` key. `brokerage_active`
already exists (M-69).

---

## Deployment

1. Apply `0022_shipment_operations.sql` after 0021. Four `create or replace
   function` statements plus grants — milliseconds, no lock on any table, no
   backfill.
2. Deploy. Page count **353 → 363** (five locales each of the board and the
   create route; the detail route is dynamic and prerenders nothing).

Nothing operator-visible changes at the moment of deploy: `brokerage_active`
stays `false`, so the board renders its honest "creation is switched off" note
and the create form renders the waitlist card instead of a form. The staff
sidebar gains one entry, and the quotes desk gains a "→ Shipment" link that only
appears on quoted/booked rows.

Verify with the four commands CI uses:

```bash
npm test                 # 799 unit
npm run test:rls         # 397 assertions — rebuilds from 0001 → 0022 + seed + fixtures
npm run test:integration # 128 tests — rebuilds from 0001 → 0022 + seed
npx playwright test      # 187 chromium
```

---

## Tests

| Suite | Count | Was | New in M-75 |
|---|---|---|---|
| `npm test` | **799** | 578 | **+221** across five files |
| `npm run test:rls` | **397** | 386 | **+11** (suite §11) |
| `npm run test:integration` | **128** | 78 | **+50** |
| `npx playwright test` | **187** | 179 | **+8** |
| `npm run build` | **363 pages** | 353 | 5 locales × 2 routes |

### What each lane proves

**`shipment-board.test.ts` (32)** — §14's eight columns in §14's order, every
column naming only real statuses, every non-terminal status covered, `cancelled`
in none; the **exact predicate chain** per column kind (a status column is one
`in`; a day column is `in` + `gte` + `lte` on the *right* appointment; Delayed is
the two-fact `or`); the day window proved to be the **Eastern** operating day
including the 20:00-ET-is-today case; the §19 scope expression in all three
shapes plus `dispatcherMayActOn` with an admin control; and the §25 bound —
`range()` present on every column even against `pageSize: 100_000`, scope applied
*before* the column rule and filters after, a total order key, exactly eight
queries against exactly one table, and a failed read reported as `failed` rather
than as an empty column.

**`shipment-create.test.ts` (27)** — the §2 gate open/closed/unreadable, the
refusal writing **nothing** (no RPC, no audit row) with a creation control that
shows the assertion can fail, `P0001` mapped back to the staff message, and the
message's three required clauses; §5's retry re-rolling only on the
tracking-number index (a different 23505 is not a collision), producing two
*different* candidates, giving up after five, and not retrying a non-collision;
the allow-list stripping the five forbidden keys and dropping `undefined`; and
the quote mapping field by field — `shipper_id` carried, a shipper-less quote
**refused**, a missing city refused *by name* with no placeholder invented,
`quoted_rate` → gross with **no** derived margin, status `quote_accepted`, the
date→appointment promotion at noon UTC, the TEXT pallets column parsed honestly,
and purity.

**`shipment-search.test.ts` (20)** — the four input shapes a dispatcher
produces, the reconstruction, the year floor refused on both paths, wildcards
stripped, long input truncated, and the query half: equality for exact, bounded
`ilike` for a tail, the **scope applied before the number predicate**, the lean
projection, a failed read as `failed` rather than "no results".

**`dispatcher-shipment-actions.test.ts` (110)** — the action exports are
**discovered, not listed**, and each of the fifteen is driven through five
refusals (no session · shipper session · suspended staff · out-of-scope
shipment · unresolvable or malformed id) with `rpcCalls` and `writes` asserted
empty, plus an in-scope-admin control proving none of them refuses for an
authorization reason when it should not. Then the engine contract: a status
update issues exactly `[facts, transition]` and **no** raw `shipments` write; a
§20 precondition refusal costs one read and zero writes; a `PL409` renders as
"Somebody else moved this shipment… Reload"; appointments, call, email, note,
exception and POD each issue exactly one append; the ETA and assignment paths
call their 0022 functions; a dispatcher cannot assign an out-of-scope carrier;
and §20's correction refuses a dispatcher, refuses a one-character reason, and
calls `apply_shipment_correction`.

**`dispatcher-shipments-a11y.test.tsx` (32)** — axe in seven states, the
scanner shown to fail; then the structure a scanner cannot see: per-column
`aria-label` with the count, the eight headings in order, a `<label for>` on
every filter control, the GET/search form, `role="status"`, the scoped-view
notice with its carrier count, **zero `[draggable]`**, a `data-th` on every body
cell of every card table matched against its header row, `<time datetime>`
everywhere, the audience band as text, §14's action forms present (and the
correction form absent for a dispatcher), the transition select carrying exactly
the offered targets and the honest sentence when there are none, §30's five
claims, and the "no new CSS class, no raw hex" pair.

**`tests/integration/dispatcher-operations.test.ts` (50)** — the REAL exported
code from `src/` (column rules, quote mapping, search parser, transition engine,
scope expression) against the REAL schema `0001…0022` on local PG16, through the
REAL 0019/0022 functions. §27's dispatcher flow end to end (create → assign →
pickup walk → delay → ETA → delivered → POD request → complete), including the
refusals that make it a control: another carrier's driver `PL422`, a second open
assignment `23505`, a no-op ETA `PL422`, `pod_uploaded` still refused because
M-77 has not landed, `completed` refused without the closeout assertion and
accepted with it, and the finished timeline provably append-only. Plus the §2
gate refusing creation (and failing closed with the key deleted, and leaving
in-flight freight operable), the five forbidden keys stripped **in SQL**, the
DDL defaults landing, the quote conversion carrying `shipper_id` onto a real
row, §20's correction leaving the original event byte-identical, §19's
dispatcher A vs dispatcher B in both directions with an admin control, §5's
search finding a mangled paste and refusing to become a wildcard, and every
board column's SQL running against real data — Pickup Today matching today and
not last week, Delayed catching minutes without the flag, and **no column
surfacing a cancelled shipment** while the status filter still finds it.

**`supabase/tests/20_rls_isolation.sql` §11 (+11)** — all four 0022 functions
refused `42501` to an **admin** session and to anon; `prosecdef` true on all
four; `service_role` holding EXECUTE (the non-vacuity control); neither
`authenticated` nor `anon` holding it on any of them; `shipment_exceptions` and
`shipment_eta_history` proved **absent** so the M-78 deferral cannot rot into a
drift; and §5 immutability re-asserted as the table owner *after* 0022.

**`tests/e2e/dispatcher-shipments.spec.ts` (8)** — all three routes and a
malformed id bounce to `/login`; none of the seven §14/§5 query parameters is a
second door; the quote-conversion entry point is gated; the bounce preserves the
destination; nothing appears in the sitemap and `robots.txt` disallows
`/portal`; all five locales gated identically; and a bare POST to any of the
three reaches the login gate and leaks **no** board marker and **no** tracking
number (with M-73's documented format *example* excluded, because the login page
carries the whole i18n catalogue and that string is documentation, not data).

### Non-vacuity — proven by injection, not asserted

Five defects were injected one at a time and the suites re-run; each failed
loudly, then the tree was restored and every lane returned to green.

| Injected defect | Suite | Assertion that caught it |
|---|---|---|
| §2 service-layer gate short-circuited in `create.ts` | unit | *REFUSES CREATION and writes nothing at all while closed* |
| `shipmentScopeExpression` returns `null` for a dispatcher | unit **and** integration | 4 unit failures (board, search, scope) + 3 integration failures (A's board, B's board, scoped search) |
| `create_shipment` EXECUTE also granted to `authenticated` | RLS | *even an ADMIN session cannot call create_shipment* — got `P0001`, i.e. it ran |
| cross-carrier driver check removed from `assign_shipment_carrier` | integration | *refuses another carrier's driver (PL422)* |
| `requestPodAction` skips `resolveShipmentAccess` | unit | **5** failures at once, one per refusal scenario — the discovery-based enumeration is what makes a single skipped gate loud |

Two real defects the suites caught before ship: the §5 parser read a six-digit
sequence as a year-plus-partial and matched nothing (integration), and the first
draft of `assign_shipment_carrier` set the idempotency key with a follow-up
UPDATE, which 0019's append-only trigger refuses for every role — caught while
probing the migration against PG16 before any test existed.

### Honest limitations

- **All three routes are axe-scanned in jsdom, not in a browser.** They sit
  behind a Supabase staff session *and* the M-61 MFA step-up, and the e2e lane
  runs on placeholder credentials by design (M-41). Minting a staff session and
  seeding a shipment would mean shipping a fabricated shipment fixture, which
  §30 forbids. The scan uses the same axe-core 4.12 engine on the same
  components; what it cannot see is **colour contrast** (jsdom applies no
  stylesheet), covered structurally by the "no new CSS class, no new colour"
  assertions. The e2e lane asserts the session gate, so the limitation is proved
  rather than assumed.
- **The integration lane's board SQL is a translator, not PostgREST.** It
  implements exactly the operators `board.ts` emits and throws on anything else,
  so a future predicate cannot silently take an untested path — but a PostgREST
  behaviour M-75 does not exercise is not covered by it.
- **`resolveShipmentAccess` is proved against a stubbed client.** It proves the
  layer (a refusal happens before any write, for every action). That the SQL
  underneath is right is the RLS suite's and the integration lane's job.
- **Dispatcher scoping and column-level financial protection** remain M-71's
  R-1/R-2, owned by M-83. M-75 adds the query and write layers, not the policy.
- **Nothing here uploads a document, resolves an exception, sends a customer
  email or computes an ETA.** Those are M-77, M-78 and M-79, and the surface
  says so in the words a dispatcher will read.

---

## Files

**New:** `supabase/migrations/0022_shipment_operations.sql` ·
`src/lib/shipments/{board,create,assignments,eta,search,staff-access,staff-detail}.ts`
· `src/lib/validation/dispatcher-shipments.ts` ·
`src/app/actions/dispatcher-shipments.ts` ·
`src/components/portal/{ShipmentBoardView,ShipmentOpsForms,ShipmentStaffDetailView}.tsx`
· `src/app/[locale]/portal/admin/shipments/page.tsx` ·
`src/app/[locale]/portal/admin/shipments/new/page.tsx` ·
`src/app/[locale]/portal/admin/shipments/[shipmentId]/page.tsx` ·
`tests/unit/{shipment-board,shipment-create,shipment-search,dispatcher-shipment-actions}.test.ts`
· `tests/unit/dispatcher-shipments-a11y.test.tsx` ·
`tests/integration/dispatcher-operations.test.ts` ·
`tests/e2e/dispatcher-shipments.spec.ts` · this doc.

**Changed:** `src/lib/staff-scope.ts` · `src/lib/shipments/types.ts` ·
`src/lib/supabase/database.types.ts` ·
`src/components/portal/PortalSidebar.tsx` ·
`src/app/[locale]/portal/admin/quotes/page.tsx` ·
`supabase/tests/20_rls_isolation.sql` · `tests/e2e/{axe,responsive}.spec.ts` ·
`docs/modules/INDEX.md` · `docs/LAUNCH-RUNBOOK.md`.

### Launch runbook

Three things change for an operator and all three are recorded: **migration
0022** joins the order-and-rollback table (non-destructive, functions only), the
gate counts move to 799 / 397 / 128 / 187 / 363, and the `brokerage_active`
switchboard row gains a second consequence — it now gates a *staff* surface
(shipment creation) as well as the customer-facing labels M-69 wired. No new
environment variable, no new `company_settings` key, no new go-live step.

---

## Extension points

- **M-76** (carrier + driver updates) calls `applyShipmentTransition` with
  `actor: "carrier"` / `"driver"`. The `pod_requested` events this module writes
  are addressed to the `carrier` band and are what that surface answers.
- **M-77** (documents) completes `approved_pod_required` by replacing one
  literal in `shipment_transition_facts()` (the expression is in 0019's
  comment), and replaces the "Documents and POD upload" line in this page's
  "Not here yet" block. `requestPodAction` needs no change.
- **M-78** inherits, explicitly: `shipment_exceptions` (backfillable from
  `exception_opened` events carrying `metadata.exception_source =
  "m75_event_only"`), `resolve exception` as §14's other half,
  `shipment_eta_history` (backfillable from `eta_update` events carrying
  `previous_at`/`new_at`), and the ETA sources `DISPATCHER_ETA_SOURCES`
  deliberately withholds. Widening that constant is the diff that makes a
  calculated ETA offerable, and it should not be widened before a calculator
  exists.
- **M-79** replaces `resendNotificationAction`'s portal-feed-only body with the
  real fan-out. The idempotency key format
  (`m75:notify:<shipment>:<kind>:<day>`) is already the dedupe M-79 generalises.
- **M-80** fills the location fields the board already reads
  (`current_city`/`current_state`); the board renders neither today and needs no
  change to start.
- **M-81** (broker portal) can reuse `applyBoardColumn` and
  `shipmentScopeExpression`'s shape; the broker equivalent is an org filter, not
  a two-armed one.
- **M-83** inherits R-1 and R-2 unchanged and can lift §11's grant-matrix
  assertion shape (reading `pg_proc` directly rather than inferring from
  refusals) for the other functions it audits.
- **M-83b** extends `tests/integration/` — the dispatcher flow is now the
  seventh of §27's eleven named tests to be proved end to end.
- **M-84b** replaces `logShipmentSignal`'s body; every M-75 failure path already
  emits `status_update_error`, `eta_calculation_failure` or
  `unauthorized_access_attempt` with no call-site change needed.
