-- ============================================================================
-- PickLoads — M-83. §19's two structural gaps, closed in the database.
--
-- `docs/DIRECTIVE-tracking.md` §19 names seven proofs. Six of them have been
-- provable since M-71…M-81. Two were carried as residual risks instead:
--
--   R-1 (M-71, inherited by M-72/M-74/M-75/M-77/M-81) — RLS is row-level, so
--       the three §18 financial columns are in the payload of any row a
--       customer may read. `toShipperDto`/`toCarrierDto`/`toBrokerDto` are
--       allow-lists and the projections are explicit, but neither is a
--       DATABASE guarantee: a hand-written PostgREST request naming
--       `margin` on a row the caller may read was answered.
--
--   R-2 (M-71, inherited by M-72/M-75/M-77/M-81 as R-4) — dispatcher
--       least-privilege was QUERY-LEVEL (`src/lib/staff-scope.ts`). The
--       `"staff manage …"` policies say `is_staff()`, which does not
--       distinguish a dispatcher from an admin, so a dispatcher's own access
--       token used directly against PostgREST read every shipment in the
--       system. §19's *"dispatcher permissions are limited"* was therefore a
--       claim about the application, not about the schema — and a query-level
--       filter that is tested as though it were a database guarantee is
--       exactly the failure mode M-81's third injection surfaced.
--
-- This migration closes both. Nothing here is additive-only in the usual
-- sense: it REMOVES privileges that `authenticated` holds today, which is the
-- point. Both changes fail CLOSED — a caller that loses a privilege gets an
-- error, never silently-wrong data.
--
--   §1  dispatcher scope helpers
--   §2  RESTRICTIVE policies — 14 tables
--   §3  `my_shipment_exceptions()` — the one SECURITY DEFINER function a
--       restrictive policy cannot reach
--   §4  column privileges on `shipments`
--   §5  `shipment_restricted_fields()` — the audience-aware accessor that
--       replaces the revoked columns for the two callers entitled to them
--
-- Migrations 0001–0004 remain frozen; 0017–0029 are not edited.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1 · Dispatcher scope helpers
--
-- The predicate is `src/lib/staff-scope.ts`'s, restated in SQL and NOT
-- reimplemented in a second shape: a dispatcher reaches a shipment they own
-- (`shipments.dispatcher_id`) or one hauled by a carrier an admin assigned
-- them (`carriers.assigned_dispatcher_id`, M-58's existing least-privilege
-- key). §6's first four statuses have no carrier at all, which is why the
-- first arm exists — a carrier-only rule would hide from a dispatcher every
-- shipment they are sourcing a truck for, including the ones they created.
--
-- SECURITY DEFINER because a restrictive policy on `shipments` must be able
-- to read `profiles` and `carriers` without recursing into their own
-- policies. STABLE so the planner may cache within a statement.
-- ---------------------------------------------------------------------------

create or replace function public.is_dispatcher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'dispatcher'
  );
$$;

comment on function public.is_dispatcher() is
  'M-83 §19: true when the caller is a dispatcher (not an admin). The one '
  'thing is_staff() deliberately cannot tell you.';

