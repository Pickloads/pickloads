-- ============================================================================
-- PickLoads — Migration 0025: ETA architecture + exceptions/delays (M-78).
--
-- SCOPE (plan §7, Phase B, row M-78): *"ETA architecture (8 fields incl.
-- `eta_confidence`, public/internal delay reasons), ETA-change events,
-- previous-value history; exceptions (13 types, 10 fields, open/resolve
-- lifecycle)."*
-- Authority: `docs/DIRECTIVE-tracking.md` §10 (the ETA field list and the
-- three things that must happen when an ETA changes), §21 (the 13 types, the
-- 10 fields, and the customer-honesty rule), §6 (history instead of
-- overwriting), §7 (append-only ledger), §17 (notify per preferences), §19
-- (RLS per audience), §24 (five locales, no silent machine translation), §25
-- (bounded, indexed reads), §26 (`eta_calculation_failure`), §30 (do not
-- claim predictive ETAs).
--
-- Migrations 0001–0004 are FROZEN and untouched. 0017–0024 are untouched, with
-- ONE deliberate exception argued in section 6: this migration REPLACES
-- `set_shipment_eta()`, because M-75 shipped it writing the previous ETA into
-- the event metadata *and said in its own header that M-78 replaces the
-- metadata-based history with `shipment_eta_history` rows*. The signature is
-- byte-identical, so the existing grants and the TypeScript caller are
-- unchanged; only the body grows one INSERT.
--
-- ── THE TWO TABLES M-71 DELIBERATELY LEFT ────────────────────────────────
--
-- 0017 listed `shipment_exceptions` and `shipment_eta_history` among the
-- tables it did not create, and the RLS suite asserted their ABSENCE so the
-- deferral could not quietly become drift. That assertion is inverted in this
-- deploy: both tables now exist, both carry the columns M-70's
-- `ShipmentExceptionRow` / `ShipmentEtaHistoryRow` declare, and every enum
-- they need (`shipment_exception_type` ×13, `shipment_exception_severity` ×4,
-- `eta_source`, `eta_confidence`, `eta_kind`) was created by 0017 — this
-- migration mints no new type.
--
-- ── WHY THE CUSTOMER BANDS ARE A FUNCTION AND NOT FOUR POLICIES ──────────
--
-- 0024 gave `shipment_documents` a policy per audience because *every column
-- of a document row is safe for whoever may read the row at all*. That is not
-- true here. §21 is emphatic about ONE column:
--
--     "Do not expose blame, legal conclusions or sensitive internal
--      commentary."
--
-- `internal_description` and `resolution` are exactly that, and a ROW-level
-- policy cannot restrict a COLUMN. A `select *` from a shipper session under
-- a permissive row policy would hand the shipper the dispatcher's account of
-- whose fault the delay was. Column-level REVOKE cannot help either: staff and
-- customers are both the `authenticated` role, so a revoke that protects the
-- shipper also blinds the dispatcher.
--
-- So the base table carries the STAFF policy and nothing else — a customer
-- session reads zero rows and therefore zero columns — and the customer path
-- is `my_shipment_exceptions()`, a `security definer` function whose
-- `returns table (...)` clause is a seven-column allow-list with no internal
-- field in it. The projection is enforced by the function's TYPE, which no
-- future `select *` can widen, and the caller cannot choose its own audience:
-- the function resolves membership itself.
--
-- `/track` (anon) does not use it. That path already runs under the
-- service-role client (`src/lib/shipments/public-lookup.ts`) behind the §4
-- two-factor check, and §4 gives anonymous visitors no table access at all.
--
-- ── WHY THE BACKFILL IS A FUNCTION THAT IS THEN CALLED ───────────────────
--
-- M-75 shipped exceptions as structured `exception_opened` EVENTS carrying
-- `metadata.exception_source = 'm75_event_only'`, and said in its own module
-- doc: *"M-78 backfills from"* them. M-76 added `'m76_carrier_report'` and
-- `'m76_driver_report'` on the same contract. Section 7 honours it.
--
-- The migration of those events into rows is `backfill_shipment_exceptions()`,
-- defined and then invoked once at the bottom. A function rather than a bare
-- INSERT because it must be idempotent and RE-RUNNABLE: a second call after
-- the deploy must migrate anything that arrived from a lagging replica or a
-- rolled-back-and-reapplied surface without creating a duplicate row. The
-- unique `source_event_id` is what makes that true, and the integration suite
-- calls the function twice for exactly this reason.
--
-- §7 is append-only and this migration obeys it literally: the backfill
-- INSERTS and never deletes, never updates and never rewrites a single
-- `shipment_events` row. After it runs, both the event and the exception row
-- exist and point at each other. The event ledger is still the history; the
-- table is the LIFECYCLE, which an append-only ledger cannot express (a row
-- that closes is not an event).
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────
--
--   -- 1. RESTORE M-75's `set_shipment_eta()` FIRST: re-run the
--   --    `create or replace function public.set_shipment_eta(...)` block from
--   --    0022 verbatim. Its body writes the same columns and the same event;
--   --    it simply does not insert the history row. Do this BEFORE dropping
--   --    the table or every ETA update fails on a missing relation.
--   drop policy if exists "staff manage shipment exceptions" on shipment_exceptions;
--   drop policy if exists "staff manage shipment eta history" on shipment_eta_history;
--   drop function if exists public.backfill_shipment_exceptions();
--   drop function if exists public.my_shipment_exceptions(uuid);
--   drop function if exists public.update_shipment_exception(uuid, uuid, boolean, shipment_exception_severity, text, uuid);
--   drop function if exists public.resolve_shipment_exception(uuid, text, uuid, shipment_event_source, text, text, text);
--   drop function if exists public.open_shipment_exception(uuid, shipment_exception_type, shipment_exception_severity, text, text, uuid, uuid, shipment_event_source, text, jsonb);
--   drop trigger  if exists trg_shipment_exceptions_lifecycle on shipment_exceptions;
--   drop function if exists public.guard_shipment_exception_lifecycle();
--   drop trigger  if exists trg_shipment_eta_history_append_only on shipment_eta_history;
--   drop function if exists public.guard_shipment_eta_history_append_only();
--   drop table if exists shipment_exceptions cascade;
--   drop table if exists shipment_eta_history cascade;
--
--   DESTRUCTIVE for the LIFECYCLE, not for the HISTORY. Every exception that
--   was ever opened still exists as an `exception_opened` event and every
--   resolution as an `exception_resolved` event — that is the whole reason
--   both functions write an event as well as a row. What is lost is
--   `assigned_to`, `customer_notified_at`, the resolution text and the
--   open/closed state; take a dump first (`pg_dump -t shipment_exceptions -t
--   shipment_eta_history`). ETA history reverts to the event metadata M-75
--   already wrote, which is where it lived before this module.
--
--   Roll back `src/lib/shipments/{exceptions,eta,eta-estimate}.ts`, the four
--   surfaces and the two server-action files in the SAME deploy. It fails
--   CLOSED either way: with the table gone, `my_shipment_exceptions()` is
--   gone too, the customer DTOs receive an empty exception list, and the
--   banner disappears rather than rendering an error.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · shipment_eta_history — §10's "preserve previous ETA values in history"
-- ---------------------------------------------------------------------------
--
-- Columns match `ShipmentEtaHistoryRow` in src/lib/shipments/types.ts exactly,
-- in declaration order. M-70 wrote that interface; nothing here invents a
-- column, and nothing there is missing here.
--
-- WHY A TABLE WHEN THE EVENT ALREADY CARRIES THE PREVIOUS VALUE. M-75 put
-- `previous_at` / `new_at` into the `eta_update` event's `metadata`, which was
-- the honest thing to do with no table — but `metadata` is `jsonb` on a table
-- whose customer policies span five visibility bands, it is unindexable for
-- "show me every ETA change on this shipment in order", and it mixes the ETA
-- record with sixteen other event types. §10 asks for history "or metadata";
-- this module ships the history, and the event stays, so the two agree.
create table shipment_eta_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  eta_kind eta_kind not null,

  -- NULLABLE ON BOTH SIDES, and the nulls are meaningful:
  --   previous_at null → this was the FIRST ETA for this kind
  --   new_at      null → the ETA was CLEARED (a real operational act, §10)
  -- A CHECK forbidding "both null" would forbid nothing useful, because
  -- `set_shipment_eta()` already refuses a no-op restatement (PL422).
  previous_eta_at timestamptz,
  new_eta_at timestamptz,

  -- §10's provenance, carried per CHANGE and not only as the shipment's
  -- current value. Without it, "who said 14:00 and on what basis?" is
  -- unanswerable the moment somebody overwrites the column.
  eta_source eta_source not null,
  eta_confidence eta_confidence,

  delay_minutes integer,
  -- The customer-safe wording as it stood AT THE CHANGE. A D-6 phrase token
  -- (`phrase:delay.traffic`) or free text — see src/lib/shipments/phrases.ts.
  reason_public text,
  -- §21's operational truth. NEVER leaves a staff surface: this table has no
  -- customer policy and no customer accessor at all.
  reason_internal text,

  -- The §10 "create a shipment event" companion. `on delete set null` rather
  -- than cascade: 0019's trigger makes `shipment_events` append-only for every
  -- role including the service role, so this can only fire if a future
  -- migration deliberately removes an event — and losing the ETA history as
  -- collateral would be worse than a dangling reference.
  event_id uuid references shipment_events(id) on delete set null,
  changed_by uuid references profiles(id) on delete set null,
  changed_at timestamptz not null default now(),

  constraint shipment_eta_history_delay_sane
    check (delay_minutes is null or (delay_minutes >= 0 and delay_minutes <= 100000))
);

