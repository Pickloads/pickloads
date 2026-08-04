-- ============================================================================
-- PickLoads — Migration 0009: RLS for every table added in 0005–0008.
--
-- Same doctrine as 0002 (decision Q3): NO anon policies — public/auth writes
-- go through server actions (service role) after Zod + Turnstile + rate
-- limit; RLS is defense in depth for authenticated portal reads. Staff via
-- is_staff(); own-data via SECURITY DEFINER membership helpers. Existing
-- 0002 policies (profile_id = auth.uid()) stay valid; membership-based
-- policies are ADDED alongside — 0001–0004 are never edited.
-- ============================================================================

-- ---------- Membership helpers (audit §5/0009 sketch) ----------
create or replace function public.my_carrier_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select carrier_id from carrier_memberships where profile_id = auth.uid()
$$;
revoke all on function public.my_carrier_ids() from public;
grant execute on function public.my_carrier_ids() to authenticated;

create or replace function public.my_shipper_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select shipper_id from shipper_memberships where profile_id = auth.uid()
$$;
revoke all on function public.my_shipper_ids() from public;
grant execute on function public.my_shipper_ids() to authenticated;

-- ---------- Enable RLS on everything new ----------
alter table shippers               enable row level security;
alter table carrier_memberships    enable row level security;
alter table shipper_memberships    enable row level security;
alter table account_status_history enable row level security;
alter table audit_events           enable row level security;
alter table user_preferences       enable row level security;
alter table trucks                 enable row level security;
alter table drivers                enable row level security;
alter table support_threads        enable row level security;
alter table support_messages       enable row level security;
alter table notifications          enable row level security;
alter table invoices               enable row level security;

-- ---------- shippers ----------
create policy "staff manage shippers" on shippers
  for all using (is_staff());
create policy "member read own shipper" on shippers
  for select using (id in (select my_shipper_ids()));

-- ---------- memberships (reads only — rows are written by server actions
-- with the service role; the single-user UI has no invite surface, D4) ------
create policy "staff read carrier memberships" on carrier_memberships
  for select using (is_staff());
create policy "own carrier memberships" on carrier_memberships
  for select using (profile_id = auth.uid());
create policy "staff read shipper memberships" on shipper_memberships
  for select using (is_staff());
create policy "own shipper memberships" on shipper_memberships
  for select using (profile_id = auth.uid());

-- ---------- account_status_history / audit_events (writes via service role
-- or SECURITY DEFINER only — end-user sessions never insert) ----------------
create policy "staff read status history" on account_status_history
  for select using (is_staff());
create policy "staff read audit events" on audit_events
  for select using (is_staff());

-- ---------- user_preferences ----------
create policy "own preferences read" on user_preferences
  for select using (profile_id = auth.uid());
create policy "own preferences insert" on user_preferences
  for insert with check (profile_id = auth.uid());
create policy "own preferences update" on user_preferences
  for update using (profile_id = auth.uid());
create policy "staff read preferences" on user_preferences
  for select using (is_staff());

-- ---------- trucks / drivers (carrier fleet CRUD via membership) ----------
create policy "staff manage trucks" on trucks
  for all using (is_staff());
create policy "member manage trucks" on trucks
  for all using (carrier_id in (select my_carrier_ids()))
  with check (carrier_id in (select my_carrier_ids()));
create policy "staff manage drivers" on drivers
  for all using (is_staff());
create policy "member manage drivers" on drivers
  for all using (carrier_id in (select my_carrier_ids()))
  with check (carrier_id in (select my_carrier_ids()));

-- ---------- support (participants read/write own threads; staff read all) ---
create policy "staff manage support threads" on support_threads
  for all using (is_staff());
create policy "own support threads read" on support_threads
  for select using (profile_id = auth.uid());
create policy "own support threads insert" on support_threads
  for insert with check (profile_id = auth.uid() and status = 'open');
create policy "staff manage support messages" on support_messages
  for all using (is_staff());
create policy "own support messages read" on support_messages
  for select using (
    thread_id in (select id from support_threads where profile_id = auth.uid())
  );
create policy "own support messages insert" on support_messages
  for insert with check (
    author_id = auth.uid()
    and is_staff = false
    and thread_id in (select id from support_threads where profile_id = auth.uid())
  );

-- ---------- notifications (inserts via service role only) ----------
create policy "own notifications read" on notifications
  for select using (profile_id = auth.uid());
create policy "own notifications mark read" on notifications
  for update using (profile_id = auth.uid());

-- ---------- invoices ----------
create policy "staff manage invoices" on invoices
  for all using (is_staff());
create policy "member read invoices" on invoices
  for select using (carrier_id in (select my_carrier_ids()));

-- ---------- freight_quotes: the M-32 Phase-4 fix (audit §6.3) ----------
-- Shipper members read their company's quotes under RLS — replaces the
-- documented admin-client email-matching workaround before shipper signup.
create policy "member read own quotes" on freight_quotes
  for select using (shipper_id in (select my_shipper_ids()));

-- ---------- carriers/documents/loads: additive membership policies ----------
create policy "member read carrier" on carriers
  for select using (id in (select my_carrier_ids()));
create policy "member read docs" on documents
  for select using (carrier_id in (select my_carrier_ids()));
create policy "member upload docs" on documents
  for insert with check (
    carrier_id in (select my_carrier_ids())
    and uploaded_by = auth.uid()
    and status = 'pending'
  );
create policy "member read loads" on loads
  for select using (carrier_id in (select my_carrier_ids()));
