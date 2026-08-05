-- ============================================================================
-- PickLoads — Migration 0020: `shipment_tracking_access` (M-73).
--
-- Source of truth: `ShipmentTrackingAccessRow` in `src/lib/shipments/types.ts`
-- (M-70) — the exact column list, in declaration order, with the nullability
-- the interface declares. The `tracking_access_outcome` enum was created by
-- 0017 (M-71 created the whole vocabulary up front precisely so later
-- migrations add tables, never a second copy of a value list).
--
-- SCOPE (plan §7, Phase B, row M-73): the ledger half of *"Public `/track`:
-- two-factor lookup (number + ZIP/access code), server-route only (no anon
-- table SELECT), rate limiting, enumeration protection, ACCESS LOGGING …"*.
-- §19 requires the public tracking route to "log access" and to "prevent
-- enumeration"; this table is where both requirements become evidence rather
-- than intention.
--
-- Migrations 0001–0004 are FROZEN and untouched. 0017–0019 are untouched too.
-- The whole migration is additive: one new table, four indexes, one trigger,
-- one policy. No existing table, column, policy, trigger, enum or grant
-- changes.
--
-- ── THE COLUMN THAT DOES NOT EXIST ────────────────────────────────────────
--
-- The attempted TRACKING NUMBER is stored: it is the thing being guessed, and
-- a ledger that does not record the guess cannot detect enumeration.
--
-- The attempted SECONDARY VALUE is stored in NO FORM AT ALL — not plaintext,
-- not truncated, not hashed, not "just the first two characters".
-- `docs/modules/M-70-shipment-domain.md` states the reason and it is worth
-- restating where the DDL lives: a recipient ZIP has ~41 000 realistic values
-- and an access code is short, so a table of hashes of attempted secondary
-- values is a rainbow-friendly ledger of exactly the credential §4 relies on —
-- and unlike `shipments.public_access_hash` (one row per shipment, salted by
-- an env-held HMAC key) it would accumulate every *guess*, including the
-- correct ones, in a table whose whole purpose is to be read by operators.
-- There is no column here it could arrive through, which is a stronger
-- guarantee than a rule about what callers should pass.
--
-- ── WHY NO `on delete` ACTION ON EITHER FOREIGN KEY ───────────────────────
--
-- Both FKs are NO ACTION, matching `audit_events.actor_id` (0005) — the
-- closest existing analogue, and for the same reason. A ledger a cascade can
-- rewrite is not a ledger: `on delete set null` performs an UPDATE, which the
-- append-only trigger below refuses anyway, and `on delete cascade` would
-- delete the evidence of the very access somebody might later be deleting a
-- row to hide. Shipments are already undeletable once they have any timeline
-- event (0019's documented consequence); this adds the same property for
-- shipments that have ever been looked up.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--
--   drop policy if exists "staff read shipment tracking access" on shipment_tracking_access;
--   alter table shipment_tracking_access disable row level security;
--   drop trigger if exists trg_shipment_tracking_access_append_only on shipment_tracking_access;
--   drop function if exists public.guard_shipment_tracking_access_append_only();
--   drop table if exists shipment_tracking_access cascade;
--
--   DESTRUCTIVE: drops the entire public-tracking access history, which is the
--   only record of enumeration attempts against the platform. Take a dump
--   first (`pg_dump -t shipment_tracking_access`). Note the ORDER — the
--   append-only trigger has to go before the table, because `drop table` is
--   DDL and does not fire it, while any attempt to clear rows first would.
--
--   The `tracking_access_outcome` ENUM is NOT dropped: 0017 created it and
--   0017 is not being rolled back. Roll back `src/lib/supabase/database.types.ts`
--   and delete `src/lib/shipments/public-lookup.ts` in the SAME deploy, or the
--   /track route inserts into a table that no longer exists — which fails
--   CLOSED (the lookup treats a failed log write as a refusal, see that file),
--   so the visible symptom is "tracking is unavailable", never a silent
--   unlogged lookup. `shipments`, `shipment_events`, `shipment_parties` and
--   `shipment_assignments` are untouched and keep working.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · shipment_tracking_access — M-70's `ShipmentTrackingAccessRow`
-- ---------------------------------------------------------------------------

create table shipment_tracking_access (
  id uuid primary key default gen_random_uuid(),

  -- NULL when the lookup matched nothing — the enumeration case, and the one
  -- an operator most wants to count. NO ACTION on delete (see the header).
  shipment_id uuid references shipments(id),

  -- The guess, stored verbatim after the app's own normalisation. Bounded so
  -- a script cannot use the ledger as free write-amplified storage: the
  -- canonical format is 14 characters (`PL-YYYY-######`) and the app truncates
  -- before it ever reaches here, so 64 is generous headroom, not a target.
  tracking_number_attempted text not null
    check (length(tracking_number_attempted) <= 64),

  outcome tracking_access_outcome not null,

  -- Request attribution. `ip` is text rather than inet because the app writes
  -- whatever `x-forwarded-for` gave it (including the literal 'unknown'), and
  -- a cast failure must never be the reason an access goes unlogged.
  ip text check (ip is null or length(ip) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),

  -- Set when an AUTHENTICATED portal user performed the lookup (M-74 reuses
  -- this ledger rather than inventing a second one). Null for /track.
  profile_id uuid references profiles(id),

  accessed_at timestamptz not null default now()

  -- DELIBERATELY ABSENT: any column able to hold the attempted secondary
  -- value. See the header. `supabase/tests/20_rls_isolation.sql` asserts this
  -- exact column list, so adding one is a test failure, not a review miss.
);

comment on table shipment_tracking_access is
  'M-73/§19: append-only ledger of PUBLIC TRACKING LOOKUP ATTEMPTS — the '
  '"logs access" and "prevents enumeration" half of §19''s public-tracking '
  'rules. Stores the attempted TRACKING NUMBER (the thing being guessed) and '
  'NEVER the attempted SECONDARY VALUE in any form, hashed or otherwise: a '
  'ledger of hashes of recipient ZIPs is a rainbow-friendly index of exactly '
  'the credential §4 relies on. There is no column it could arrive through.';
comment on column shipment_tracking_access.shipment_id is
  'M-73/§19: NULL for a lookup that matched no shipment — the enumeration '
  'case. NO ACTION on delete: a ledger a cascade can rewrite is not a ledger.';
comment on column shipment_tracking_access.outcome is
  'M-73/§19: granted | not_found | bad_secondary | rate_limited | '
  'tracking_disabled. The CALLER sees one identical refusal for not_found, '
  'bad_secondary and tracking_disabled (§19 "prevents enumeration"); the '
  'distinction lives HERE, where only staff can read it.';
comment on column shipment_tracking_access.ip is
  'M-73/§26: request IP for enumeration detection. Text, not inet — the app '
  'writes whatever x-forwarded-for gave it, and a cast failure must never be '
  'the reason an access goes unlogged.';

-- ---------------------------------------------------------------------------
-- 2 · Indexes — §25, and the three questions an operator actually asks
-- ---------------------------------------------------------------------------

-- "Is one network sweeping us?" — §26's `repeated_invalid_tracking_attempts`.
create index idx_shipment_tracking_access_ip
  on shipment_tracking_access (ip, accessed_at desc);

-- "Is one tracking number being hammered from many networks?" The per-IP rate
-- limit cannot see this shape at all, so the ledger has to.
create index idx_shipment_tracking_access_number
  on shipment_tracking_access (tracking_number_attempted, accessed_at desc);

-- §15 "view … access history" for one shipment. Partial: the enumeration rows
-- carry no shipment id and are dead weight in this index.
create index idx_shipment_tracking_access_shipment
  on shipment_tracking_access (shipment_id, accessed_at desc)
  where shipment_id is not null;

-- The failure feed M-84b's observability queries read. Partial for the same
-- reason: a healthy system's granted rows dominate the table.
create index idx_shipment_tracking_access_failures
  on shipment_tracking_access (outcome, accessed_at desc)
  where outcome <> 'granted';

-- ---------------------------------------------------------------------------
-- 3 · Append-only guard
-- ---------------------------------------------------------------------------
--
-- Same mechanism and same argument as `trg_shipment_events_append_only`
-- (0019): a trigger is the only guarantee that survives the SERVICE ROLE,
-- because `BYPASSRLS` is not `BYPASSTRIGGER` (which does not exist) and
-- disabling a trigger requires table OWNERSHIP, which the API role does not
-- have.
--
-- Why an access ledger needs it more than most tables: its value is entirely
-- in being complete. A tamperable enumeration log tells you what the last
-- person to hold the service-role key wanted you to believe, which is worse
-- than no log at all, because it reads as evidence.
create or replace function public.guard_shipment_tracking_access_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'shipment_tracking_access is append-only (DIRECTIVE-tracking §19: public tracking access must be logged); an access record is evidence, not state'
    using errcode = 'P0001';
end;
$$;

create trigger trg_shipment_tracking_access_append_only
  before update or delete on shipment_tracking_access
  for each row execute function guard_shipment_tracking_access_append_only();

-- ---------------------------------------------------------------------------
-- 4 · RLS — §19's no-anon rule, applied to the ledger itself
-- ---------------------------------------------------------------------------
--
-- ONE policy: staff SELECT. Everything else is a deliberate absence.
--
--   * NO ANON POLICY, for the same reason 0018 and 0019 have none — §19: "do
--     not use direct anonymous table SELECT access". The anon key ships in the
--     browser bundle, so an anon read policy here would publish the platform's
--     enumeration telemetry (which numbers exist, which were guessed, from
--     where) to the attacker generating it.
--   * NO CUSTOMER POLICY. A shipper reading "who looked up my shipment" sounds
--     benign and is not: the rows carry IPs and user agents of people who are
--     not their customers, and §15 assigns access history to ADMIN
--     management. M-74 surfaces a shipper's own lookups through a
--     server-side, DTO-shaped read if that requirement ever lands.
--   * NO WRITE POLICY AT ALL, staff included. Every insert arrives through the
--     service-role client in `src/lib/shipments/public-lookup.ts`. A staff
--     session that could write here could forge the evidence.
alter table shipment_tracking_access enable row level security;

create policy "staff read shipment tracking access" on shipment_tracking_access
  for select using (is_staff());