-- §25: the only read shape this table has — one shipment's ETA changes,
-- newest first, bounded.
create index idx_shipment_eta_history_shipment
  on shipment_eta_history (shipment_id, changed_at desc);

comment on table shipment_eta_history is
  'M-78/§10: one row per ETA CHANGE, carrying the PREVIOUS value beside the '
  'new one. Written only by set_shipment_eta(). Append-only (trigger). STAFF '
  'ONLY — reason_internal lives here and there is no customer policy or '
  'accessor; a customer''s ETA history is the eta_update events they already '
  'read on their timeline.';

-- Append-only, exactly as 0019 made `shipment_events`. A history that can be
-- edited answers nothing: the single purpose of this table is to be the record
-- of what the ETA USED to be, and an UPDATE would destroy the one fact it
-- exists to keep.
create or replace function public.guard_shipment_eta_history_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'shipment_eta_history is append-only (DIRECTIVE-tracking §6, §10): an ETA history row is never updated or deleted — record a new change instead'
    using errcode = 'PL409';
end;
$$;

create trigger trg_shipment_eta_history_append_only
  before update or delete on shipment_eta_history
  for each row execute function public.guard_shipment_eta_history_append_only();

alter table shipment_eta_history enable row level security;

-- Privileges BEFORE policies and revoke-then-grant, the 0024 doctrine:
-- Supabase's defaults hand `authenticated`/`anon` full DML on every new public
-- table and a table grant is checked IN ADDITION to RLS, so leaving the
-- default would mean a signed-in browser session held INSERT on the ETA
-- history whether or not a policy ever matched.
revoke all on shipment_eta_history from authenticated, anon;
-- SELECT only, and only to `authenticated`. Staff sessions ARE `authenticated`
-- (the JWT claim is what `is_staff()` reads), so a grant is required for the
-- policy below to have anything to filter; `anon` gets nothing, so the public
-- path cannot reach this table at any privilege level. No INSERT/UPDATE/DELETE
-- to anybody: the only writer is `set_shipment_eta()` under the service role.
grant select on shipment_eta_history to authenticated;

