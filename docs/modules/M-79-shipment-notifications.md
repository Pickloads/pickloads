# M-79 — Shipment Notifications

**Status:** ✅ Complete · **Phase:** B (tracking core — **closing module**) · **Date:** 2026-08-06

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-79 —
*"Notifications: 11 customer events, idempotency keys, dedupe, retry with
backoff, preference respect, ×5 localisation, tracking link, no sensitive data;
**background processing architecture** (queue table + worker route), delivery
logging"* — **and** the plan's §4 restored row *"§25 background notification
processing architecture prepared — UNJUSTIFIED silent downgrade"*, which this
module exists to actually deliver rather than to re-promise.

Authority: `docs/DIRECTIVE-tracking.md` **§17** (the eleven notifications and
the nine requirements — the spec), §25 (background processing), §26 (the
`notification_failure` signal and the never-log list), §24 + decision **D-6**
(five locales, operator free text), §30 (honest labels), §19 (RLS per
audience), §27 (the test tiers).

Migration **0026**. Migrations 0001–0004 remain frozen. 0017–0025 are untouched
entirely; **0005 is ALTERED in exactly one way** — three columns *added* to
`user_preferences`, all defaulted, no column dropped and no policy touched
(argued below).

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0026_shipment_notifications.sql` | 3 enums, 5 tables, 4 `security definer` functions, 2 triggers, 6 indexes, 5 policies, and the three `user_preferences` columns. |
| `src/lib/shipments/notification-rules.ts` | The pure half of §17: the eleven, the channels, the event→template map, the rules mirror, `notificationIdempotencyKey()`, the backoff table, `decideSend()`, the payload allow-list. No `server-only`, no client, no React — so the unit lane can prove all of it. |
| `src/lib/shipments/notification-queue.ts` | The four SQL functions as typed calls: harvest, enqueue, claim, settle. Every one returns a result envelope; none throws. |
| `src/lib/shipments/notification-worker.ts` | The loop — harvest → claim → deliver → settle. Delivery is M-60's `sendEmail` / `notifyCustomer`, unchanged. |
| `src/app/api/cron/notifications/route.ts` | The worker route. `CRON_SECRET` bearer, compared in **constant time**, 503 when unset, 401 when wrong. |
| `src/emails/shipment-templates.tsx` | §17's eleven React Email templates on M-60's `CustomerEmail` layout, ×5 locales, plus `trackingUrl()`, `optOutUrl()` and the in-app copy. |
| `src/emails/phrases.ts` | Resolves M-73's D-6 phrase **tokens** for email, from M-73's own five-locale catalogue. |
| `src/emails/CustomerEmail.tsx` | One **optional** prop (`optOut`). Every M-60 template renders byte-identically. |
| `src/lib/email/send.ts` | `sendEmail` now **returns** `{status, providerMessageId, error}`. Additive — every existing caller ignores it. |
| `src/lib/notify.ts` | `notifyCustomer` now reports what it did. Same additive contract. |
| `src/lib/notification-preferences.ts` | The preference/suppression reads the worker uses, and the tokenized opt-out writes. |
| `src/app/actions/notification-preferences.ts` | The POST half of the opt-out (rate-limited; the GET never mutates). |
| `src/app/[locale]/(site)/notifications/unsubscribe/page.tsx` + `src/components/forms/NotificationOptOutForm.tsx` | The opt-out surface. `noindex`. No session required. |
| `src/app/actions/dispatcher-shipments.ts` | M-75's "resend notification" now enqueues a **real localized email** instead of saying "emails are M-79". |
| `src/components/tracking/TrackingLookup.tsx` + `track/page.tsx` | `?number=` prefill — where §17's tracking link lands. |
| `messages/{en,es,fr,ht,ru}.json` | 17 keys × 5 locales (the opt-out page). |
| Tests | 2 unit files (**90**), 1 integration file (**41**), a new RLS section (**36**), a new e2e spec (**11**). |

---

## The restored requirement: what "background processing architecture" means here

The plan's §4 records that the audit downgraded §25's *"background notification
processing architecture prepared"* to two retry columns, without saying so.
Two columns are not an architecture. What §17 actually asks for, item by item,
is a set of things a column cannot be:

| §17 requirement | Why an inline send cannot satisfy it | Where it lives now |
|---|---|---|
| *provide retry handling* | The request that caused the shipment to move is over. There is nowhere to retry **from**. | `shipment_notification_queue.available_at` + `retryDelaySeconds()` |
| *use idempotency keys* | A key must be enforced, and only a `unique` index enforces. | `idempotency_key text not null unique` |
| *avoid duplicate notifications* | Two producers of one customer fact must collapse — across processes, replays and retries. | `on conflict (idempotency_key) do nothing` |
| *log notification attempts* | Plural attempts, each with its own answer, is a table. | `shipment_notification_attempts`, append-only |
| *record provider response* | The sender has to hand it back. M-60's returned `void`. | `sendEmail` → `EmailSendResult` → the ledger + the queue row |
| *respect user preferences* | Checked at the last possible moment, not at the first. | `decideSend()`, at enqueue **and** at send |

So: a queue, an attempt ledger, a harvest watermark, four `security definer`
functions, and a cron-driven worker route. Sends are no longer inline.

### Why the queue is filled by HARVEST and not by call sites

Every fact a customer could be told about is already a `shipment_events` row —
M-72, M-75, M-76, M-77 and M-78 all write there, and M-78's own doc handed the
`eta_update` event to this module by name. The harvest joins those events
against a rules **table**.

The alternative — an `enqueue()` call in each producer — has one decisive flaw:
a notification can be missed because a call site was forgotten, and double-sent
because one was added twice. Harvesting cannot forget, because it does not
know about call sites at all. **The brief's "do not add a second event source"
is satisfied structurally**: M-79 adds no event writer. It subscribes.

The one exception is **M-75's "resend notification"**, which is a deliberate
human act rather than a shipment fact, and therefore enqueues directly — through
the same function, with the same preference gating, so a dispatcher pressing
Resend cannot mail somebody who has unsubscribed.

---

## §17's eleven notifications → trigger → template

| # | §17 notification | Enum value | Trigger (the module that already emits it) | Dedupe | Template |
|---|---|---|---|---|---|
| 1 | quote accepted | `quote_accepted` | `status_change` → `quote_accepted` (**M-72**, from M-75's conversion) | per shipment | `shipment-quote-accepted` |
| 2 | carrier assigned | `carrier_assigned` | `status_change` → `carrier_assigned` (**M-72**/M-75 assignment) | per shipment | `shipment-carrier-assigned` |
| 3 | driver dispatched | `driver_dispatched` | `status_change` → `dispatched` (**M-72**) | per shipment | `shipment-driver-dispatched` |
| 4 | picked up | `picked_up` | `status_change` → `picked_up` (**M-72**/M-76 carrier + driver link) | per shipment | `shipment-picked-up` |
| 5 | shipment in transit | `in_transit` | `status_change` → `in_transit` (**M-72**) | per shipment | `shipment-in-transit` |
| 6 | delay reported | `delay_reported` | **two** producers, one notification: `exception_opened` (**M-78**) **or** `status_change` → `delayed` (**M-72**) — both **only** when the event is customer-visible | per source | `shipment-delay-reported` |
| 7 | delivery ETA updated | `delivery_eta_updated` | `eta_update` with `metadata @> {"eta_kind":"delivery"}` (**M-78**'s `set_shipment_eta`) | per source | `shipment-eta-updated` |
| 8 | arrived at delivery | `arrived_at_delivery` | `status_change` → `arrived_at_delivery` (**M-72**) | per shipment | `shipment-arrived-at-delivery` |
| 9 | delivered | `delivered` | `status_change` → `delivered` (**M-72**) | per shipment | `shipment-delivered` |
| 10 | POD available | `pod_available` | `document_approved` with `{"doc_type":"pod","decision":"approved"}` (**M-77**'s approval, **not** the upload) | per shipment | `shipment-pod-available` |
| 11 | invoice available | `invoice_available` | an `invoices` row carrying `shipment_id` **and** `shipper_id` (**M-31**/0021's linkage) — read directly, not through an event | per source | `shipment-invoice-available` |

Three rows carry a decision worth restating:

* **#10 keys on APPROVAL.** 0024 makes an unapproved POD unreadable by the
  shipper. Announcing availability at upload time would mail a link to a
  document the customer is not licensed to open — §30's fake-capability rule,
  applied to a hyperlink.
* **#6 requires a customer-visible band.** M-78 writes an exception
  `staff_only` when it has no public description. Telling a customer *"there is
  a delay"* while deliberately withholding what it is is worse than the
  silence; §21's calm-explanation rule says so.
* **#11 has no event producer, and finds nothing today.** Shipper invoicing is
  M-96's. The harvest reads `invoices` directly so that module switches this
  notification on with no further wiring, and until then the honest answer is
  *no rows* — not a fabricated notification. The integration suite asserts the
  absence rather than leaving it to be discovered.

Each of the eleven is a full `Record` entry in `SHIPMENT_NOTIFICATION_MAP`, so
a twelfth notification without a template is a **compile error**, not a silent
non-send.

---

## Anti-drift: the mapping exists twice, on purpose

`shipment_notification_rules` (SQL, what the harvest executes) and
`SHIPMENT_NOTIFICATION_RULES` (TypeScript, what the product reasons about) are
the same table written twice. The integration suite reads the real table and
compares it **cell for cell in both directions** — same count, every TS rule
found in SQL, every SQL row found in TS, same dedupe scope as the map, and
`max_attempts` equal to `MAX_NOTIFICATION_ATTEMPTS`.

Drift between the two is the one bug neither the unit lane (no database) nor
the RLS lane (no TypeScript) can see. M-77 established the technique for its
visibility matrix; it is reused rather than reinvented.

---

## §17 — "respect user preferences"

M-78 stated the honest baseline: the only customer preference that existed was
`profiles.preferred_language`. `user_preferences` (0005) had three booleans,
all about carrier/dispatch flows and marketing, and no shipment channel at all.

**Three columns added to 0005's table** — `email_shipment_updates`,
`inapp_shipment_updates` (both `default true`) and `notification_token`
(`default gen_random_uuid()`, uniquely indexed). Nothing dropped, no default
changed, and 0009's four `user_preferences` policies are byte-identical after
this migration.

*Why default TRUE.* A shipper who booked freight asked to be told what happens
to it. Defaulting a transactional shipment update to off would be a silent
service downgrade dressed as a privacy win — and would have made every existing
row stop receiving mail on deploy.

**Two levels, because they answer different questions:**

* the **preference boolean** answers *does this account want mail*;
* `notification_suppressions` answers *may we write to this address at all* —
  which a shared receiving mailbox (`dock@acme.com`) needs and an account
  boolean cannot express.

The worker refuses on **either**. Opting out writes both.

**Checked twice, and the second check is authoritative.** The harvest gates at
enqueue so an opted-out customer leaves no backlog; the worker gates again
immediately before sending, because a customer who opts out *while a row sits
in the queue* must not receive that row. §17 says "respect user preferences",
not "respect the preferences that were in force when we decided to write".

A suppressed row settles as **`suppressed`, a terminal success** — never
retried, never counted as a failure. An honoured opt-out that appeared on a
failure dashboard would look like an outage.

### The opt-out surface

`/notifications/unsubscribe?token=…`, ×5 locales, `noindex`, **no session
required**. The token is single-purpose — the same shape and the same argument
as M-69/P-1's `subscribers.unsubscribe_token`: it is printed in every shipment
email, so it must reach the opt-out page and do **nothing else**. It is
deliberately not the profile id and not the newsletter token: it must not
confirm a subscription, read a shipment or identify an account.

The **GET never mutates** (corporate link scanners prefetch every URL in an
email); the POST is rate-limited; `already` is reported as success; and the
page states which mail it covers and which it does not.

**No `List-Unsubscribe` header.** `send.ts` restricts the RFC 8058 pair to
marketing-class sends — M-69's own rule — and these are transactional mail
about freight the recipient is paying for. The visible link in every one of the
eleven templates is the honest, reachable equivalent.

---

## §17 — "do not expose sensitive data"

Defence in four layers, deliberately redundant:

1. **The payload is built by construction.** The harvest's `jsonb_build_object`
   names six keys and there is no path by which a seventh arrives:
   `tracking_number`, `event_time`, `public_message`, `eta_at`,
   `delay_minutes`, `reason_public`. Every one is a fact §8's public tracking
   page already publishes.
2. **A CHECK constraint** refuses a payload carrying `signed_url`,
   `access_code`, `internal_message`, `gross_shipper_amount` or `carrier_pay`
   — a write failure, not a review comment.
3. **The templates take `ShipmentNotificationPayload` and nothing else.** There
   is no parameter through which an amount, an internal note or a signed URL
   could reach a builder.
4. **The sentinel sweep** (M-70's pattern, applied to rendered HTML): all
   eleven templates, all five locales, rendered against a payload full of
   sentinels — a shipper gross, a carrier pay, a margin, an internal note, an
   access code, a signed URL, a bearer token, a driver token and exact
   coordinates — asserting none appears in the output, and none appears in a
   subject line.

**Nine of the eleven templates never render operator text at all.** Only
`delay_reported` and `delivery_eta_updated` echo `reason_public` /
`public_message`, because that is D-6's whole point. The sweep poisons those
two fields and runs over the other **nine** — excluded **by name**, so the
exclusion is a stated decision and a twelfth template does not quietly inherit
it. A separate non-vacuity test proves the two really do echo.

**The tracking link never carries the second factor.** `trackingUrl()` has no
parameter for it. M-73's threat model is explicit: a URL carrying the ZIP or
access code puts both factors into a location bar, a browser history, a
`Referer` header and every corporate proxy log — and an email is forwarded,
archived and machine-scanned far more often than a page is visited.

---

## §24 / D-6 — the phrase library, reused rather than re-authored

M-73 stores a curated phrase as a **token**: `ShipmentOpsForms.tsx` writes
`phrase:delay.traffic` into `shipment_events.public_message` and
`shipments.delay_reason_public`. Every on-screen surface resolves it —
`TrackingResult`, `ShipmentDetailView`, `CarrierShipmentDetailView` all call
`resolvePublicText`.

An email builder that printed the stored value verbatim would mail the customer
the literal string `phrase:delay.traffic` — in the one channel that is archived
and forwarded, and the one with no "report a problem" button beside it. **This
was a real defect in the first cut of this module and is fixed here**, with six
tests, four of which fail when the fix is reverted.

`src/emails/phrases.ts` resolves through M-73's own five-locale catalogue
(`shipment.phrase.*`) rather than a copy authored in `src/emails/`. A second
vocabulary would drift from the `/track` page the same email links to.

Genuinely novel dispatcher prose is rendered **verbatim** under §24's honest
label — *"Written by dispatch, in English"*, in the reader's language — and
never machine-translated. A library phrase is **not** labelled: it really is in
the reader's language, and saying otherwise would be false in the other
direction. A retired phrase id degrades to labelled English, never to a token.

**Locale coverage.** Template copy follows M-60's rule: **en/es/fr authored,
ru/ht mirror English and are flagged** pending native review. M-73's phrase
catalogue is separately translated for es/fr with the same ru/ht mirror. Dates
are `Intl.DateTimeFormat` per locale, in **UTC and labelled** — an email is
read in an unknown timezone, and silently rendering server-local time is how a
customer stands on a dock at the wrong hour.

---

## §30 / §26 — honest labels

Every one of the eleven carries the same foot note: *"Milestone tracking —
updates are entered by our dispatch team as the shipment moves."* Never "live",
never "real-time", never "AI". A unit test asserts the label is present on all
eleven and that none of `live`, `real-time`, `GPS` or `AI` appears in any
rendered body.

The ETA email says the estimate is *"provided by our dispatch team from the
driver's latest check-in — they are not a guarantee"*, matching M-78's
computed-estimate label rather than inventing a stronger one.

**§26's `notification_failure` is a named signal.** Every failed delivery calls
`reportNotificationFailure`, which routes through M-72's redactor — so a
provider error string carrying a bearer token is dropped whole rather than
logged. The worker route's JSON body is **counts only**: no addresses, no
tracking numbers, no payloads, no provider text. §26's never-log list applies
to a response body that lands in a Vercel log as much as to a `console.error`.

---

## Graceful degradation (no Resend key, no service key)

* **No `RESEND_API_KEY`** → `sendEmail` returns `skipped`, not `sent`. The
  queue row settles `suppressed` with the attempt row reading *"email provider
  not configured"*. It is **not** retried five times against a key that is
  still absent, and it is **never** recorded as delivered — a queue that read
  `sent` in a secretless environment would make every local run look green.
* **No `SUPABASE_SERVICE_ROLE_KEY`** → the harvest returns `not_configured`,
  the worker returns early, and the route answers **503**. Not a green 200 with
  zeros in it.
* **No `CRON_SECRET`** → 503 before any work. The queue still fills whenever a
  harvest runs; nothing sends.
* **Every test is secretless.** The unit lane renders templates with no
  transport at all; the integration lane drives real SQL against local PG16 and
  never a provider; the e2e lane exercises the opt-out page and the `?number=`
  prefill against a dev server with placeholder env.

---

## DB changes

**Migration 0026** — additive. 0001–0004 frozen; 0017–0025 untouched.

**Types (3):** `shipment_notification_event` (§17's eleven, in the directive's
order), `notification_channel` (`email`, `in_app` — **no `sms`**, which §17
permits only with an approved provider and compliant opt-in, and §30 forbids
shipping as a dead capability), `notification_delivery_state` (`pending`,
`sending`, `sent`, `suppressed`, `dead`).

**Tables (5):**

| Table | Purpose |
|---|---|
| `shipment_notification_rules` | The event → notification mapping as **data**. 11 seeded rows. |
| `shipment_notification_queue` | The queue. `idempotency_key` **unique**; the payload-safety CHECK; the `(state='sent') = (sent_at is not null)` CHECK; 3 indexes, one partial on the hot worker read. |
| `shipment_notification_attempts` | One row per **attempt**. Append-only for every role including the owner (`PL409`). |
| `shipment_notification_watermark` | Single-row harvest watermark. An **optimisation**, not the correctness mechanism — which is why the harvest deliberately re-reads a 10-minute overlap. |
| `notification_suppressions` | Address-level opt-out. Lowercase enforced by CHECK. |

**Columns added to `user_preferences` (0005):** `email_shipment_updates`,
`inapp_shipment_updates`, `notification_token` — all defaulted, none dropped,
no policy touched.

**Functions (4), `security definer`, EXECUTE to `service_role` ALONE:**
`enqueue_shipment_notification`, `harvest_shipment_notifications`,
`claim_shipment_notifications` (`for update skip locked` + lock TTL),
`settle_shipment_notification` (writes the ledger row and moves the queue row
in **one** transaction).

**RLS:** enabled on all five tables. `revoke all … from authenticated, anon`,
then **SELECT only**, then **one staff-read policy each** — five policies
total, and **no write policy for any role**. The grant is required and safe for
the same reason M-78's was: `is_staff()` evaluates inside an `authenticated`
session, and a customer holding the same grant matches no policy and reads zero
rows. `anon` holds no privilege at all.

### ROLLBACK

Stop the worker **first** (remove the `vercel.json` cron entry or unset
`CRON_SECRET`) so nothing claims rows mid-teardown. Then:

```sql
drop function if exists public.settle_shipment_notification(uuid, text, text, text, integer);
drop function if exists public.claim_shipment_notifications(integer, interval);
drop function if exists public.enqueue_shipment_notification(uuid, shipment_notification_event, notification_channel, uuid, text, jsonb, uuid);
drop function if exists public.harvest_shipment_notifications(integer, interval);
drop trigger if exists trg_shipment_notification_attempts_append_only on shipment_notification_attempts;
drop function if exists public.shipment_notification_attempts_append_only();
drop trigger if exists trg_shipment_notification_queue_updated_at on shipment_notification_queue;
drop table if exists shipment_notification_attempts cascade;
drop table if exists shipment_notification_queue cascade;
drop table if exists shipment_notification_watermark cascade;
drop table if exists shipment_notification_rules cascade;
drop table if exists notification_suppressions cascade;
alter table user_preferences
  drop column if exists email_shipment_updates,
  drop column if exists inapp_shipment_updates,
  drop column if exists notification_token;
