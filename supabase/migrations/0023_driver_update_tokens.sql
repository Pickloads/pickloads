-- ============================================================================
-- PickLoads — Migration 0023: driver update tokens (M-76).
--
-- SCOPE (plan §7, Phase B, row M-76): the storage half of *"Carrier update
-- experience (portal, permission-scoped transitions only) + `/driver/update/
-- [token]`: shipment-scoped, short-lived, revocable, rate-limited,
-- audit-logged, non-enumerable, consent-aware."*
-- Authority: `docs/DIRECTIVE-tracking.md` §13 (the requirement list, verbatim),
-- §9 (driver consent for location), §19 (least privilege), §26 (unauthorized
-- access attempts and repeated invalid tokens as named signals), §30
-- ("Tracking link expired").
--
-- Migrations 0001–0004 are FROZEN and untouched. 0017–0022 are untouched too.
-- Everything here is additive: one enum, two tables, six indexes, two
-- triggers, four `security definer` functions, four policies and a GRANT model
-- that is stricter than any table shipped so far.
--
-- ── THE TOKEN IS NEVER STORED ─────────────────────────────────────────────
--
-- §13: *"Do not expose internal shipment IDs in predictable URLs."* The token
-- in `/driver/update/[token]` is 32 CSPRNG bytes, base64url — it is not, and
-- does not contain, the shipment id, the carrier id, the tracking number or a
-- counter. What this table stores is `token_hash`: HMAC-SHA-256 of the token
-- under `DRIVER_TOKEN_SECRET`, held in the environment and never in the
-- database (`src/lib/shipments/driver-token.ts`, the same reasoning M-73's
-- `access-code.ts` applies to `shipments.public_access_hash`).
--
-- There is no column the token itself could arrive through, and the issuing
-- function takes the HASH as its argument — so even a caller that wanted to
-- store the plaintext has nowhere to put it. A database dump therefore hands
-- an attacker nothing: without the env key a candidate digest cannot be
-- computed, and with 2^256 candidates it could not be searched if it could.
--
-- ── WHY `token_hash` IS COLUMN-REVOKED AND NOT MERELY POLICY-HIDDEN ───────
--
-- M-71 recorded residual risk R-1: RLS is ROW-level, so every column of a row
-- a customer may read is in the payload. For an operational column that is a
-- documented risk; for a bearer-credential column it would be a mistake. So
-- this migration does what no earlier one needed to:
--
--     revoke select on shipment_driver_tokens from authenticated, anon;
--     grant  select (…every column except token_hash…) to authenticated;
--
-- Column privileges are checked IN ADDITION to RLS, and a table-level SELECT
-- would override a column-level revoke — hence the revoke-then-grant order.
-- The result is that no browser-reachable role can name `token_hash` in a
-- select list at all, whatever policy is written later.
--
-- ── WHY REDEMPTION IS ONE SQL FUNCTION ────────────────────────────────────
--
-- §13 requires the driver path to be rate limited AND audit logged AND to
-- refuse expired/revoked tokens. Done in the application those are three
-- round trips with two race windows: two concurrent presentations of a token
-- both pass the rate check, and a token revoked between the read and the
-- ledger write is recorded as granted. `redeem_shipment_driver_token()` does
-- the count, the lookup, the expiry/revocation/carrier checks, the usage
-- bump and the ledger insert in ONE statement, so the record and the decision
-- cannot disagree. It is also the only door: no other code path reads the
-- token table by hash.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--
--   drop policy if exists "staff manage driver token access" on shipment_driver_token_access;
--   drop policy if exists "staff manage driver tokens" on shipment_driver_tokens;
--   drop policy if exists "carrier member read driver tokens" on shipment_driver_tokens;
--   alter table shipment_driver_token_access disable row level security;
--   alter table shipment_driver_tokens       disable row level security;
--   drop function if exists public.set_driver_token_consent(text, boolean, text, text);
--   drop function if exists public.redeem_shipment_driver_token(text, text, text, integer, integer, integer);
--   drop function if exists public.revoke_shipment_driver_token(uuid, text, uuid, shipment_event_source);
--   drop function if exists public.issue_shipment_driver_token(uuid, uuid, text, timestamptz, uuid, text, text, uuid, text, shipment_event_source);
--   drop trigger if exists trg_driver_token_access_append_only on shipment_driver_token_access;
--   drop function if exists public.guard_driver_token_access_append_only();
--   drop trigger if exists trg_driver_tokens_immutable on shipment_driver_tokens;
--   drop function if exists public.guard_driver_token_immutable();
--   drop table if exists shipment_driver_token_access cascade;
--   drop table if exists shipment_driver_tokens cascade;
--   drop type if exists driver_token_outcome;
--
--   DESTRUCTIVE: drops every issued driver link and the entire record of who
--   presented one, which is the evidence §13's "audit logged" requirement
--   exists to produce. Take a dump first (`pg_dump -t shipment_driver_tokens
--   -t shipment_driver_token_access`). Mind the ORDER — the append-only
--   trigger goes before its table, because `drop table` is DDL and does not
--   fire it while any attempt to clear rows first would.
--
--   Roll back `src/lib/supabase/database.types.ts` and delete
--   `src/lib/shipments/driver-*.ts` plus the `/driver/update/[token]` route in
--   the SAME deploy, or the route calls functions that no longer exist — which
--   fails CLOSED (an unreachable redeem is an "unavailable" refusal, never an
--   unlogged grant). `shipments`, `shipment_events`, `shipment_assignments`
--   and the carrier portal are untouched: rolling this back removes driver
--   links and leaves the carrier's own update surface working.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · driver_token_outcome — the ledger's vocabulary
-- ---------------------------------------------------------------------------
--
-- SIX outcomes, and the CALLER sees ONE refusal for five of them. §13 requires
-- the link to be non-enumerable; a page that said "expired" for an expired
-- token and "not found" for a guess would be an oracle telling a guesser when
-- they had found a real token. The distinction lives HERE, where only staff
-- can read it — the same split M-73 made for `tracking_access_outcome`.
create type driver_token_outcome as enum (
  'granted',
  'not_found',
  'expired',
  'revoked',
  -- The carrier was released or replaced after the link was issued. The token
  -- is still unexpired and unrevoked, but it no longer belongs to the truck
  -- hauling this freight, so it must stop working — §13 "no access to other
  -- carrier records", applied across time rather than across companies.
  'carrier_released',
  'rate_limited',
  -- A redeemed token whose UPDATE was refused (an unpermitted transition, a
  -- precondition, a location without consent). §26's "unauthorized access
  -- attempts" signal counts these.
  'update_rejected'
);

