-- ============================================================================
-- PickLoads — Migration 0022: the dispatcher write paths (M-75).
--
-- Scope: docs/FINAL-IMPLEMENTATION-PLAN.md §7, Phase B, row M-75 — creation,
-- quote→shipment conversion, assignments and ETA updates. Authority:
-- docs/DIRECTIVE-tracking.md §§5, 7, 10, 14, 15, 19, 20, 25.
--
-- WHY THIS MIGRATION EXISTS AT ALL. M-72 settled the doctrine and 0019 is the
-- precedent: a change to a `shipments` column and the `shipment_events` row
-- that explains it must be ONE statement, because PostgREST has no
-- multi-statement transaction and a crash between two supabase-js calls leaves
-- a shipment whose state has no event explaining it — the exact condition §6
-- and §7 forbid. M-75 introduces four more writes with that shape:
--
--   create shipment      insert `shipments` + `shipment_created` event
--   assign carrier       insert `shipment_assignments` + update
--                        `shipments.carrier_id` + `assignment_created` event
--   release assignment   stamp `released_at` + clear `shipments.carrier_id`
--                        + `assignment_released` event
--   update ETA           update five ETA columns + `eta_update` event
--                        carrying the PREVIOUS values (§10 history)
--
-- Every one of them is two-to-three writes. Done from the application they are
-- two-to-three transactions; done here they are one. Nothing else M-75 needs
-- is added: `record call`, `record email`, `public update`, `internal note`
-- and `request POD` are single event appends and already have
-- `append_shipment_event()`; status changes are `apply_shipment_transition()`;
-- appointments are `set_shipment_appointment()`; the §20 admin correction is
-- `apply_shipment_correction()`. M-75 CALLS those; it does not reimplement
-- them, and this file adds no second copy of any of them.
--
-- SAME SECURITY MODEL AS 0019, deliberately and without exception:
--   * `security definer`, `set search_path = public`;
--   * EXECUTE granted to `service_role` ALONE — not anon, not authenticated,
--     not even an admin session. A browser session cannot call these, which is
--     what makes §19's "unauthorized writes fail" structural rather than
--     enumerated. The RLS suite asserts the 42501 for an admin session.
--   * NO new table, NO new policy, NO new enum, NO new trigger. Nothing in
--     0001–0004 (frozen) or 0017–0021 is altered. This migration is four
--     functions and nothing else.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   * It does not touch `tracking_number` on UPDATE. 0017's immutability
--     trigger stands; §20's admin correction corrects a STATUS, never a
--     number (M-71's doc states the same and M-75 honours it).
--   * It does not create `shipment_exceptions`. M-78 owns that table with
--     §21's 13 types, 10 fields and open/resolve lifecycle; M-75 logs an
--     exception as an `exception_opened` event through the existing
--     append path. See docs/modules/M-75-dispatcher-operations.md, "The
--     exceptions deferral", for the argument and for exactly what M-78
--     inherits.
--   * It does not create `shipment_eta_history`. M-78 owns that too; the
--     previous ETA is preserved in the `eta_update` event's `metadata` here,
--     which is a real history a dispatcher can read today rather than a
--     column that will be backfilled from nothing.
--
-- ROLLBACK (safe in isolation — these functions have no dependents outside
-- src/lib/shipments/, and dropping them removes CAPABILITY, never data):
--
--   drop function if exists public.set_shipment_eta(uuid, eta_kind, timestamptz, eta_source, eta_confidence, integer, text, text, uuid, shipment_event_source, shipment_event_visibility, text, text);
--   drop function if exists public.release_shipment_assignment(uuid, text, uuid, shipment_event_source, shipment_event_visibility, text, text, boolean, text);
--   drop function if exists public.assign_shipment_carrier(uuid, uuid, uuid, uuid, uuid, uuid, shipment_event_source, shipment_event_visibility, text, text, text);
--   drop function if exists public.create_shipment(jsonb, uuid, shipment_event_source, text, text);
--
--   NOT DESTRUCTIVE: no row is deleted and no column changes. After a
--   rollback, shipments already created stay readable and their statuses stay
--   writable through 0019's engine; what stops working is CREATING one,
--   assigning a carrier and updating an ETA — i.e. the M-75 surface, which
--   must be rolled back in the same deploy (delete
--   src/lib/shipments/{create,assignments,eta}.ts and the three
--   /portal/admin/shipments routes) or the build calls functions that no
--   longer exist. 0017–0021 are untouched and need no rollback of their own.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · create_shipment() — §14 "create shipment" / "convert accepted quote"
-- ---------------------------------------------------------------------------
--
-- ONE jsonb payload rather than fifty parameters. `shipments` has 52 columns;
-- a positional signature over them would be unreadable, un-reviewable and
-- would break on every future ALTER. `jsonb_populate_record(null::shipments,
-- …)` gives the same type checking the column list does — a bad type is a
-- 22P02 here, not a silently coerced value — and the key ALLOW-LIST below is
-- what stops the payload being a back door.
--
-- WHY THE INSERT IS DYNAMIC, AND WHY THAT IS SAFE. `insert into shipments
-- select (jsonb_populate_record(null::shipments, payload)).*` would be
-- simpler and is WRONG: `jsonb_populate_record` yields NULL for every key the
-- payload omits, so an omitted `public_tracking_enabled` would be an explicit
-- NULL that OVERRIDES the column default and violates its NOT NULL. Naming
-- the defaults again inside this function would work and would put a second
-- copy of 0017's DDL here, to drift the first time somebody changes one.
--
-- So the column list is built from the INTERSECTION of the payload's keys and
-- `information_schema.columns` for this table, and only those columns are
-- named in the INSERT — every absent column takes its own DDL default, once,
-- where it is declared. The identifiers come from the CATALOG, never from the
-- payload (a key that is not a real column is dropped by the `where … in`
-- before `format` ever sees it) and every VALUE travels as a bound jsonb
-- parameter, so there is no injection surface in either half.
--
-- THE ALLOW-LIST IS THE POINT. Five columns are stripped from the payload
-- unconditionally, whatever the caller sends:
--
--   id            the database mints it; a caller-chosen primary key lets a
--                 retry overwrite an unrelated shipment
--   created_at    } stamped by the column defaults. A creation that can
--   updated_at    } backdate itself makes every operational report and every
--                 §15 "audit who changed what, when" answer negotiable
--   completed_at  } §6/§20 milestones. A shipment created already-completed
--   cancelled_at  } has a timestamp no event ever produced
--
-- `tracking_number` IS accepted, and must be: §5 requires server-side
-- generation, the generator lives in src/lib/shipments/tracking-number.ts
-- (M-70), and the caller owns the 23505 retry loop — which is only possible
-- if the caller is the one supplying the candidate.
--
-- THE §2 GATE IS NOT WEAKENED HERE. 0017's `trg_shipments_brokerage_gate`
-- BEFORE INSERT trigger still fires on the insert below and still raises
-- P0001 while `brokerage_active` is false. This function is `security
-- definer`, which bypasses RLS — it does NOT bypass triggers, and there is no
-- such thing as BYPASSTRIGGER. M-75's service layer refuses first, with a
-- staff-readable reason; this remains the net underneath it.
create or replace function public.create_shipment(
  p_payload jsonb,
  p_actor uuid default null,
  p_source shipment_event_source default 'dispatcher',
  p_public_message text default null,
  p_internal_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean jsonb;
  v_shipment shipments%rowtype;
  v_event_id uuid;
  v_cols text;
  v_vals text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'create_shipment requires a JSON object payload'
      using errcode = 'PL422';
  end if;

  -- The allow-list, applied in SQL as well as in TypeScript. Two layers,
  -- because the TypeScript one is a constant somebody can edit and this one
  -- is a property of the write path itself.
  v_clean := p_payload - 'id' - 'created_at' - 'updated_at'
                       - 'completed_at' - 'cancelled_at';

  if coalesce(v_clean ->> 'tracking_number', '') = '' then
    raise exception
      'a shipment requires a server-generated tracking number (DIRECTIVE-tracking §5)'
      using errcode = 'PL422';
  end if;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg('r.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols, v_vals
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'shipments'
     and v_clean ? c.column_name;

  if v_cols is null then
    raise exception 'create_shipment payload names no known shipments column'
      using errcode = 'PL422';
  end if;

  execute format(
    'insert into shipments (%s) select %s '
    'from jsonb_populate_record(null::shipments, $1) r returning *',
    v_cols, v_vals)
    using v_clean
    into v_shipment;

  -- §7: the timeline starts at creation, not at the first status change. A
  -- shipment whose history begins mid-life cannot answer "who booked this?".
  insert into shipment_events (
    shipment_id, event_type, status, source, created_by,
    city, state, public_message, internal_message, visibility, metadata
  ) values (
    v_shipment.id, 'shipment_created', v_shipment.status, p_source, p_actor,
    v_shipment.origin_city, v_shipment.origin_state,
    p_public_message, p_internal_message,
    -- `staff_only` unless the caller published deliberately: the same
    -- privacy-first default 0019 uses. A creation note is operational.
    case when p_public_message is null then 'staff_only'::shipment_event_visibility
         else 'shipper'::shipment_event_visibility end,
    jsonb_strip_nulls(jsonb_build_object(
      'quote_id', v_shipment.quote_id,
      'converted_from_quote', (v_shipment.quote_id is not null)))
  ) returning id into v_event_id;

  return jsonb_build_object(
    'shipment_id', v_shipment.id,
    'tracking_number', v_shipment.tracking_number,
    'status', v_shipment.status,
    'event_id', v_event_id,
    'replayed', false);
end;
$$;

comment on function public.create_shipment(jsonb, uuid, shipment_event_source, text, text) is
  'M-75/§14: create a shipment and its `shipment_created` event atomically. '
  'The payload is key-allow-listed (id/created_at/updated_at/completed_at/'
  'cancelled_at are stripped). 0017''s §2 brokerage gate and the tracking-'
  'number CHECK/unique index still apply — a 23505 is the caller''s retry '
  'signal (§5, M-70). EXECUTE: service_role only.';

-- ---------------------------------------------------------------------------
-- 2 · assign_shipment_carrier() — §14 "assign carrier / dispatcher / driver"
-- ---------------------------------------------------------------------------
--
-- Three writes, one statement: the assignment row (M-70: "reassignment is a
-- new row, never an edit"), the denormalised `shipments.carrier_id` that
-- 0018's `"carrier member read shipments"` policy and M-71's
-- `idx_shipments_carrier` both key on, and the `assignment_created` event.
--
-- Doing this from the application would allow a state 0018 cannot express: an
-- assignment row exists but `carrier_id` is still null, so the carrier the
-- dispatcher just assigned CANNOT SEE THE SHIPMENT. That is a policy outcome
-- produced by a crash, which is exactly what a transaction is for.
--
-- IT DOES NOT CHANGE THE STATUS. §20's `carrier_assigned` requires a carrier
-- assignment as a PRECONDITION; the transition itself is
-- `apply_shipment_transition()`, evaluated by M-72's engine with its actor
-- gate and its compare-and-swap. Folding the status change in here would be a
-- second, un-validated transition path — the thing §20 exists to prevent.
--
-- The one-active-assignment guarantee is M-71's partial unique index
-- (`shipment_assignments_one_active`); a second open assignment raises 23505,
-- which M-75 surfaces as "release the current carrier first" rather than as a
-- generic write failure.
create or replace function public.assign_shipment_carrier(
  p_shipment_id uuid,
  p_carrier_id uuid,
  p_driver_id uuid default null,
  p_truck_id uuid default null,
  p_dispatcher_id uuid default null,
  p_actor uuid default null,
  p_source shipment_event_source default 'dispatcher',
  p_visibility shipment_event_visibility default 'shipper',
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
  v_shipment shipments%rowtype;
  v_assignment_id uuid;
  v_event shipment_events%rowtype;
  v_event_id uuid;
begin
  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'shipment_id', v_event.shipment_id, 'assignment_id', null,
        'event_id', v_event.id, 'replayed', true);
    end if;
  end if;

  -- FOR UPDATE: two dispatchers assigning at once must serialise here, so the
  -- loser meets the one-active-assignment index rather than racing past it.
  select * into v_shipment from shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'shipment % does not exist', p_shipment_id
      using errcode = 'PL404';
  end if;

  -- A driver or truck must belong to the carrier being assigned. Without this
  -- a dispatcher can put carrier A's truck on carrier B's assignment, and
  -- §20's "driver marking another carrier's shipment delivered" becomes
  -- reachable through data rather than through a permission mistake.
  if p_driver_id is not null and not exists (
    select 1 from drivers where id = p_driver_id and carrier_id = p_carrier_id
  ) then
    raise exception 'driver % does not belong to carrier %', p_driver_id, p_carrier_id
      using errcode = 'PL422';
  end if;
  if p_truck_id is not null and not exists (
    select 1 from trucks where id = p_truck_id and carrier_id = p_carrier_id
  ) then
    raise exception 'truck % does not belong to carrier %', p_truck_id, p_carrier_id
      using errcode = 'PL422';
  end if;

  insert into shipment_assignments (
    shipment_id, carrier_id, driver_id, truck_id, dispatcher_id, assigned_by
  ) values (
    p_shipment_id, p_carrier_id, p_driver_id, p_truck_id,
    coalesce(p_dispatcher_id, v_shipment.dispatcher_id), p_actor
  ) returning id into v_assignment_id;

  update shipments
     set carrier_id = p_carrier_id,
         dispatcher_id = coalesce(p_dispatcher_id, dispatcher_id)
   where id = p_shipment_id;

  -- The idempotency key goes in the INSERT, not a follow-up UPDATE: 0019's
  -- `trg_shipment_events_append_only` refuses UPDATE for every role including
  -- this function's owner, which is exactly the guarantee it exists to give.
  insert into shipment_events (
    shipment_id, event_type, source, created_by,
    public_message, internal_message, visibility, metadata, idempotency_key
  ) values (
    p_shipment_id, 'assignment_created', p_source, p_actor,
    p_public_message, p_internal_message, p_visibility,
    jsonb_strip_nulls(jsonb_build_object(
      'assignment_id', v_assignment_id,
      'carrier_id', p_carrier_id,
      'driver_id', p_driver_id,
      'truck_id', p_truck_id)),
    p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object(
    'shipment_id', p_shipment_id, 'assignment_id', v_assignment_id,
    'event_id', v_event_id, 'replayed', false);
end;
$$;

comment on function public.assign_shipment_carrier(uuid, uuid, uuid, uuid, uuid, uuid, shipment_event_source, shipment_event_visibility, text, text, text) is
  'M-75/§14: assignment row + shipments.carrier_id + assignment_created event, '
  'atomically. Refuses a driver/truck belonging to another carrier (PL422). '
  'Does NOT change status — that is apply_shipment_transition() (§20). '
  'EXECUTE: service_role only.';

-- ---------------------------------------------------------------------------
-- 3 · release_shipment_assignment() — §6 carrier reassignment
-- ---------------------------------------------------------------------------
--
-- The mirror image, and the reason `carrier_assigned → carrier_search` is a
-- legal edge in M-72's graph. `released_at` is stamped on the open row (never
-- deleted — §7's "do not delete history silently" applies to assignments for
-- the same reason it applies to events), `shipments.carrier_id` is cleared so
-- 0018's carrier policy stops matching, and the event records why.
--
-- `p_clear_carrier` exists because the two cases are genuinely different:
-- releasing a carrier who fell through means the shipment has no carrier and
-- the previous one must lose visibility; releasing to immediately reassign
-- (a truck swap inside the same carrier) does not. Default true, because the
-- privacy-preserving choice is the one that should require no argument.
create or replace function public.release_shipment_assignment(
  p_shipment_id uuid,
  p_reason text default null,
  p_actor uuid default null,
  p_source shipment_event_source default 'dispatcher',
  p_visibility shipment_event_visibility default 'staff_only',
  p_public_message text default null,
  p_internal_message text default null,
  p_clear_carrier boolean default true,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment shipment_assignments%rowtype;
  v_event shipment_events%rowtype;
  v_event_id uuid;
begin
  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'shipment_id', v_event.shipment_id, 'assignment_id', null,
        'event_id', v_event.id, 'replayed', true);
    end if;
  end if;

  select * into v_assignment from shipment_assignments
    where shipment_id = p_shipment_id and released_at is null
    for update;
  if not found then
    raise exception 'shipment % has no open carrier assignment', p_shipment_id
      using errcode = 'PL422';
  end if;

  update shipment_assignments
     set released_at = now(), release_reason = p_reason
   where id = v_assignment.id;

  if p_clear_carrier then
    update shipments set carrier_id = null where id = p_shipment_id;
  end if;

  insert into shipment_events (
    shipment_id, event_type, source, created_by,
    public_message, internal_message, visibility, metadata, idempotency_key
  ) values (
    p_shipment_id, 'assignment_released', p_source, p_actor,
    p_public_message, p_internal_message, p_visibility,
    jsonb_strip_nulls(jsonb_build_object(
      'assignment_id', v_assignment.id,
      'carrier_id', v_assignment.carrier_id,
      'release_reason', p_reason,
      'carrier_cleared', p_clear_carrier)),
    p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object(
    'shipment_id', p_shipment_id, 'assignment_id', v_assignment.id,
    'event_id', v_event_id, 'replayed', false);
end;
$$;

comment on function public.release_shipment_assignment(uuid, text, uuid, shipment_event_source, shipment_event_visibility, text, text, boolean, text) is
  'M-75/§6: stamp released_at (never delete), optionally clear '
  'shipments.carrier_id so 0018''s carrier policy stops matching, and record '
  'assignment_released. EXECUTE: service_role only.';

-- ---------------------------------------------------------------------------
-- 4 · set_shipment_eta() — §10, the part M-71's columns already support
-- ---------------------------------------------------------------------------
--
-- HONEST SCOPE. §10 describes an eight-field ETA architecture with a
-- `shipment_eta_history` table, and the plan assigns ALL of it to M-78. What
-- M-71 already shipped is the five columns on `shipments`
-- (`estimated_pickup_at`, `estimated_delivery_at`, `eta_source`,
-- `eta_confidence`, `eta_updated_at`) plus `delay_minutes` and the public /
-- internal delay reasons. This function writes exactly those and records the
-- change; it does not model confidence decay, provider ETAs, or the history
-- table. M-78 replaces the metadata-based history with `shipment_eta_history`
-- rows and inherits nothing to unpick, because the event is additive.
--
-- The PREVIOUS values go into the event's `metadata`. §10 requires "preserve
-- previous ETA values in history", and an UPDATE on a column destroys exactly
-- that. Recording the old value beside the new one in an append-only ledger
-- is the same technique 0019 used for appointments, for the same reason, and
-- it means M-78 arrives to a real history rather than to a backfill from
-- nothing.
--
-- `p_eta_source` is NOT defaulted to anything predictive. §30's honest-label
-- rule turns on this column: an ETA a dispatcher typed must be labelled as a
-- dispatcher ETA, and the surfaces (M-73/M-74) already render
-- `label.eta_dispatcher` when it says so.
create or replace function public.set_shipment_eta(
  p_shipment_id uuid,
  p_kind eta_kind,
  p_new_eta_at timestamptz,
  p_eta_source eta_source,
  p_eta_confidence eta_confidence default null,
  p_delay_minutes integer default null,
  p_reason_public text default null,
  p_reason_internal text default null,
  p_actor uuid default null,
  p_source shipment_event_source default 'dispatcher',
  p_visibility shipment_event_visibility default 'shipper',
  p_idempotency_key text default null,
  p_public_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment shipments%rowtype;
  v_previous timestamptz;
  v_event shipment_events%rowtype;
  v_event_id uuid;
begin
  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'shipment_id', v_event.shipment_id, 'event_id', v_event.id,
        'previous_at', null, 'new_at', null, 'replayed', true);
    end if;
  end if;

  select * into v_shipment from shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'shipment % does not exist', p_shipment_id
      using errcode = 'PL404';
  end if;

  v_previous := case p_kind
                  when 'pickup'   then v_shipment.estimated_pickup_at
                  when 'delivery' then v_shipment.estimated_delivery_at
                end;

  -- The same rule 0019 applies to appointments: an "update" to the identical
  -- value asserts nothing, and a customer timeline is not a place for events
  -- that assert nothing. Delay fields are exempt — re-stating an ETA while
  -- raising the delay minutes IS a change.
  if v_previous is not distinct from p_new_eta_at
     and p_delay_minutes is null
     and p_reason_public is null
     and p_reason_internal is null then
    raise exception 'the % ETA is already %', p_kind, coalesce(p_new_eta_at::text, 'unset')
      using errcode = 'PL422';
  end if;

  if p_kind = 'pickup' then
    update shipments
       set estimated_pickup_at = p_new_eta_at,
           eta_source = p_eta_source,
           eta_confidence = coalesce(p_eta_confidence, eta_confidence),
           eta_updated_at = now(),
           delay_minutes = coalesce(p_delay_minutes, delay_minutes),
           delay_reason_public = coalesce(p_reason_public, delay_reason_public),
           delay_reason_internal = coalesce(p_reason_internal, delay_reason_internal)
     where id = p_shipment_id;
  else
    update shipments
       set estimated_delivery_at = p_new_eta_at,
           eta_source = p_eta_source,
           eta_confidence = coalesce(p_eta_confidence, eta_confidence),
           eta_updated_at = now(),
           delay_minutes = coalesce(p_delay_minutes, delay_minutes),
           delay_reason_public = coalesce(p_reason_public, delay_reason_public),
           delay_reason_internal = coalesce(p_reason_internal, delay_reason_internal)
     where id = p_shipment_id;
  end if;

  insert into shipment_events (
    shipment_id, event_type, source, created_by,
    public_message, internal_message, visibility, metadata, idempotency_key
  ) values (
    p_shipment_id, 'eta_update', p_source, p_actor,
    p_public_message, p_reason_internal, p_visibility,
    -- NOT jsonb_strip_nulls: a null `previous_at` is the FACT that there was
    -- no ETA before, and stripping it would make "first ETA" and "ETA
    -- unchanged" indistinguishable to M-78's reader.
    jsonb_build_object(
      'eta_kind', p_kind,
      'previous_at', v_previous,
      'new_at', p_new_eta_at,
      'eta_source', p_eta_source,
      'eta_confidence', p_eta_confidence,
      'delay_minutes', p_delay_minutes,
      'reason_public', p_reason_public),
    p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object(
    'shipment_id', p_shipment_id, 'event_id', v_event_id,
    'previous_at', v_previous, 'new_at', p_new_eta_at, 'replayed', false);
end;
$$;

comment on function public.set_shipment_eta(uuid, eta_kind, timestamptz, eta_source, eta_confidence, integer, text, text, uuid, shipment_event_source, shipment_event_visibility, text, text) is
  'M-75/§10 (partial — M-78 owns the full ETA architecture): write the ETA '
  'columns M-71 shipped and record the change with the PREVIOUS value in the '
  'event metadata. Refuses a no-op restatement (PL422). EXECUTE: service_role '
  'only.';

-- ---------------------------------------------------------------------------
-- 5 · Grants — service_role ONLY, exactly as 0019
-- ---------------------------------------------------------------------------
--
-- `security definer` functions are EXECUTE-granted to PUBLIC by default,
-- which would hand every browser session the whole write path. Revoke first,
-- then grant to one role. The RLS suite asserts 42501 for anon AND for an
-- authenticated admin session on all four.
revoke all on function public.create_shipment(
  jsonb, uuid, shipment_event_source, text, text) from public;
revoke all on function public.assign_shipment_carrier(
  uuid, uuid, uuid, uuid, uuid, uuid, shipment_event_source,
  shipment_event_visibility, text, text, text) from public;
revoke all on function public.release_shipment_assignment(
  uuid, text, uuid, shipment_event_source, shipment_event_visibility,
  text, text, boolean, text) from public;
revoke all on function public.set_shipment_eta(
  uuid, eta_kind, timestamptz, eta_source, eta_confidence, integer, text,
  text, uuid, shipment_event_source, shipment_event_visibility, text, text)
  from public;

grant execute on function public.create_shipment(
  jsonb, uuid, shipment_event_source, text, text) to service_role;
grant execute on function public.assign_shipment_carrier(
  uuid, uuid, uuid, uuid, uuid, uuid, shipment_event_source,
  shipment_event_visibility, text, text, text) to service_role;
grant execute on function public.release_shipment_assignment(
  uuid, text, uuid, shipment_event_source, shipment_event_visibility,
  text, text, boolean, text) to service_role;
grant execute on function public.set_shipment_eta(
  uuid, eta_kind, timestamptz, eta_source, eta_confidence, integer, text,
  text, uuid, shipment_event_source, shipment_event_visibility, text, text)
  to service_role;
