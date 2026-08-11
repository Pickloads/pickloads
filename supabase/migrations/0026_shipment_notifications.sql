-- ============================================================================
-- PickLoads — Migration 0026: shipment notifications (M-79).
--
-- SCOPE (plan §7, Phase B, row M-79): *"Notifications: 11 customer events,
-- idempotency keys, dedupe, retry with backoff, preference respect, ×5
-- localisation, tracking link, no sensitive data; background processing
-- architecture (queue table + worker route), delivery logging."*
--
-- The **background processing architecture** is the restored requirement.
-- `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 records that the audit silently
-- downgraded §25's *"background notification processing architecture
-- prepared"* to two retry columns. This migration is the architecture: a
-- queue, an attempt ledger, a harvest watermark, and four `security definer`
-- functions that make enqueue idempotent, claiming concurrency-safe and
-- settlement auditable.
--
-- Authority: `docs/DIRECTIVE-tracking.md` §17 (the 11 customer notifications
-- and the nine requirements), §25 (background processing), §26 (the
-- `notification_failure` signal; the never-log list), §24 (five locales),
-- §19 (RLS per audience).
--
-- Migrations 0001–0004 are FROZEN and untouched. 0005 is ALTERED in exactly
-- one way — three columns ADDED to `user_preferences`, all with defaults, no
-- column dropped, no policy touched (section 5 argues it). 0017–0025 are
-- untouched entirely.
--
-- ── WHY A QUEUE AND NOT M-60'S INLINE FAN-OUT ────────────────────────────
--
-- `src/lib/notify.ts` is M-60's shipped fan-out: notification row + email +
-- `email_log`, in one best-effort call, inline in the request that caused it.
-- That is right for the flows it serves — a welcome email that fails is a
-- welcome email that fails, and the account still exists.
--
-- It is NOT right for shipment notifications, for three reasons §17 states
-- outright:
--
--   * *"provide retry handling"* — an inline send has nowhere to retry FROM.
--     The request is over; the failure is a console line.
--   * *"use idempotency keys" / "avoid duplicate notifications"* — dedupe
--     across retries, replays and two producers of the same customer fact
--     needs a row with a unique key, not a boolean in a function.
--   * *"log notification attempts" / "record provider response"* — plural
--     attempts, each with its own provider answer, is a table.
--
-- So this migration EXTENDS rather than replaces: M-60's inline path keeps
-- serving every non-shipment flow unchanged, and the worker itself calls
-- `notifyCustomer`/`sendEmail` to do the actual delivery. What is new is
-- durability around them.
--
-- ── WHERE THE QUEUE ROWS COME FROM (the harvest) ─────────────────────────
--
-- From `shipment_events`, which is where M-72/M-75/M-76/M-77/M-78 already
-- write every fact a customer could be told about. M-78's own header says so:
-- *"The HAND-OFF is the `eta_update` event, which M-79's worker selects on.
-- It is already written … so M-79 arrives to a queue rather than to a
-- retrofit."*
--
-- Harvesting has one decisive property over calling an enqueue helper from
-- each producer: a notification cannot be missed because a call site was
-- forgotten, and it cannot be double-sent because a call site was added
-- twice. The event ledger is append-only (0019) and already carries the
-- audience band, the metadata and the timestamps. The mapping from an event
-- to a customer notification is DATA — `shipment_notification_rules`, section
-- 2 — mirrored by `SHIPMENT_NOTIFICATION_RULES` in
-- `src/lib/shipments/notification-rules.ts` and pinned cell-for-cell by an
-- integration test, the same anti-drift technique M-77 used for its
-- visibility matrix.
--
-- The twelfth source is not an event at all: `invoices` rows carrying a
-- `shipment_id` (0021's shipper-invoice linkage) produce §17's *invoice
-- available*. Nothing writes such a row today — shipper invoicing is M-96's
-- — so the harvest finds none, which is the honest state rather than a
-- fabricated one.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────
--
--   -- 1. stop the worker first (remove the vercel.json cron entry, or unset
--   --    CRON_SECRET) so nothing claims rows mid-teardown.
--   drop function if exists public.settle_shipment_notification(uuid, text, text, text, integer, jsonb);
--   drop function if exists public.claim_shipment_notifications(integer, interval);
--   drop function if exists public.enqueue_shipment_notification(uuid, shipment_notification_event, notification_channel, uuid, text, jsonb, uuid);
--   drop function if exists public.harvest_shipment_notifications(integer, interval);
--   drop trigger if exists trg_shipment_notification_attempts_append_only on shipment_notification_attempts;
--   drop function if exists public.shipment_notification_attempts_append_only();
--   drop trigger if exists trg_shipment_notification_queue_updated_at on shipment_notification_queue;
--   drop table if exists shipment_notification_attempts cascade;
--   drop table if exists shipment_notification_queue cascade;
--   drop table if exists shipment_notification_watermark cascade;
--   drop table if exists shipment_notification_rules cascade;
--   drop table if exists notification_suppressions cascade;
--   alter table user_preferences
--     drop column if exists email_shipment_updates,
--     drop column if exists inapp_shipment_updates,
--     drop column if exists notification_token;
--   drop type if exists notification_delivery_state;
--   drop type if exists notification_channel;
--   drop type if exists shipment_notification_event;
--
-- Destructive for the QUEUE and the ATTEMPT LEDGER, not for the history:
-- every notification the worker sent is still in `email_log` (M-14) and in
-- `notifications` (M-60), and every fact that produced one is still a
-- `shipment_events` row. What is lost is the retry state of anything still
-- in flight and the per-attempt provider answers. `pg_dump -t
-- shipment_notification_queue -t shipment_notification_attempts` first.
-- Dropping the three `user_preferences` columns re-subscribes anyone who had
-- opted out — export them (`select profile_id from user_preferences where not
-- email_shipment_updates`) before dropping, and keep
-- `notification_suppressions` if you can: an address-level opt-out you cannot
-- reproduce is the one piece of state whose loss is visible to a customer.
--
-- It fails CLOSED either way: with the queue gone the worker route returns
-- 503 and no shipment email is sent at all, rather than an unthrottled inline
-- send appearing in its place.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Vocabulary
-- ---------------------------------------------------------------------------
--
-- §17 names eleven customer notifications. They are an ENUM for the same
-- reason §6's statuses are: a notification kind typed as free text drifts into
-- eleven spellings and no exhaustive `Record` in TypeScript can catch it.
-- Order is the directive's own order.

create type shipment_notification_event as enum (
  'quote_accepted',
  'carrier_assigned',
  'driver_dispatched',
  'picked_up',
  'in_transit',
  'delay_reported',
  'delivery_eta_updated',
  'arrived_at_delivery',
  'delivered',
  'pod_available',
  'invoice_available'
);

-- §17: *"Channels at launch: email; in-app notifications."* SMS is
-- deliberately ABSENT from this enum rather than present-and-unused —
-- §17 permits it *"only when Twilio or another approved provider is
-- explicitly enabled and compliant opt-in exists"*, and a value nothing can
-- deliver is exactly the fake capability §30 forbids.
create type notification_channel as enum ('email', 'in_app');

-- The delivery state machine. `suppressed` is a TERMINAL SUCCESS, not a
-- failure: the customer asked not to receive this, we honoured it, and the
-- row records that we honoured it. Conflating it with `failed` would make an
-- opt-out look like an outage on every dashboard.
create type notification_delivery_state as enum (
  'pending',    -- waiting for `available_at`
  'sending',    -- claimed by a worker; released by the lock TTL if it dies
  'sent',       -- the provider accepted it
  'suppressed', -- a preference or an address opt-out refused the send
  'dead'        -- attempts exhausted; a human decides what happens next
);

-- ---------------------------------------------------------------------------
-- 2 · The mapping, as DATA
-- ---------------------------------------------------------------------------
--
-- One row per (shipment event shape → customer notification). The harvest
-- joins against it, so adding a twelfth notification is an INSERT plus a
-- template, not a new branch in a function.
--
-- `match_metadata` is a jsonb CONTAINMENT filter (`@>`), which is how
-- `document_approved` is narrowed to *an approved POD* and `eta_update` to
-- *a delivery ETA* without a column per producer.
--
-- `require_customer_visible` reads the event's own audience band. §21's
-- exceptions are the case that matters: an exception with no public
-- description is written `staff_only`, and telling a customer about a delay
-- we have deliberately not described to them would be worse than silence.

create table shipment_notification_rules (
  id uuid primary key default gen_random_uuid(),
  notification_event shipment_notification_event not null,
  source_event_type shipment_event_type not null,
  -- null = any status. Non-null = only when the event asserts this status.
  match_status shipment_status,
  match_metadata jsonb not null default '{}'::jsonb,
  require_customer_visible boolean not null default false,
  -- `per_shipment`: at most one of these per shipment, ever (delivered).
  -- `per_source`:   one per producing event/row (every ETA change).
  dedupe_scope text not null
    check (dedupe_scope in ('per_shipment', 'per_source')),
  created_at timestamptz not null default now(),
  -- `nulls not distinct` (PG15+) so two rules for the same event type with a
  -- null status collide instead of silently coexisting.
  constraint shipment_notification_rules_shape
    unique nulls not distinct (source_event_type, match_status, match_metadata)
);

insert into shipment_notification_rules
  (notification_event, source_event_type, match_status, match_metadata,
   require_customer_visible, dedupe_scope)
values
  -- §17 1–5, 8–9: the milestone statuses. One per shipment: a status that is
  -- re-entered (a corrected `in_transit`, a second `picked_up` after a
  -- correction) is the same news, and telling somebody twice is what
  -- "avoid duplicate notifications" is about.
  ('quote_accepted',       'status_change', 'quote_accepted',      '{}'::jsonb, false, 'per_shipment'),
  ('carrier_assigned',     'status_change', 'carrier_assigned',    '{}'::jsonb, false, 'per_shipment'),
  ('driver_dispatched',    'status_change', 'dispatched',          '{}'::jsonb, false, 'per_shipment'),
  ('picked_up',            'status_change', 'picked_up',           '{}'::jsonb, false, 'per_shipment'),
  ('in_transit',           'status_change', 'in_transit',          '{}'::jsonb, false, 'per_shipment'),
  ('arrived_at_delivery',  'status_change', 'arrived_at_delivery', '{}'::jsonb, false, 'per_shipment'),
  ('delivered',            'status_change', 'delivered',           '{}'::jsonb, false, 'per_shipment'),

  -- §17 6: delay reported. TWO producers, ONE notification — M-78's
  -- `exception_opened` and a `delayed` status change — collapsed by
  -- `per_source` keys that both resolve through the same dedupe window (see
  -- section 4). Both require a customer-visible band.
  ('delay_reported', 'exception_opened', null,      '{}'::jsonb, true, 'per_source'),
  ('delay_reported', 'status_change',    'delayed', '{}'::jsonb, true, 'per_source'),

  -- §17 7: delivery ETA updated. `per_source` — an ETA that moves three times
  -- is three different facts, and §10 requires the customer to be told when
  -- it changes. A PICKUP eta is operational scheduling between dispatch and
  -- the carrier; §17's list says "delivery ETA updated" and means it.
  ('delivery_eta_updated', 'eta_update', null,
   '{"eta_kind": "delivery"}'::jsonb, false, 'per_source'),

  -- §17 10: POD available. Keyed on APPROVAL, not on the `pod_uploaded`
  -- status: 0024 makes an unapproved POD unreadable by the shipper, so
  -- announcing availability at upload time would be a link to a 404.
  ('pod_available', 'document_approved', null,
   '{"doc_type": "pod", "decision": "approved"}'::jsonb, false, 'per_shipment');

-- §17 11 (invoice available) has no `shipment_events` producer: an invoice is
-- a row in `invoices`, not a timeline entry. The harvest reads it directly
-- (section 6), so it has no rule row — and that absence is asserted by the
-- integration test rather than left to be discovered.

create index idx_shipment_notification_rules_lookup
  on shipment_notification_rules (source_event_type, match_status);

comment on table shipment_notification_rules is
  'M-79/§17: event → customer notification mapping, as data. Mirrored by '
  'SHIPMENT_NOTIFICATION_RULES in src/lib/shipments/notification-rules.ts and '
  'pinned cell-for-cell by tests/integration/shipment-notifications.test.ts — '
  'drift between the two is the one bug neither the unit lane (no database) '
  'nor the RLS lane (no TypeScript) can see.';

-- ---------------------------------------------------------------------------
-- 3 · Preferences (§17 "respect user preferences")
-- ---------------------------------------------------------------------------
--
-- M-78 stated the honest baseline: *"the only customer preference that EXISTS
-- today is `profiles.preferred_language`"*. `user_preferences` (0005) has
-- three booleans, all about carrier/dispatch flows and marketing, and no
-- shipment channel at all.
--
-- Three columns are ADDED. Nothing is dropped, no default changes, no policy
-- is touched: 0009's four `user_preferences` policies are byte-identical
-- after this migration, and the two new booleans default TRUE so every
-- existing row keeps receiving what it receives today (transactional
-- shipment updates are what a shipper asked for when they booked freight —
-- defaulting them off would be a silent service downgrade, not a privacy win).
--
-- `notification_token` is a single-purpose credential, the same shape and for
-- the same reason as M-69's `subscribers.unsubscribe_token`: it is printed in
-- every shipment email, so it must be able to do exactly one thing — reach
-- the opt-out page — and nothing else. It is NOT the profile id.

alter table user_preferences
  add column if not exists email_shipment_updates boolean not null default true,
  add column if not exists inapp_shipment_updates boolean not null default true,
  add column if not exists notification_token uuid not null default gen_random_uuid();

create unique index if not exists idx_user_preferences_notification_token
  on user_preferences (notification_token);

comment on column user_preferences.email_shipment_updates is
  'M-79/§17: per-customer opt-out for shipment notification EMAIL. Checked at '
  'enqueue AND again at send — a preference changed while a row sat in the '
  'queue must be honoured, and the later check is the authoritative one.';
comment on column user_preferences.notification_token is
  'M-79: single-purpose credential for /notifications/unsubscribe. Printed in '
  'every shipment email. Deliberately not the profile id and not the '
  'newsletter token: it must not confirm a subscription, read a shipment or '
  'identify an account.';

-- ADDRESS-level opt-out. §17's "respect user preferences" is about a person,
-- and a person is reachable at an address even when the address belongs to a
-- shared mailbox (`dispatch@acme.com`) with no profile of its own. The
-- preference row answers "does this ACCOUNT want mail"; this table answers
-- "may we write to this ADDRESS at all", and the worker refuses on either.
create table notification_suppressions (
  email text not null,
  scope text not null default 'shipment'
    check (scope in ('shipment')),
  reason text,
  created_at timestamptz not null default now(),
  primary key (email, scope),
  -- Stored lowercased so a suppression cannot be defeated by capitalisation.
  constraint notification_suppressions_email_lower
    check (email = lower(email)),
  constraint notification_suppressions_email_shape
    check (position('@' in email) > 1)
);

comment on table notification_suppressions is
  'M-79/§17: address-level opt-out for shipment notifications. Checked by the '
  'worker immediately before every send. "Do not send to an unsubscribed '
  'address" is enforced here rather than in the template, because the '
  'template is not the last thing that runs.';

-- ---------------------------------------------------------------------------
-- 4 · The queue
-- ---------------------------------------------------------------------------

create table shipment_notification_queue (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  notification_event shipment_notification_event not null,
  channel notification_channel not null,
  recipient_profile_id uuid not null references profiles(id) on delete cascade,

  -- §17's *"use idempotency keys"*, made a database fact. UNIQUE, so the
  -- second enqueue of the same customer fact cannot create a second row
  -- whatever raced with what. Derived by `notificationIdempotencyKey()` in
  -- TypeScript and by the harvest in SQL, from the same three parts.
  idempotency_key text not null unique,

  -- The `shipment_events` row that produced this, when one did. `on delete
  -- set null` and not `cascade`: 0019's append-only trigger means an event is
  -- never deleted, so this is defensive rather than expected — but a queue
  -- row that vanishes because its source did would lose the record that we
  -- told somebody.
  source_event_id uuid references shipment_events(id) on delete set null,

  -- Rendering inputs ONLY, and never a fact the recipient may not see. §17:
  -- *"do not expose sensitive data"*. What goes in here is the tracking
  -- number, the event time, a public message and a delay minute count — the
  -- same fields M-73's public DTO already publishes. No amounts, no internal
  -- notes, no document contents, no signed URLs, no tokens. The CHECK below
  -- makes the three worst of those a write failure rather than a code review.
  payload jsonb not null default '{}'::jsonb,

  state notification_delivery_state not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  -- Must equal MAX_NOTIFICATION_ATTEMPTS in notification-rules.ts, where the
  -- backoff table lives; a unit test and an integration test pin the pair.
  max_attempts integer not null default 6 check (max_attempts between 1 and 10),

  -- §17 *"provide retry handling"*: when this row may next be claimed. The
  -- BACKOFF SCHEDULE itself lives in TypeScript (`retryDelaySeconds()`), which
  -- is where it can be unit-tested; SQL stores the answer rather than
  -- duplicating the policy.
  available_at timestamptz not null default now(),
  locked_at timestamptz,

  sent_at timestamptz,
  last_error text,
  -- §17 *"record provider response"*. `email_log` (0001) already records one
  -- per SEND; this records the one that belongs to the LAST attempt of this
  -- notification, so "what happened to the delivered email for PL-2026-000458"
  -- is one lookup rather than a join through timestamps.
  provider_message_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A sent row has a timestamp; an unsent one does not. Two facts that must
  -- not be able to disagree.
  constraint shipment_notification_queue_sent_shape
    check ((state = 'sent') = (sent_at is not null)),

  -- §17/§26 — the three key shapes that must never reach a payload. Cheap,
  -- absolute, and it fires on the writer rather than on the reader.
  constraint shipment_notification_queue_payload_safe
    check (
      not (payload ? 'signed_url')
      and not (payload ? 'access_code')
      and not (payload ? 'internal_message')
      and not (payload ? 'gross_shipper_amount')
      and not (payload ? 'carrier_pay')
    )
);

-- THE worker query: due rows, oldest first. Partial — `sent`/`suppressed`/
-- `dead` rows are terminal and are dead weight in the hot index.
create index idx_shipment_notification_queue_due
  on shipment_notification_queue (available_at, created_at)
  where state in ('pending', 'sending');

-- §14/§15: "what have we told this customer?", on the dispatcher's shipment
-- page.
create index idx_shipment_notification_queue_shipment
  on shipment_notification_queue (shipment_id, created_at desc);

-- The dedupe read the harvest runs for `per_shipment` rules.
create index idx_shipment_notification_queue_event
  on shipment_notification_queue (shipment_id, notification_event);

create trigger trg_shipment_notification_queue_updated_at
  before update on shipment_notification_queue
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 5 · The attempt ledger (§17 "log notification attempts")
-- ---------------------------------------------------------------------------
--
-- One row per ATTEMPT, not per notification. A notification that succeeded on
-- the third try has three rows here, and the two failures are the operational
-- fact — "Resend is failing for gmail.com since 14:00" is a query over this
-- table and is unanswerable from a queue row that only remembers its last
-- error.
--
-- Append-only for every role including the owner, the same guard 0019 and
-- 0025 use: a delivery ledger somebody can edit is not a ledger.

create table shipment_notification_attempts (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null
    references shipment_notification_queue(id) on delete cascade,
  attempt_no integer not null check (attempt_no >= 1),
  outcome text not null
    check (outcome in ('sent', 'failed', 'suppressed', 'skipped')),
  -- §17 *"record provider response"*, per attempt.
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (queue_id, attempt_no)
);

create index idx_shipment_notification_attempts_recent
  on shipment_notification_attempts (created_at desc);

create or replace function public.shipment_notification_attempts_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'shipment_notification_attempts is append-only (M-79/§17) — a delivery '
    'attempt that happened cannot be un-happened'
    using errcode = 'PL409';
end;
$$;

create trigger trg_shipment_notification_attempts_append_only
  before update or delete on shipment_notification_attempts
  for each row execute function public.shipment_notification_attempts_append_only();

-- ---------------------------------------------------------------------------
-- 6 · The harvest watermark
-- ---------------------------------------------------------------------------
--
-- One row, forever (the `check (id)` on a boolean primary key is the
-- single-row idiom). It records how far through `shipment_events.recorded_at`
-- the harvest has read.
--
-- The watermark is an OPTIMISATION, not the correctness mechanism: every
-- enqueue is idempotent on `idempotency_key`, so re-reading the same window
-- inserts nothing. That is why the harvest deliberately re-reads an OVERLAP
-- window behind the watermark — an event committed a moment after a
-- concurrently-started harvest read the clock would otherwise be skipped
-- forever, and the cost of the overlap is a few rows that conflict-do-nothing.

create table shipment_notification_watermark (
  id boolean primary key default true check (id),
  harvested_through timestamptz not null default now(),
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into shipment_notification_watermark (id) values (true);

create trigger trg_shipment_notification_watermark_updated_at
  before update on shipment_notification_watermark
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 7 · RLS
-- ---------------------------------------------------------------------------
--
-- §19 lists no customer permission on notification infrastructure, and there
-- is no surface that needs one: a shipper sees the RESULT (a `notifications`
-- row, an email) and never the machinery. So the four tables are STAFF-READ
-- and nothing else — no insert, update or delete policy exists for any role,
-- and every write goes through the `security definer` functions in section 8,
-- executable by `service_role` alone.
--
-- The `grant select` is required and safe for the same reason M-78's was:
-- `is_staff()` evaluates inside an `authenticated` session, and a customer
-- holding the same grant matches no policy and reads zero rows.

alter table shipment_notification_rules      enable row level security;
alter table shipment_notification_queue      enable row level security;
alter table shipment_notification_attempts   enable row level security;
alter table shipment_notification_watermark  enable row level security;
alter table notification_suppressions        enable row level security;

revoke all on shipment_notification_rules      from authenticated, anon;
revoke all on shipment_notification_queue      from authenticated, anon;
revoke all on shipment_notification_attempts   from authenticated, anon;
revoke all on shipment_notification_watermark  from authenticated, anon;
revoke all on notification_suppressions        from authenticated, anon;

grant select on shipment_notification_rules     to authenticated;
grant select on shipment_notification_queue     to authenticated;
grant select on shipment_notification_attempts  to authenticated;
grant select on shipment_notification_watermark to authenticated;
grant select on notification_suppressions       to authenticated;

create policy "staff read notification rules" on shipment_notification_rules
  for select using (is_staff());
create policy "staff read notification queue" on shipment_notification_queue
  for select using (is_staff());
create policy "staff read notification attempts" on shipment_notification_attempts
  for select using (is_staff());
create policy "staff read notification watermark" on shipment_notification_watermark
  for select using (is_staff());
create policy "staff read notification suppressions" on notification_suppressions
  for select using (is_staff());

-- ---------------------------------------------------------------------------
-- 8 · The write path — four functions, `service_role` only
-- ---------------------------------------------------------------------------

-- 8.1 · enqueue_shipment_notification()
--
-- The idempotent insert. Returns the row id and whether it was DEDUPED, which
-- the caller needs: §17's dedupe has to be observable, not silently absorbed
-- (the same reasoning 0019 applies to `replayed`).
--
-- `on conflict do nothing` + a re-select rather than `do update`: an existing
-- row may already be `sent`, and touching it would reset a delivery that
-- happened.
create or replace function public.enqueue_shipment_notification(
  p_shipment_id uuid,
  p_event shipment_notification_event,
  p_channel notification_channel,
  p_recipient_profile_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_source_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_deduped boolean := false;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'an idempotency key is required (§17)'
      using errcode = 'PL422';
  end if;

  -- Guarantee the preference row exists, so the opt-out token printed in the
  -- email always resolves. Without this a customer who never opened their
  -- preferences page would receive mail whose unsubscribe link 404s, which is
  -- the exact failure M-69/P-1 fixed for the newsletter.
  insert into user_preferences (profile_id)
  values (p_recipient_profile_id)
  on conflict (profile_id) do nothing;

  insert into shipment_notification_queue (
    shipment_id, notification_event, channel, recipient_profile_id,
    idempotency_key, payload, source_event_id)
  values (
    p_shipment_id, p_event, p_channel, p_recipient_profile_id,
    p_idempotency_key, coalesce(p_payload, '{}'::jsonb), p_source_event_id)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    v_deduped := true;
    select id into v_id from shipment_notification_queue
      where idempotency_key = p_idempotency_key;
  end if;

  return jsonb_build_object('id', v_id, 'deduped', v_deduped);
end;
$$;

revoke all on function public.enqueue_shipment_notification(
  uuid, shipment_notification_event, notification_channel, uuid, text, jsonb, uuid) from public;
grant execute on function public.enqueue_shipment_notification(
  uuid, shipment_notification_event, notification_channel, uuid, text, jsonb, uuid) to service_role;

-- 8.2 · harvest_shipment_notifications()
--
-- The whole mapping, in one statement per source. Reads the rules table,
-- resolves the audience (§17's customer = the shipper organisation's owner
-- member, the same resolution M-60's `getShipperOwnerRecipient` performs),
-- honours the two preference booleans, and enqueues one row per licensed
-- channel with a deterministic idempotency key.
--
-- Preference gating happens HERE as well as at send time. Not redundancy for
-- its own sake: an opted-out customer whose rows are never enqueued leaves no
-- queue backlog to process, and the send-time check then covers the case the
-- enqueue-time one cannot — a preference changed after enqueue.
create or replace function public.harvest_shipment_notifications(
  p_limit integer default 500,
  p_overlap interval default interval '10 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to timestamptz := now();
  v_scanned integer := 0;
  v_enqueued integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
begin
  select harvested_through - coalesce(p_overlap, interval '10 minutes')
    into v_from from shipment_notification_watermark where id;

  with candidate as (
    select
      e.id            as event_id,
      e.shipment_id   as shipment_id,
      e.recorded_at   as recorded_at,
      e.event_time    as event_time,
      e.public_message as public_message,
      e.metadata      as metadata,
      r.notification_event as notification_event,
      r.dedupe_scope  as dedupe_scope,
      s.tracking_number as tracking_number,
      m.profile_id    as recipient_profile_id
    from shipment_events e
    join shipment_notification_rules r
      on r.source_event_type = e.event_type
     and (r.match_status is null or r.match_status = e.status)
     and e.metadata @> r.match_metadata
     and (not r.require_customer_visible or e.visibility <> 'staff_only')
    join shipments s on s.id = e.shipment_id
    join lateral (
      select sm.profile_id
        from shipper_memberships sm
       where sm.shipper_id = s.shipper_id and sm.role = 'owner'
       order by sm.created_at asc
       limit 1
    ) m on true
    where e.recorded_at > v_from
      and e.recorded_at <= v_to
    order by e.recorded_at asc
    limit v_limit
  ),
  counted as (select count(*)::int as n from candidate),
  keyed as (
    select
      c.*,
      'm79:' || c.notification_event::text || ':' || c.shipment_id::text || ':' ||
        case c.dedupe_scope
          when 'per_shipment' then 'once'
          else c.event_id::text
        end as base_key
    from candidate c
  ),
  expanded as (
    select k.*, ch.channel
    from keyed k
    cross join (values ('email'::notification_channel),
                       ('in_app'::notification_channel)) as ch(channel)
  ),
  allowed as (
    select e.*
    from expanded e
    left join user_preferences up on up.profile_id = e.recipient_profile_id
    where case e.channel
            when 'email'  then coalesce(up.email_shipment_updates, true)
            when 'in_app' then coalesce(up.inapp_shipment_updates, true)
          end
  ),
  prefs as (
    insert into user_preferences (profile_id)
    select distinct recipient_profile_id from allowed
    on conflict (profile_id) do nothing
    returning 1
  ),
  inserted as (
    insert into shipment_notification_queue (
      shipment_id, notification_event, channel, recipient_profile_id,
      idempotency_key, payload, source_event_id)
    select
      a.shipment_id,
      a.notification_event,
      a.channel,
      a.recipient_profile_id,
      a.base_key || ':' || a.channel::text,
      -- The payload allow-list, built by CONSTRUCTION. Every key is a fact
      -- §8 already publishes on the public tracking page.
      jsonb_strip_nulls(jsonb_build_object(
        'tracking_number', a.tracking_number,
        'event_time',      a.event_time,
        'public_message',  a.public_message,
        'eta_at',          a.metadata ->> 'new_at',
        'delay_minutes',   a.metadata -> 'delay_minutes',
        'reason_public',   a.metadata ->> 'reason_public')),
      a.event_id
    from allowed a
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select (select n from counted), (select count(*)::int from inserted)
    into v_scanned, v_enqueued;

  -- §17's ELEVENTH notification has no `shipment_events` producer: an invoice
  -- is a row in `invoices` (0021's shipper linkage), not a timeline entry.
  -- Reading the table directly is what lets M-96's shipper invoicing switch
  -- this notification on with no further wiring — and until it lands, the
  -- honest answer here is "no rows", not a fabricated notification.
  with candidate as (
    select
      i.id            as invoice_id,
      i.shipment_id   as shipment_id,
      i.created_at    as created_at,
      s.tracking_number as tracking_number,
      m.profile_id    as recipient_profile_id
    from invoices i
    join shipments s on s.id = i.shipment_id
    join lateral (
      select sm.profile_id
        from shipper_memberships sm
       where sm.shipper_id = s.shipper_id and sm.role = 'owner'
       order by sm.created_at asc
       limit 1
    ) m on true
    where i.shipment_id is not null
      and i.shipper_id is not null
      and i.created_at > v_from
      and i.created_at <= v_to
    order by i.created_at asc
    limit v_limit
  ),
  expanded as (
    select c.*, ch.channel
    from candidate c
    cross join (values ('email'::notification_channel),
                       ('in_app'::notification_channel)) as ch(channel)
  ),
  allowed as (
    select e.*
    from expanded e
    left join user_preferences up on up.profile_id = e.recipient_profile_id
    where case e.channel
            when 'email'  then coalesce(up.email_shipment_updates, true)
            when 'in_app' then coalesce(up.inapp_shipment_updates, true)
          end
  ),
  prefs as (
    insert into user_preferences (profile_id)
    select distinct recipient_profile_id from allowed
    on conflict (profile_id) do nothing
    returning 1
  ),
  inserted as (
    insert into shipment_notification_queue (
      shipment_id, notification_event, channel, recipient_profile_id,
      idempotency_key, payload, source_event_id)
    select
      a.shipment_id,
      'invoice_available',
      a.channel,
      a.recipient_profile_id,
      'm79:invoice_available:' || a.shipment_id::text || ':' ||
        a.invoice_id::text || ':' || a.channel::text,
      -- NO AMOUNT. §18 marks shipper gross staff-only and §17 forbids
      -- sensitive data in a notification; the email says an invoice exists
      -- and the portal says what it is for.
      jsonb_strip_nulls(jsonb_build_object(
        'tracking_number', a.tracking_number,
        'event_time',      a.created_at)),
      null
    from allowed a
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select v_scanned + (select count(*)::int from candidate),
         v_enqueued + (select count(*)::int from inserted)
    into v_scanned, v_enqueued;

  update shipment_notification_watermark
     set harvested_through = v_to, last_run_at = v_to
   where id;

  return jsonb_build_object(
    'scanned', v_scanned,
    'enqueued', v_enqueued,
    'from', v_from,
    'through', v_to);
end;
$$;

revoke all on function public.harvest_shipment_notifications(integer, interval) from public;
grant execute on function public.harvest_shipment_notifications(integer, interval) to service_role;

comment on function public.harvest_shipment_notifications(integer, interval) is
  'M-79/§17+§25: map new shipment_events onto customer notifications and '
  'enqueue them idempotently. Re-runnable: every insert is on conflict do '
  'nothing against the unique idempotency key. EXECUTE: service_role only.';

-- 8.3 · claim_shipment_notifications()
--
-- `for update skip locked` is what makes two workers safe. Without it, two
-- concurrent invocations either block on each other (a slow worker stalls a
-- fast one) or both read the same rows and send twice.
--
-- The lock TTL is the crash story: a worker that dies mid-send leaves rows in
-- `sending` forever unless something reclaims them. Reclaiming has a cost —
-- the send may actually have gone out — which is why the ATTEMPT is counted
-- at claim time, so a row that keeps dying reaches `dead` rather than
-- reclaiming forever.
create or replace function public.claim_shipment_notifications(
  p_limit integer default 25,
  p_lock_ttl interval default interval '5 minutes'
)
returns setof shipment_notification_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
begin
  return query
  with due as (
    select q.id
      from shipment_notification_queue q
     where (q.state = 'pending' and q.available_at <= now())
        or (q.state = 'sending'
            and q.locked_at is not null
            and q.locked_at < now() - coalesce(p_lock_ttl, interval '5 minutes'))
     order by q.available_at asc, q.created_at asc
     limit v_limit
     for update skip locked
  )
  update shipment_notification_queue q
     set state = 'sending',
         locked_at = now(),
         attempts = q.attempts + 1
    from due
   where q.id = due.id
  returning q.*;
end;
$$;

revoke all on function public.claim_shipment_notifications(integer, interval) from public;
grant execute on function public.claim_shipment_notifications(integer, interval) to service_role;

-- 8.4 · settle_shipment_notification()
--
-- One call closes an attempt: it writes the ledger row AND moves the queue
-- row, in one transaction, so a delivery that is recorded as sent always has
-- an attempt explaining it and vice versa.
--
-- `p_retry_after_seconds` comes from TypeScript's `retryDelaySeconds()`. When
-- it is null, or attempts are exhausted, the row goes `dead` — a state a
-- human resolves, not a state the worker retries out of.
create or replace function public.settle_shipment_notification(
  p_id uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error text default null,
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row shipment_notification_queue;
  v_state notification_delivery_state;
  v_available timestamptz;
begin
  if p_outcome not in ('sent', 'failed', 'suppressed', 'skipped') then
    raise exception 'unknown settlement outcome %', p_outcome
      using errcode = 'PL422';
  end if;

  select * into v_row from shipment_notification_queue where id = p_id for update;
  if not found then
    raise exception 'notification % does not exist', p_id using errcode = 'PL404';
  end if;

  insert into shipment_notification_attempts (
    queue_id, attempt_no, outcome, provider_message_id, error)
  values (
    p_id, greatest(v_row.attempts, 1), p_outcome, p_provider_message_id,
    -- The error is TRUNCATED here as well as redacted in TypeScript. §26's
    -- never-log list is not a thing to hold in one place: a provider stack
    -- trace pasted whole into a column is read by every staff surface that
    -- lists attempts.
    left(p_error, 500))
  on conflict (queue_id, attempt_no) do nothing;

  if p_outcome = 'sent' then
    v_state := 'sent';
  elsif p_outcome in ('suppressed', 'skipped') then
    v_state := 'suppressed';
  elsif p_retry_after_seconds is not null
        and v_row.attempts < v_row.max_attempts then
    v_state := 'pending';
    v_available := now() + make_interval(secs => p_retry_after_seconds);
  else
    v_state := 'dead';
  end if;

  update shipment_notification_queue set
    state = v_state,
    locked_at = null,
    available_at = coalesce(v_available, available_at),
    sent_at = case when v_state = 'sent' then now() else null end,
    provider_message_id = coalesce(p_provider_message_id, provider_message_id),
    last_error = case when p_outcome = 'failed' then left(p_error, 500) else null end
  where id = p_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'state', v_row.state,
    'attempts', v_row.attempts,
    'available_at', v_row.available_at);
end;
$$;

revoke all on function public.settle_shipment_notification(
  uuid, text, text, text, integer) from public;
grant execute on function public.settle_shipment_notification(
  uuid, text, text, text, integer) to service_role;

comment on function public.settle_shipment_notification(uuid, text, text, text, integer) is
  'M-79/§17: close one delivery attempt — write the append-only attempt row '
  'and move the queue row (sent / suppressed / retry-with-backoff / dead) in '
  'ONE transaction. EXECUTE: service_role only.';