create policy "staff manage shipment eta history" on shipment_eta_history
  for all using (is_staff());

-- ---------------------------------------------------------------------------
-- 2 · shipment_exceptions — §21's 13 types, 10 fields, open/resolve lifecycle
-- ---------------------------------------------------------------------------
--
-- §21's ten named fields, all present: severity · public description ·
-- internal description · opened_at · resolved_at · opened_by · assigned_to ·
-- customer notified · resolution — plus `exception_type`, which §21 names
-- separately as the 13-value list.
--
-- TWO COLUMNS BEYOND THAT LIST, both argued rather than assumed:
--
--   `source_event_id`     the `exception_opened` event this row was opened by
--                         (or backfilled from). UNIQUE, which is what makes
--                         the backfill idempotent, and what lets §7's ledger
--                         and this table be reconciled by a join rather than
--                         by a timestamp heuristic.
--   `resolution_event_id` the `exception_resolved` event that closed it.
--
-- The alternative to the second was `resolved_by` + a resolution timestamp
-- duplicated on the row. That would put three answers to "who closed this,
-- when, in whose words" in two places, to disagree the first time somebody
-- writes one and not the other. The event already records the actor, the
-- time and the wording under §7's append-only guarantee; a pointer to it is
-- strictly better than a copy of it.
create table shipment_exceptions (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  exception_type shipment_exception_type not null,
  severity shipment_exception_severity not null default 'medium',

  -- §21: "the customer should see a clear and calm explanation." NULL means
  -- there is nothing honest to publish yet, and M-70's DTO already omits such
  -- an exception from every customer view rather than rendering a blank
  -- alarm. That is why this is nullable and `internal_description` carries the
  -- operational weight.
  public_description text,
  internal_description text,

  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  opened_by uuid references profiles(id) on delete set null,
  assigned_to uuid references profiles(id) on delete set null,
  -- §21 "customer notified" as a TIMESTAMP, not a boolean. A boolean answers
  -- "did we tell them"; §17's duplicate-suppression and every "when did they
  -- find out?" conversation need "when". A null is the same false a boolean
  -- would have carried.
  customer_notified_at timestamptz,
  resolution text,

  source_event_id uuid unique references shipment_events(id) on delete set null,
  resolution_event_id uuid references shipment_events(id) on delete set null,

  -- At least ONE description. An exception with neither is a row that says
  -- nothing to anybody; the dispatcher form additionally requires the internal
  -- one, and the carrier/driver forms write it from their report.
  constraint shipment_exceptions_has_a_description
    check (
      coalesce(btrim(public_description), '') <> ''
      or coalesce(btrim(internal_description), '') <> ''
    ),
  -- §21 names `resolution` as a field of a resolved exception. A closed
  -- exception with no resolution text is the shape that makes an exception log
  -- useless six months later, so the database refuses it.
  constraint shipment_exceptions_resolution_present
    check (resolved_at is null or coalesce(btrim(resolution), '') <> ''),
  constraint shipment_exceptions_resolution_after_open
    check (resolved_at is null or resolved_at >= opened_at),
  constraint shipment_exceptions_resolution_event_iff_resolved
    check (resolution_event_id is null or resolved_at is not null)
);

