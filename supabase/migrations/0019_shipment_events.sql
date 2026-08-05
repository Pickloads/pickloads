-- ============================================================================
-- PickLoads — Migration 0019: `shipment_events` + the status-transition write
-- path (M-72).
--
-- Source of truth: `ShipmentEventRow` in `src/lib/shipments/types.ts` (M-70) —
-- all 18 fields §7 names, in declaration order, with the nullability the
-- interface declares. The enum types this file uses were ALL created by 0017
-- (M-71 created the vocabulary up front precisely so this migration adds a
-- table, never a second copy of a value list). If this file and `types.ts`
-- ever disagree, this file is wrong.
--
-- SCOPE (plan §7, Phase B, row M-72): *"Status-transition engine (server-side,
-- preconditions per §20, impossible-transition list) + `shipment_events` (all
-- 18 fields incl. `idempotency_key`, `external_event_id`, `metadata`) +
-- event-sourced appointments; corrections as additional audit events, never
-- deletes."*
--
-- The GRAPH lives in TypeScript (`src/lib/shipments/transitions.ts`), for the
-- same reason `LOAD_TRANSITIONS` does: it is a product rule that the portal,
-- the dispatcher board and the carrier surface all have to agree on, and a
-- copy of it in PL/pgSQL would be a second specification to keep in sync.
-- What lives HERE is what only the database can guarantee — atomicity,
-- compare-and-swap against concurrent writers, idempotency, append-only
-- history, and the tenant bands of §7's visibility model.
--
-- Migrations 0001–0004 are FROZEN and untouched. Nothing here alters an
-- existing table, column, policy, trigger, enum or grant: the whole migration
-- is additive.
--
-- ── WHY A `security definer` RPC AND NOT TWO STATEMENTS ────────────────────
--
-- §7 requires every status change to have a timeline event, and §20 requires
-- transition validation to be server-side. Through PostgREST, "UPDATE the
-- status" and "INSERT the event" are two HTTP round trips in two separate
-- transactions. If the second one fails — a dropped connection, a serverless
-- function killed mid-invocation, a deploy — the shipment is left in a state
-- with no event explaining how it got there, which is precisely the history
-- §6/§7 exist to prevent. There is no client-side fix: PostgREST has no
-- multi-statement transaction.
--
-- One `plpgsql` function is one statement, one transaction, and therefore
-- atomic by construction. It also buys the thing a two-step client CANNOT
-- have: a COMPARE-AND-SWAP. The update carries `where status = p_expected_
-- status`, so two dispatchers who both read `in_transit` and both act cannot
-- both win — the loser gets a typed conflict (`PL409`) instead of silently
-- overwriting the other's transition and leaving an event that describes a
-- transition that never happened.
--
-- The functions are `security definer` because 0018's doctrine gives customer
-- roles SELECT and nothing else, and 0019 keeps it that way: EXECUTE is
-- granted to `service_role` ONLY. A browser session — anon, shipper, carrier,
-- broker, even a staff session — cannot call them at all. Writes arrive
-- through server actions holding the service-role key, after the TypeScript
-- engine has validated the transition. That is what makes §19's "unauthorized
-- status transitions fail" true by construction rather than by policy
-- enumeration.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--
--   drop policy if exists "staff manage shipment events" on shipment_events;
--   drop policy if exists "shipper member read shipment events" on shipment_events;
--   drop policy if exists "carrier member read shipment events" on shipment_events;
--   drop policy if exists "broker member read shipment events" on shipment_events;
--   alter table shipment_events disable row level security;
--   drop function if exists public.apply_shipment_transition(uuid, shipment_status, shipment_status, shipment_event_source, uuid, shipment_event_visibility, timestamptz, text, text, text, text, numeric, numeric, jsonb, text, text, text, shipment_event_type);
--   drop function if exists public.apply_shipment_correction(uuid, shipment_status, shipment_status, text, uuid, shipment_event_visibility, text, timestamptz, jsonb, text);
--   drop function if exists public.set_shipment_appointment(uuid, eta_kind, timestamptz, shipment_event_source, uuid, shipment_event_visibility, text, text, text, text);
--   drop function if exists public.append_shipment_event(uuid, shipment_event_type, shipment_event_source, uuid, shipment_event_visibility, timestamptz, text, text, text, text, numeric, numeric, jsonb, text, text, shipment_status);
--   drop function if exists public.shipment_transition_facts(uuid);
--   drop trigger if exists trg_shipment_events_append_only on shipment_events;
--   drop function if exists public.guard_shipment_events_append_only();
--   drop table if exists shipment_events cascade;
--
--   DESTRUCTIVE: drops the entire timeline of every shipment. Take a dump
--   first (`pg_dump -t shipment_events`). Note the ORDER — the append-only
--   trigger has to go before the table, because `drop table` is DDL and does
--   not fire it, but any attempt to clear rows first would. Roll back
--   `src/lib/supabase/database.types.ts` and delete
--   `src/lib/shipments/apply-transition.ts` in the same deploy, or the build
--   references functions that no longer exist. `shipments`, `shipment_parties`
--   and `shipment_assignments` are untouched by this rollback and keep working
--   — statuses simply stop being writable through the engine.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · shipment_events — M-70's `ShipmentEventRow`, all 18 §7 fields
-- ---------------------------------------------------------------------------

