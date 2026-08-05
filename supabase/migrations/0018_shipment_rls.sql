-- ============================================================================
-- PickLoads — Migration 0018: RLS for the M-71 shipment tables.
--
-- Same doctrine as 0002 and 0009 (decision Q3, CLAUDE.md §Security model):
--
--   * NO ANON POLICY ON ANY TABLE HERE. §19 is explicit — "Do not use direct
--     anonymous table SELECT access." The public `/track` page (M-73) reaches
--     the data through a server route holding the service-role key, behind
--     tracking-number + secondary-credential validation, rate limiting,
--     enumeration protection and a strict public DTO. Adding an anon SELECT
--     policy here, however narrow, would make every one of those controls
--     optional, because the anon key ships in the browser bundle.
--   * Customer roles get SELECT only. There is no INSERT, UPDATE or DELETE
--     policy for shippers, carriers or brokers on any of these tables. Writes
--     go through server actions with the service role after validation, which
--     is what makes §19's "carrier users cannot edit financial fields" and
--     "unauthorized status transitions fail" true by construction rather than
--     by column enumeration — there is no field a carrier session can write.
--   * Own-data scoping uses SECURITY DEFINER membership helpers, never a
--     subquery on `profiles` inside a policy (F-06 recursion).
--   * 0001–0004 are FROZEN and untouched. No existing policy is modified;
--     everything here is a new policy on a new table.
--
-- ROLLBACK (run BEFORE 0017's rollback):
--
--   drop policy if exists "staff manage shipments" on shipments;
--   drop policy if exists "shipper member read shipments" on shipments;
--   drop policy if exists "carrier member read shipments" on shipments;
--   drop policy if exists "broker member read shipments" on shipments;
--   drop policy if exists "staff manage shipment parties" on shipment_parties;
--   drop policy if exists "shipper member read shipment parties" on shipment_parties;
--   drop policy if exists "carrier member read shipment parties" on shipment_parties;
--   drop policy if exists "broker member read public shipment parties" on shipment_parties;
--   drop policy if exists "staff manage shipment assignments" on shipment_assignments;
--   drop policy if exists "shipper member read shipment assignments" on shipment_assignments;
--   drop policy if exists "carrier member read shipment assignments" on shipment_assignments;
--   drop policy if exists "staff manage broker partners" on broker_partners;
--   drop policy if exists "member read own broker partner" on broker_partners;
--   drop policy if exists "staff read broker partner memberships" on broker_partner_memberships;
--   drop policy if exists "own broker partner memberships" on broker_partner_memberships;
--   alter table shipments             disable row level security;
--   alter table shipment_parties      disable row level security;
--   alter table shipment_assignments  disable row level security;
--   alter table broker_partners       disable row level security;
--   alter table broker_partner_memberships disable row level security;
--   drop function if exists public.my_broker_partner_ids();
--
--   DANGEROUS IN ISOLATION: rolling this back leaves five tables with rows
--   and no tenant isolation, so every authenticated session could read every
--   shipment. Only ever run it immediately before rolling back 0017 as well.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Membership helper — the third sibling of my_carrier_ids/my_shipper_ids
-- ---------------------------------------------------------------------------

-- Returns the broker organizations the caller belongs to, AND ONLY THE ACTIVE
-- ONES. §12 requires broker partners to be admin-invited and verified before
-- they see anything; putting `active` in the helper means every policy built
-- on it inherits that rule automatically, and an admin de-activating a broker
-- organization revokes its access everywhere in one write. A membership row
-- on an inactive organization grants nothing.
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
$$;
revoke all on function public.my_broker_partner_ids() from public;
grant execute on function public.my_broker_partner_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Enable RLS on everything 0017 created
-- ---------------------------------------------------------------------------

alter table shipments                  enable row level security;
alter table shipment_parties           enable row level security;
alter table shipment_assignments       enable row level security;
alter table broker_partners            enable row level security;
alter table broker_partner_memberships enable row level security;

-- ---------------------------------------------------------------------------
-- 3 · shipments
-- ---------------------------------------------------------------------------

-- Dispatcher + admin. HONEST NOTE (plan §4, §19 "dispatcher permissions are
-- limited"): this is the existing staff idiom, and it does NOT distinguish a
-- dispatcher from an admin at the database level. Dispatcher least-privilege
-- is QUERY-LEVEL today (src/lib/staff-scope.ts, M-58), exactly as it is for
-- `loads`, `carriers` and `documents`. Making it a database rule needs
-- RESTRICTIVE policies that would also constrain admins, which is M-83's
-- scope and touches shipped tables. Stating this plainly is better than a
-- policy name that implies a guarantee the schema does not give.
create policy "staff manage shipments" on shipments
  for all using (is_staff());

-- §19 Shipper: "shipments where the authenticated user belongs to the
-- shipment's shipper organization."
create policy "shipper member read shipments" on shipments
  for select using (shipper_id in (select my_shipper_ids()));

-- §19 Carrier: assigned shipments only. Reads, never writes — carrier
-- operational updates are M-76 server actions with a transition whitelist.
create policy "carrier member read shipments" on shipments
  for select using (carrier_id in (select my_carrier_ids()));

-- §19 Broker Partner: "only shipments EXPLICITLY LINKED to their broker
-- organization." The link is `shipments.broker_partner_id`, written by an
-- admin/dispatcher action — a broker cannot create the link that grants them
-- access, and no wildcard, prefix or org-family rule exists. M-81 layers
-- per-shipment sharing grants on top of this floor; it cannot widen it
-- without a new policy that says so.
create policy "broker member read shipments" on shipments
  for select using (broker_partner_id in (select my_broker_partner_ids()));

-- ---------------------------------------------------------------------------
-- 4 · shipment_parties
-- ---------------------------------------------------------------------------

create policy "staff manage shipment parties" on shipment_parties
  for all using (is_staff());

create policy "shipper member read shipment parties" on shipment_parties
  for select using (
    exists (
      select 1 from shipments s
      where s.id = shipment_parties.shipment_id
        and s.shipper_id in (select my_shipper_ids())
    )
  );

create policy "carrier member read shipment parties" on shipment_parties
  for select using (
    exists (
      select 1 from shipments s
      where s.id = shipment_parties.shipment_id
        and s.carrier_id in (select my_carrier_ids())
    )
  );

-- §12 lists "approved contact channels" among a broker partner's permissions
-- and nothing broader. A broker therefore reads only the party rows somebody
-- has marked shareable (`public_contact`), not the shipper's internal buyer,
-- the consignee's night-shift supervisor or the driver's mobile number.
create policy "broker member read public shipment parties" on shipment_parties
  for select using (
    public_contact
    and exists (
      select 1 from shipments s
      where s.id = shipment_parties.shipment_id
        and s.broker_partner_id in (select my_broker_partner_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- 5 · shipment_assignments
-- ---------------------------------------------------------------------------

create policy "staff manage shipment assignments" on shipment_assignments
  for all using (is_staff());

-- §11's shipment detail shows the shipper who is hauling their freight.
create policy "shipper member read shipment assignments" on shipment_assignments
  for select using (
    exists (
      select 1 from shipments s
      where s.id = shipment_assignments.shipment_id
        and s.shipper_id in (select my_shipper_ids())
    )
  );

-- A carrier reads its own assignments — matched on `carrier_id` directly, not
-- through the shipment, so a released carrier keeps its own history without
-- regaining access to the shipment it no longer holds.
create policy "carrier member read shipment assignments" on shipment_assignments
  for select using (carrier_id in (select my_carrier_ids()));

-- NO BROKER POLICY, deliberately. §12's permitted list is assigned shipments,
-- status, timeline, POD, BOL-when-authorized and approved contacts; carrier
-- assignment detail (which truck, which driver, when released and why) is
-- carrier operational data and sits next to "carrier's private packet" on the
-- must-not-see list. If M-81's account agreements need to share a subset, it
-- adds a policy that says exactly which — silence here is a decision, not an
-- oversight.

-- ---------------------------------------------------------------------------
-- 6 · broker_partners / broker_partner_memberships
-- ---------------------------------------------------------------------------

create policy "staff manage broker partners" on broker_partners
  for all using (is_staff());
-- A broker member reads its own organization only. Note this uses the same
-- active-filtered helper: a de-activated organization becomes invisible even
-- to its own members, which is the correct read of §12's approval gate.
create policy "member read own broker partner" on broker_partners
  for select using (id in (select my_broker_partner_ids()));

create policy "staff read broker partner memberships" on broker_partner_memberships
  for select using (is_staff());
-- Own membership rows only (mirrors 0009's carrier/shipper membership
-- policies). Deliberately NOT filtered on `active`: a user must be able to
-- see that they hold a membership on an organization an admin has suspended,
-- otherwise "you have no access and no explanation" is the support ticket.
create policy "own broker partner memberships" on broker_partner_memberships
  for select using (profile_id = auth.uid());