-- §25 — the three read shapes this module has.
-- Every surface's "exceptions on this shipment", newest first.
create index idx_shipment_exceptions_shipment
  on shipment_exceptions (shipment_id, opened_at desc);
-- The dispatcher board's open-exception count and the triage queue. Partial,
-- so it stays proportional to the OPEN set rather than to all history.
create index idx_shipment_exceptions_open
  on shipment_exceptions (severity, opened_at desc)
  where resolved_at is null;
-- "What is assigned to me and still open" (§21 `assigned_to`).
create index idx_shipment_exceptions_assigned
  on shipment_exceptions (assigned_to, opened_at desc)
  where resolved_at is null and assigned_to is not null;

comment on table shipment_exceptions is
  'M-78/§21: the 13 exception types with their 10 fields and an open/resolve '
  'lifecycle. STAFF-ONLY at the table level — internal_description and '
  'resolution are the columns §21 forbids exposing, and a row policy cannot '
  'restrict a column. Customers read the calm projection through '
  'my_shipment_exceptions(); /track reads it service-side behind the §4 '
  'two-factor check.';

-- ---------------------------------------------------------------------------
-- 3 · The lifecycle, enforced in the database and not only in the action
-- ---------------------------------------------------------------------------
--
-- §21 describes a lifecycle (opened → assigned/notified → resolved) but not
-- its rules. These are the ones that must hold whatever writes the row, and
-- each one exists because its absence is a real failure mode:
--
--   * WHAT THE EXCEPTION IS cannot change. `shipment_id`, `exception_type`,
--     `opened_at`, `opened_by` and `source_event_id` are frozen after insert —
--     the same reasoning 0024 applies to a filed document. Re-typing a
--     `damaged_freight` into a `traffic` after the claim is filed rewrites
--     history; opening a second exception does not.
--   * RESOLUTION IS ONE-WAY. Once `resolved_at` is set it cannot be cleared
--     and cannot be moved. Re-opening is a NEW exception, which is also what
--     leaves the reopen visible in the ledger.
--   * NOTIFICATION IS ONE-WAY. `customer_notified_at` cannot be cleared: the
--     customer either was told or was not, and un-telling them is not a state
--     the system can reach.
--   * A RESOLVED EXCEPTION IS CLOSED TO EDITS other than its own resolution
--     write. Re-assigning or re-severitying a closed exception is almost
--     always somebody operating on the wrong row.
create or replace function public.guard_shipment_exception_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if new.shipment_id is distinct from old.shipment_id
     or new.exception_type is distinct from old.exception_type
     or new.opened_at is distinct from old.opened_at
     or new.opened_by is distinct from old.opened_by
     or new.source_event_id is distinct from old.source_event_id then
    raise exception
      'shipment_exceptions.%: what an exception IS cannot change — open a new exception instead (DIRECTIVE-tracking §21)',
      case
        when new.shipment_id is distinct from old.shipment_id then 'shipment_id'
        when new.exception_type is distinct from old.exception_type then 'exception_type'
        when new.opened_at is distinct from old.opened_at then 'opened_at'
        when new.opened_by is distinct from old.opened_by then 'opened_by'
        else 'source_event_id'
      end
      using errcode = 'PL409';
  end if;

  if old.resolved_at is not null
     and new.resolved_at is distinct from old.resolved_at then
    raise exception
      'this exception was resolved at % — a resolution is one-way; re-open by logging a NEW exception (DIRECTIVE-tracking §21)',
      old.resolved_at
      using errcode = 'PL409';
  end if;

  if old.customer_notified_at is not null and new.customer_notified_at is null then
    raise exception
      'customer_notified_at cannot be cleared — the customer either was notified or was not (DIRECTIVE-tracking §17)'
      using errcode = 'PL409';
  end if;

  if old.resolved_at is not null
     and (new.severity is distinct from old.severity
          or new.assigned_to is distinct from old.assigned_to
          or new.public_description is distinct from old.public_description) then
    raise exception
      'this exception is closed — triage fields are read-only once it is resolved (DIRECTIVE-tracking §21)'
      using errcode = 'PL409';
  end if;

  return new;
end;
$$;

create trigger trg_shipment_exceptions_lifecycle
  before update on shipment_exceptions
  for each row execute function public.guard_shipment_exception_lifecycle();

alter table shipment_exceptions enable row level security;

revoke all on shipment_exceptions from authenticated, anon;
-- SELECT only, for the same reason as the ETA history above: `is_staff()`
-- evaluates inside an `authenticated` session, so the policy needs a grant to
-- filter. A CUSTOMER session holds the same grant and reads ZERO ROWS — and
-- zero rows is zero columns, which is how `internal_description` stays
-- unreachable without a column-level revoke that would blind dispatch too.
grant select on shipment_exceptions to authenticated;