create table shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  event_type shipment_event_type not null,

  -- The status this event ASSERTS, when it asserts one. Null for the many
  -- event kinds that are not about status at all (a logged call, an internal
  -- note, a location ping).
  status shipment_status,

  -- §7 keeps BOTH: when it happened in the world, and when PickLoads learned
  -- of it. They differ on every provider event and on every dispatcher who
  -- types up a 06:40 arrival at 09:15, and a timeline that conflates them
  -- cannot answer "how late were we told?".
  event_time timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  source shipment_event_source not null,
  created_by uuid references profiles(id) on delete set null,

  city text,
  state text,
  latitude numeric
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude numeric
    check (longitude is null or (longitude >= -180 and longitude <= 180)),

  public_message text,
  internal_message text,

  -- §7's visibility band. DEFAULT `staff_only`, deliberately: the same
  -- privacy-first defaulting M-71 used for `public_tracking_enabled` and
  -- `location_visibility`. A writer that forgets to choose publishes nothing
  -- to a customer; the opposite default would publish operational commentary
  -- the first time somebody omitted the column.
  visibility shipment_event_visibility not null default 'staff_only',

  -- §9's "store raw provider metadata securely". NOT NULL with a `{}` default
  -- so "no metadata" has exactly one representation — a nullable jsonb whose
  -- empty value is sometimes null and sometimes `{}` is two facts pretending
  -- to be one, and every consumer then needs both branches.
  metadata jsonb not null default '{}'::jsonb,

  -- §9 Mode C: the provider's own event id, for dedupe on replay/backfill.
  -- M-80 writes it; the unique index below is what makes it mean something.
  external_event_id text,

  -- §7/§17: the caller-supplied retry key. A retried write with the same key
  -- returns the FIRST event instead of appending a second one.
  idempotency_key text,

  -- A `status_change` that carries no status is not a status change. This is
  -- the one shape error the engine could otherwise write silently.
  constraint shipment_events_status_change_has_status
    check (event_type <> 'status_change' or status is not null),

  -- §20: "allow controlled admin correction with MANDATORY REASON and audit
  -- event." The reason is the correction's whole justification, so it is a
  -- database invariant here for the same reason `cancellation_reason` is one
  -- on `shipments` (0017) — an invariant the database holds outlives the
  -- application that remembers it.
  constraint shipment_events_correction_has_reason
    check (event_type <> 'correction' or internal_message is not null)
);

comment on table shipment_events is
  'M-72/§7: append-only shipment timeline. UPDATE and DELETE are refused by '
  'trg_shipment_events_append_only — §7''s "do not delete event history '
  'silently" and "corrections should be recorded as additional audit events". '
  'Written only through the SECURITY DEFINER functions below, which are '
  'EXECUTE-granted to service_role alone.';
comment on column shipment_events.visibility is
  'M-72/§7: which audience band may read this row. The three customer policies '
  'in this migration mirror AUDIENCE_EVENT_VISIBILITY in '
  'src/lib/shipments/dto.ts exactly, and tests/unit/shipment-transitions.test.ts '
  'parses this file to prove they have not drifted. staff_only appears in NO '
  'customer policy — §7''s hard rule.';
comment on column shipment_events.idempotency_key is
  'M-72/§7: caller-supplied retry key, globally unique (partial index). A '
  'replayed write returns the original event and performs NO status change.';