create or replace function public.dispatcher_may_see(
  p_dispatcher_id uuid,
  p_carrier_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (p_dispatcher_id is not null and p_dispatcher_id = auth.uid())
    or (
      p_carrier_id is not null
      and exists (
        select 1 from public.carriers c
         where c.id = p_carrier_id
           and c.assigned_dispatcher_id = auth.uid()
      )
    );
$$;

comment on function public.dispatcher_may_see(uuid, uuid) is
  'M-83 §19: the two-arm dispatcher scope — own shipment OR assigned carrier. '
  'Mirrors shipmentScopeExpression()/dispatcherMayActOn() in staff-scope.ts.';

/**
 * The value every restrictive policy actually tests.
 *
 * Reads as: "unless you are a dispatcher, this constraint does not apply to
 * you." Admins, shippers, carriers, broker partners and anon all short-circuit
 * on the first arm, so the restrictive policy can be attached to a table
 * without narrowing any customer policy — which is what made 0002's frozen
 * `"staff manage"` policies untouchable and this approach available.
 */
create or replace function public.staff_scope_ok(
  p_dispatcher_id uuid,
  p_carrier_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_dispatcher()
      or public.dispatcher_may_see(p_dispatcher_id, p_carrier_id);
$$;

comment on function public.staff_scope_ok(uuid, uuid) is
  'M-83 §19: the restrictive-policy predicate. True for every non-dispatcher.';

/** The same question for a table that carries only a shipment id. */
create or replace function public.shipment_in_staff_scope(p_shipment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_dispatcher()
      or exists (
        select 1 from public.shipments s
         where s.id = p_shipment_id
           and public.dispatcher_may_see(s.dispatcher_id, s.carrier_id)
      );
$$;

comment on function public.shipment_in_staff_scope(uuid) is
  'M-83 §19: restrictive-policy predicate for the shipment-scoped child '
  'tables. True for every non-dispatcher.';

revoke all on function public.is_dispatcher() from public;
revoke all on function public.dispatcher_may_see(uuid, uuid) from public;
revoke all on function public.staff_scope_ok(uuid, uuid) from public;
revoke all on function public.shipment_in_staff_scope(uuid) from public;

-- EXECUTE goes to anon as well as authenticated. A restrictive policy is
-- evaluated for EVERY role that reaches the table, including anon — and an
-- anon caller refused with "permission denied for function staff_scope_ok"
-- instead of "no rows" would be a new oracle, not a control. 0013 set the
-- same precedent for `is_staff()`.
grant execute on function public.is_dispatcher() to anon, authenticated, service_role;
grant execute on function public.dispatcher_may_see(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.staff_scope_ok(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.shipment_in_staff_scope(uuid) to anon, authenticated, service_role;

-- `dispatcher_may_see` probes `carriers` by assigned dispatcher once per ROW
-- rather than once per request, so the supporting index stops being a nicety.
-- 0005 already created `idx_carriers_assigned_dispatcher`; asserted here (as
-- a hard failure, not a create-if-missing) so a future migration that drops
-- it cannot quietly turn every staff query into a sequential scan of
-- `carriers`.
do $$ begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'carriers'
       and indexdef like '%assigned_dispatcher_id%'
  ) then
    raise exception
      'M-83: carriers(assigned_dispatcher_id) has no index — the dispatcher '
      'scope predicate runs per row and needs it';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- §2 · RESTRICTIVE policies
--
-- PostgreSQL ORs permissive policies and ANDs restrictive ones on top. So one
-- restrictive policy per table constrains EVERY existing policy at once —
-- including the frozen-by-convention `"staff manage …"` ones — without
-- editing any of them, and without widening anything.
--
-- `for all`, not `for select`: §19's sentence is about permissions, and a
-- scoped read with an unscoped write is not a limit. Both `using` and
-- `with check` carry the predicate so a dispatcher cannot move a row INTO or
-- OUT OF their scope either.
--
-- WHICH TABLES. Every table that carries a `shipment_id` and has a staff
-- policy, plus `shipments` itself. `invoices` also carries `shipment_id`
-- (0021) but is M-31 billing under 0008's own staff policy and outside the
-- tracking directive's §19 — named in M-83's residual ledger rather than
-- silently included.
-- ---------------------------------------------------------------------------

drop policy if exists "dispatcher scope shipments" on public.shipments;
create policy "dispatcher scope shipments" on public.shipments
  as restrictive for all
  using (public.staff_scope_ok(dispatcher_id, carrier_id))
  with check (public.staff_scope_ok(dispatcher_id, carrier_id));

drop policy if exists "dispatcher scope shipment parties" on public.shipment_parties;
create policy "dispatcher scope shipment parties" on public.shipment_parties
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope shipment assignments" on public.shipment_assignments;
create policy "dispatcher scope shipment assignments" on public.shipment_assignments
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope shipment events" on public.shipment_events;
create policy "dispatcher scope shipment events" on public.shipment_events
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope shipment documents" on public.shipment_documents;
create policy "dispatcher scope shipment documents" on public.shipment_documents
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope shipment eta history" on public.shipment_eta_history;
create policy "dispatcher scope shipment eta history" on public.shipment_eta_history
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope shipment exceptions" on public.shipment_exceptions;
create policy "dispatcher scope shipment exceptions" on public.shipment_exceptions
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope shipment locations" on public.shipment_locations;
create policy "dispatcher scope shipment locations" on public.shipment_locations
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope driver tokens" on public.shipment_driver_tokens;
create policy "dispatcher scope driver tokens" on public.shipment_driver_tokens
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope notification queue" on public.shipment_notification_queue;
create policy "dispatcher scope notification queue" on public.shipment_notification_queue
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope provider connections" on public.tracking_provider_connections;
create policy "dispatcher scope provider connections" on public.tracking_provider_connections
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope broker grants" on public.broker_shipment_grants;
create policy "dispatcher scope broker grants" on public.broker_shipment_grants
  as restrictive for all
  using (public.shipment_in_staff_scope(shipment_id))
  with check (public.shipment_in_staff_scope(shipment_id));

-- THE TWO ENUMERATION LEDGERS are the exception, and the `shipment_id is
-- null` arm is the whole reason they need their own text.
--
-- M-73's tracking ledger and M-76's driver-token ledger both record MISSES as
-- well as hits, and a miss has no shipment by definition (0020 and 0023 both
-- make the column nullable for exactly that). A bare
-- `shipment_in_staff_scope(shipment_id)` evaluates NULL → false and would hide
-- every failed lookup from every dispatcher — i.e. it would blind the
-- operators watching for the attack the tables exist to detect, which is a
-- worse outcome than the over-broad read it would be fixing. Unattributed
-- attempts stay visible to all staff; attempts against a SPECIFIC shipment
-- follow that shipment's scope.
drop policy if exists "dispatcher scope tracking access" on public.shipment_tracking_access;
create policy "dispatcher scope tracking access" on public.shipment_tracking_access
  as restrictive for all
  using (shipment_id is null or public.shipment_in_staff_scope(shipment_id))
  with check (shipment_id is null or public.shipment_in_staff_scope(shipment_id));

drop policy if exists "dispatcher scope driver token access" on public.shipment_driver_token_access;
create policy "dispatcher scope driver token access" on public.shipment_driver_token_access
  as restrictive for all
  using (shipment_id is null or public.shipment_in_staff_scope(shipment_id))
  with check (shipment_id is null or public.shipment_in_staff_scope(shipment_id));

-- ---------------------------------------------------------------------------
-- §3 · The one function a restrictive policy cannot reach
--
-- `my_shipment_exceptions()` (0025) is SECURITY DEFINER, so it runs as the
-- owner and RLS — restrictive policies included — does not apply inside it.
-- Its `is_staff()` arm therefore remained an unscoped read of any shipment's
-- exceptions for any dispatcher. Replaced with the same predicate the
-- policies use. The customer arms are byte-identical to 0025's.
-- ---------------------------------------------------------------------------

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
       (is_staff() and staff_scope_ok(s.dispatcher_id, s.carrier_id))
       or s.shipper_id in (select my_shipper_ids())
       or s.carrier_id in (select my_carrier_ids())
       or s.broker_partner_id in (select my_broker_partner_ids())
     )
   order by e.opened_at desc
$$;

-- ---------------------------------------------------------------------------
-- §4 · Column privileges on `shipments` — R-1, closed
--
-- M-76 proved the shape on `shipment_driver_tokens`: column privileges are
-- checked IN ADDITION to RLS, and the order is load-bearing — a table-level
-- SELECT overrides a column-level revoke, so the table-level grant has to go
-- first.
--
-- WHY M-71 SAID THIS WAS UNAVAILABLE, AND WHAT CHANGED. M-71's R-1 is
-- correct that Postgres cannot distinguish staff from customer at the GRANT
-- level, because every browser session — staff included — is `authenticated`.
-- The resolution is not a cleverer GRANT: it is to take the four columns
-- AWAY FROM THE TABLE for every browser role and hand them back through a
-- SECURITY DEFINER accessor that applies the audience rule in SQL (§5).
-- Two call sites needed changing, both server-side.
--
-- THE FOUR COLUMNS
--   gross_shipper_amount · margin   §18 staff-only. No customer serializer
--                                   names them; now no customer ROLE can.
--   carrier_pay                     §18 staff-only, with M-70's one deliberate
--                                   crossing: the hauling carrier sees their
--                                   own contract rate. That crossing now
--                                   happens in `shipment_restricted_fields()`,
--                                   where the rule is written down, instead of
--                                   in a projection string.
--   public_access_hash              §4's second factor. M-70: *"a CREDENTIAL,
--                                   not data"*. Every projection already
--                                   omitted it; now the column privilege does.
--
-- WRITES. `authenticated` and `anon` lose INSERT/UPDATE/DELETE on `shipments`
-- outright. Nothing in `src/` writes this table through a browser session —
-- every write is an 0019/0022 SECURITY DEFINER RPC or a service-role client
-- (verified: the sole `.update()` on `shipments`, the §14 dispatcher
-- reassignment, uses `tryCreateAdminClient()`). So §19's *"carrier users
-- cannot edit financial fields"* stops being the absence of a policy — a fact
-- a future `for all` policy could erase by accident — and becomes a catalog
-- fact that survives any policy anyone writes later.
--
-- FAIL-CLOSED CONSEQUENCE, STATED SO IT IS NOT A SURPRISE: a future migration
-- that adds a column to `shipments` must GRANT SELECT on it to
-- `authenticated`, or every customer read of that column errors. That is the
-- intended direction of failure and it is in the launch runbook.
-- ---------------------------------------------------------------------------

revoke all on public.shipments from authenticated, anon;

grant select (
  id, tracking_number, shipper_id, carrier_id, dispatcher_id, quote_id,
  broker_partner_id, load_id, status,
  origin_company, origin_address, origin_city, origin_state, origin_zip,
  destination_company, destination_address, destination_city,
  destination_state, destination_zip,
  pickup_appointment_at, delivery_appointment_at,
  equipment, commodity_category, weight_lbs, pallets, distance_miles,
  shipper_reference, po_number,
  public_tracking_enabled, tracking_mode, location_visibility,
  current_latitude, current_longitude, current_city, current_state,
  last_location_at,
  estimated_pickup_at, estimated_delivery_at, eta_source, eta_confidence,
  eta_updated_at,
  delay_minutes, delay_reason_public,
  created_at, updated_at, completed_at, cancelled_at, cancellation_reason
) on public.shipments to authenticated;

-- `anon` gets NOTHING. It never had a policy on `shipments` (§19 forbids
-- direct anonymous SELECT and M-73 goes through the service role), so the
-- grant it held was dead weight that only RLS was standing on. Now both stand
-- on it.

-- ---------------------------------------------------------------------------
-- §5 · `shipment_restricted_fields()` — the accessor
--
-- One row, or none. The audience rule, in one place:
--
--   staff, in scope   → all four
--   hauling carrier   → `carrier_pay` only; the other three are NULL
--   anyone else       → NO ROW AT ALL
--
-- The "no row" arm matters: a caller who may not see the shipment must not
-- learn that it exists, so an out-of-scope dispatcher and a shipper both get
-- an empty result rather than a row of nulls — which would have been an
-- existence oracle sitting behind a privacy control.
--
-- SECURITY DEFINER is unavoidable (the point is to read columns the caller
-- may not name) and is therefore written defensively: `set search_path`,
-- EXECUTE revoked from `public`, granted to `authenticated` only — `anon`
-- has no business here and, unlike the policy predicates in §1, this function
-- is never reached by a policy evaluation.
-- ---------------------------------------------------------------------------

create or replace function public.shipment_restricted_fields(p_shipment_id uuid)
returns table (
  gross_shipper_amount numeric,
  carrier_pay numeric,
  margin numeric,
  delay_reason_internal text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when is_staff() then s.gross_shipper_amount end,
    case when is_staff() or s.carrier_id in (select my_carrier_ids())
         then s.carrier_pay end,
    case when is_staff() then s.margin end,
    case when is_staff() then s.delay_reason_internal end
    from shipments s
   where s.id = p_shipment_id
     and (
       (is_staff() and staff_scope_ok(s.dispatcher_id, s.carrier_id))
       or s.carrier_id in (select my_carrier_ids())
     );
$$;

comment on function public.shipment_restricted_fields(uuid) is
  'M-83: the §18 staff-only columns, behind the audience rule. Replaces the '
  'column privileges revoked from authenticated in 0030 §4.';

revoke all on function public.shipment_restricted_fields(uuid) from public;
grant execute on function public.shipment_restricted_fields(uuid)
  to authenticated, service_role;