drop type if exists notification_delivery_state;
drop type if exists notification_channel;
drop type if exists shipment_notification_event;
```

**Destructive for the QUEUE and the LEDGER, not for the history.** Every
notification the worker sent is still in `email_log` (M-14) and `notifications`
(M-60); every fact that produced one is still a `shipment_events` row. What is
lost is the retry state of anything in flight and the per-attempt provider
answers. `pg_dump -t shipment_notification_queue -t shipment_notification_attempts`
first.

**Export the opt-outs before dropping the columns** — dropping them
re-subscribes everyone who unsubscribed:

```sql
select profile_id from user_preferences where not email_shipment_updates;
```

Keep `notification_suppressions` if you can: an address-level opt-out you
cannot reproduce is the one piece of state whose loss is visible to a customer.

**Code rollback in the same deploy:** revert `src/lib/supabase/database.types.ts`;
delete `src/lib/shipments/notification-{rules,queue,worker}.ts`,
`src/lib/notification-preferences.ts`, `src/app/actions/notification-preferences.ts`,
`src/emails/{shipment-templates.tsx,phrases.ts}`, the cron route and the
unsubscribe page; revert the `resendNotificationAction` block in
`src/app/actions/dispatcher-shipments.ts` to its M-75 text. `sendEmail`'s and
`notifyCustomer`'s new return values may stay — they are additive and every
other caller ignores them. Remove the cron entry from `vercel.json`.

**It fails CLOSED either way:** with the queue gone the worker route returns
503 and **no shipment email is sent at all**, rather than an unthrottled inline
send appearing in its place. M-60's fan-out for non-shipment flows is untouched
throughout.

---

## Endpoints

| Route | Method | Guard |
|---|---|---|
| `/api/cron/notifications` | GET | `Authorization: Bearer $CRON_SECRET`, **constant-time**; 503 unset, 401 mismatch |
| `/[locale]/notifications/unsubscribe` | GET | token in query; **never mutates**; `noindex` |
| — (server action) | POST | rate-limited per IP; token-only |

---

## Env vars

**No new environment variable.** `CRON_SECRET` (M-35), `RESEND_API_KEY` +
`EMAIL_FROM` (M-14), `SUPABASE_SERVICE_ROLE_KEY` (M-01) and
`NEXT_PUBLIC_SITE_URL` are all already declared and already documented. The
cron schedule is added to `vercel.json` beside the existing daily job:
`*/5 * * * *`.

---

## Deployment

1. Apply `0026_shipment_notifications.sql`.
2. Deploy the code (`vercel.json` now carries two cron entries).
3. Confirm `CRON_SECRET` is set in Vercel — **without it the worker 503s and
   nothing sends**, which is the honest failure, not a silent one.
4. Smoke test (below).

---

## Tests

| Lane | Count | Command |
|---|---|---|
| Unit | **90** (`shipment-notifications.test.tsx` 74, `shipment-notification-worker.test.ts` 16) | `npm test` |
| Integration | **41** (`tests/integration/shipment-notifications.test.ts`, real PG16) | `npm run test:integration` |
| RLS | **36** (new section in `20_rls_isolation.sql`) | `npm run test:rls` |
| E2E | **11** (`tests/e2e/shipment-notifications.spec.ts`) | `npx playwright test` |

Totals after this module: **1238 unit · 588 RLS · 263 integration · 264 e2e ·
build 373 pages**.

What each lane proves that the others cannot:

* **Unit** — the decisions are total and stable: every one of the eleven has a
  template and an audience; a key derived twice is the same key; the backoff is
  monotone and terminates; preference gating is total over the channel set;
  locale resolution falls back correctly; and the sentinel sweep over rendered
  HTML finds nothing in 11 × 5 renders.
* **Integration** — the queue really dedupes, retries and suppresses against
  real SQL. A unit test cannot prove a unique index, and pretending otherwise
  is the vacuous kind of green. Includes the full §27 path: event → queue row →
  worker processes → `email_log` written → **second run is a no-op**; retry
  after a simulated failure moves the row into the future and out of the next
  claim; exhaustion goes `dead` rather than pending forever; an opted-out
  customer is enqueued **nothing**; the rules table and its TypeScript mirror
  agree cell for cell.
* **RLS** — the five tables are staff-read and nothing else; `anon` holds no
  privilege at all; **no write policy exists for any role**; the four functions
  are granted to `service_role` alone.
* **E2E** — the opt-out page is reachable with no session, renders in all five
  locales, is `noindex`, the GET makes no state-changing request, and the
  notification link prefills the tracking number and **not** the second factor.

### Non-vacuity by injection

Every zero in this module is mirrored by a positive read that is not zero:

* the opted-out customer's zero rows sit beside a **resumed** customer who gets
  both channels back;
* the customer's zero rows on the queue sit beside a **dispatcher** who reads
  all four — so the zero is a policy decision, not an empty table;
* the sentinel sweep over nine templates sits beside a test proving the other
  **two** really do echo operator text;
* the payload-safety CHECK's rejections sit beside an accepted allow-listed
  payload.

Injection runs performed for this module: reverting the phrase-token resolution
in `noteRow` fails **4 of the 6** new D-6 tests (the remaining two are guards
that correctly stay green); the two that stay green are stated as guards rather
than counted as proof.

### Honest limitations

* **`invoice_available` finds nothing today.** Nothing writes a shipper invoice
  — that is M-96. The wiring is real and the absence is asserted; the
  notification is not.
* **ru/ht template copy mirrors English** and is flagged, per M-60's and M-42's
  precedent. M-73's phrase catalogue mirrors for the same two locales.
* **No SMS.** §17 permits it only with an approved provider and compliant
  opt-in; the enum has no value for it.
* **In-app delivery reuses M-60's `notifications` table**, which has no read
  receipt — "sent" means the row was written, and the queue says exactly that.
* **The worker processes 25 rows per invocation.** A serverless invocation has
  a wall clock, and a worker that tries to drain an unbounded backlog times out
  and settles nothing. At a 5-minute schedule that is 300 notifications an
  hour; raise `WORKER_BATCH` or the schedule together if volume demands it.

---

## Extension points

* **A twelfth notification** = an enum value + a rules row + a `Record` entry +
  a template. The compiler names the last two if you forget them, and the
  anti-drift test names the first two.
* **A new audience** (M-81's broker partner) = widen `NotificationAudience`;
  the compiler then re-checks every site.
* **SMS** = an enum value on `notification_channel`, a preference column, a
  branch in `deliver()`, and — first — the approved provider and compliant
  opt-in §17 requires.
* **M-96's shipper invoicing** switches `invoice_available` on with **no**
  further wiring: the harvest already reads `invoices`.
* **A dispatcher "what have we told this customer" panel** is one query away —
  `idx_shipment_notification_queue_shipment` exists for it.