comment on column shipment_events.external_event_id is
  'M-72/§9: the provider''s own event id, unique per shipment. M-80''s Mode C '
  'dedupe key — a key added later cannot deduplicate history already stored.';

-- ---------------------------------------------------------------------------
-- 2 · Dedupe keys
-- ---------------------------------------------------------------------------

-- GLOBAL, not per-shipment, and that is the point: an idempotency key is a
-- property of the ATTEMPT, not of the shipment. A retry that also carries a
-- corrupted shipment id must still be recognised as a retry rather than
-- appending a stray event to the wrong timeline.
create unique index shipment_events_idempotency_key
  on shipment_events (idempotency_key) where idempotency_key is not null;

-- Per-shipment, because provider event ids are only unique within a provider's
-- own stream and M-80 connects one provider per shipment
-- (`tracking_provider_connections`).
create unique index shipment_events_external_event_id_key
  on shipment_events (shipment_id, external_event_id)
  where external_event_id is not null;

-- ---------------------------------------------------------------------------
-- 3 · §25 indexes — "event timeline pagination or sensible limits"
-- ---------------------------------------------------------------------------

-- THE timeline query: one shipment, newest first. `id desc` is the tiebreaker
-- that makes keyset pagination stable — two events can share an `event_time`
-- to the microsecond after a bulk provider backfill, and an unstable sort key
-- makes page 2 skip or repeat rows.
create index idx_shipment_events_timeline
  on shipment_events (shipment_id, event_time desc, id desc);

-- The AUDIENCE-filtered timeline every customer surface runs (M-73/M-74/M-76):
-- one shipment, the two or three bands that audience may read, newest first.
-- Without this the visibility predicate is a filter after the fact; with it,
-- a shipper's page never touches a staff_only row at all.
create index idx_shipment_events_audience
  on shipment_events (shipment_id, visibility, event_time desc);

-- §15 "view status history" / "audit who changed each status", and the
-- engine's own `delivered_at` / `pickup_confirmed_at` fact lookups. Partial:
-- most events assert no status and are dead weight here.
create index idx_shipment_events_status_history
  on shipment_events (shipment_id, status, event_time desc)
  where status is not null;

-- §14's operational sweeps ("what has dispatch touched today?") and M-84b's
-- observability queries, which are time-ordered across shipments, not within
-- one.
create index idx_shipment_events_recorded_at
  on shipment_events (recorded_at desc);

-- ---------------------------------------------------------------------------
-- 4 · Append-only guard — §7's absolute rule
-- ---------------------------------------------------------------------------
--
-- §7: "Do not delete event history silently. Corrections should be recorded as
-- additional audit events." A guard trigger is the only mechanism that makes
-- that true for every role including the service role: `BYPASSRLS` is not
-- `BYPASSTRIGGER`, which does not exist, and disabling a trigger requires
-- table OWNERSHIP, which the API role does not have (the same argument M-71
-- made for `trg_shipments_tracking_number_immutable`, asserted the same way —
-- as the table owner, with RLS bypassed).
--
-- CONSEQUENCE, stated rather than discovered: `shipment_events.shipment_id`
-- carries `on delete cascade`, so a shipment that has ANY event can no longer
-- be deleted — the cascade fires this trigger and the whole statement aborts.
-- That is intentional. §15's admin capabilities are suspend tracking, revoke
-- public codes, mark sensitive and manage retention; "delete a shipment" is
-- not among them, and a brokerage record with a real customer's freight in it
-- is not a row anybody should be able to make disappear. If a lawful erasure
-- requirement ever lands, it arrives as a visible migration that drops and
-- recreates this trigger inside an audited procedure — reviewed as such, not
-- discovered as an absent guard. (§26's retention purger, M-84b, targets
-- `shipment_locations`, not the timeline.)
create or replace function public.guard_shipment_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'shipment_events is append-only (DIRECTIVE-tracking §7: do not delete event history silently); record a correction as an ADDITIONAL event via apply_shipment_correction()'
    using errcode = 'P0001';
end;
$$;

create trigger trg_shipment_events_append_only
  before update or delete on shipment_events
  for each row execute function guard_shipment_events_append_only();

