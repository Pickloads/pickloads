-- ============================================================================
-- PickLoads — Migration 0017: shipment schema (M-71).
--
-- Source of truth: `src/lib/shipments/types.ts` (M-70). Every enum below is
-- the exact value list of the matching `as const` array — ORDER INCLUDED,
-- because `tests/unit/shipment-types.test.ts` pins those arrays and the
-- directive's lifecycle numbering (§6) is read out of them. Every column
-- below is the matching `*Row` interface, in declaration order, with the
-- nullability the interface declares. If this file and that file ever
-- disagree, this file is wrong.
--
-- WHY A NEW TABLE AND NOT `loads`: `docs/FINAL-IMPLEMENTATION-PLAN.md` §1.
-- `loads.carrier_id` is NOT NULL and the F-03 `compute_load_fee` trigger three
-- modules depend on assumes a carrier exists; the directive's shipment
-- lifecycle begins with four statuses that have NO carrier at all. `loads` is
-- untouched here and remains the dispatch system of record;
-- `shipments.load_id` is the nullable bridge.
--
-- SCOPE (plan §7, Phase B, row M-71): `shipments` + `shipment_parties` +
-- `shipment_assignments`, the tracking-number immutability trigger, and the
-- §25 indexes. RLS is 0018. The transition ENGINE is M-72; the public route
-- is M-73.
--
-- Migrations 0001–0004 are FROZEN and are not touched. Nothing here alters an
-- existing table, policy, trigger or enum: the whole migration is additive.
--
-- ── What this migration deliberately does NOT create ──────────────────────
--
-- M-70 defines ten row types. Seven of them belong to later modules and are
-- NOT created here, because none of them is referenced by the three tables
-- M-71 owns (every FK runs child → `shipments`, never the other way), so
-- omitting them breaks no constraint:
--
--   shipment_events ................ M-72 (with the transition engine that
--                                    writes them — a table with all 18 §7
--                                    fields and no writer is a schema half
--                                    a module can silently diverge from)
--   shipment_documents ............. M-77 (needs its §16 visibility MATRIX
--                                    and the private bucket in the same
--                                    change)
--   shipment_eta_history ........... M-78
--   shipment_exceptions ............ M-78
--   shipment_locations ............. M-80 (retention executor lands with it)
--   shipment_tracking_access ....... M-73 (plan §7 assigns it migration 0018
--                                    of ITS module — it is the public
--                                    route's enumeration ledger and is
--                                    meaningless before the route exists)
--   tracking_provider_connections .. M-80
--
-- The ENUM TYPES for all of them ARE created here, on purpose: a vocabulary
-- created twice is the drift M-70 exists to prevent, and `create type` is
-- free. Later modules add tables only.
--
-- ── What this migration creates BEYOND the three named tables ─────────────
--
-- `broker_partners` + `broker_partner_memberships`. `ShipmentRow.
-- broker_partner_id` needs a referent, and M-71's own scope line requires
-- "RLS for shipper/carrier/broker/…" plus a proof that broker A cannot read
-- broker B. Neither is expressible without a broker organization and a
-- membership join. These two tables are deliberately the MINIMUM: an
-- organization identity and the same membership shape `carrier_memberships` /
-- `shipper_memberships` already use (0005). M-81 owns the invitation flow,
-- verification workflow, per-shipment sharing grants and the portal — it adds
-- tables ALONGSIDE these, it does not rewrite them. `active` defaults FALSE,
-- so a broker organization grants nothing until an admin activates it (§12
-- "invited by an admin; verified"), and `my_broker_partner_ids()` (0018)
-- enforces that in SQL rather than in a comment.
--
-- ROLLBACK (run BEFORE rolling back 0018 would leave the tables unprotected —
-- roll back 0018 first, then this file):
--
--   drop trigger if exists trg_shipments_tracking_number_immutable on shipments;
--   drop trigger if exists trg_shipments_brokerage_gate on shipments;
--   drop trigger if exists trg_shipments_updated_at on shipments;
--   drop trigger if exists trg_broker_partners_updated_at on broker_partners;
--   drop function if exists public.guard_tracking_number_immutable();
--   drop function if exists public.assert_brokerage_active();
--   drop table if exists shipment_assignments, shipment_parties, shipments,
--                        broker_partner_memberships, broker_partners cascade;
--   drop type if exists shipment_status, shipment_event_type,
--     shipment_event_source, shipment_event_visibility, shipment_tracking_mode,
--     shipment_location_visibility, tracking_provider, tracking_consent_status,
--     eta_source, eta_confidence, eta_kind, shipment_document_type,
--     shipment_document_visibility, shipment_exception_type,
--     shipment_exception_severity, shipment_party_role,
--     tracking_access_outcome;
--
--   DESTRUCTIVE: drops every shipment, party and assignment row. Take a dump
--   first (`pg_dump -t shipments -t shipment_parties -t shipment_assignments
--   -t broker_partners -t broker_partner_memberships`). Nothing else in the
--   product reads these tables at M-71 — no route, no server action, no page
--   — so the rollback is otherwise inert: `loads`, `carriers`, `shippers`,
--   `freight_quotes` and every shipped surface are untouched by it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Enum types — verbatim from src/lib/shipments/types.ts
-- ---------------------------------------------------------------------------

