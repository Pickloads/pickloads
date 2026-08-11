-- ============================================================================
-- PickLoads — Migration 0027: location history + provider connections (M-80).
--
-- SCOPE (plan §7, Phase C, row M-80): *"Map + provider adapter interface
-- (Motive/Samsara/Geotab/Verizon shapes, no fake connection),
-- `tracking_provider_connections`, 4 privacy visibility levels, per-shipment
-- tracking links, lazy-loaded map, accessible alternative."*
--
-- Plus the item `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 restores against §9:
-- *"location-history retention EXECUTOR"* — recorded there as "a policy with
-- no purger". This migration ships the purger.
--
-- Authority: `docs/DIRECTIVE-tracking.md` §9 (the three modes, the four
-- privacy levels, the adapter responsibilities, "location history retention
-- must be configurable"), §15 ("manage integration credentials through
-- environment variables, never database plaintext"; "manage retention
-- settings"), §19 (RLS per audience), §25 (indexes), §26 (the
-- `location_provider_failure` signal; the never-log list), §30 (honest
-- labels, no fake positions).
--
-- Migrations 0001–0004 are FROZEN and untouched. 0005–0026 are untouched
-- entirely: this migration creates two tables, one CHECK-guarded settings
-- row, six functions and two triggers on `shipment_events`, and alters no
-- shipped column, policy or grant.
--
-- ── NO PROVIDER IS CONNECTED ─────────────────────────────────────────────
--
-- §9: *"Do not implement a fake connection."* Nothing in this migration, and
-- nothing in `src/lib/shipments/providers/`, opens a socket to Motive,
-- Samsara, Geotab or Verizon Connect. `tracking_provider_connections` is the
-- place a connection WOULD be recorded; today it holds zero rows in every
-- environment, and the map surfaces render §30's "Milestone tracking"
-- because that is the honest state of a system with manual updates only.
--
-- ── WHY A SECOND LOCATION TABLE WHEN `shipment_events` HAS city/state ────
--
-- Because §9 requires location-history retention to be CONFIGURABLE, and
-- 0019's `trg_shipment_events_append_only` refuses DELETE for every role
-- including the table owner. A retention window over a ledger that cannot be
-- deleted from is not a retention window; it is a sentence in a document.
--
-- So the position series gets its own table, which is deletable BY THE
-- PURGER AND NOTHING ELSE (section 1's trigger blocks UPDATE outright and
-- section 6's function is the only granted deleter), and the ledger keeps
-- what a ledger is for: what happened, in order, forever.
--
-- Two consequences, both deliberate:
--
--   * `shipment_events.latitude` / `.longitude` (columns 0019 created and
--     that NO code path in `src/` has ever written — checked by grep before
--     this was written) are REFUSED from this migration on, by
--     `trg_shipment_events_no_coordinates`. Coordinates cannot enter the
--     un-purgeable ledger, so the retention promise is structural rather
--     than procedural. `apply_shipment_transition`'s and
--     `append_shipment_event`'s `p_latitude`/`p_longitude` parameters stay
--     for signature stability; passing a non-null value now raises PL422
--     naming `record_shipment_location()` as the replacement.
--   * `trg_shipment_events_location_mirror` writes a `shipment_locations`
--     row whenever an event carries a city or a state. Mode A (§9's manual
--     updates, the only mode required for launch) therefore produces real
--     location history with no call-site change anywhere in `src/` — the
--     same "harvest, do not ask every producer to remember" doctrine 0026
--     applied to notifications.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────
--
--   -- 1. remove the retention task from /api/cron/daily first (or unset
--   --    CRON_SECRET) so nothing calls the purger mid-teardown.
--   drop trigger if exists trg_shipment_events_location_mirror on shipment_events;
--   drop trigger if exists trg_shipment_events_no_coordinates on shipment_events;
--   drop function if exists public.mirror_shipment_event_location();
--   drop function if exists public.guard_shipment_event_coordinates();
--   drop function if exists public.purge_expired_shipment_locations(integer, integer);
--   drop function if exists public.record_shipment_location(uuid, timestamptz, numeric, numeric, text, text, numeric, integer, shipment_event_source, tracking_provider, text, jsonb);
--   drop function if exists public.set_shipment_location_visibility(uuid, shipment_location_visibility, uuid, text);
--   drop function if exists public.attach_tracking_provider_connection(uuid, tracking_provider, text, text, timestamptz, tracking_consent_status, uuid);
--   drop function if exists public.revoke_tracking_provider_connection(uuid, uuid, text);
--   drop function if exists public.my_shipment_locations(uuid, integer);
--   drop function if exists public.location_retention_days();
--   drop trigger if exists trg_tracking_provider_connections_immutable on tracking_provider_connections;
--   drop function if exists public.guard_tracking_provider_connection_immutable();
--   drop policy if exists "staff manage tracking provider connections" on tracking_provider_connections;
--   drop policy if exists "staff manage shipment locations" on shipment_locations;
--   drop trigger if exists trg_shipment_locations_no_update on shipment_locations;
--   drop function if exists public.guard_shipment_locations_no_update();
--   drop table if exists tracking_provider_connections cascade;
--   drop table if exists shipment_locations cascade;
--   delete from company_settings where key = 'location_retention_days';
--
-- DESTRUCTIVE for the position series and for every provider link ever
-- attached; `pg_dump -t shipment_locations -t tracking_provider_connections`
-- first. NOT destructive for the timeline: every city/state a dispatcher or
-- driver ever reported survives as the `shipment_events` row it was mirrored
-- from, which is why the mirror is a copy and not a move.
--
-- It fails CLOSED: with the tables gone the accessors are gone, the DTOs
-- receive an empty location list, the map never mounts and the panels render
-- §30's "Location temporarily unavailable" — the same honest state they show
-- today with no provider connected.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0 · The retention SETTING (§9 "configurable", §15 "manage retention
--     settings")
-- ---------------------------------------------------------------------------
--
-- The switchboard, not an environment variable: §15 puts retention under
-- *admin management*, and the M-24 settings editor is where an admin already
-- changes company-wide policy without a deploy. Environment variables are
-- for CREDENTIALS (§15's other clause), which is where the future provider
-- keys live — see `docs/modules/M-80-map-providers.md`.
--
-- 90 days is the launch default and is a decision, not a constant of nature:
-- it is long enough to answer "where was the truck when the customer says it
-- was late?" across a full billing dispute cycle, and short enough that a
-- breach two quarters from now does not hand over a year of movements.
insert into company_settings (key, value, description) values
  ('location_retention_days', '90',
   'M-80/§9: how many days of shipment location history to keep. The daily cron deletes older readings. Integer 1–3650; unreadable or out of range falls back to 90.')
on conflict (key) do nothing;

/**
 * Resolve the retention window, in days.
 *
 * FAILS SAFE, not open: a missing key, a non-numeric value, a negative or an
 * absurd one all resolve to 90 rather than to "keep forever". A retention
 * executor that silently stops deleting because somebody typed `"ninety"`
 * into a settings box is the exact failure the plan's §4 flagged — a policy
 * with nothing enforcing it.
 *
 * Mirrored EXACTLY by `resolveRetentionDays` in `src/lib/shipments/
 * retention.ts`, which the unit suite pins against this ladder.
 */
create or replace function public.location_retention_days()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw jsonb;
  parsed numeric;
begin
  select value into raw from company_settings where key = 'location_retention_days';
  if raw is null then return 90; end if;

  begin
    -- Accepts the JSON number the seed writes (`90`) and the string form the
    -- M-24 settings editor stores when an admin types into it (`"90"`).
    if jsonb_typeof(raw) = 'number' then
      parsed := raw::text::numeric;
    elsif jsonb_typeof(raw) = 'string' then
      parsed := trim(raw #>> '{}')::numeric;
    else
      return 90;
    end if;
  exception when others then
    return 90;
  end;

  if parsed is null or parsed < 1 or parsed > 3650 then return 90; end if;
  return floor(parsed)::integer;
end;
$$;

revoke all on function public.location_retention_days() from public;
grant execute on function public.location_retention_days() to service_role;

comment on function public.location_retention_days() is
  'M-80/§9: the configurable location-history retention window in days. '
  'Fails safe to 90 on a missing, unparseable or out-of-range setting — '
  'never to "keep forever".';

-- ---------------------------------------------------------------------------
-- 1 · shipment_locations — M-70's `ShipmentLocationRow`, column for column
-- ---------------------------------------------------------------------------
--
-- M-70's row type is the specification (its doc: "the TypeScript IS the
-- specification"). Every field below is one of its fifteen, in its order.
create table shipment_locations (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,

  -- When the truck WAS there, not when we heard about it. `recorded_at` is
  -- the provider's or operator's timestamp; the retention window and the
  -- newest-first read both order by it.
  recorded_at timestamptz not null default now(),

  -- §9 Mode C. NULL for every Mode A reading, which is the honest state of a
  -- manual update: a dispatcher types a city, not a fix.
  latitude numeric
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude numeric
    check (longitude is null or (longitude >= -180 and longitude <= 180)),

  city text check (city is null or length(city) <= 120),
  state text check (state is null or length(state) <= 60),

  -- §9 Mode C "fetch vehicle speed, IF PERMITTED". The permission is the
  -- per-shipment location-visibility level plus driver consent, applied in
  -- `my_shipment_locations()` below and in `dto.ts`; the column simply holds
  -- what a provider reported. Bounded because a 4 000 mph truck is a
  -- malformed payload, not a fast one.
  speed_mph numeric check (speed_mph is null or (speed_mph >= 0 and speed_mph <= 200)),
  heading_degrees integer
    check (heading_degrees is null or (heading_degrees >= 0 and heading_degrees < 360)),

  source shipment_event_source not null,
  -- NULL for `dispatcher` / `carrier` / `driver` / `system` readings. A
  -- provider name on a manually typed city would be a small lie about
  -- provenance, and provenance is what §30 is about.
  provider tracking_provider,

  -- §9 "prevent duplicate events". M-72 already made `external_event_id`
  -- unique PER SHIPMENT on `shipment_events`; the same rule applies here,
  -- enforced by the partial unique index below rather than by the adapter
  -- remembering to check.
  external_event_id text check (external_event_id is null or length(external_event_id) <= 200),

  -- §9 "store raw provider event metadata securely". STAFF ONLY, and that is
  -- a structural fact rather than a projection string: this table carries the
  -- staff policy alone (section 4) and the customer accessor's RETURN TYPE
  -- has no `raw_metadata` column in it (section 5).
  raw_metadata jsonb not null default '{}'::jsonb,

  -- Stamped at write time from `location_retention_days()`. Storing the
  -- expiry rather than recomputing it means shortening the window applies to
  -- old rows too (the purger also sweeps on `recorded_at`), while LENGTHENING
  -- it does not silently resurrect rows that were already promised a shorter
  -- life.
  retention_expires_at timestamptz,

  -- A reading that names neither a place nor a position says nothing. Better
  -- refused at the writer than stored as a row the map cannot plot and the
  -- text equivalent cannot describe.
  constraint shipment_locations_says_something
    check (city is not null or state is not null
           or (latitude is not null and longitude is not null)),

  -- Coordinates come in pairs. A lone latitude is a bug in a normaliser, and
  -- half a fix on a map is a fake position (§30).
  constraint shipment_locations_coordinate_pair
    check ((latitude is null) = (longitude is null)),

  -- §9 Mode C provenance: a provider-sourced reading must say which provider,
  -- and a non-provider source must not claim one.
  constraint shipment_locations_provider_source
    check ((source in ('eld', 'gps')) = (provider is not null)),

  -- An `external_event_id` is a PROVIDER's identifier. Without a provider it
  -- dedupes nothing and misdescribes where the row came from.
  constraint shipment_locations_external_id_needs_provider
    check (external_event_id is null or provider is not null)
);

-- §9's dedupe, as a database fact. Partial so the many NULLs a Mode A history
-- carries do not collide with each other.
create unique index idx_shipment_locations_external_event
  on shipment_locations (shipment_id, provider, external_event_id)
  where external_event_id is not null;

-- §25: the only customer-facing read shape — one shipment's history, newest
-- first, bounded.
create index idx_shipment_locations_shipment
  on shipment_locations (shipment_id, recorded_at desc);

-- The PURGER's scan. Partial and leading on the expiry so a nightly sweep
-- over hundreds of thousands of readings touches an index, not a table.
create index idx_shipment_locations_retention
  on shipment_locations (retention_expires_at)
  where retention_expires_at is not null;

comment on table shipment_locations is
  'M-80/§9: the PURGEABLE position series. Separate from shipment_events '
  'because §9 requires configurable retention and 0019 made the event ledger '
  'append-only for every role. raw_metadata is STAFF ONLY — the table carries '
  'one staff policy and the customer accessor my_shipment_locations() cannot '
  'return the column. Written by record_shipment_location() and by the '
  'shipment_events mirror trigger; deleted only by '
  'purge_expired_shipment_locations().';

/**
 * A reading is a FACT ABOUT A MOMENT. You do not edit it; you let it expire.
 *
 * UPDATE is refused for every role including the owner (`BYPASSRLS` is not
 * `BYPASSTRIGGER`, and disabling a trigger needs table ownership — the
 * argument 0017/0019/0024/0025 already make). DELETE is deliberately NOT
 * refused: this is the one shipment table §9 requires to be deletable, and
 * the purger is the only grantee that can reach it (section 4 revokes DELETE
 * from `authenticated` and `anon`, and no policy grants it).
 */
create or replace function public.guard_shipment_locations_no_update()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'shipment_locations rows are immutable (DIRECTIVE-tracking §9): a location reading is a fact about a moment — record a new reading, or let retention expire this one'
    using errcode = 'PL409';
end;
$$;

create trigger trg_shipment_locations_no_update
  before update on shipment_locations
  for each row execute function public.guard_shipment_locations_no_update();

-- ---------------------------------------------------------------------------
-- 2 · tracking_provider_connections — M-70's `TrackingProviderConnectionRow`
-- ---------------------------------------------------------------------------
--
-- §9 Mode B's five named fields — provider, external tracking ID, TRACKING
-- URL, expiration, consent status — plus the lifecycle columns M-70 modelled
-- and the two Mode C groundwork columns (`last_polled_at`, `last_error`).
--
-- §15: *"manage integration credentials through environment variables, never
-- database plaintext."* This table holds the PER-SHIPMENT LINK and its
-- lifecycle and nothing else. The distinction is worth stating precisely,
-- because "no secrets" and "store the tracking URL" look contradictory:
--
--   * an INTEGRATION CREDENTIAL is the thing that authenticates PickLoads to
--     a provider's API for every shipment — an API key, a client secret, a
--     refresh token. Those live in environment variables. There is no column
--     here that can hold one, and `shipment_provider_url_is_not_a_credential`
--     below refuses the shapes they take.
--   * a MODE B TRACKING URL is the resource itself: a single, expiring,
--     per-shipment locator the provider mints for one driver. §9 names it as
--     a field to store. It is still treated as sensitive — it is staff-only
--     at every layer, because a link to a live truck position is exactly what
--     §9's privacy rules exist to keep off a public page.
create table tracking_provider_connections (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  provider tracking_provider not null,

  external_tracking_id text
    check (external_tracking_id is null or length(external_tracking_id) <= 200),

  -- §9 Mode B. The field `FINAL-IMPLEMENTATION-PLAN` §4 records as missing.
  tracking_url text check (tracking_url is null or length(tracking_url) <= 2000),

  -- §9 "expiration" / §30 "Tracking link expired". Nullable because a Mode C
  -- ELD connection does not expire the way a share link does.
  expires_at timestamptz,

  -- §9/§13's consent vocabulary, reused from 0017 rather than re-declared.
  consent_status tracking_consent_status not null default 'pending',

  active boolean not null default true,
  connected_by uuid references profiles(id) on delete set null,
  connected_at timestamptz not null default now(),

  -- Mode C groundwork. `last_error` is an OPERATOR sentence, never a provider
  -- payload: §26's never-log list and the redaction in
  -- `src/lib/shipments/observability.ts` point the same way, and this column
  -- is read on a dispatcher screen.
  last_polled_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),

  -- A connection that names neither a link nor an external id connects to
  -- nothing.
  constraint tracking_provider_connections_identifies_something
    check (tracking_url is not null or external_tracking_id is not null),

  -- HTTPS only. A Mode B link is opened by a dispatcher in a browser; `http:`
  -- would put a live truck position on the wire in clear text, and
  -- `javascript:` / `data:` would make an operator-supplied string a script
  -- source on a staff page.
  constraint tracking_provider_connections_url_https
    check (tracking_url is null or tracking_url ~ '^https://[^\s]+$'),

  -- §15, enforced at the WRITER rather than by review. These are the shapes
  -- an INTEGRATION CREDENTIAL takes; the same marker list
  -- `observability.ts` redacts on. An opaque path segment or query token in a
  -- share link is untouched by this — it is not a named credential parameter,
  -- and refusing it would refuse Mode B itself.
  constraint tracking_provider_connections_url_is_not_a_credential
    check (
      tracking_url is null or (
        tracking_url !~* '(client_secret|api[_-]?key|access_token|refresh_token|private_key|bearer[ %]|authorization=)'
        and tracking_url not like '%-----BEGIN%'
        and tracking_url not like '%sk\_%'
        and tracking_url not like '%whsec\_%'
      )
    )
);

-- ONE active connection per shipment. Two live links to the same truck is an
-- operational ambiguity ("which one is current?") that a partial unique index
-- can simply forbid — the same technique 0017 used to make "reassignment is a
-- new row" a database fact.
create unique index idx_tracking_provider_connections_active
  on tracking_provider_connections (shipment_id)
  where active;

-- §9's dedupe on the provider's own identifier.
create unique index idx_tracking_provider_connections_external
  on tracking_provider_connections (shipment_id, provider, external_tracking_id)
  where external_tracking_id is not null;

-- The poller's read shape (Mode C, when a provider is ever connected):
-- "which live connections are due?"
create index idx_tracking_provider_connections_due
  on tracking_provider_connections (last_polled_at)
  where active;

comment on table tracking_provider_connections is
  'M-80/§9 Mode B + Mode C groundwork: the per-shipment provider link and its '
  'lifecycle. STAFF ONLY — no customer policy exists. Holds NO integration '
  'credential (§15): API keys live in environment variables, and a CHECK '
  'refuses credential-shaped URLs. NO PROVIDER IS CONNECTED — this table is '
  'empty in every environment today.';

/**
 * What a connection IS cannot change, and deactivation is one-way.
 *
 * Same doctrine as 0024's document trigger and 0023's token trigger: a row
 * that can be re-pointed at a different shipment, a different provider or a
 * different external id is a row whose history means nothing. Re-connecting
 * is a NEW row — which the partial unique index above already permits,
 * because it only constrains the ACTIVE one.
 */
create or replace function public.guard_tracking_provider_connection_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.shipment_id is distinct from old.shipment_id
     or new.provider is distinct from old.provider
     or new.external_tracking_id is distinct from old.external_tracking_id
     or new.connected_at is distinct from old.connected_at then
    raise exception
      'a tracking provider connection is immutable in shipment, provider, external id and connected_at (DIRECTIVE-tracking §9): revoke this one and attach a new one'
      using errcode = 'PL409';
  end if;
  if old.active = false and new.active = true then
    raise exception
      'a revoked tracking provider connection cannot be re-activated (DIRECTIVE-tracking §9, §30 "Tracking link expired"): attach a new connection'
      using errcode = 'PL409';
  end if;
  return new;
end;
$$;

create trigger trg_tracking_provider_connections_immutable
  before update on tracking_provider_connections
  for each row execute function public.guard_tracking_provider_connection_immutable();

-- ---------------------------------------------------------------------------
-- 3 · The event ledger keeps NO coordinates, and mirrors what it does keep
-- ---------------------------------------------------------------------------

/**
 * §9's retention requirement, made structural.
 *
 * 0019 gave `shipment_events` `latitude`/`longitude` columns and an
 * append-only trigger that refuses DELETE for every role. Those two facts
 * together mean a coordinate written to the ledger is a coordinate that can
 * never be purged — so the retention window would be a promise about one
 * table while the same position sat permanently in another.
 *
 * No code path in `src/` has ever written them (verified by grep across the
 * whole tree before this migration was authored: `apply-transition.ts` passes
 * the parameter through and no caller sets it). So refusing them now breaks
 * nothing and closes the hole for good. City and state are untouched: they
 * are a place, not a position, and §9 Mode A is built on them.
 */
create or replace function public.guard_shipment_event_coordinates()
returns trigger
language plpgsql
as $$
begin
  if new.latitude is not null or new.longitude is not null then
    raise exception
      'shipment_events carries no coordinates (DIRECTIVE-tracking §9, M-80): the event ledger is append-only and therefore un-purgeable, so precise positions go to shipment_locations via record_shipment_location() where the retention window can reach them'
      using errcode = 'PL422';
  end if;
  return new;
end;
$$;

create trigger trg_shipment_events_no_coordinates
  before insert on shipment_events
  for each row execute function public.guard_shipment_event_coordinates();

/**
 * Mode A history, harvested rather than requested.
 *
 * Every dispatcher status update, every carrier update and every driver
 * report that names a city or a state already writes a `shipment_events`
 * row. Mirroring here means §9's location history is populated by M-72's,
 * M-75's and M-76's existing write paths with no edit to any of them — and,
 * decisively, a future producer cannot forget to call a helper, which is the
 * failure mode 0026's harvest was built to avoid.
 *
 * The mirror is a COPY, not a move: the event keeps its city/state forever
 * (that is what a timeline is), and the purgeable series carries the same
 * place for as long as the retention window allows. Coordinates are the only
 * thing that exists in exactly one of the two, by the trigger above.
 */
create or replace function public.mirror_shipment_event_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.city is null and new.state is null then
    return new;
  end if;

  insert into shipment_locations (
    shipment_id, recorded_at, city, state, source, provider,
    external_event_id, raw_metadata, retention_expires_at
  ) values (
    new.shipment_id,
    new.event_time,
    new.city,
    new.state,
    new.source,
    -- 0017's enum has `eld` and `gps` among its sources; an event carrying
    -- one is a provider-sourced fact and the CHECK above demands a provider
    -- name. `other` is the honest answer when the ledger did not record which.
    case when new.source in ('eld', 'gps') then 'other'::tracking_provider else null end,
    -- The event's own external id is NOT reused: it dedupes EVENTS, and two
    -- different events legitimately describing the same place must both
    -- appear in the history. Dedupe on this table is for provider readings,
    -- which arrive through record_shipment_location().
    null,
    '{}'::jsonb,
    now() + make_interval(days => public.location_retention_days())
  );
  return new;
end;
$$;

create trigger trg_shipment_events_location_mirror
  after insert on shipment_events
  for each row execute function public.mirror_shipment_event_location();

-- ---------------------------------------------------------------------------
-- 4 · RLS and privileges
-- ---------------------------------------------------------------------------

alter table shipment_locations              enable row level security;
alter table tracking_provider_connections   enable row level security;

-- Revoke-then-grant, the 0024/0025 doctrine: Supabase's default privileges
-- hand `authenticated` and `anon` full DML on every new public table, and a
-- table grant is checked IN ADDITION to RLS. Leaving the default would mean a
-- signed-in browser session held INSERT and DELETE on the location series
-- whether or not a policy ever matched — and DELETE is the one privilege this
-- table exists to keep in exactly one pair of hands.
revoke all on shipment_locations            from authenticated, anon;
revoke all on tracking_provider_connections from authenticated, anon;

-- SELECT only, and only to `authenticated`, because `is_staff()` evaluates
-- inside an `authenticated` session and the staff policy needs a grant to
-- filter. A CUSTOMER session holds the same grant and reads ZERO ROWS — which
-- is the design: `raw_metadata` and `tracking_url` are staff-only, a ROW
-- policy cannot restrict a COLUMN, and staff share the `authenticated` role
-- with customers so a column-level revoke would blind dispatch too. Customers
-- read `my_shipment_locations()` instead, whose RETURN TYPE is the allow-list.
grant select on shipment_locations            to authenticated;
grant select on tracking_provider_connections to authenticated;

create policy "staff manage shipment locations" on shipment_locations
  for all using (is_staff());

create policy "staff manage tracking provider connections" on tracking_provider_connections
  for all using (is_staff());

-- ---------------------------------------------------------------------------
-- 5 · my_shipment_locations() — the customer path, and §9's four levels
-- ---------------------------------------------------------------------------
--
-- §9's privacy rules applied where they cannot be bypassed. The audience is
-- resolved from the CALLER'S OWN memberships inside the function, never from
-- an argument, so a shipper cannot ask for the staff view — the same
-- construction 0025 used for `my_shipment_exceptions()`.
--
--   hidden          → zero rows.
--   milestone_only  → zero rows; progress is told through timeline events.
--   approximate     → city/state and the time; coordinates and speed NULL.
--   exact           → coordinates and speed too.
--
-- The PUBLIC audience never reaches this function at all: `anon` holds no
-- EXECUTE, and §9's cap for public visitors (city/state even at `exact`) is
-- applied by `toPublicTrackingDto` on the service-role path M-73 already
-- owns. Two layers, and the one that matters here is the one a browser can
-- call.
--
-- The RETURN TYPE is the allow-list: no `raw_metadata`, no `external_event_id`,
-- no `provider`, no `id`. The RLS suite reads that OUT list out of `pg_proc`,
-- so an `alter function` that widened it fails even if every row assertion
-- still passed.
create or replace function public.my_shipment_locations(
  p_shipment_id uuid,
  p_limit integer default 50
)
returns table (
  recorded_at timestamptz,
  city text,
  state text,
  latitude numeric,
  longitude numeric,
  speed_mph numeric,
  source shipment_event_source
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_level shipment_location_visibility;
  v_allowed boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  select s.location_visibility,
         (s.shipper_id in (select my_shipper_ids())
          or s.carrier_id in (select my_carrier_ids())
          or s.broker_partner_id in (select my_broker_partner_ids()))
    into v_level, v_allowed
  from shipments s
  where s.id = p_shipment_id;

  if v_level is null or v_allowed is not true then
    return;
  end if;

  -- §9: at these two levels a customer receives no position at all. Returning
  -- zero rows rather than raising keeps "hidden" and "no readings yet"
  -- indistinguishable, so the privacy setting is not itself a signal.
  if v_level in ('hidden', 'milestone_only') then
    return;
  end if;

  return query
  select l.recorded_at,
         l.city,
         l.state,
         case when v_level = 'exact' then l.latitude end,
         case when v_level = 'exact' then l.longitude end,
         -- §9 "vehicle speed, IF PERMITTED". Permitted means the shipment is
         -- at `exact` AND the provider connection that produced the reading
         -- has consent. A Mode A reading has no speed to begin with.
         case when v_level = 'exact'
                and (l.provider is null
                     or exists (select 1 from tracking_provider_connections c
                                 where c.shipment_id = l.shipment_id
                                   and c.provider = l.provider
                                   and c.consent_status = 'granted'))
              then l.speed_mph end,
         l.source
  from shipment_locations l
  where l.shipment_id = p_shipment_id
  order by l.recorded_at desc
  limit v_limit;
end;
$$;

revoke all on function public.my_shipment_locations(uuid, integer) from public;
grant execute on function public.my_shipment_locations(uuid, integer) to authenticated, service_role;

comment on function public.my_shipment_locations(uuid, integer) is
  'M-80/§9: the customer location history. Audience resolved from the '
  'caller''s own memberships; the four visibility levels applied in SQL; the '
  'RETURN TYPE withholds raw_metadata, external_event_id and provider.';

-- ---------------------------------------------------------------------------
-- 6 · purge_expired_shipment_locations() — THE RETENTION EXECUTOR
-- ---------------------------------------------------------------------------
--
-- `FINAL-IMPLEMENTATION-PLAN` §4: §9's retention "was a policy with no
-- purger". This is the purger.
--
-- TWO predicates, and the second is why the window is honoured even for rows
-- written before somebody shortened it:
--
--   * `retention_expires_at <= now()` — the stamp the row was written with;
--   * `recorded_at < now() - window` — the CURRENT window, applied to
--     everything including rows stamped under a longer one.
--
-- Shortening the window therefore takes effect immediately, which is the
-- direction that matters for a privacy control. Lengthening it does not
-- resurrect what the first predicate already expired, which is the honest
-- outcome: a row promised a 30-day life is not retroactively given 90.
--
-- BOUNDED per call, so one nightly run cannot lock the table for minutes on a
-- backlog; the cron simply deletes the next batch tomorrow, and the return
-- value says whether more remain.
create or replace function public.purge_expired_shipment_locations(
  p_retention_days integer default null,
  p_limit integer default 50000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_limit integer := least(greatest(coalesce(p_limit, 50000), 1), 500000);
  v_cutoff timestamptz;
  v_deleted bigint;
begin
  -- An explicit argument wins (the cron can force a window during an incident
  -- without touching the switchboard); otherwise the setting; otherwise 90.
  v_days := coalesce(
    case when p_retention_days between 1 and 3650 then p_retention_days end,
    public.location_retention_days()
  );
  v_cutoff := now() - make_interval(days => v_days);

  with doomed as (
    select id from shipment_locations
    where (retention_expires_at is not null and retention_expires_at <= now())
       or recorded_at < v_cutoff
    order by recorded_at
    limit v_limit
    for update skip locked
  )
  delete from shipment_locations l
  using doomed d
  where l.id = d.id;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'retention_days', v_days,
    'cutoff', v_cutoff,
    'deleted', v_deleted,
    'batch_limit', v_limit,
    'more_remaining', v_deleted >= v_limit
  );
end;
$$;

revoke all on function public.purge_expired_shipment_locations(integer, integer) from public;
grant execute on function public.purge_expired_shipment_locations(integer, integer) to service_role;

comment on function public.purge_expired_shipment_locations(integer, integer) is
  'M-80/§9 RETENTION EXECUTOR. Deletes location readings past the configured '
  'window. Called nightly by /api/cron/daily. Bounded per call; returns the '
  'window used, the cutoff, the number deleted and whether more remain.';

-- ---------------------------------------------------------------------------
-- 7 · The write path — service_role only, exactly as 0019/0022/0024/0025
-- ---------------------------------------------------------------------------

/**
 * Record one location reading (§9 Mode B/Mode C ingestion).
 *
 * DEDUPE IS THE DATABASE'S JOB. `on conflict do nothing` against the partial
 * unique index means a provider replaying a page of events, or two workers
 * polling the same connection, cannot double-write — and the function reports
 * which happened, so a caller can distinguish "stored" from "already knew".
 *
 * The shipment's CURRENT position is advanced only when the reading is newer
 * than what is on the row. Out-of-order delivery is normal for telematics
 * (a queued fix arriving after a fresher one), and letting a stale fix
 * overwrite a fresh one would put a truck backwards on a customer's page —
 * §30's "do not display fake GPS positions" in its most literal form.
 */
create or replace function public.record_shipment_location(
  p_shipment_id uuid,
  p_recorded_at timestamptz default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_city text default null,
  p_state text default null,
  p_speed_mph numeric default null,
  p_heading_degrees integer default null,
  p_source shipment_event_source default 'system',
  p_provider tracking_provider default null,
  p_external_event_id text default null,
  p_raw_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := coalesce(p_recorded_at, now());
  v_id uuid;
  v_exists boolean;
begin
  select true into v_exists from shipments where id = p_shipment_id;
  if v_exists is not true then
    raise exception 'shipment % does not exist', p_shipment_id
      using errcode = 'PL404';
  end if;

  insert into shipment_locations (
    shipment_id, recorded_at, latitude, longitude, city, state,
    speed_mph, heading_degrees, source, provider, external_event_id,
    raw_metadata, retention_expires_at
  ) values (
    p_shipment_id, v_at, p_latitude, p_longitude, p_city, p_state,
    p_speed_mph, p_heading_degrees, p_source, p_provider, p_external_event_id,
    coalesce(p_raw_metadata, '{}'::jsonb),
    now() + make_interval(days => public.location_retention_days())
  )
  on conflict (shipment_id, provider, external_event_id)
    where external_event_id is not null
  do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('deduped', true, 'location_id', null);
  end if;

  update shipments s
     set current_latitude  = coalesce(p_latitude,  s.current_latitude),
         current_longitude = coalesce(p_longitude, s.current_longitude),
         current_city      = coalesce(p_city,  s.current_city),
         current_state     = coalesce(p_state, s.current_state),
         last_location_at  = v_at
   where s.id = p_shipment_id
     and (s.last_location_at is null or s.last_location_at <= v_at);

  return jsonb_build_object('deduped', false, 'location_id', v_id);
end;
$$;

revoke all on function public.record_shipment_location(uuid, timestamptz, numeric, numeric, text, text, numeric, integer, shipment_event_source, tracking_provider, text, jsonb) from public;
grant execute on function public.record_shipment_location(uuid, timestamptz, numeric, numeric, text, text, numeric, integer, shipment_event_source, tracking_provider, text, jsonb) to service_role;

/**
 * §9's four levels, on the WRITE side (the half M-70's DTO could not cover).
 *
 * WHO MAY SET WHAT, and why it is not simply "staff":
 *
 *   * NARROWING (toward `hidden`) is available to any dispatcher in scope. It
 *     only ever discloses less, it is the action somebody takes when a
 *     shipper calls and asks for the map to be turned off, and requiring an
 *     admin would mean the privacy-increasing action is the slow one.
 *   * WIDENING (toward `exact`) is ADMIN ONLY. §15 puts "control public
 *     tracking visibility" on the admin list, and `exact` is the setting §9
 *     spends a paragraph warning about. Ranked `hidden` 0 → `exact` 3, and
 *     mirrored by `mayChangeLocationVisibility` in
 *     `src/lib/shipments/location-visibility.ts`.
 *
 * The change writes a `staff_only` `shipment_events` row in the same
 * statement, so §15's *"audit who changed each status"* extends to who
 * changed how much of the truck the customer can see.
 */
create or replace function public.set_shipment_location_visibility(
  p_shipment_id uuid,
  p_level shipment_location_visibility,
  p_actor_id uuid,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current shipment_location_visibility;
  v_rank_of jsonb := '{"hidden":0,"milestone_only":1,"approximate":2,"exact":3}'::jsonb;
  v_event_id uuid;
begin
  select location_visibility into v_current from shipments where id = p_shipment_id;
  if v_current is null then
    raise exception 'shipment % does not exist', p_shipment_id using errcode = 'PL404';
  end if;

  if v_current = p_level then
    raise exception 'location visibility is already %', p_level using errcode = 'PL422';
  end if;

  if (v_rank_of ->> p_level::text)::int > (v_rank_of ->> v_current::text)::int
     and p_actor_role is distinct from 'admin' then
    raise exception
      'widening location visibility from % to % is an admin action (DIRECTIVE-tracking §15 "control public tracking visibility")', v_current, p_level
      using errcode = 'PL403';
  end if;

  update shipments set location_visibility = p_level where id = p_shipment_id;

  insert into shipment_events (
    shipment_id, event_type, event_time, source, created_by,
    internal_message, visibility, metadata
  ) values (
    p_shipment_id, 'internal_note', now(), 'dispatcher', p_actor_id,
    format('Location visibility changed from %s to %s', v_current, p_level),
    'staff_only',
    jsonb_build_object(
      'kind', 'location_visibility_change',
      'previous_level', v_current,
      'new_level', p_level,
      'actor_role', p_actor_role
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'previous_level', v_current, 'new_level', p_level, 'event_id', v_event_id);
end;
$$;

revoke all on function public.set_shipment_location_visibility(uuid, shipment_location_visibility, uuid, text) from public;
grant execute on function public.set_shipment_location_visibility(uuid, shipment_location_visibility, uuid, text) to service_role;

/**
 * Attach a Mode B per-shipment tracking link (§9).
 *
 * Any previously active connection on the shipment is revoked in the SAME
 * statement, which is what makes the partial unique index satisfiable without
 * the caller doing a read-modify-write across two round trips — the
 * `assign_shipment_carrier` argument from 0022, applied to a smaller problem.
 */
create or replace function public.attach_tracking_provider_connection(
  p_shipment_id uuid,
  p_provider tracking_provider,
  p_external_tracking_id text default null,
  p_tracking_url text default null,
  p_expires_at timestamptz default null,
  p_consent_status tracking_consent_status default 'pending',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_exists boolean;
begin
  select true into v_exists from shipments where id = p_shipment_id;
  if v_exists is not true then
    raise exception 'shipment % does not exist', p_shipment_id using errcode = 'PL404';
  end if;

  update tracking_provider_connections
     set active = false,
         last_error = 'superseded by a newer connection'
   where shipment_id = p_shipment_id and active;

  insert into tracking_provider_connections (
    shipment_id, provider, external_tracking_id, tracking_url,
    expires_at, consent_status, connected_by
  ) values (
    p_shipment_id, p_provider, p_external_tracking_id, p_tracking_url,
    p_expires_at, coalesce(p_consent_status, 'pending'), p_actor_id
  )
  returning id into v_id;

  -- §9 Mode B means the shipment is tracked by a LINK, not by manual updates.
  -- Saying so on the row is what lets §30's honest labels differ between a
  -- shipment with a live source and one without.
  update shipments set tracking_mode = 'link'
   where id = p_shipment_id and tracking_mode = 'manual';

  insert into shipment_events (
    shipment_id, event_type, event_time, source, created_by,
    internal_message, visibility, metadata
  ) values (
    p_shipment_id, 'internal_note', now(), 'dispatcher', p_actor_id,
    format('Tracking provider connection attached (%s)', p_provider),
    'staff_only',
    jsonb_build_object('kind', 'provider_connection_attached',
                       'provider', p_provider,
                       'connection_id', v_id)
  );

  return jsonb_build_object('connection_id', v_id);
end;
$$;

revoke all on function public.attach_tracking_provider_connection(uuid, tracking_provider, text, text, timestamptz, tracking_consent_status, uuid) from public;
grant execute on function public.attach_tracking_provider_connection(uuid, tracking_provider, text, text, timestamptz, tracking_consent_status, uuid) to service_role;

/** Revoke one connection. One-way, per the immutability trigger. */
create or replace function public.revoke_tracking_provider_connection(
  p_connection_id uuid,
  p_actor_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment uuid;
  v_provider tracking_provider;
begin
  select shipment_id, provider into v_shipment, v_provider
  from tracking_provider_connections where id = p_connection_id and active;

  if v_shipment is null then
    return jsonb_build_object('revoked', false);
  end if;

  update tracking_provider_connections
     set active = false,
         last_error = left(coalesce(p_reason, 'revoked by staff'), 500)
   where id = p_connection_id;

  -- Back to Mode A. §30: with no live source, the honest label is milestone
  -- tracking, and the shipment must say so rather than keep claiming a link.
  update shipments s set tracking_mode = 'manual'
   where s.id = v_shipment
     and not exists (select 1 from tracking_provider_connections c
                      where c.shipment_id = s.id and c.active);

  insert into shipment_events (
    shipment_id, event_type, event_time, source, created_by,
    internal_message, visibility, metadata
  ) values (
    v_shipment, 'internal_note', now(), 'dispatcher', p_actor_id,
    format('Tracking provider connection revoked (%s)', v_provider),
    'staff_only',
    jsonb_build_object('kind', 'provider_connection_revoked',
                       'provider', v_provider,
                       'connection_id', p_connection_id)
  );

  return jsonb_build_object('revoked', true, 'shipment_id', v_shipment);
end;
$$;

revoke all on function public.revoke_tracking_provider_connection(uuid, uuid, text) from public;
grant execute on function public.revoke_tracking_provider_connection(uuid, uuid, text) to service_role;
