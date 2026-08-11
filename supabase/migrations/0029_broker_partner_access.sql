-- ============================================================================
-- PickLoads — Migration 0029: broker-partner access (M-81).
--
-- SCOPE (plan §7, Phase C, row M-81): *"Broker-partner access: admin-invited
-- only, org-scoped, explicit allow/deny permission lists per §12."*
--
-- Authority: `docs/DIRECTIVE-tracking.md` §12 in full, §3 (*"Do not allow
-- public self-registration as a broker partner without admin approval"*), §19
-- (*"Broker A cannot view Broker B's shipment"*, *"only shipments explicitly
-- linked to their broker organization AND PERMITTED BY SHARING POLICY"*), §16
-- (the document band), §25 (indexes), §15 (audit trail).
--
-- Migrations 0001–0004 are FROZEN and untouched. 0017/0018 are EXTENDED, never
-- rewritten: M-71 created `broker_partners` + `broker_partner_memberships` as
-- *"the minimum §12's explicitly-linked broker RLS requires"* and wrote, in
-- 0018 §3, *"M-81 layers per-shipment sharing grants on top of this floor; it
-- cannot widen it without a new policy that says so."* This migration is that
-- new policy — three of them — plus the verification state §12 demands.
--
-- ── WHAT CHANGES FOR AN EXISTING BROKER ORGANIZATION ─────────────────────
--
-- `my_broker_partner_ids()` is REPLACED, and the replacement is STRICTLY
-- NARROWER: it now requires `active` AND `verification_status = 'verified'`.
-- Every policy in 0018, 0019 and 0024 that keys off the helper inherits the
-- new rule in one write, which is exactly why M-71 put `active` in the helper
-- rather than in six policies. §12's *"verified"* is now a database fact.
--
-- The backfill below marks every organization an admin had already activated
-- as verified, so no shipped access is revoked by deploying this file. A
-- freshly created organization starts `active = false, verification_status =
-- 'pending'` and reads nothing until an admin does both.
--
-- ── §12's TWO GRANT SHAPES, MODELLED SEPARATELY ──────────────────────────
--
-- §12: *"granted access shipment by shipment or account agreement."* Two
-- sentences, two tables, and they are NOT the same mechanism wearing different
-- names:
--
--   `broker_shipment_grants`      one row = one shipment. Explicit, revocable
--                                 per shipment, and the audit trail says which
--                                 shipment was shared and when.
--   `broker_account_agreements`   one row = a broker organization's standing
--                                 access to ONE shipper's freight, bounded by
--                                 a start and an optional end. Revoking it
--                                 closes every shipment under it at once.
--
-- Collapsing them would have meant either (a) writing a grant row per shipment
-- when an account agreement is signed — which silently keeps granting after
-- the agreement ends, because nothing links the rows to the agreement — or
-- (b) treating an agreement as a wildcard grant, which makes "which shipments
-- can this partner see?" unanswerable without re-deriving the wildcard. Both
-- are the shapes §19's *"permitted by sharing policy"* exists to forbid.
--
-- `shipments.broker_partner_id` (M-71's floor) survives untouched as a THIRD
-- shape: the partner that is a party to the shipment itself. All three are
-- OR'd inside one function, `broker_can_read_shipment()`, so there is exactly
-- one definition of "this broker may read this shipment" in the database.
--
-- ── NO SELF-SERVICE ANYWHERE ─────────────────────────────────────────────
--
-- §3: *"Do not allow public self-registration as a broker partner without
-- admin approval."* Every one of the three new tables has RLS on, a staff
-- policy, a narrow member-read policy where a member has a legitimate reason
-- to see their own row, and **no INSERT/UPDATE/DELETE policy for any customer
-- role at all**. A broker cannot invite themselves, verify themselves, grant
-- themselves a shipment or sign their own agreement. Writes happen in
-- admin-gated server actions holding the service role.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────
--
-- Reverses cleanly; restore 0018's helper FIRST or every broker policy in the
-- chain fails on a missing function.
--
--   -- 1. restore 0018's helper VERBATIM (drops the verification requirement)
--   create or replace function public.my_broker_partner_ids()
--   returns setof uuid language sql security definer stable
--   set search_path = public as $$
--     select m.broker_partner_id
--     from broker_partner_memberships m
--     join broker_partners b on b.id = m.broker_partner_id
--     where m.profile_id = auth.uid() and b.active
--   $$;
--   revoke all on function public.my_broker_partner_ids() from public;
--   grant execute on function public.my_broker_partner_ids() to authenticated;
--
--   -- 2. the policies this migration added (0018/0019/0024's stay)
--   drop policy if exists "broker shared read shipments"          on shipments;
--   drop policy if exists "broker shared read shipment events"    on shipment_events;
--   drop policy if exists "broker shared read shipment parties"   on shipment_parties;
--   drop policy if exists "broker shared read shipment documents" on shipment_documents;
--   drop policy if exists "staff manage broker invites"      on broker_partner_invites;
--   drop policy if exists "staff manage broker grants"       on broker_shipment_grants;
--   drop policy if exists "member read own broker grants"    on broker_shipment_grants;
--   drop policy if exists "staff manage broker agreements"   on broker_account_agreements;
--   drop policy if exists "member read own broker agreements" on broker_account_agreements;
--
--   -- 3. functions, then tables
--   drop function if exists public.broker_can_read_shipment(uuid);
--   drop function if exists public.verify_broker_partner(uuid, uuid, boolean, text);
--   drop table if exists broker_account_agreements cascade;
--   drop table if exists broker_shipment_grants cascade;
--   drop table if exists broker_partner_invites cascade;
--
--   -- 4. the broker_partners columns
--   alter table broker_partners
--     drop column if exists verification_status,
--     drop column if exists verified_by,
--     drop column if exists verified_at,
--     drop column if exists dot_number,
--     drop column if exists bond_provider,
--     drop column if exists bond_amount_usd,
--     drop column if exists authority_since,
--     drop column if exists days_to_pay;
--   drop type if exists broker_verification_status;
--
--   -- 5. demote the role (0028 cannot be reversed; the value goes inert)
--   update profiles set role = 'carrier' where role = 'broker';
--
-- **DESTRUCTIVE at step 3**: it drops the record of which shipments were
-- shared with which partner and under what agreement. `pg_dump -t
-- broker_shipment_grants -t broker_account_agreements -t
-- broker_partner_invites` first. It fails CLOSED: with the tables gone, a
-- broker partner falls back to M-71's floor (`shipments.broker_partner_id`
-- only), which is less access, never more.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · §12's verification state
-- ---------------------------------------------------------------------------

-- Four values, and the two negatives are genuinely different:
--   pending   invited, not yet checked. The DEFAULT, so a row created by any
--             path reads nothing until somebody acts.
--   verified  an admin checked authority, bond and references (the field list
--             below) and said yes. The ONLY value that grants anything.
--   rejected  checked and refused. Terminal in practice; kept distinct from
--             `pending` so "we looked" is not confused with "we haven't".
--   suspended was verified, then something changed — a lapsed bond, a payment
--             incident. Reversible by re-verifying.
create type broker_verification_status as enum (
  'pending',
  'verified',
  'rejected',
  'suspended'
);

-- The vetting FIELD LIST is `docs/FINAL-IMPLEMENTATION-PLAN.md` §9.3:
-- *"M-81 broker vetting — the skill's broker checklist (authority, bond,
-- days-to-pay, MC age <12 months + urgency = fraud pattern) is the field list
-- for broker-partner onboarding."* `mc_number` already existed (0017); these
-- are the rest of it. They are RECORDS OF WHAT WAS CHECKED, not a scoring
-- engine: nothing in the schema or in `src/` computes a risk verdict from
-- them, because a verdict computed from five columns would be exactly the
-- "not AI-powered" overclaim §30 forbids. An admin reads them and decides.
alter table broker_partners
  add column verification_status broker_verification_status not null default 'pending',
  add column verified_by uuid references profiles(id) on delete set null,
  add column verified_at timestamptz,
  add column dot_number text,
  add column bond_provider text,
  add column bond_amount_usd numeric(12,2),
  add column authority_since date,
  add column days_to_pay integer;

comment on column broker_partners.verification_status is
  'M-81 (§12 "verified"): my_broker_partner_ids() requires ''verified''. '
  'Default ''pending'' — an invited organization reads nothing until an admin acts.';
comment on column broker_partners.authority_since is
  'M-81 (plan §9.3): FMCSA authority grant date. Authority under 12 months old '
  'combined with urgency is the fraud pattern the carrier-management skill names. '
  'Recorded for a human to read; nothing scores it.';
comment on column broker_partners.days_to_pay is
  'M-81 (plan §9.3): the partner''s stated payment terms in days. Recorded at '
  'onboarding; the escalation rule (>45 days past due) is M-79''s, not a CHECK here.';

-- Backfill: an organization an admin had already ACTIVATED was, in every sense
-- 0017 could express, an approved one. Marking it verified keeps deployment
-- access-neutral. `approved_by`/`approved_at` carry over so the ledger says
-- who, not just that.
update broker_partners
   set verification_status = 'verified',
       verified_by = approved_by,
       verified_at = coalesce(approved_at, now())
 where active;

-- ---------------------------------------------------------------------------
-- 2 · The helper, narrowed (§12 "verified")
-- ---------------------------------------------------------------------------

-- REPLACES 0018's definition. The only change is the added
-- `verification_status = 'verified'` clause, and it is added HERE rather than
-- in each policy for M-71's stated reason: one helper means an admin
-- suspending an organization revokes its access EVERYWHERE in one write, and
-- a future policy cannot forget the rule because it cannot see it.
create or replace function public.my_broker_partner_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select m.broker_partner_id
  from broker_partner_memberships m
  join broker_partners b on b.id = m.broker_partner_id
  where m.profile_id = auth.uid()
    and b.active
    and b.verification_status = 'verified'
$$;
revoke all on function public.my_broker_partner_ids() from public;
grant execute on function public.my_broker_partner_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Invitations (§12 "invited by an admin") — M-58's idiom, not a new one
-- ---------------------------------------------------------------------------

-- Same shape as `staff_invites` (0012) on purpose: hashed single-use token,
-- expiry, server-side role assignment. The differences are the two §12 adds —
-- the invite names the ORGANIZATION the invitee joins, and it can be REVOKED
-- before it is used, because a broker invitation may be issued days before a
-- verification decision lands.
create table broker_partner_invites (
  id uuid primary key default gen_random_uuid(),
  broker_partner_id uuid not null references broker_partners(id) on delete cascade,
  email text not null,
  -- The membership role the invitee receives INSIDE the organization. The
  -- PROFILE role is always 'broker' and is not a column: making it one would
  -- be a place for a forged value to land.
  membership_role membership_role not null default 'owner',
  token_hash text not null unique,     -- sha256 hex; never the raw token
  invited_by uuid not null references profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- An invite cannot be both used and cancelled: whichever happened first is
  -- the truth, and a row holding both would make "was this link usable?"
  -- depend on which column the reader looked at.
  constraint broker_invites_single_outcome
    check (accepted_at is null or revoked_at is null)
);
create index idx_broker_partner_invites_email
  on broker_partner_invites (lower(email));
create index idx_broker_partner_invites_partner
  on broker_partner_invites (broker_partner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4 · §12 grant shape ONE — shipment by shipment
-- ---------------------------------------------------------------------------

create table broker_shipment_grants (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  broker_partner_id uuid not null references broker_partners(id) on delete cascade,
  granted_by uuid not null references profiles(id),
  granted_at timestamptz not null default now(),
  -- Revocation is a column, not a DELETE. §15 wants an access history; a row
  -- that disappears when access is withdrawn cannot answer "who could see this
  -- shipment last March?" — the question an audit actually asks.
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  revoke_reason text,
  note text,
  created_at timestamptz not null default now(),
  constraint broker_grants_revocation_complete
    check ((revoked_at is null) = (revoked_by is null))
);

-- One LIVE grant per (shipment, partner). A partner re-granted after a
-- revocation gets a new row, so the history is a sequence rather than a
-- column that keeps being overwritten.
create unique index idx_broker_grants_live
  on broker_shipment_grants (shipment_id, broker_partner_id)
  where revoked_at is null;
-- §25: the broker portal's list predicate reads this direction.
create index idx_broker_grants_partner
  on broker_shipment_grants (broker_partner_id, granted_at desc)
  where revoked_at is null;
create index idx_broker_grants_shipment
  on broker_shipment_grants (shipment_id, granted_at desc);

-- ---------------------------------------------------------------------------
-- 5 · §12 grant shape TWO — account agreement
-- ---------------------------------------------------------------------------

create table broker_account_agreements (
  id uuid primary key default gen_random_uuid(),
  broker_partner_id uuid not null references broker_partners(id) on delete cascade,
  -- The agreement is ALWAYS about one shipper account. A null here would be
  -- "this partner sees everything", which is the wildcard §19's *"only
  -- shipments explicitly linked"* forbids, so the column is NOT NULL and the
  -- wildcard is unrepresentable rather than merely unused.
  shipper_id uuid not null references shippers(id) on delete cascade,
  -- Free text, e.g. a signed-agreement reference. Never a document body.
  agreement_reference text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  granted_by uuid not null references profiles(id),
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_agreements_window
    check (ends_at is null or ends_at > starts_at),
  constraint broker_agreements_revocation_complete
    check ((revoked_at is null) = (revoked_by is null))
);
create unique index idx_broker_agreements_live
  on broker_account_agreements (broker_partner_id, shipper_id)
  where revoked_at is null;
create index idx_broker_agreements_partner
  on broker_account_agreements (broker_partner_id, starts_at desc);
create trigger trg_broker_account_agreements_updated_at
  before update on broker_account_agreements
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 6 · The ONE definition of "this broker may read this shipment"
-- ---------------------------------------------------------------------------

-- Three OR'd branches, and no fourth is reachable: the partner is a party to
-- the shipment (M-71's floor), OR holds a live per-shipment grant, OR holds a
-- live account agreement covering the shipment's shipper at this moment.
--
-- `security definer` because it reads `shipments` and `shippers` to answer a
-- question ABOUT A SHIPMENT THE CALLER ALREADY NAMED. It leaks nothing: it
-- returns one boolean, it is only ever called from a policy's USING clause
-- with that policy's row id, and every branch is filtered by
-- `my_broker_partner_ids()` — which is itself `auth.uid()`-scoped and
-- verification-gated. A caller who guesses a shipment id learns "false",
-- which is what they would learn by guessing anything.
--
-- STABLE, not IMMUTABLE: the agreement window is evaluated against `now()`, so
-- an agreement that ends mid-session stops granting on the next statement.
create or replace function public.broker_can_read_shipment(p_shipment_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    -- (a) §12 "attached to a broker organization" — M-71's floor, unchanged.
    select 1 from shipments s
    where s.id = p_shipment_id
      and s.broker_partner_id in (select my_broker_partner_ids())
  ) or exists (
    -- (b) §12 "shipment by shipment".
    select 1 from broker_shipment_grants g
    where g.shipment_id = p_shipment_id
      and g.revoked_at is null
      and g.broker_partner_id in (select my_broker_partner_ids())
  ) or exists (
    -- (c) §12 "or account agreement", bounded by its own window.
    select 1
    from shipments s
    join broker_account_agreements a on a.shipper_id = s.shipper_id
    where s.id = p_shipment_id
      and a.revoked_at is null
      and a.starts_at <= now()
      and (a.ends_at is null or a.ends_at > now())
      and a.broker_partner_id in (select my_broker_partner_ids())
  );
$$;
revoke all on function public.broker_can_read_shipment(uuid) from public;
grant execute on function public.broker_can_read_shipment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7 · RLS — every new table, no customer write anywhere
-- ---------------------------------------------------------------------------

alter table broker_partner_invites    enable row level security;
alter table broker_shipment_grants    enable row level security;
alter table broker_account_agreements enable row level security;

-- Supabase's default privileges hand `authenticated` full DML on a new table.
-- RLS refuses it today; a future permissive policy written for one column
-- would inherit a write grant nobody meant to give. 0024 set this precedent
-- and it is load-bearing here for the same reason.
revoke all on broker_partner_invites    from authenticated, anon;
revoke all on broker_shipment_grants    from authenticated, anon;
revoke all on broker_account_agreements from authenticated, anon;
grant select on broker_shipment_grants    to authenticated;
grant select on broker_account_agreements to authenticated;

-- COLUMN-LEVEL grant on the invite table — M-76's idiom from 0023's
-- `shipment_driver_tokens`, and the ORDER matters: a table-level `grant
-- select` would override a column-level revoke, so the credential column is
-- simply never granted rather than granted and then taken back.
--
-- The admin page needs to LIST invites (who was invited, is it still
-- pending?) and reads them through the cookie-bound client under
-- `is_staff()`, so a table-wide revoke would have pushed a perfectly
-- policy-scopable read onto the service role. What must never be readable is
-- `token_hash`: naming it in a select is now a PERMISSION ERROR for every
-- session, staff included. The invite matcher runs as the service role, which
-- is the only place the column has a use.
grant select (
  id, broker_partner_id, email, membership_role, invited_by, expires_at,
  accepted_at, accepted_by, revoked_at, revoked_by, created_at
) on broker_partner_invites to authenticated;

create policy "staff manage broker invites" on broker_partner_invites
  for all using (is_staff());

create policy "staff manage broker grants" on broker_shipment_grants
  for all using (is_staff());
-- A partner may see WHICH of its own grants exist — that is how the portal
-- tells a user "this shipment was shared with you on the 4th" — and nothing
-- about any other organization's. No write clause: granting is an admin act.
create policy "member read own broker grants" on broker_shipment_grants
  for select using (broker_partner_id in (select my_broker_partner_ids()));

create policy "staff manage broker agreements" on broker_account_agreements
  for all using (is_staff());
create policy "member read own broker agreements" on broker_account_agreements
  for select using (broker_partner_id in (select my_broker_partner_ids()));

-- ---------------------------------------------------------------------------
-- 8 · The sharing policies (§19 "permitted by sharing policy")
-- ---------------------------------------------------------------------------

-- ADDITIVE, per 0018's own instruction. 0018/0019/0024's four broker policies
-- are left exactly as written; these four sit beside them, and because
-- permissive policies OR together the effect is "M-71's floor, plus §12's two
-- sharing shapes, and nothing else". Every branch still runs through
-- `my_broker_partner_ids()`, so verification and activation gate all of it.
--
-- Naming: "shared" rather than "member" so a reader can tell at a glance which
-- policy came from which module.

create policy "broker shared read shipments" on shipments
  for select using (broker_can_read_shipment(id));

-- §12 grants "status; timeline". The bands are M-70's
-- `AUDIENCE_EVENT_VISIBILITY.broker` — `public` + `broker`, never the
-- shipper's or the carrier's commercial correspondence, never `staff_only`.
-- Identical band clause to 0019's; only the reachability test differs.
create policy "broker shared read shipment events" on shipment_events
  for select using (
    visibility in ('public', 'broker')
    and broker_can_read_shipment(shipment_id)
  );

-- §12 grants "approved contact channels" and nothing wider, so the
-- `public_contact` clause from 0018 is repeated verbatim. A shared shipment
-- does not make a private party row visible.
create policy "broker shared read shipment parties" on shipment_parties
  for select using (
    public_contact = true
    and broker_can_read_shipment(shipment_id)
  );

-- §16's matrix decides WHICH document; this decides WHICH shipment. Both must
-- pass, exactly as in 0024 — a shared shipment widens the set of shipments a
-- partner can reach, never the set of document types.
create policy "broker shared read shipment documents" on shipment_documents
  for select using (
    shipment_document_reaches_audience(doc_type, visibility, status, 'broker')
    and broker_can_read_shipment(shipment_id)
  );

-- ---------------------------------------------------------------------------
-- 9 · Verification, as a function rather than an UPDATE in six places
-- ---------------------------------------------------------------------------

-- §12 requires verification to be an ADMIN act with a trail. The server action
-- records the `audit_events` row (M-61's single writer); this function is what
-- makes the state change atomic with the `verified_by`/`verified_at` stamp, so
-- a verified organization can never exist without a name against it.
--
-- `service_role` only — the admin gate lives in the server action, and a
-- function granted to `authenticated` would be a second door with no gate.
create or replace function public.verify_broker_partner(
  p_broker_partner_id uuid,
  p_actor_id uuid,
  p_verified boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old broker_verification_status;
  v_new broker_verification_status;
begin
  select verification_status into v_old
  from broker_partners where id = p_broker_partner_id;

  if v_old is null then
    raise exception 'broker partner not found'
      using errcode = 'PL404';
  end if;

  v_new := case when p_verified then 'verified' else 'suspended' end;

  update broker_partners
     set verification_status = v_new,
         -- Verification and activation move TOGETHER. §12 lists "invited by an
         -- admin; verified; attached to a broker organization" as one gate,
         -- and two switches that must both be on is two chances to leave one
         -- off. `active` remains a separate column so a future
         -- deactivate-without-un-verifying is expressible; today nothing does
         -- it, and the RLS suite asserts both are required.
         active = p_verified,
         verified_by = case when p_verified then p_actor_id else verified_by end,
         verified_at = case when p_verified then now() else verified_at end,
         approved_by = case when p_verified then coalesce(approved_by, p_actor_id) else approved_by end,
         approved_at = case when p_verified then coalesce(approved_at, now()) else approved_at end,
         notes = case
                   when p_note is null then notes
                   else left(coalesce(notes || E'\n', '') || p_note, 4000)
                 end
   where id = p_broker_partner_id;

  return jsonb_build_object(
    'broker_partner_id', p_broker_partner_id,
    'old_status', v_old,
    'new_status', v_new
  );
end;
$$;
revoke all on function public.verify_broker_partner(uuid, uuid, boolean, text) from public;
grant execute on function public.verify_broker_partner(uuid, uuid, boolean, text) to service_role;