-- ---------------------------------------------------------------------------
-- 5 · RLS — §7's visibility bands, §19's no-anon rule
-- ---------------------------------------------------------------------------
--
-- Identical doctrine to 0018 (decision Q3, CLAUDE.md §Security model):
--   * NO ANON POLICY. §19: "Do not use direct anonymous table SELECT access."
--     M-73's public route reaches the timeline through the service role behind
--     tracking-number + secondary-credential validation, rate limiting and a
--     strict public DTO. An anon policy here — however narrow — would make
--     every one of those optional, because the anon key ships in the bundle.
--   * NO CUSTOMER WRITE POLICY. Shippers, carriers and brokers get SELECT and
--     nothing else on this table, as on every table 0018 created. Carrier
--     status updates (M-76) go through a server action calling the RPCs below
--     with the service role, after the engine's actor gate.
--   * The band lists below are AUDIENCE_EVENT_VISIBILITY from
--     `src/lib/shipments/dto.ts`, verbatim. `staff_only` appears in none of
--     them, which is §7's one absolute sentence.
alter table shipment_events enable row level security;

create policy "staff manage shipment events" on shipment_events
  for all using (is_staff());

-- shipper: ['public', 'shipper']
create policy "shipper member read shipment events" on shipment_events
  for select using (
    visibility in ('public', 'shipper')
    and exists (
      select 1 from shipments s
      where s.id = shipment_events.shipment_id
        and s.shipper_id in (select my_shipper_ids())
    )
  );

-- carrier: ['public', 'carrier'] — NOT the shipper band, which carries the
-- shipper's commercial correspondence about the very load they are hauling.
create policy "carrier member read shipment events" on shipment_events
  for select using (
    visibility in ('public', 'carrier')
    and exists (
      select 1 from shipments s
      where s.id = shipment_events.shipment_id
        and s.carrier_id in (select my_carrier_ids())
    )
  );