comment on type driver_token_outcome is
  'M-76/§13: outcome of a driver-link presentation. The DRIVER PAGE renders '
  'one identical refusal for not_found / expired / revoked / carrier_released '
  '(§30 "Tracking link expired"); the distinction is staff-only telemetry.';

-- ---------------------------------------------------------------------------
-- 2 · shipment_driver_tokens
-- ---------------------------------------------------------------------------

create table shipment_driver_tokens (
  id uuid primary key default gen_random_uuid(),

  -- §13 "only assigned shipment": exactly one, and the immutability trigger
  -- below refuses to move it. `on delete cascade` matches every other
  -- shipment child; a shipment with any timeline event is already undeletable
  -- (0019's documented consequence), so this cascade is theoretical.
  shipment_id uuid not null references shipments(id) on delete cascade,

  -- §13 "no access to other carrier records". Recorded at ISSUE time and
  -- compared against the shipment's CURRENT carrier on every redemption, so a
  -- reassignment silently invalidates the old driver's link.
  carrier_id uuid not null references carriers(id),

  -- HMAC-SHA-256 under DRIVER_TOKEN_SECRET, as 'v1:<64 hex>'. UNIQUE because
  -- a collision would make one link open two shipments. See the header for
  -- why the plaintext token has no column here.
  token_hash text not null unique
    check (token_hash ~ '^v[0-9]+:[0-9a-f]{64}$'),

  -- Who the link was handed to. Operational attribution for §7's timeline and
  -- §15's "who did what" — never a credential.
  driver_id uuid references drivers(id),
  driver_name text check (driver_name is null or length(driver_name) <= 120),

  issued_by uuid references profiles(id),
  -- 'dispatcher' | 'admin' | 'carrier' — §13 allows both origins (a dispatcher
  -- issuing from M-75's surface, a carrier issuing from their own portal).
  issued_by_role text not null
    check (issued_by_role in ('admin', 'dispatcher', 'carrier')),
  issued_at timestamptz not null default now(),

  -- §13 "short-lived OR shipment-scoped" — this implementation is BOTH, and
  -- NOT NULL is what makes the first half non-optional. There is no way to
  -- issue a link that never expires.
  expires_at timestamptz not null,
  check (expires_at > issued_at),

  -- §13 "revocable". Explicit, nullable, and set only by
  -- revoke_shipment_driver_token().
  revoked_at timestamptz,
  revoked_by uuid references profiles(id),
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 300),

  -- §9/§13 "Driver consent must be considered for location tracking."
  -- DEFAULT 'pending', never 'granted': consent is something the driver
  -- ACTIVELY gives on the page, and a column that defaulted to granted would
  -- make the checkbox decorative. 0017 created this enum (M-71 created the
  -- whole vocabulary up front); this is its first real user.
  consent_status tracking_consent_status not null default 'pending',
  consent_at timestamptz,
  check (consent_status in ('granted', 'denied') = (consent_at is not null)),

  -- Usage telemetry. Not a rate limit (that is the ledger's job) — the
  -- question these answer is "was this link ever used, and when last?", which
  -- is what a dispatcher asks before re-sending one.
  last_used_at timestamptz,
  use_count integer not null default 0 check (use_count >= 0),

  created_at timestamptz not null default now()

  -- DELIBERATELY ABSENT: the plaintext token, in any form — not truncated,
  -- not a prefix, not "the last four". A prefix column would be a partial
  -- credential in a table operators read. `supabase/tests/20_rls_isolation.sql`
  -- asserts this exact column list, so adding one is a test failure.
);

comment on table shipment_driver_tokens is
  'M-76/§13: shipment-scoped, short-lived, revocable driver update links. '
  'Stores an HMAC of the token under an env-held key and NEVER the token '
  'itself. One row = one link = one shipment; the immutability trigger '
  'refuses to re-point a link at different freight.';
comment on column shipment_driver_tokens.token_hash is
  'M-76/§13: HMAC-SHA-256(token, DRIVER_TOKEN_SECRET) as v1:<64 hex>. '
  'SELECT is REVOKED at COLUMN level from authenticated and anon (see the '
  'migration header) — no browser-reachable role can name this column.';
comment on column shipment_driver_tokens.expires_at is
  'M-76/§13 "short-lived": NOT NULL, so a non-expiring link cannot be issued.';
comment on column shipment_driver_tokens.consent_status is
  'M-76/§9/§13: driver consent for location sharing. Defaults to PENDING — '
  'the driver grants it on the page, or the location fields stay refused.';

-- §25 indexes, one per question something actually asks.
-- "Which links exist for this shipment?" — the dispatcher and carrier lists.
create index idx_driver_tokens_shipment
  on shipment_driver_tokens (shipment_id, issued_at desc);
-- "Which links does this carrier hold?" — the carrier portal, and the §19
-- scope predicate behind it.
create index idx_driver_tokens_carrier
  on shipment_driver_tokens (carrier_id, issued_at desc);
-- "Which links are live right now?" — the expiry sweep and the operator view.
-- Partial: a revoked link is never live again.
create index idx_driver_tokens_live
  on shipment_driver_tokens (expires_at desc)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 3 · Immutability — a link cannot be re-pointed
-- ---------------------------------------------------------------------------
--
-- §13's "only assigned shipment" is a property of the LINK, not of the page
-- that renders it. Without this trigger, one UPDATE turns a link a driver
-- already holds into a link to somebody else's freight — the failure §13's
-- "no access to other carrier records" describes, arriving through the back
-- door. `token_hash` is frozen for the same reason a tracking number is
-- (0017): a credential that can be swapped is not a credential.
--
-- Same mechanism and same argument as 0019/0020: a trigger is the only
-- guarantee that survives the SERVICE ROLE, because BYPASSRLS is not
-- BYPASSTRIGGER and disabling a trigger needs table OWNERSHIP.
create or replace function public.guard_driver_token_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.shipment_id is distinct from old.shipment_id then
    raise exception
      'shipment_driver_tokens.shipment_id is immutable (DIRECTIVE-tracking §13: a driver link is scoped to ONE shipment); issue a new link instead'
      using errcode = 'P0001';
  end if;
  if new.token_hash is distinct from old.token_hash then
    raise exception
      'shipment_driver_tokens.token_hash is immutable (DIRECTIVE-tracking §13); a credential that can be swapped is not a credential'
      using errcode = 'P0001';
  end if;
  if new.carrier_id is distinct from old.carrier_id then
    raise exception
      'shipment_driver_tokens.carrier_id is immutable (DIRECTIVE-tracking §13: no access to other carrier records); issue a new link for the new carrier'
      using errcode = 'P0001';
  end if;
  -- §13 "revocable" is one-way. Un-revoking would resurrect a credential
  -- somebody deliberately killed, and the person who revoked it would have no
  -- way to know.
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception
      'a revoked driver link cannot be un-revoked (DIRECTIVE-tracking §13); issue a new link'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_driver_tokens_immutable
  before update on shipment_driver_tokens
  for each row execute function guard_driver_token_immutable();

-- ---------------------------------------------------------------------------
-- 4 · shipment_driver_token_access — §13 "audit logged", §26's signal source
-- ---------------------------------------------------------------------------
--
-- Every presentation of a driver link lands here, including the ones that
-- matched nothing. That is the point: §26 names "repeated invalid tokens" as
-- a tracked signal, and a ledger that only recorded successes could not count
-- them. It is ALSO the rate limiter's memory (see `redeem_…` below), so one
-- write serves both requirements and they cannot drift apart.
create table shipment_driver_token_access (
  id uuid primary key default gen_random_uuid(),

  -- NULL when the presented token matched nothing — the enumeration case, and
  -- the one an operator most wants to count. NO ACTION on delete, matching
  -- `audit_events.actor_id` (0005) and `shipment_tracking_access` (0020): a
  -- ledger a cascade can rewrite is not a ledger.
  token_id uuid references shipment_driver_tokens(id),
  shipment_id uuid references shipments(id),

  outcome driver_token_outcome not null,

  -- What was attempted, when the attempt is worth describing. NEVER the
  -- token: not hashed (a ledger of hashes of presented tokens is an oracle
  -- for anyone who can read it), not truncated, not a prefix. `detail` carries
  -- the STATUS a driver tried to set, or the refusal code — operational facts,
  -- no credentials.
  detail text check (detail is null or length(detail) <= 200),

  ip text check (ip is null or length(ip) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),

  accessed_at timestamptz not null default now()
);

comment on table shipment_driver_token_access is
  'M-76/§13/§26: append-only ledger of DRIVER-LINK PRESENTATIONS, successful '
  'and not. Doubles as the rate limiter''s memory, so "rate limited" and '
  '"audit logged" are one write and cannot disagree. Stores NO form of the '
  'presented token — there is no column it could arrive through.';

-- "Is one network sweeping us?" — §26's repeated-invalid-token signal, and
-- the predicate `redeem_shipment_driver_token` counts on.
create index idx_driver_token_access_ip
  on shipment_driver_token_access (ip, accessed_at desc);
-- "What happened on this shipment's links?" — §15's access history.
create index idx_driver_token_access_shipment
  on shipment_driver_token_access (shipment_id, accessed_at desc)
  where shipment_id is not null;
-- The failure feed M-84b's observability queries read. Partial for the same
-- reason 0020's is: a healthy system's granted rows dominate.
create index idx_driver_token_access_failures
  on shipment_driver_token_access (outcome, accessed_at desc)
  where outcome <> 'granted';

create or replace function public.guard_driver_token_access_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'shipment_driver_token_access is append-only (DIRECTIVE-tracking §13: driver updates must be audit logged); an access record is evidence, not state'
    using errcode = 'P0001';
end;
$$;

create trigger trg_driver_token_access_append_only
  before update or delete on shipment_driver_token_access
  for each row execute function guard_driver_token_access_append_only();

-- ---------------------------------------------------------------------------
-- 5 · RLS and the GRANT model
-- ---------------------------------------------------------------------------
--
-- NO ANON POLICY on either table, for the reason 0018/0019/0020 give: §19
-- forbids direct anonymous table SELECT, and the anon key ships in the browser
-- bundle. THE DRIVER PAGE IS ANONYMOUS AND STILL DOES NOT GET ONE — it reaches
-- its shipment through `redeem_shipment_driver_token()` under the service role,
-- exactly as /track reaches its shipment through a server route.
--
-- NO WRITE POLICY FOR ANYONE, staff included. Issue, revoke, redeem and
-- consent are the four functions below; a staff session that could UPDATE this
-- table directly could extend an expiry without an event.
alter table shipment_driver_tokens       enable row level security;
alter table shipment_driver_token_access enable row level security;

create policy "staff manage driver tokens" on shipment_driver_tokens
  for select using (is_staff());

-- §13 lets a CARRIER issue and revoke links for its own freight, so a carrier
-- has to be able to see its own. Matched on `carrier_id` directly — the same
-- shape as `"carrier member read shipment assignments"` (0018) and for the
-- same reason: a released carrier keeps its own history without regaining
-- access to freight it no longer holds.
--
-- THIS DOES NOT WIDEN THE CARRIER READ POLICY ON `shipments`.
-- `docs/modules/M-71-shipment-schema.md` is explicit: *"Do not widen 'carrier
-- member read shipments' into a FOR ALL."* It is untouched, still
-- `for select`, and §12 of the RLS suite asserts that as a catalog fact.
create policy "carrier member read driver tokens" on shipment_driver_tokens
  for select using (carrier_id in (select my_carrier_ids()));

create policy "staff manage driver token access" on shipment_driver_token_access
  for select using (is_staff());

-- The column model (see the migration header). Table-level SELECT is revoked
-- FIRST, because a table-level grant overrides a column-level revoke.
revoke all on shipment_driver_tokens       from authenticated, anon;
revoke all on shipment_driver_token_access from authenticated, anon;

grant select (
  id, shipment_id, carrier_id, driver_id, driver_name, issued_by,
  issued_by_role, issued_at, expires_at, revoked_at, revoked_by,
  revoke_reason, consent_status, consent_at, last_used_at, use_count,
  created_at
) on shipment_driver_tokens to authenticated;

-- The LEDGER keeps a table-level SELECT for `authenticated` because its
-- policy is `is_staff()` — revoking the privilege outright would make that
-- policy dead code and §15's "view access history" unimplementable from any
-- staff surface. A carrier session therefore reaches the table and reads ZERO
-- rows, which is a policy result rather than a permission error, and the RLS
-- suite asserts both halves.
--
-- `anon` gets nothing at all on either table.
grant select on shipment_driver_token_access to authenticated;

-- ---------------------------------------------------------------------------
-- 6 · issue_shipment_driver_token — §13 issuance, atomic with its event
-- ---------------------------------------------------------------------------
--
-- Two writes that must be one: the token row, and the `shipment_events` row
-- that records a link was handed out. M-72 settled the doctrine and 0022
-- followed it — PostgREST has no multi-statement transaction, so two
-- supabase-js calls leave a window in which a live credential exists with
-- nothing in the timeline explaining it. §15 is explicit that operators must
-- be able to see who did what.
--
-- The event is `internal_note` at the `carrier` band: the carrier whose driver
-- holds the link may see that it exists (they may need to revoke it), and the
-- shipper has no business in the carrier's crew logistics.
create or replace function public.issue_shipment_driver_token(
  p_shipment_id  uuid,
  p_carrier_id   uuid,
  p_token_hash   text,
  p_expires_at   timestamptz,
  p_driver_id    uuid    default null,
  p_driver_name  text    default null,
  p_issued_by_role text  default 'dispatcher',
  p_issued_by    uuid    default null,
  p_label        text    default null,
  p_source       shipment_event_source default 'dispatcher'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment  shipments%rowtype;
  v_token_id  uuid;
  v_event     jsonb;
begin
  select * into v_shipment from shipments where id = p_shipment_id;
  if not found then
    raise exception 'shipment % does not exist', p_shipment_id
      using errcode = 'PL404';
  end if;

  -- §13 "only assigned shipment" / "no access to other carrier records",
  -- enforced where it cannot be forgotten: a link may only be issued for the
  -- carrier that is actually hauling this freight, right now.
  if v_shipment.carrier_id is null then
    raise exception
      'shipment % has no assigned carrier — assign one before issuing a driver link', p_shipment_id
      using errcode = 'PL422';
  end if;
  if v_shipment.carrier_id is distinct from p_carrier_id then
    raise exception
      'carrier % is not the carrier assigned to shipment %', p_carrier_id, p_shipment_id
      using errcode = 'PL422';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'a driver link must expire in the future'
      using errcode = 'PL422';
  end if;

  -- A driver row, if named, must belong to the assigned carrier. The same
  -- check `assign_shipment_carrier` (0022) makes, for the same reason.
  if p_driver_id is not null
     and not exists (select 1 from drivers d
                      where d.id = p_driver_id and d.carrier_id = p_carrier_id) then
    raise exception 'driver % does not belong to carrier %', p_driver_id, p_carrier_id
      using errcode = 'PL422';
  end if;

  insert into shipment_driver_tokens (
    shipment_id, carrier_id, token_hash, driver_id, driver_name,
    issued_by, issued_by_role, expires_at
  ) values (
    p_shipment_id, p_carrier_id, p_token_hash, p_driver_id, p_driver_name,
    p_issued_by, p_issued_by_role, p_expires_at
  )
  returning id into v_token_id;

  v_event := append_shipment_event(
    p_shipment_id   => p_shipment_id,
    p_event_type    => 'internal_note',
    p_source        => p_source,
    p_actor         => p_issued_by,
    p_visibility    => 'carrier',
    p_internal_message => coalesce(
      p_label,
      'Driver update link issued' ||
      case when p_driver_name is null then '' else ' to ' || p_driver_name end ||
      '. Expires ' || to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.'
    ),
    p_metadata      => jsonb_build_object(
      'driver_token_id', v_token_id,
      'issued_by_role', p_issued_by_role,
      'expires_at', p_expires_at,
      'driver_id', p_driver_id
    )
  );

  return jsonb_build_object(
    'token_id', v_token_id,
    'shipment_id', p_shipment_id,
    'carrier_id', p_carrier_id,
    'expires_at', p_expires_at,
    'event_id', v_event -> 'event_id'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7 · revoke_shipment_driver_token — §13 "revocable"
-- ---------------------------------------------------------------------------
--
-- Idempotent by design: revoking an already-revoked link returns the original
-- revocation rather than raising. A dispatcher pressing the button twice
-- because the page was slow must not see an error suggesting the link is
-- still live.
create or replace function public.revoke_shipment_driver_token(
  p_token_id uuid,
  p_reason   text default null,
  p_actor    uuid default null,
  p_source   shipment_event_source default 'dispatcher'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token shipment_driver_tokens%rowtype;
begin
  select * into v_token from shipment_driver_tokens
    where id = p_token_id for update;
  if not found then
    raise exception 'driver link % does not exist', p_token_id
      using errcode = 'PL404';
  end if;

  if v_token.revoked_at is not null then
    return jsonb_build_object(
      'token_id', v_token.id,
      'shipment_id', v_token.shipment_id,
      'revoked_at', v_token.revoked_at,
      'already_revoked', true
    );
  end if;

  update shipment_driver_tokens
     set revoked_at = now(),
         revoked_by = p_actor,
         revoke_reason = p_reason
   where id = p_token_id;

  perform append_shipment_event(
    p_shipment_id => v_token.shipment_id,
    p_event_type  => 'internal_note',
    p_source      => p_source,
    p_actor       => p_actor,
    p_visibility  => 'carrier',
    p_internal_message => 'Driver update link revoked.' ||
      case when p_reason is null then '' else ' Reason: ' || p_reason end,
    p_metadata    => jsonb_build_object('driver_token_id', v_token.id, 'revoked', true)
  );

  return jsonb_build_object(
    'token_id', v_token.id,
    'shipment_id', v_token.shipment_id,
    'revoked_at', now(),
    'already_revoked', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8 · redeem_shipment_driver_token — the only door
-- ---------------------------------------------------------------------------
--
-- Rate limit, lookup, expiry, revocation, carrier check, usage bump and ledger
-- write, in one statement. See the migration header for why that matters.
--
-- TWO LIMITS, counted over the same ledger:
--
--   * `p_fail_limit` failed presentations per IP per window — the enumeration
--     budget. Low, because a driver with a working link never produces one.
--   * `p_total_limit` presentations per IP per window — the flood ceiling. It
--     has to be well above the fail limit because a driver at a dock reloads
--     the page, and a yard full of drivers can share one carrier NAT.
--
-- A per-TOKEN limit is deliberately NOT added, for the reason M-73 records
-- against a per-tracking-number limit: it would let anyone holding the link
-- lock the driver out of their own updates. The compensating control for a
-- LEAKED token is short expiry plus revocation, not a lockout.
create or replace function public.redeem_shipment_driver_token(
  p_token_hash text,
  p_ip         text default null,
  p_user_agent text default null,
  p_window_minutes integer default 10,
  p_fail_limit integer default 8,
  p_total_limit integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token    shipment_driver_tokens%rowtype;
  v_shipment shipments%rowtype;
  v_since    timestamptz := now() - make_interval(mins => greatest(p_window_minutes, 1));
  v_fails    integer := 0;
  v_total    integer := 0;
  v_outcome  driver_token_outcome;
begin
  if p_ip is not null then
    select count(*) filter (where outcome <> 'granted'), count(*)
      into v_fails, v_total
      from shipment_driver_token_access
     where ip = p_ip and accessed_at >= v_since;

    if v_fails >= greatest(p_fail_limit, 1)
       or v_total >= greatest(p_total_limit, 1) then
      insert into shipment_driver_token_access (outcome, ip, user_agent, detail)
        values ('rate_limited', p_ip, p_user_agent,
                'fails=' || v_fails || ' total=' || v_total);
      return jsonb_build_object('outcome', 'rate_limited');
    end if;
  end if;

  select * into v_token from shipment_driver_tokens
    where token_hash = p_token_hash;

  if not found then
    insert into shipment_driver_token_access (outcome, ip, user_agent)
      values ('not_found', p_ip, p_user_agent);
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select * into v_shipment from shipments where id = v_token.shipment_id;

  -- Order matters: revocation is a deliberate act and outranks expiry in the
  -- ledger, because "somebody killed this link" and "this link aged out" are
  -- different operational stories.
  if v_token.revoked_at is not null then
    v_outcome := 'revoked';
  elsif v_token.expires_at <= now() then
    v_outcome := 'expired';
  elsif v_shipment.carrier_id is distinct from v_token.carrier_id then
    v_outcome := 'carrier_released';
  else
    v_outcome := 'granted';
  end if;

  insert into shipment_driver_token_access
    (token_id, shipment_id, outcome, ip, user_agent)
    values (v_token.id, v_token.shipment_id, v_outcome, p_ip, p_user_agent);

  if v_outcome <> 'granted' then
    return jsonb_build_object('outcome', v_outcome);
  end if;

  update shipment_driver_tokens
     set last_used_at = now(), use_count = use_count + 1
   where id = v_token.id;

  -- The GRANT payload names its columns. `gross_shipper_amount`, `carrier_pay`,
  -- `margin`, `delay_reason_internal` and `public_access_hash` are NOT among
  -- them — §13: "no access to financial data", enforced here as well as in the
  -- DTO, so a financial value never enters the driver request's memory at all.
  return jsonb_build_object(
    'outcome', 'granted',
    'token_id', v_token.id,
    'shipment_id', v_shipment.id,
    'carrier_id', v_token.carrier_id,
    'driver_id', v_token.driver_id,
    'driver_name', v_token.driver_name,
    'expires_at', v_token.expires_at,
    'consent_status', v_token.consent_status,
    'use_count', v_token.use_count + 1,
    'tracking_number', v_shipment.tracking_number,
    'status', v_shipment.status,
    'origin_city', v_shipment.origin_city,
    'origin_state', v_shipment.origin_state,
    'origin_company', v_shipment.origin_company,
    'destination_city', v_shipment.destination_city,
    'destination_state', v_shipment.destination_state,
    'destination_company', v_shipment.destination_company,
    'pickup_appointment_at', v_shipment.pickup_appointment_at,
    'delivery_appointment_at', v_shipment.delivery_appointment_at,
    'equipment', v_shipment.equipment,
    'current_city', v_shipment.current_city,
    'current_state', v_shipment.current_state
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9 · set_driver_token_consent — §9/§13 consent, actively granted
-- ---------------------------------------------------------------------------
--
-- Takes the HASH, not the token id: the driver page holds a token and nothing
-- else, and giving the consent path an id-shaped argument would mean the page
-- had to learn an internal id first — the thing §13 forbids exposing.
--
-- Refuses an expired or revoked link, so consent cannot be recorded against a
-- credential that no longer works. Writes a timeline event at the `carrier`
-- band: the carrier is entitled to know their driver granted or refused
-- location sharing on their freight; the shipper is not a party to it.
create or replace function public.set_driver_token_consent(
  p_token_hash text,
  p_granted    boolean,
  p_ip         text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token shipment_driver_tokens%rowtype;
  v_new   tracking_consent_status;
begin
  select * into v_token from shipment_driver_tokens
    where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_token.revoked_at is not null then
    return jsonb_build_object('outcome', 'revoked');
  end if;
  if v_token.expires_at <= now() then
    return jsonb_build_object('outcome', 'expired');
  end if;

  -- §9's enum has six values; a driver can only ever produce two of them.
  -- `revoked` and `expired` belong to M-80's provider connections, and
  -- `not_required` describes a shipment with no location sharing at all.
  v_new := case when p_granted then 'granted'::tracking_consent_status
                else 'denied'::tracking_consent_status end;

  if v_token.consent_status = v_new then
    return jsonb_build_object('outcome', 'granted', 'consent_status', v_new,
                              'changed', false);
  end if;

  update shipment_driver_tokens
     set consent_status = v_new, consent_at = now()
   where id = v_token.id;

  perform append_shipment_event(
    p_shipment_id => v_token.shipment_id,
    p_event_type  => 'internal_note',
    p_source      => 'driver',
    p_visibility  => 'carrier',
    p_internal_message => case when p_granted
      then 'Driver granted consent to share location updates on this shipment.'
      else 'Driver declined to share location updates on this shipment.' end,
    p_metadata    => jsonb_build_object(
      'driver_token_id', v_token.id,
      'consent_status', v_new
    )
  );

  return jsonb_build_object('outcome', 'granted', 'consent_status', v_new,
                            'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10 · Grants — service_role only, PUBLIC revoked first
-- ---------------------------------------------------------------------------
--
-- `security definer` functions are EXECUTE-able by PUBLIC by default, so every
-- one is revoked before it is granted. An `authenticated` session that could
-- call `redeem_shipment_driver_token` would be able to test candidate tokens
-- straight from a browser, at the anon key's leisure, with the rate limit
-- still applying but the server-side gate gone. §12 of the RLS suite proves
-- the refusal from an ADMIN session and reads the grants out of `pg_proc`.
revoke all on function public.issue_shipment_driver_token(uuid, uuid, text, timestamptz, uuid, text, text, uuid, text, shipment_event_source) from public;
revoke all on function public.revoke_shipment_driver_token(uuid, text, uuid, shipment_event_source) from public;
revoke all on function public.redeem_shipment_driver_token(text, text, text, integer, integer, integer) from public;
revoke all on function public.set_driver_token_consent(text, boolean, text, text) from public;

grant execute on function public.issue_shipment_driver_token(uuid, uuid, text, timestamptz, uuid, text, text, uuid, text, shipment_event_source) to service_role;
grant execute on function public.revoke_shipment_driver_token(uuid, text, uuid, shipment_event_source) to service_role;
grant execute on function public.redeem_shipment_driver_token(text, text, text, integer, integer, integer) to service_role;
grant execute on function public.set_driver_token_consent(text, boolean, text, text) to service_role;
