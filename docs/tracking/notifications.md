# Notification architecture

## What it is

Eleven customer notifications, two channels, one queue, and a worker that runs
every five minutes. §17 of the directive specifies it; M-79 built it.

## The eleven, and the two channels

§17 names eleven events: shipment created · carrier assigned · picked up · in
transit · delayed · exception opened · ETA updated · arrived at delivery ·
delivered · POD available · invoice available.

The channels are **email** and **in-app**. SMS is not implemented and is not
stubbed — decision Q6 removed Twilio from scope, so there is no code path
that pretends to send one.

Every event maps to a template, an audience and in-app copy in every authored
locale. Four total-function tests keep that honest: every event has a builder,
every builder has an event, every event has a distinct email template id, and
every event has in-app copy in all five locales.

## Generation, not emission

Nothing sends an email at the point a status changes. `harvest_shipment_
notifications()` reads the timeline and enqueues rows; the worker sends them.
Three reasons this is worth the extra table:

- A status change is a database write inside a transaction. Sending an email
  from there means either an HTTP call in a transaction or an email that goes
  out for a write that rolls back.
- Preferences, suppressions and rate limits are re-checked at *send* time, not
  only at enqueue time. A customer who opts out between the two is not emailed.
- A failed provider call retries with backoff instead of being lost.

The harvest narrows carefully: an ETA update is notified for **delivery** and
ignored for pickup; a POD is notified on **approval** and never on a bare
upload; a delay whose exception was never described to the customer is
withheld, because there would be nothing honest to say; `invoice_available`
harvests the **shipper's** invoice and carries no amount, and ignores the
carrier's invoice entirely — it is not the shipper's shipment news.

A status §17 does not name produces nothing.

## Deduplication

Every queued row carries an idempotency key derived identically in SQL and in
TypeScript (asserted equal in the integration lane). The dedupe **scope** is
per rule:

- `per_shipment` — one "delivered" email per shipment, collapsing even after a
  correction re-enters the status.
- `per_source` — three ETA changes are three emails, because each is news.

Re-running the harvest over the same events enqueues nothing new. A direct
enqueue with a duplicate key returns the original rather than erroring; an
enqueue with no key at all is refused.

## Delivery and retry

`claim_shipment_notifications()` claims a bounded batch with row locks, so two
workers never reclaim the same row. `settle_shipment_notification()` records
the outcome and the provider response.

- Transient failure → the row moves into the future with backoff, out of the
  next claim. The TypeScript backoff table and the SQL `max_attempts` are kept
  in step by a test.
- Attempts exhausted → the row goes **dead**, not pending forever.
- A suppression is **terminal**: no retry, no failure. An opted-out customer
  is not a delivery problem.

The attempt ledger is append-only, for the owner too.

## Preferences and unsubscribe

Suppression happens at the source: with the email channel off, no email row is
enqueued, but the in-app feed row still is — the customer can still see their
own shipment news in the portal. With both channels off, nothing is enqueued.
Opting back in resumes both (the non-vacuity control).

Every notified customer gets a tokenised unsubscribe link, and every message
carries a `List-Unsubscribe` header. Address-level suppressions are stored
lowercased and anything else is refused.

## What never reaches the queue

The payload is an **allow-list**. A key outside it is never harvested, proved
by a test that also asserts the allow-listed payload *is* accepted, so the
refusal is not vacuous. No amounts, no internal notes, no tokens, no document
contents.

Every notification carries a tracking link (§17), and the link is
`/track?number=…`, which prefills the first factor only. The second factor is
still required.

## The worker

`/api/cron/notifications`, every five minutes, `CRON_SECRET`-guarded. It
harvests **before** it claims, so a fact written this minute is sendable this
minute. Without the service key it stops without claiming; if only the harvest
failed it still processes the backlog.

## RLS shape

All five notification tables have RLS enabled, declare `select` policies and
**no** write policy for any role. The four write functions are granted to
`service_role` alone.

## Where the tests are

- `tests/unit/shipment-notifications.test.tsx` — the eleven, the channels, the
  rules, the templates and the locales
- `tests/unit/shipment-notification-worker.test.ts` — the loop, the outcomes,
  suppression, retry and give-up
- `tests/integration/shipment-notifications.test.ts` — the SQL/TypeScript rule
  agreement, generation end to end, dedupe, retry, preferences, the payload
  allow-list and the RLS shape
- `tests/e2e/shipment-notifications.spec.ts`

## Environment

| Variable | Effect if unset |
|---|---|
| `RESEND_API_KEY` | emails are logged, not sent (dev) |
| `CRON_SECRET` | the worker route returns 503 and does nothing |
| `SUPABASE_SERVICE_ROLE_KEY` | same |
| `NEXT_PUBLIC_SITE_URL` | tracking and unsubscribe links have no absolute base |

## Extension points

A twelfth notification is: an enum value, a rule row, a template, a builder,
in-app copy in five locales, and a dedupe scope. The total-function tests will
name every one of those you forget — which is the whole reason they are total
rather than sampled.
