# Dispatcher workflow

## What it is

The desk. `/portal/admin/shipments` is an operational board, not a report:
eight columns that each answer a question somebody is about to be asked.
§14 of the directive specifies it; M-75 built it.

## Creating a shipment

Two doors, one function. A dispatcher fills the form at
`/portal/admin/shipments/new`, or converts an accepted quote. Both call
`create_shipment()`, which writes the shipment **and** its `shipment_created`
event in one statement — so a shipment with no origin event cannot exist.

Three guards worth knowing:

- **The brokerage gate.** While `company_settings.brokerage_active` is false,
  the trigger refuses every shipment insert with `P0001`, and it **fails
  closed** if the switchboard key is missing entirely. Existing shipments stay
  fully operable while the gate is shut — freight already in flight is not
  stranded by a legal switch.
- **Forbidden keys are stripped**, not rejected. A payload carrying
  `tracking_number`, `status`, `margin` or the access hash has those keys
  removed before the insert. The caller does not get to set them.
- **Provenance is recorded.** A converted quote's shipment carries the quote
  id and an event that says where it came from, so "where did this come from?"
  has an answer and `idx_shipments_quote` answers "already converted?".

## Assignment

`assign_shipment_carrier()` writes the assignment row, sets
`shipments.carrier_id` and appends the event, atomically, under a row lock so
two dispatchers assigning at once serialise rather than racing.

It refuses a driver or truck belonging to a different carrier (`PL422`) — the
structural reason §20's "a driver marks another carrier's shipment delivered"
is unreachable through data. A second open assignment raises `23505` rather
than putting two carriers on one load.

Releasing a carrier stamps `released_at` and clears `shipments.carrier_id` so
the carrier's RLS policy stops matching immediately. The history is kept.

## The eight board columns

Each is a real query with a real predicate, tested against real rows:

| Column | Question |
|---|---|
| Needs carrier | which accepted quotes have nobody hauling them |
| Pickup today | what is appointed for pickup today, operating-day bounded |
| In transit | what is on the road |
| Delayed | what is flagged `delayed` **or** carries delay minutes |
| Delivery today | what is due today |
| POD outstanding | delivered with no approved POD |
| Docs to review | uploaded documents awaiting a decision |
| Exceptions open | unresolved exceptions |

No column surfaces a cancelled shipment. Day boundaries go through
`operatingDayBounds`, which had a daylight-saving defect found and fixed in
M-74 — the naive arithmetic put a whole day's pickups in the wrong column
twice a year.

Everything is server-side. The board never loads rows to count them.

## Timeline actions

§14 names five and all five write structured facts into `metadata` rather than
prose a later reader has to parse:

- **Record a call** — direction, outcome, who.
- **Record an email** — the same shape.
- **Public update vs internal note** — different bands, different columns.
  This is the single most-used control on the page and the one where a mistake
  is visible to a customer, so the two are never the same field with a
  checkbox.
- **Log an exception** — with a type and a severity M-78's backfill can read.
- **Resend a notification** — deduplicated by idempotency key, so a
  double-click sends one email.

## ETA and delays

`set_shipment_eta()` writes the column, the event and the history row in one
call, carrying the previous value forward every time. A no-op restatement is
refused with `PL422` and writes no history row: an "update" to the same value
asserts nothing, and a customer timeline is not a place for events that assert
nothing. Restating an ETA *while raising the delay minutes* is a change and is
allowed.

Pickup and delivery ETAs keep separate histories.

## Search

A pasted number is findable however it was mangled in transit, and a shipment
is findable by the last digits a customer read out. A hostile value cannot
become a wildcard or a new operand. The search is **scoped**: dispatcher A
cannot find dispatcher B's shipment by typing its number, and that is enforced
by migration 0030's restrictive policy rather than by the query builder — the
integration lane proves it by removing the application-level predicate.

## Least privilege

§19's sixth proof. Until M-83, dispatcher scoping lived entirely in
`src/lib/staff-scope.ts`, which meant a mistake in one query builder was a
tenancy breach. Migration 0030 adds fourteen `as restrictive` policies that
AND on top of the existing permissive ones without editing any of them, so a
dispatcher's reach is now decided by the database:

- `dispatcher_may_see()` derives scope from assigned carriers plus their own
  shipments. A dispatcher with no assigned carriers still sees their own.
- An admin sees everything — which is what makes every dispatcher zero above a
  scope result rather than an empty table.
- The restrictive policies short-circuit for customer roles, so they narrow
  staff without touching a shipper's read.

## Corrections

Admin only, additive, and reasoned. A correction is a new event carrying
`from`, `to` and a mandatory reason; the original event is left byte-identical
(the append-only trigger would refuse otherwise). A correction with a stale
expected status raises `PL409`. The tracking number still cannot be rewritten.

## Where the tests are

- `tests/unit/dispatcher-shipment-actions.test.ts`, `shipment-board.test.ts`,
  `shipment-create.test.ts`, `shipment-search.test.ts`
- `tests/integration/dispatcher-operations.test.ts` — §27's dispatcher flow
  end to end, the board columns, the timeline actions, corrections and
  least-privilege
- `tests/integration/tracking-security.test.ts` — §19 proof 6 through `src/`
- `tests/e2e/dispatcher-shipments.spec.ts`

## Extension points

A ninth board column is a predicate function plus a column definition; the
board test walks every column's SQL and asserts it returns a number, so a
malformed one fails immediately. A new timeline action is an event type plus a
metadata shape — put the facts in `metadata`, never in the prose.