-- §6 — the 18 statuses, in the directive's lifecycle order 1…18.
-- DECLARATION order, not a transition graph (M-72 owns transitions): `delayed`
-- and `cancelled` are lifecycle states, not milestones, so reading progress
-- out of the ordinal would be wrong.
create type shipment_status as enum (
  'quote_requested',
  'quote_sent',
  'quote_accepted',
  'carrier_search',
  'carrier_assigned',
  'dispatched',
  'en_route_to_pickup',
  'arrived_at_pickup',
  'loading',
  'picked_up',
  'in_transit',
  'delayed',
  'arrived_at_delivery',
  'unloading',
  'delivered',
  'pod_uploaded',
  'completed',
  'cancelled'
);

-- §7 — timeline event kinds (used by M-72's `shipment_events`).
create type shipment_event_type as enum (
  'shipment_created',
  'status_change',
  'location_update',
  'eta_update',
  'appointment_set',
  'appointment_rescheduled',
  'assignment_created',
  'assignment_released',
  'document_uploaded',
  'document_approved',
  'pod_requested',
  'exception_opened',
  'exception_resolved',
  'public_update',
  'internal_note',
  'call_logged',
  'email_logged',
  'notification_sent',
  'correction',
  'cancellation'
);

-- §7 — event sources.
create type shipment_event_source as enum (
  'dispatcher',
  'carrier',
  'driver',
  'eld',
  'gps',
  'system',
  'admin',
  'shipper'
);

-- §7 — visibility bands. FIVE, not four: `broker` is M-70's deliberate
-- addition (plan §4 records the same lesson against `doc_visibility`) —
-- without it §12's "BOL, when authorized" leaves only two bad options, show
-- brokers the shipper's commercial band or show them nothing.
create type shipment_event_visibility as enum (
  'public',
  'shipper',
  'carrier',
  'broker',
  'staff_only'
);

-- §9 — tracking modes. Only `manual` (Mode A) is required for launch.
create type shipment_tracking_mode as enum ('manual', 'link', 'eld');

-- §9 — location privacy, most to least revealing.
create type shipment_location_visibility as enum (
  'exact',
  'approximate',
  'milestone_only',
  'hidden'
);

-- §9 — Mode C telematics providers (M-80 connects them; nothing here does).
create type tracking_provider as enum (
  'motive',
  'samsara',
  'geotab',
  'verizon_connect',
  'other'
);

-- §9/§13 — driver consent for location sharing.
create type tracking_consent_status as enum (
  'not_required',
  'pending',
  'granted',
  'denied',
  'revoked',
  'expired'
);

-- §10 — ETA provenance. This is the mechanism behind §30's honest labels: a
-- dispatcher-typed ETA must never be presented as live or predictive.
create type eta_source as enum (
  'manual',
  'calculated',
  'provider',
  'dispatcher_adjusted'
);

create type eta_confidence as enum ('high', 'medium', 'low');
create type eta_kind as enum ('pickup', 'delivery');

-- §16 — document types and visibility (M-77 owns the type → audience matrix).
create type shipment_document_type as enum (
  'quote',
  'shipper_confirmation',
  'rate_confirmation',
  'bol',
  'lumper_receipt',
  'detention_documentation',
  'delivery_receipt',
  'pod',
  'invoice',
  'claim',
  'other'
);

create type shipment_document_visibility as enum (
  'public',
  'shipper',
  'carrier',
  'broker',
  'staff_only'
);

-- §21 — the 13 exception types and their severity band (M-78 owns the table).
create type shipment_exception_type as enum (
  'pickup_delay',
  'delivery_delay',
  'mechanical_issue',
  'weather',
  'traffic',
  'facility_delay',
  'rejected_freight',
  'damaged_freight',
  'missing_appointment',
  'driver_unavailable',
  'carrier_cancellation',
  'documentation_issue',
  'other'
);

create type shipment_exception_severity as enum (
  'low',
  'medium',
  'high',
  'critical'
);

-- §8/§18 — roles a party may hold on a shipment.
create type shipment_party_role as enum (
  'shipper',
  'consignee',
  'broker_partner',
  'carrier',
  'billing',
  'third_party'
);

-- §19 — outcome of a public tracking attempt (M-73 owns the ledger).
create type tracking_access_outcome as enum (
  'granted',
  'not_found',
  'bad_secondary',
  'rate_limited',
  'tracking_disabled'
);

-- ---------------------------------------------------------------------------
-- 2 · Broker organizations (§12) — the minimum `shipments.broker_partner_id`
--     and the §19 broker RLS proof require. M-81 builds on top.
-- ---------------------------------------------------------------------------

create table broker_partners (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  mc_number text,
  contact_name text,
  contact_email text,
  contact_phone text,
  -- §12: "Do not allow public self-registration as a broker partner without
  -- admin approval." DARK BY DEFAULT — my_broker_partner_ids() (0018) filters
  -- on this column, so an unapproved organization grants access to nothing
  -- even if a membership row exists. Approval is an admin write (M-81).
  active boolean not null default false,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_broker_partners_updated_at before update on broker_partners
  for each row execute function set_updated_at();

-- Same shape as carrier_memberships / shipper_memberships (0005) on purpose:
-- one membership doctrine (M-57), one helper idiom, one thing to reason about.
create table broker_partner_memberships (
  broker_partner_id uuid not null references broker_partners(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (broker_partner_id, profile_id)
);
create index idx_broker_partner_memberships_profile
  on broker_partner_memberships (profile_id);

-- ---------------------------------------------------------------------------
-- 3 · shipments — every field of M-70's `ShipmentRow`, in its order
-- ---------------------------------------------------------------------------

create table shipments (
  id uuid primary key default gen_random_uuid(),

  -- §5 `PL-YYYY-######`. The pattern is TRACKING_NUMBER_SQL_PATTERN exported
  -- by src/lib/shipments/tracking-number.ts, and a unit test proves the JS
  -- regex and this string accept/reject the same corpus. Generated
  -- server-side; the unique index below is the collision arbiter (callers
  -- retry on 23505); the immutability trigger below is §5's "immutable after
  -- creation".
  tracking_number text not null
    constraint shipments_tracking_number_format
      check (tracking_number ~ '^PL-[0-9]{4}-[0-9]{6}$'),

  shipper_id uuid not null references shippers(id),
  -- NULL through the first four statuses — no carrier exists yet (§6). This
  -- single nullable column is why `shipments` cannot be `loads`.
  carrier_id uuid references carriers(id),
  dispatcher_id uuid references profiles(id) on delete set null,
  quote_id uuid references freight_quotes(id) on delete set null,
  broker_partner_id uuid references broker_partners(id) on delete set null,
  -- Plan §1 bridge: set when this brokerage shipment is covered by a
  -- dispatched truck. Never makes `loads` a dependency.
  load_id uuid references loads(id) on delete set null,

  status shipment_status not null default 'quote_requested',

  origin_company text,
  origin_address text,
  origin_city text not null,
  origin_state text not null,
  origin_zip text,

  destination_company text,
  destination_address text,
  destination_city text not null,
  destination_state text not null,
  destination_zip text,

  pickup_appointment_at timestamptz,
  delivery_appointment_at timestamptz,

  equipment text not null,
  commodity_category text,
  weight_lbs integer check (weight_lbs is null or weight_lbs >= 0),
  pallets integer check (pallets is null or pallets >= 0),
  distance_miles numeric check (distance_miles is null or distance_miles >= 0),

  -- §18 staff-only trio. See the note under "Financial columns" below: RLS is
  -- row-level, so these are protected by the M-70 DTO allow-list and by the
  -- absence of any customer UPDATE policy, NOT by a column grant.
  gross_shipper_amount numeric
    check (gross_shipper_amount is null or gross_shipper_amount >= 0),
  carrier_pay numeric check (carrier_pay is null or carrier_pay >= 0),
  margin numeric,

  shipper_reference text,
  po_number text,

  -- §4/§19: public tracking is OPT-IN per shipment. A default of true would
  -- publish every shipment the moment a tracking number exists.
  public_tracking_enabled boolean not null default false,
  tracking_mode shipment_tracking_mode not null default 'manual',
  -- §9: `approximate` (city/state, never coordinates) is the default. `exact`
  -- must be a deliberate per-shipment decision, never an inherited one.
  location_visibility shipment_location_visibility not null default 'approximate',
  -- §4 secondary-verification CREDENTIAL, not data. Store a hash, never the
  -- code; no DTO in src/lib/shipments/dto.ts serializes it at ANY audience.
  public_access_hash text,

  current_latitude numeric
    check (current_latitude is null
           or (current_latitude >= -90 and current_latitude <= 90)),
  current_longitude numeric
    check (current_longitude is null
           or (current_longitude >= -180 and current_longitude <= 180)),
  current_city text,
  current_state text,
  last_location_at timestamptz,

  estimated_pickup_at timestamptz,
  estimated_delivery_at timestamptz,
  eta_source eta_source,
  eta_confidence eta_confidence,
  eta_updated_at timestamptz,
  -- Signed on purpose: a shipment running EARLY is negative minutes, which is
  -- information §10 wants kept, not clamped to zero.
  delay_minutes integer,
  delay_reason_public text,
  delay_reason_internal text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,

  -- §20: "`cancelled` must record a cancellation reason." The transition
  -- ENGINE is M-72; this is the one piece of §20 that is a schema invariant
  -- rather than a graph, and an invariant the database can hold is worth more
  -- than one only the application remembers.
  constraint shipments_cancellation_reason_present
    check (status <> 'cancelled' or cancellation_reason is not null)
);

-- §5 property 2 — the unique constraint. The NAME is
-- TRACKING_NUMBER_UNIQUE_INDEX exported by tracking-number.ts, so the
-- generator's documented 23505-retry contract points at a real object.
create unique index shipments_tracking_number_key
  on shipments (tracking_number);

comment on column shipments.tracking_number is
  'M-71/§5: PL-YYYY-######. Server-generated (src/lib/shipments/tracking-number.ts), '
  'unique via shipments_tracking_number_key, IMMUTABLE via '
  'trg_shipments_tracking_number_immutable. An identifier, never a credential — '
  '§4''s secondary verification is what protects the data.';
comment on column shipments.margin is
  'M-71/§18 STAFF-ONLY. Never serialized to a public, shipper, carrier or '
  'broker audience (src/lib/shipments/dto.ts, pinned by '
  'tests/unit/shipment-dto.test.ts). RLS is row-level and cannot hide a column '
  'from a row the caller may read — see docs/modules/M-71-shipment-schema.md '
  '§Security, residual risk R-1.';
comment on column shipments.public_access_hash is
  'M-71/§4: HASH of the secondary verification value (access code / recipient '
  'ZIP). Never the value itself, never read back into any DTO.';

-- ---------------------------------------------------------------------------
-- 4 · shipment_parties — M-70's `ShipmentPartyRow` (§8 contacts, §18 parties)
-- ---------------------------------------------------------------------------

create table shipment_parties (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  party_role shipment_party_role not null,
  -- POLYMORPHIC BY DESIGN, and therefore deliberately WITHOUT a foreign key:
  -- the referent is `shippers` for a shipper party, `carriers` for a carrier
  -- party, `broker_partners` for a broker party, and NOTHING at all for a
  -- consignee or third party, which is the common case (a receiving warehouse
  -- has no PickLoads account). A FK would force inventing account rows for
  -- every dock in the country. Integrity is the writer's job (M-75) and the
  -- role column says which table to look in.
  organization_id uuid,
  company_name text,
  contact_name text,
  phone text,
  email text,
  -- §8 forbids exposing a driver's personal number by default and §4 forbids
  -- private carrier contact on the public page outright. FALSE by default: a
  -- contact reaches the public tracking page only when somebody decides so.
  public_contact boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column shipment_parties.organization_id is
  'M-71: polymorphic — shippers / carriers / broker_partners depending on '
  'party_role, NULL for consignees and third parties with no account. No FK '
  'on purpose (see the migration comment).';

-- ---------------------------------------------------------------------------
-- 5 · shipment_assignments — M-70's `ShipmentAssignmentRow`
-- ---------------------------------------------------------------------------

create table shipment_assignments (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  carrier_id uuid not null references carriers(id),
  driver_id uuid references drivers(id) on delete set null,
  truck_id uuid references trucks(id) on delete set null,
  dispatcher_id uuid references profiles(id) on delete set null,
  assigned_by uuid references profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text
);

-- "Reassignment is a NEW ROW, never an edit" (M-70). That sentence is only
-- true if the database refuses a second open assignment; otherwise two
-- carriers can hold the same shipment and §20's "carrier_assigned requires a
-- carrier assignment" becomes ambiguous. Partial unique index = at most one
-- unreleased assignment per shipment, unlimited released history.
create unique index shipment_assignments_one_active
  on shipment_assignments (shipment_id) where released_at is null;

-- ---------------------------------------------------------------------------
-- 6 · Triggers
-- ---------------------------------------------------------------------------

create trigger trg_shipments_updated_at before update on shipments
  for each row execute function set_updated_at();
-- shipment_parties and shipment_assignments carry no `updated_at` (M-70's row
-- types have `created_at` / `assigned_at` only — an assignment is an
-- append-only fact, not a mutable record), so they get no trigger.

-- ── §5 property 6: tracking numbers are immutable after creation ───────────
--
-- Name = TRACKING_NUMBER_IMMUTABLE_TRIGGER from tracking-number.ts.
--
-- WHO THIS STOPS, precisely. A trigger is not RLS: it fires for every role,
-- including Supabase's `service_role`, whose privilege is BYPASSRLS — not
-- BYPASSTRIGGER, which does not exist. The only way past it is
-- `alter table shipments disable trigger …`, which requires table OWNERSHIP;
-- migrations run as `postgres`, the API `service_role` is a different role and
-- cannot. So the answer to "can the service role change a tracking number" is
-- NO, by construction, and that is deliberate: §5 makes the number immutable
-- and admin correction is a controlled flow with a mandatory reason and an
-- audit event (§20), which M-75 implements as an explicit, logged, superuser-
-- free procedure rather than an UPDATE anybody can type.
--
-- `before update OF tracking_number` narrows the trigger to statements that
-- actually name the column, so ordinary shipment updates pay nothing.
create or replace function public.guard_tracking_number_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.tracking_number is distinct from old.tracking_number then
    raise exception
      'shipments.tracking_number is immutable after creation (DIRECTIVE-tracking §5); admin correction is the controlled M-75 flow, not an UPDATE'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_shipments_tracking_number_immutable
  before update of tracking_number on shipments
  for each row execute function guard_tracking_number_immutable();

-- ── §2 legal gate, enforced by the database ────────────────────────────────
--
-- The plan's D-4/§11 requires shipment creation to be gated on
-- `company_settings.brokerage_active` SERVER-SIDE, not presentationally.
-- M-71 owns the DB half, and it is feasible here for a structural reason:
-- plan §1 made `shipments` the brokerage table and left `loads` as the
-- dispatch table, so "no shipment may be created while brokerage is off" is
-- an exact statement about this table and nothing else. Dispatch keeps
-- working; only brokerage is dark.
--
-- INSERT ONLY, on purpose. If the flag is ever switched back off, shipments
-- already in flight must still be operable — refusing their status updates
-- would strand real freight, which is a worse outcome than the one §2 guards
-- against. Cancellation of an in-flight shipment must also stay possible.
--
-- FAIL CLOSED: a missing key reads as false. A gate that opens when its
-- configuration is absent is not a gate.
--
-- SECURITY DEFINER so the read of `company_settings` cannot be filtered by
-- the caller's RLS (it is publicly readable today, but the gate must not
-- depend on that staying true).
--
-- This is the DB half of a two-layer control, not the whole control. M-75
-- must still refuse in the service layer with a human error message, and
-- M-73/M-74 must still render the honest waitlist state — a 23514-shaped
-- failure at the bottom of a stack is a safety net, not a user experience.
create or replace function public.assert_brokerage_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_active boolean;
begin
  select (value = 'true'::jsonb) into is_active
    from company_settings where key = 'brokerage_active';
  if coalesce(is_active, false) is not true then
    raise exception
      'shipments cannot be created while company_settings.brokerage_active is false (DIRECTIVE-tracking §2 — brokerage authority gate)'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_shipments_brokerage_gate
  before insert on shipments
  for each row execute function assert_brokerage_active();

-- ---------------------------------------------------------------------------
-- 7 · §25 indexes — "indexed status/date/organization columns", each one
--     written for a named query. See docs/modules/M-71-shipment-schema.md
--     §Performance for the full table.
-- ---------------------------------------------------------------------------

-- §11 shipper list: "my shipments", filtered by status, newest first (M-74).
create index idx_shipments_shipper
  on shipments (shipper_id, status, created_at desc);

-- Carrier portal list (M-76). Partial: two thirds of the lifecycle's opening
-- statuses have no carrier, and those rows are dead weight in this index.
create index idx_shipments_carrier
  on shipments (carrier_id, status, created_at desc)
  where carrier_id is not null;

-- §12 broker-partner list (M-81). Partial for the same reason — a broker
-- partner is the exception, not the rule.
create index idx_shipments_broker
  on shipments (broker_partner_id, status, created_at desc)
  where broker_partner_id is not null;

-- §14 "my shipments" for a dispatcher desk (M-75).
create index idx_shipments_dispatcher
  on shipments (dispatcher_id, status)
  where dispatcher_id is not null;

-- §14 operational board — 8 status columns, newest first, no org filter.
create index idx_shipments_status_board
  on shipments (status, created_at desc);

-- §14 "today's pickups" / "today's deliveries" and the late-delivery sweep.
-- Partial: an unscheduled shipment can never match a date range query.
create index idx_shipments_pickup_appointment
  on shipments (pickup_appointment_at)
  where pickup_appointment_at is not null;
create index idx_shipments_delivery_appointment
  on shipments (delivery_appointment_at)
  where delivery_appointment_at is not null;

-- Quote → shipment conversion (M-75): "has this quote already been
-- converted?" is a lookup on every conversion attempt.
create index idx_shipments_quote
  on shipments (quote_id) where quote_id is not null;

-- Plan §1 bridge lookup: "which shipment covers this dispatch load?"
create index idx_shipments_load
  on shipments (load_id) where load_id is not null;

-- shipment_parties: the detail-page fetch (all parties of one shipment,
-- grouped by role) and the reverse "which shipments is this org a party to".
create index idx_shipment_parties_shipment
  on shipment_parties (shipment_id, party_role);
create index idx_shipment_parties_organization
  on shipment_parties (organization_id) where organization_id is not null;

-- shipment_assignments: assignment history for one shipment (newest first),
-- and the carrier's own assignment list.
create index idx_shipment_assignments_shipment
  on shipment_assignments (shipment_id, assigned_at desc);
create index idx_shipment_assignments_carrier
  on shipment_assignments (carrier_id, assigned_at desc);
-- M-76's driver update link resolves a driver to their open assignments.
create index idx_shipment_assignments_driver
  on shipment_assignments (driver_id) where driver_id is not null;