-- The ONE policy. See the header for why customers get a function instead:
-- §21's forbidden columns cannot be withheld by a row-level rule, and staff
-- and customers share the `authenticated` role so a column REVOKE would blind
-- dispatch. `is_staff()` is the shipped idiom (0018) and, as 0018 records
-- honestly, it does NOT distinguish dispatcher from admin at the database
-- level — dispatcher least-privilege is query-level (`src/lib/staff-scope.ts`)
-- until M-83's restrictive policies.
create policy "staff manage shipment exceptions" on shipment_exceptions
  for all using (is_staff());

-- ---------------------------------------------------------------------------
-- 4 · my_shipment_exceptions() — the customer projection, as a TYPE
-- ---------------------------------------------------------------------------
--
-- Seven columns, named in the `returns table` clause. `internal_description`,
-- `resolution`, `opened_by`, `assigned_to` and both event ids are not merely
-- unselected — they are not in the function's return type, so no caller can
-- ask for them and no future `select *` inside the body can leak them.
--
-- THE AUDIENCE IS RESOLVED HERE, NOT PASSED IN. A parameter would be the
-- obvious design and would be a privilege-escalation-by-argument: a shipper
-- passing `'staff'` would read the internal commentary. The function asks the
-- caller's own memberships instead, through the three shipped helpers, which
-- means the three customer bands of 0018 are reused rather than restated.
--
-- `public_description is not null` is the same rule M-70's DTO applies and
-- §21 requires: an exception with nothing honest to say reaches no customer.
-- Applying it HERE as well as in the DTO is deliberate belt-and-braces — the
-- database's answer cannot be widened by a mistake in TypeScript.
create or replace function public.my_shipment_exceptions(p_shipment_id uuid)
returns table (
  id uuid,
  shipment_id uuid,
  exception_type shipment_exception_type,
  severity shipment_exception_severity,
  public_description text,
  opened_at timestamptz,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.shipment_id, e.exception_type, e.severity,
         e.public_description, e.opened_at, e.resolved_at
    from shipment_exceptions e
    join shipments s on s.id = e.shipment_id
   where e.shipment_id = p_shipment_id
     and coalesce(btrim(e.public_description), '') <> ''
     and (
       is_staff()
       or s.shipper_id in (select my_shipper_ids())
       or s.carrier_id in (select my_carrier_ids())
       or s.broker_partner_id in (select my_broker_partner_ids())
     )
   order by e.opened_at desc
$$;

revoke all on function public.my_shipment_exceptions(uuid) from public;
grant execute on function public.my_shipment_exceptions(uuid) to authenticated, service_role;

comment on function public.my_shipment_exceptions(uuid) is
  'M-78/§21: the CALM projection of a shipment''s exceptions for whichever '
  'customer band the caller belongs to. The audience is resolved from the '
  'caller''s memberships, never from an argument. internal_description and '
  'resolution are absent from the RETURN TYPE, which is what makes §21''s '
  '"do not expose blame or internal commentary" a database property.';

-- ---------------------------------------------------------------------------
-- 5 · open / resolve / update — the write path, one transaction each
-- ---------------------------------------------------------------------------
--
-- Same doctrine as 0019 and 0022, for the same reason: an exception row and
-- the `shipment_events` row that explains it must be ONE statement. PostgREST
-- has no multi-statement transaction, and a crash between two supabase-js
-- calls leaves either an exception nobody can see on the timeline or a
-- timeline entry with no lifecycle behind it.
--
-- SECURITY MODEL, unchanged from 0019/0022/0024: `security definer`,
-- `set search_path = public`, EXECUTE granted to `service_role` ALONE. A
-- browser session — including an admin's — cannot call these, which is what
-- makes §19's "unauthorized writes fail" structural rather than enumerated.

-- open_shipment_exception() — §14 "log exception", §13 "submit exception".
--
-- `p_visibility` is NOT a parameter. §21 decides it: an exception with a
-- public description is a `public` event (the customer is being told), and one
-- without is `staff_only` (there is nothing honest to publish). Making that a
-- caller's choice would let a public description be filed staff-only, which is
-- a customer who was told nothing while the record says otherwise.
create or replace function public.open_shipment_exception(
  p_shipment_id uuid,
  p_exception_type shipment_exception_type,
  p_severity shipment_exception_severity default 'medium',
  p_public_description text default null,
  p_internal_description text default null,
  p_opened_by uuid default null,
  p_assigned_to uuid default null,
  p_source shipment_event_source default 'dispatcher',
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event shipment_events%rowtype;
  v_existing shipment_exceptions%rowtype;
  v_event_id uuid;
  v_exception_id uuid;
  v_public text := nullif(btrim(coalesce(p_public_description, '')), '');
  v_internal text := nullif(btrim(coalesce(p_internal_description, '')), '');
begin
  -- Replay FIRST, before any validation: a retried submit must return the
  -- original outcome, not a fresh rejection. Same order as 0019's append path.
  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      select * into v_existing from shipment_exceptions
        where source_event_id = v_event.id;
      return jsonb_build_object(
        'shipment_id', v_event.shipment_id,
        'exception_id', v_existing.id,
        'event_id', v_event.id,
        'replayed', true);
    end if;
  end if;

  if v_public is null and v_internal is null then
    raise exception
      'an exception needs at least one description — say what happened, even if only internally (§21)'
      using errcode = 'PL422';
  end if;

  if not exists (select 1 from shipments where id = p_shipment_id) then
    raise exception 'shipment % does not exist', p_shipment_id
      using errcode = 'PL404';
  end if;

  insert into shipment_events (
    shipment_id, event_type, source, created_by,
    public_message, internal_message, visibility, metadata, idempotency_key
  ) values (
    p_shipment_id, 'exception_opened', p_source, p_opened_by,
    v_public, v_internal,
    -- §21, decided here rather than by the caller. See the note above.
    (case when v_public is null then 'staff_only' else 'public' end)::shipment_event_visibility,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'exception_type', p_exception_type,
      'severity', p_severity),
    p_idempotency_key
  ) returning id into v_event_id;

  insert into shipment_exceptions (
    shipment_id, exception_type, severity,
    public_description, internal_description,
    opened_by, assigned_to, source_event_id
  ) values (
    p_shipment_id, p_exception_type, p_severity,
    v_public, v_internal, p_opened_by, p_assigned_to, v_event_id
  ) returning id into v_exception_id;

  -- The back-reference, written after the row exists so the event carries the
  -- exception id a reader lands on from the timeline. This is an UPDATE on
  -- `shipment_events`, which 0019's append-only trigger refuses — so it is
  -- deliberately NOT done. The link is one-directional by design: the row
  -- points at the event, and `source_event_id` is unique, so the join works
  -- in both directions from one column.

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'exception_id', v_exception_id,
    'event_id', v_event_id,
    'replayed', false);