-- broker: ['public', 'broker'] — §12 grants "status and timeline" on
-- explicitly linked shipments and nothing wider. `my_broker_partner_ids()`
-- (0018) already filters on `broker_partners.active`, so an unapproved
-- organization reads nothing here either.
create policy "broker member read shipment events" on shipment_events
  for select using (
    visibility in ('public', 'broker')
    and exists (
      select 1 from shipments s
      where s.id = shipment_events.shipment_id
        and s.broker_partner_id in (select my_broker_partner_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- 6 · shipment_transition_facts() — the §20 precondition read, in ONE query
-- ---------------------------------------------------------------------------
--
-- §25 forbids N+1. The engine needs five facts about a shipment before it can
-- decide a transition, and fetching them as five selects from a server action
-- is exactly the shape §25 names. One function, one round trip, one jsonb.
--
-- TWO FACTS ARE DELIBERATELY NULL TODAY, and they are null in SQL rather than
-- absent in prose so the gap is visible where it matters:
--
--   `approved_pod_document_id` — §20: "`pod_uploaded` requires an approved POD
--   document." M-77 owns `shipment_documents`. Until it lands there is no
--   table to select from, so this returns null and the engine REFUSES every
--   transition into `pod_uploaded`. That is the honest behaviour: a
--   precondition that cannot be checked must fail, not pass. M-77 completes it
--   by replacing the literal below with
--     (select d.id from shipment_documents d
--       where d.shipment_id = s.id and d.doc_type = 'pod'
--         and d.approved_at is not null
--       order by d.approved_at desc limit 1)
--   and nothing else in the engine changes.
--
--   `closeout_completed_at` — §20: "`completed` should require delivery and
--   the required operational closeout." Closeout is a human assertion (paperwork
--   received, detention settled, invoice raised), not a derivable fact; M-75's
--   dispatcher surface supplies it explicitly and the engine treats an absent
--   assertion as "not closed out".
create or replace function public.shipment_transition_facts(p_shipment_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'shipment_id', s.id,
    'tracking_number', s.tracking_number,
    'status', s.status,
    'carrier_id', s.carrier_id,
    'shipper_id', s.shipper_id,
    'pickup_appointment_at', s.pickup_appointment_at,
    'delivery_appointment_at', s.delivery_appointment_at,
    'cancellation_reason', s.cancellation_reason,
    'active_assignment_id', (
      select a.id from shipment_assignments a
      where a.shipment_id = s.id and a.released_at is null
      limit 1
    ),
    -- §20 "picked_up should require pickup confirmation". The confirmation
    -- that EXISTS at M-72 is a recorded event placing the truck at the pickup
    -- facility. `picked_up` itself is excluded on purpose — a precondition
    -- that its own outcome satisfies is not a precondition.
    'pickup_confirmed_at', (
      select max(e.event_time) from shipment_events e
      where e.shipment_id = s.id
        and e.status in ('arrived_at_pickup', 'loading')
    ),
    -- §20 "delivered may require delivery timestamp" — for the transitions
    -- that come AFTER delivery, the timestamp is the recorded delivery event.
    'delivered_at', (
      select max(e.event_time) from shipment_events e
      where e.shipment_id = s.id and e.status = 'delivered'
    ),
    'approved_pod_document_id', null,   -- M-77 (see the note above)
    'closeout_completed_at', null,      -- M-75 asserts it (see the note above)
    'event_count', (
      select count(*) from shipment_events e where e.shipment_id = s.id
    )
  )
  from shipments s
  where s.id = p_shipment_id
$$;

-- ---------------------------------------------------------------------------
-- 7 · apply_shipment_transition() — the atomic status write
-- ---------------------------------------------------------------------------
--
-- Returns jsonb: { event_id, shipment_id, status, replayed }.
--
-- SQLSTATEs it raises, all mapped to typed failures in
-- `src/lib/shipments/apply-transition.ts`:
--   PL404  the shipment does not exist
--   PL409  compare-and-swap lost — the row is no longer `p_expected_status`
--   PL422  invalid argument (blank cancellation reason, wrong event type)
create or replace function public.apply_shipment_transition(
  p_shipment_id uuid,
  p_expected_status shipment_status,
  p_new_status shipment_status,
  p_source shipment_event_source,
  p_actor uuid default null,
  p_visibility shipment_event_visibility default 'staff_only',
  p_event_time timestamptz default now(),
  p_public_message text default null,
  p_internal_message text default null,
  p_city text default null,
  p_state text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_metadata jsonb default '{}'::jsonb,
  p_external_event_id text default null,
  p_idempotency_key text default null,
  p_cancellation_reason text default null,
  p_event_type shipment_event_type default 'status_change'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event shipment_events%rowtype;
  v_current shipment_status;
  v_event_id uuid;
begin
  if p_event_type not in ('status_change', 'cancellation') then
    raise exception
      'apply_shipment_transition writes status_change or cancellation events only; use append_shipment_event() for %', p_event_type
      using errcode = 'PL422';
  end if;

  if p_new_status = 'cancelled'
     and coalesce(btrim(p_cancellation_reason), '') = '' then
    raise exception
      'cancelling a shipment requires a cancellation reason (DIRECTIVE-tracking §20)'
      using errcode = 'PL422';
  end if;

  -- ── 1 · Idempotent replay. Checked BEFORE the compare-and-swap, so a retry
  -- performs no write at all: the status is not re-applied, no second event is
  -- appended, and the caller receives the ORIGINAL event id.
  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      select status into v_current from shipments where id = v_event.shipment_id;
      return jsonb_build_object(
        'event_id', v_event.id,
        'shipment_id', v_event.shipment_id,
        'status', v_current,
        'replayed', true);
    end if;
  end if;

  -- ── 2 · Provider dedupe (§9 Mode C): the same provider event delivered
  -- twice is one fact, not two.
  if p_external_event_id is not null then
    select * into v_event from shipment_events
      where shipment_id = p_shipment_id
        and external_event_id = p_external_event_id;
    if found then
      select status into v_current from shipments where id = v_event.shipment_id;
      return jsonb_build_object(
        'event_id', v_event.id,
        'shipment_id', v_event.shipment_id,
        'status', v_current,
        'replayed', true);
    end if;
  end if;

  -- ── 3 · Compare-and-swap. `where status = p_expected_status` is the whole
  -- concurrency story: the engine validated a transition FROM a status it
  -- read, and this refuses to apply it if the row has moved since.
  update shipments set
    status = p_new_status,
    cancellation_reason = case
      when p_new_status = 'cancelled'
        then coalesce(p_cancellation_reason, cancellation_reason)
      else cancellation_reason end,
    cancelled_at = case
      when p_new_status = 'cancelled' then coalesce(cancelled_at, p_event_time)
      else cancelled_at end,
    completed_at = case
      when p_new_status = 'completed' then coalesce(completed_at, p_event_time)
      else completed_at end
  where id = p_shipment_id
    and status = p_expected_status;

  if not found then
    select status into v_current from shipments where id = p_shipment_id;
    if v_current is null then
      raise exception 'shipment % does not exist', p_shipment_id
        using errcode = 'PL404';
    end if;
    raise exception
      'shipment % is %, not the expected % — another writer moved it (M-72 compare-and-swap)',
      p_shipment_id, v_current, p_expected_status
      using errcode = 'PL409';
  end if;

  -- ── 4 · The event. Same transaction, so a failure here rolls the status
  -- change back with it — §7's "every status change has an event" is not a
  -- convention the application maintains, it is a property of this statement.
  insert into shipment_events (
    shipment_id, event_type, status, event_time, source, created_by,
    city, state, latitude, longitude,
    public_message, internal_message, visibility, metadata,
    external_event_id, idempotency_key
  ) values (
    p_shipment_id, p_event_type, p_new_status, p_event_time, p_source, p_actor,
    p_city, p_state, p_latitude, p_longitude,
    p_public_message, p_internal_message, p_visibility,
    coalesce(p_metadata, '{}'::jsonb),
    p_external_event_id, p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object(
    'event_id', v_event_id,
    'shipment_id', p_shipment_id,
    'status', p_new_status,
    'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8 · append_shipment_event() — §14's dispatcher actions and everything else
--     that is a timeline fact without being a status change
-- ---------------------------------------------------------------------------
--
-- `record call`, `record email`, `public update`, `internal note`,
-- `pod_requested`, `notification_sent`, `assignment_created`/`released`.
-- Refuses `status_change` outright: a status change that did not go through
-- the compare-and-swap above is exactly the un-validated write §20 forbids.
create or replace function public.append_shipment_event(
  p_shipment_id uuid,
  p_event_type shipment_event_type,
  p_source shipment_event_source,
  p_actor uuid default null,
  p_visibility shipment_event_visibility default 'staff_only',
  p_event_time timestamptz default now(),
  p_public_message text default null,
  p_internal_message text default null,
  p_city text default null,
  p_state text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_metadata jsonb default '{}'::jsonb,
  p_external_event_id text default null,
  p_idempotency_key text default null,
  p_status shipment_status default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event shipment_events%rowtype;
  v_event_id uuid;
  v_exists boolean;
begin
  if p_event_type in ('status_change', 'correction') then
    raise exception
      '% events must go through apply_shipment_transition() / apply_shipment_correction() so the shipment row and its history move together', p_event_type
      using errcode = 'PL422';
  end if;

  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'event_id', v_event.id, 'shipment_id', v_event.shipment_id,
        'status', null, 'replayed', true);
    end if;
  end if;

  if p_external_event_id is not null then
    select * into v_event from shipment_events
      where shipment_id = p_shipment_id
        and external_event_id = p_external_event_id;
    if found then
      return jsonb_build_object(
        'event_id', v_event.id, 'shipment_id', v_event.shipment_id,
        'status', null, 'replayed', true);
    end if;
  end if;

  select true into v_exists from shipments where id = p_shipment_id;
  if not found then
    raise exception 'shipment % does not exist', p_shipment_id
      using errcode = 'PL404';
  end if;

  insert into shipment_events (
    shipment_id, event_type, status, event_time, source, created_by,
    city, state, latitude, longitude,
    public_message, internal_message, visibility, metadata,
    external_event_id, idempotency_key
  ) values (
    p_shipment_id, p_event_type, p_status, p_event_time, p_source, p_actor,
    p_city, p_state, p_latitude, p_longitude,
    p_public_message, p_internal_message, p_visibility,
    coalesce(p_metadata, '{}'::jsonb),
    p_external_event_id, p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object(
    'event_id', v_event_id, 'shipment_id', p_shipment_id,
    'status', p_status, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9 · set_shipment_appointment() — §6's "appointment rescheduled", event-sourced
-- ---------------------------------------------------------------------------
--
-- Plan §4 restores this as an M-72 requirement: *"§6 appointment-rescheduled
-- history — appointments modelled as plain columns."* M-71 shipped the two
-- columns; on their own an UPDATE overwrites the previous appointment and the
-- question a customer actually asks — "you told me Tuesday, what happened?" —
-- becomes unanswerable.
--
-- So the column write and the event that records old → new are one statement.
-- The FIRST time an appointment is set the event is `appointment_set`; every
-- change after that is `appointment_rescheduled`, carrying `previous_at` and
-- `new_at` in `metadata`. The row is locked FOR UPDATE while the old value is
-- read, so two dispatchers rescheduling at once cannot both record the same
-- "previous".
--
-- Default visibility is `shipper`, not `staff_only`: an appointment change is
-- the customer's own logistics, and §17 lists it among the events they are
-- notified about.
create or replace function public.set_shipment_appointment(
  p_shipment_id uuid,
  p_kind eta_kind,
  p_new_at timestamptz,
  p_source shipment_event_source,
  p_actor uuid default null,
  p_visibility shipment_event_visibility default 'shipper',
  p_reason text default null,
  p_public_message text default null,
  p_internal_message text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event shipment_events%rowtype;
  v_previous timestamptz;
  v_event_type shipment_event_type;
  v_event_id uuid;
begin
  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'event_id', v_event.id, 'shipment_id', v_event.shipment_id,
        'event_type', v_event.event_type,
        'previous_at', v_event.metadata ->> 'previous_at',
        'new_at', v_event.metadata ->> 'new_at',
        'replayed', true);
    end if;
  end if;

  select case p_kind
           when 'pickup' then pickup_appointment_at
           else delivery_appointment_at
         end
    into v_previous
    from shipments where id = p_shipment_id
    for update;

  if not found then
    raise exception 'shipment % does not exist', p_shipment_id
      using errcode = 'PL404';
  end if;

  -- A "reschedule" to the identical time is not a fact, it is noise on a
  -- timeline customers read. Refuse it rather than append it.
  if v_previous is not distinct from p_new_at then
    raise exception
      '% appointment is already %; nothing to record', p_kind,
      coalesce(p_new_at::text, 'unset')
      using errcode = 'PL422';
  end if;

  v_event_type := case when v_previous is null
                       then 'appointment_set'
                       else 'appointment_rescheduled' end;

  if p_kind = 'pickup' then
    update shipments set pickup_appointment_at = p_new_at
      where id = p_shipment_id;
  else
    update shipments set delivery_appointment_at = p_new_at
      where id = p_shipment_id;
  end if;

  insert into shipment_events (
    shipment_id, event_type, event_time, source, created_by,
    public_message, internal_message, visibility, metadata, idempotency_key
  ) values (
    p_shipment_id, v_event_type, now(), p_source, p_actor,
    p_public_message, p_internal_message, p_visibility,
    jsonb_build_object(
      'appointment_kind', p_kind,
      'previous_at', v_previous,
      'new_at', p_new_at,
      'reason', p_reason),
    p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object(
    'event_id', v_event_id, 'shipment_id', p_shipment_id,
    'event_type', v_event_type,
    'previous_at', v_previous, 'new_at', p_new_at,
    'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10 · apply_shipment_correction() — §20's controlled admin correction
-- ---------------------------------------------------------------------------
--
-- §20: *"Allow controlled admin correction with mandatory reason and audit
-- event."* §7: *"Do not delete event history silently. Corrections should be
-- recorded as additional audit events."*
--
-- So a correction NEVER touches the event that was wrong. It appends a
-- `correction` event carrying the reason (enforced by
-- `shipment_events_correction_has_reason`, and by the blank check below, since
-- a NOT NULL empty string would satisfy the constraint but not the directive),
-- and it moves the shipment row with the same compare-and-swap the ordinary
-- path uses. The caller additionally writes an `audit_events` row through
-- `src/lib/audit.ts` — belt and braces, because §7's ledger is about the
-- shipment and §15's is about the operator.
--
-- It BYPASSES the transition graph, which is the whole point of a correction:
-- the graph describes how freight moves, and a mis-keyed status is not freight
-- moving backwards, it is a typo. What it does not bypass is the reason, the
-- audit entry or the compare-and-swap.
--
-- Correcting AWAY from a terminal status clears that status's timestamp
-- (`completed_at` / `cancelled_at`) — leaving a `cancelled_at` on a shipment
-- that is no longer cancelled would make every downstream report wrong. The
-- ORIGINAL assertion survives in the timeline, which is where §7 keeps it.
create or replace function public.apply_shipment_correction(
  p_shipment_id uuid,
  p_expected_status shipment_status,
  p_corrected_status shipment_status,
  p_reason text,
  p_actor uuid default null,
  p_visibility shipment_event_visibility default 'staff_only',
  p_public_message text default null,
  p_event_time timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event shipment_events%rowtype;
  v_current shipment_status;
  v_event_id uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception
      'a correction requires a mandatory reason (DIRECTIVE-tracking §20)'
      using errcode = 'PL422';
  end if;

  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      select status into v_current from shipments where id = v_event.shipment_id;
      return jsonb_build_object(
        'event_id', v_event.id, 'shipment_id', v_event.shipment_id,
        'status', v_current, 'replayed', true);
    end if;
  end if;

  update shipments set
    status = p_corrected_status,
    cancellation_reason = case
      when p_corrected_status = 'cancelled' then p_reason
      else null end,
    cancelled_at = case
      when p_corrected_status = 'cancelled' then coalesce(cancelled_at, p_event_time)
      else null end,
    completed_at = case
      when p_corrected_status = 'completed' then coalesce(completed_at, p_event_time)
      else null end
  where id = p_shipment_id
    and status = p_expected_status;

  if not found then
    select status into v_current from shipments where id = p_shipment_id;
    if v_current is null then
      raise exception 'shipment % does not exist', p_shipment_id
        using errcode = 'PL404';
    end if;
    raise exception
      'shipment % is %, not the expected % — another writer moved it (M-72 compare-and-swap)',
      p_shipment_id, v_current, p_expected_status
      using errcode = 'PL409';
  end if;

  insert into shipment_events (
    shipment_id, event_type, status, event_time, source, created_by,
    public_message, internal_message, visibility, metadata, idempotency_key
  ) values (
    p_shipment_id, 'correction', p_corrected_status, p_event_time, 'admin', p_actor,
    p_public_message, p_reason, p_visibility,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
           'corrected_from', p_expected_status,
           'corrected_to', p_corrected_status),
    p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object(
    'event_id', v_event_id, 'shipment_id', p_shipment_id,
    'status', p_corrected_status, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11 · Grants — service_role ONLY
-- ---------------------------------------------------------------------------
--
-- 0018 gave customer roles SELECT and no write policy at all; these functions
-- are `security definer` and would sidestep that if `authenticated` could call
-- them. It cannot. Staff surfaces reach the engine through server actions
-- holding the service-role key, after `src/lib/shipments/transitions.ts` has
-- validated the transition and the actor — which is where §19's "carrier
-- updates must be limited to approved fields and transitions" is enforced.

revoke all on function public.shipment_transition_facts(uuid) from public;
grant execute on function public.shipment_transition_facts(uuid) to service_role;

revoke all on function public.apply_shipment_transition(
  uuid, shipment_status, shipment_status, shipment_event_source, uuid,
  shipment_event_visibility, timestamptz, text, text, text, text, numeric,
  numeric, jsonb, text, text, text, shipment_event_type) from public;
grant execute on function public.apply_shipment_transition(
  uuid, shipment_status, shipment_status, shipment_event_source, uuid,
  shipment_event_visibility, timestamptz, text, text, text, text, numeric,
  numeric, jsonb, text, text, text, shipment_event_type) to service_role;

revoke all on function public.append_shipment_event(
  uuid, shipment_event_type, shipment_event_source, uuid,
  shipment_event_visibility, timestamptz, text, text, text, text, numeric,
  numeric, jsonb, text, text, shipment_status) from public;
grant execute on function public.append_shipment_event(
  uuid, shipment_event_type, shipment_event_source, uuid,
  shipment_event_visibility, timestamptz, text, text, text, text, numeric,
  numeric, jsonb, text, text, shipment_status) to service_role;

revoke all on function public.set_shipment_appointment(
  uuid, eta_kind, timestamptz, shipment_event_source, uuid,
  shipment_event_visibility, text, text, text, text) from public;
grant execute on function public.set_shipment_appointment(
  uuid, eta_kind, timestamptz, shipment_event_source, uuid,
  shipment_event_visibility, text, text, text, text) to service_role;

revoke all on function public.apply_shipment_correction(
  uuid, shipment_status, shipment_status, text, uuid,
  shipment_event_visibility, text, timestamptz, jsonb, text) from public;
grant execute on function public.apply_shipment_correction(
  uuid, shipment_status, shipment_status, text, uuid,
  shipment_event_visibility, text, timestamptz, jsonb, text) to service_role;
