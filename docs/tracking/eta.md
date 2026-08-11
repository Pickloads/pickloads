# ETA architecture

## What it is

An estimated time of arrival, the source that produced it, how confident that
source is, and every value the ETA has ever had. §10 and §21 of the directive;
M-78 built it on the columns M-71 shipped.

## The fields

On `shipments`:

| Column | Meaning |
|---|---|
| `estimated_pickup_at` | when we expect to load |
| `estimated_delivery_at` | when we expect to deliver |
| `eta_source` | `manual` · `calculated` · `provider` |
| `eta_confidence` | `low` · `medium` · `high` |
| `eta_updated_at` | when the value last changed |
| `delay_minutes` | how late, in minutes |
| `delay_reason_public` | what the customer is told |
| `delay_reason_internal` | what the desk knows |

`eta_source` is never defaulted to anything predictive. §30's honest-label rule
turns on this column: an ETA a dispatcher typed renders as *"ETA provided by
dispatcher"*, and a calculated one says so. There is no code path that
produces an ETA and leaves the source blank.

## History is a table, not a memory

`shipment_eta_history` (migration 0025) holds every value that was ever true,
with its predecessor. `set_shipment_eta()` writes the column, the timeline
event and the history row in **one** call, so the three cannot disagree.

- Every subsequent change carries the previous value forward.
- Clearing an ETA is recorded as a change, not as a no-op.
- A no-op restatement is refused (`PL422`) and writes no history row.
- Pickup and delivery keep separate histories.
- The history is **append-only** — §6 and §10 both require it, and the trigger
  enforces it for the owner too.

## The estimator

`src/lib/shipments/eta-estimate.ts` is the `calculated` source. Its method is
stated, not hidden:

> distance ÷ planning speed, plus dwell, for a single driving day; add one
> ten-hour reset for each additional duty day; round late.

The details that matter:

- **No reset at exactly one duty day.** A driver who arrives just before the
  clock runs out does not take a break they do not need.
- **Rounds late, never early.** An early arrival is a good surprise; an early
  estimate is a complaint.
- **Deterministic.** The same inputs give the same answer forever, which is
  what makes it testable and what makes a customer's two lookups agree.
- **Publishes its assumptions as data.** Speed, dwell and reset count come
  back with the number, so `/track` and the portal do not each spell out the
  method in their own words.

There is **no fallback distance**. A null or undefined distance is refused
rather than substituted, because §30 forbids a fake ETA and a made-up distance
produces exactly that. The refusal is a typed result the surface renders as
"ETA not available", not a thrown exception.

The SQL calculated source produces the same number as the TypeScript
estimator, asserted in the integration lane.

## Exceptions (§21)

An exception is a first-class row (`shipment_exceptions`), not a note. It has
a structured type and severity, an internal description, an optional public
description, a triage assignment, and a resolution.

- Opening writes the row **and** the event in one call, linked.
- An exception with no public description is filed `staff_only` — there is
  nothing honest to publish yet.
- An exception with **neither** description is refused (`PL422`).
- Resolution requires a mandatory resolution text; a blank one is refused,
  because the log would be useless six months later. A second resolution is
  refused (`PL409`) — resolution is one-way — and triaging a closed exception
  is refused for the same reason.
- `customer_notified_at` is stamped once.
- Opening is idempotent by key.

Customer visibility follows the same discipline as everything else: a shipper
sees the exceptions with a public description and not the third one; no
internal description or resolution reaches them; and the non-vacuity control
shows a staff read of the same rows carrying both.

M-75 and M-76 shipped exceptions as tagged timeline events before the table
existed. `backfill_shipment_exceptions()` migrates every marked event into a
row, field for field, deletes nothing, is idempotent, does not re-migrate
exceptions opened through the new path, and skips an event whose type is not a
§21 value rather than inventing one.

## Delays

A delay is an ETA change with `delay_minutes` and a reason. The board's
"Delayed" column catches both the `delayed` status and recorded delay minutes,
because a shipment can be materially late without anybody having flipped a
status.

## Where the tests are

- `tests/unit/shipment-eta-estimate.test.ts` — the method, the boundaries, the
  rounding direction and the refusals
- `tests/unit/shipment-exceptions.test.ts`
- `tests/integration/shipment-eta-exceptions.test.ts` — the exception
  lifecycle, the backfill contract, ETA history, and customer visibility
  through the real session client
- `tests/e2e/shipment-eta-exceptions.spec.ts`

## Extension points

A provider ETA (`eta_source = 'provider'`) is already modelled and unused,
because no telematics contract exists. When one does, the adapter writes
through `set_shipment_eta()` like everything else — do not add a second write
path, and do not let a provider ETA overwrite a dispatcher's without recording
that it did.