end;
$$;

comment on function public.open_shipment_exception(uuid, shipment_exception_type, shipment_exception_severity, text, text, uuid, uuid, shipment_event_source, text, jsonb) is
  'M-78/§21: open an exception — the row AND the exception_opened event, in '
  'one transaction. Visibility is decided by whether there is a public '
  'description, never by the caller. EXECUTE: service_role only.';

-- resolve_shipment_exception() — §14's other half, which M-75 named as
-- M-78's to build ("resolving needs a row to resolve and a lifecycle to
-- close").
create or replace function public.resolve_shipment_exception(
  p_exception_id uuid,
  p_resolution text,
  p_actor uuid default null,
  p_source shipment_event_source default 'dispatcher',
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
  v_exception shipment_exceptions%rowtype;
  v_event shipment_events%rowtype;
  v_event_id uuid;
  v_resolution text := nullif(btrim(coalesce(p_resolution, '')), '');
  v_public text := nullif(btrim(coalesce(p_public_message, '')), '');
begin
  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'shipment_id', v_event.shipment_id,
        'exception_id', p_exception_id,
        'event_id', v_event.id,
        'replayed', true);
    end if;
  end if;

  if v_resolution is null then
    raise exception
      'a resolution needs words — "what closed this?" is the question an exception log exists to answer (§21)'
      using errcode = 'PL422';
  end if;

  select * into v_exception from shipment_exceptions
    where id = p_exception_id for update;
  if not found then
    raise exception 'exception % does not exist', p_exception_id
      using errcode = 'PL404';
  end if;

  -- Refused HERE with a message an operator can act on, as well as by the
  -- lifecycle trigger. Two dispatchers closing the same exception is a race
  -- that happens; a 500 is not the right answer to it.
  if v_exception.resolved_at is not null then
    raise exception
      'that exception was already resolved at %', v_exception.resolved_at
      using errcode = 'PL409';
  end if;

  insert into shipment_events (
    shipment_id, event_type, source, created_by,
    public_message, internal_message, visibility, metadata, idempotency_key
  ) values (
    v_exception.shipment_id, 'exception_resolved', p_source, p_actor,
    v_public,
    coalesce(nullif(btrim(coalesce(p_internal_message, '')), ''), v_resolution),
    (case when v_public is null then 'staff_only' else 'public' end)::shipment_event_visibility,
    jsonb_build_object(
      'exception_id', v_exception.id,
      'exception_type', v_exception.exception_type,
      'severity', v_exception.severity),
    p_idempotency_key
  ) returning id into v_event_id;

  update shipment_exceptions
     set resolved_at = now(),
         resolution = v_resolution,
         resolution_event_id = v_event_id
   where id = p_exception_id;

  return jsonb_build_object(
    'shipment_id', v_exception.shipment_id,
    'exception_id', p_exception_id,
    'event_id', v_event_id,
    'replayed', false);
end;
$$;

comment on function public.resolve_shipment_exception(uuid, text, uuid, shipment_event_source, text, text, text) is
  'M-78/§21: close an exception with a mandatory resolution, and record the '
  'exception_resolved event in the same transaction. Refuses a second '
  'resolution (PL409). EXECUTE: service_role only.';

-- update_shipment_exception() — triage, without a second write path.
--
-- `assigned_to`, `severity` and `customer_notified_at` are the three §21
-- fields that legitimately change AFTER an exception is opened, and none of
-- them is a timeline event: re-assigning an exception is not something a
-- customer's history should carry, and stamping "we told them" is a
-- consequence of a notification that already produced its own record. A
-- function rather than a policy so the one-way rules are enforced in one place
-- and the caller is still the service role.
create or replace function public.update_shipment_exception(
  p_exception_id uuid,
  p_assigned_to uuid default null,
  p_mark_customer_notified boolean default false,
  p_severity shipment_exception_severity default null,
  p_public_description text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exception shipment_exceptions%rowtype;
begin
  select * into v_exception from shipment_exceptions
    where id = p_exception_id for update;
  if not found then
    raise exception 'exception % does not exist', p_exception_id
      using errcode = 'PL404';
  end if;
  if v_exception.resolved_at is not null then
    raise exception
      'that exception is closed — triage fields are read-only once it is resolved'
      using errcode = 'PL409';
  end if;

  update shipment_exceptions
     set assigned_to = coalesce(p_assigned_to, assigned_to),
         severity = coalesce(p_severity, severity),
         public_description = coalesce(
           nullif(btrim(coalesce(p_public_description, '')), ''),
           public_description),
         customer_notified_at = case
           when p_mark_customer_notified then coalesce(customer_notified_at, now())
           else customer_notified_at
         end
   where id = p_exception_id;

  return jsonb_build_object(
    'shipment_id', v_exception.shipment_id,
    'exception_id', p_exception_id,
    'actor', p_actor,
    'replayed', false);
end;
$$;

comment on function public.update_shipment_exception(uuid, uuid, boolean, shipment_exception_severity, text, uuid) is
  'M-78/§21: triage an OPEN exception — assign, re-severity, add the customer '
  'wording, or stamp customer_notified_at. Every change is one-way or '
  'idempotent; a closed exception is refused (PL409). EXECUTE: service_role '
  'only.';

-- ---------------------------------------------------------------------------
-- 6 · set_shipment_eta() — REPLACED, with the history row M-75 promised
-- ---------------------------------------------------------------------------
--
-- 0022's own header: *"M-78 replaces the metadata-based history with
-- `shipment_eta_history` rows and inherits nothing to unpick, because the
-- event is additive."* This is that replacement.
--
-- THE SIGNATURE IS UNCHANGED — same thirteen parameters, same types, same
-- order, same defaults. `create or replace` therefore preserves 0022's
-- `revoke … from public` / `grant … to service_role`, and neither
-- `src/lib/shipments/eta.ts` nor `database.types.ts` changes shape. The body
-- gains exactly one INSERT, placed AFTER the event insert so `event_id` can be
-- the real event and not a null the history would have to be patched with.
--
-- Everything else 0022 argued still holds and is not restated: the no-op
-- refusal (PL422), the `for update` lock, the `coalesce` semantics on the
-- delay columns, and `p_eta_source` being required with no predictive default
-- (§30). The event ALSO keeps its metadata copy of the previous value — it is
-- append-only history, removing it would rewrite what past events said, and
-- §7 forbids exactly that.
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
  v_history_id uuid;
begin
  if p_idempotency_key is not null then
    select * into v_event from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'shipment_id', v_event.shipment_id, 'event_id', v_event.id,
        'previous_at', null, 'new_at', null, 'history_id', null,
        'replayed', true);
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
    -- unchanged" indistinguishable.
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

  -- M-78 — §10's third requirement, as a row rather than as prose.
  insert into shipment_eta_history (
    shipment_id, eta_kind, previous_eta_at, new_eta_at,
    eta_source, eta_confidence, delay_minutes,
    reason_public, reason_internal, event_id, changed_by
  ) values (
    p_shipment_id, p_kind, v_previous, p_new_eta_at,
    p_eta_source, p_eta_confidence, p_delay_minutes,
    p_reason_public, p_reason_internal, v_event_id, p_actor
  ) returning id into v_history_id;

  return jsonb_build_object(
    'shipment_id', p_shipment_id, 'event_id', v_event_id,
    'previous_at', v_previous, 'new_at', p_new_eta_at,
    'history_id', v_history_id, 'replayed', false);
end;
$$;

comment on function public.set_shipment_eta(uuid, eta_kind, timestamptz, eta_source, eta_confidence, integer, text, text, uuid, shipment_event_source, shipment_event_visibility, text, text) is
  'M-78/§10 (was M-75, partial): write the eight ETA fields, record the '
  'eta_update event, AND insert the shipment_eta_history row carrying the '
  'PREVIOUS value. Refuses a no-op restatement (PL422). EXECUTE: service_role '
  'only.';

-- ---------------------------------------------------------------------------
-- 7 · The M-75/M-76 backfill — honouring the contract they shipped
-- ---------------------------------------------------------------------------
--
-- M-75 wrote `metadata.exception_source = 'm75_event_only'` on every exception
-- it logged, and M-76 wrote `'m76_carrier_report'` / `'m76_driver_report'`,
-- SPECIFICALLY so this module could migrate them into rows. Both modules said
-- so in their docs. This is the migration, and it takes nothing away:
--
--   * every source event stays exactly where it is, unmodified. §7 is
--     append-only and 0019's trigger would refuse an UPDATE or DELETE anyway —
--     including from the service role — so this is guaranteed rather than
--     merely intended;
--   * every field the event carried is carried into the row: the §21 type and
--     severity out of `metadata`, the customer wording out of `public_message`,
--     the operational truth out of `internal_message`, the time out of
--     `event_time` and the actor out of `created_by`;
--   * `source_event_id` records WHERE each row came from, and being unique is
--     what makes a second run a no-op rather than a duplicate.
--
-- Two events are deliberately skipped and each is a decision:
--   * one whose `metadata.exception_type` is not a legal §21 value. It cannot
--     be coerced honestly and inventing `other` would file a fiction. The
--     event stays readable on the timeline, which is where it already was.
--   * one with neither description. The CHECK would refuse it, and a row
--     saying nothing to anybody is not an improvement on an event.
create or replace function public.backfill_shipment_exceptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  insert into shipment_exceptions (
    shipment_id, exception_type, severity,
    public_description, internal_description,
    opened_at, opened_by, source_event_id
  )
  select
    e.shipment_id,
    (e.metadata ->> 'exception_type')::shipment_exception_type,
    coalesce(
      nullif(e.metadata ->> 'severity', '')::shipment_exception_severity,
      'medium'),
    nullif(btrim(coalesce(e.public_message, '')), ''),
    nullif(btrim(coalesce(e.internal_message, '')), ''),
    e.event_time,
    e.created_by,
    e.id
  from shipment_events e
  where e.event_type = 'exception_opened'
    and e.metadata ->> 'exception_source' in
        ('m75_event_only', 'm76_carrier_report', 'm76_driver_report')
    -- Only values the §21 enum actually has. `enum_range` rather than a
    -- hand-written IN list: the list of legal types lives in ONE place.
    and (e.metadata ->> 'exception_type') = any (
      select unnest(enum_range(null::shipment_exception_type))::text)
    -- The CHECK's own condition, applied here so a skipped event is a
    -- deliberate omission rather than a failed migration.
    and (coalesce(btrim(e.public_message), '') <> ''
         or coalesce(btrim(e.internal_message), '') <> '')
  on conflict (source_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.backfill_shipment_exceptions() from public;
grant execute on function public.backfill_shipment_exceptions() to service_role;

comment on function public.backfill_shipment_exceptions() is
  'M-78: migrate M-75/M-76 event-only exceptions into shipment_exceptions '
  'rows. IDEMPOTENT (unique source_event_id + on conflict do nothing) and '
  'NON-DESTRUCTIVE — no shipment_events row is modified or removed, which '
  '0019''s append-only trigger enforces independently. Returns the number of '
  'rows inserted.';

-- Run it once, here, as part of the deploy. A backfill that ships as a
-- function nobody calls is a backfill that did not happen.
do $$
declare
  v_count integer;
begin
  v_count := public.backfill_shipment_exceptions();
  raise notice 'M-78: backfilled % event-only exception(s) into shipment_exceptions', v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8 · Grants — service_role ONLY on the write path, exactly as 0019/0022/0024
-- ---------------------------------------------------------------------------
--
-- `security definer` functions are EXECUTE-granted to PUBLIC by default, which
-- would hand every browser session the whole write path. Revoke first, then
-- grant to one role. The RLS suite asserts 42501 for anon AND for an
-- authenticated admin session on all four.
--
-- `my_shipment_exceptions()` is the deliberate exception to "service_role
-- only" and was granted to `authenticated` in section 4: it is a READ whose
-- projection is its type and whose audience is the caller's own memberships.
revoke all on function public.open_shipment_exception(
  uuid, shipment_exception_type, shipment_exception_severity, text, text,
  uuid, uuid, shipment_event_source, text, jsonb) from public;
revoke all on function public.resolve_shipment_exception(
  uuid, text, uuid, shipment_event_source, text, text, text) from public;
revoke all on function public.update_shipment_exception(
  uuid, uuid, boolean, shipment_exception_severity, text, uuid) from public;

grant execute on function public.open_shipment_exception(
  uuid, shipment_exception_type, shipment_exception_severity, text, text,
  uuid, uuid, shipment_event_source, text, jsonb) to service_role;
grant execute on function public.resolve_shipment_exception(
  uuid, text, uuid, shipment_event_source, text, text, text) to service_role;
grant execute on function public.update_shipment_exception(
  uuid, uuid, boolean, shipment_exception_severity, text, uuid) to service_role;
