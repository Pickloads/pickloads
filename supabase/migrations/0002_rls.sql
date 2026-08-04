-- ============================================================================
-- PickLoads — Migration 0002: Row Level Security
--
-- Security model (approved decision Q3 + audit F-05/F-06/F-07):
--   * ALL public-form writes go through server-side handlers using the
--     service-role key AFTER Zod + Turnstile validation. There are NO anon
--     insert policies — the anon key can write nothing, read almost nothing.
--   * RLS below is defense in depth for authenticated portal/admin reads and
--     the carrier portal, not the primary gate.
--   * Role checks use a SECURITY DEFINER helper instead of subqueries on
--     `profiles` inside policies (F-06: avoids RLS recursion).
-- ============================================================================

-- ---------- Role helper (F-06) ----------
create or replace function public.current_user_role()
returns user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from profiles where id = auth.uid();
$$;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select role from profiles where id = auth.uid()) in ('admin','dispatcher'), false);
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- ---------- Privilege-escalation guard (audit F-06) ----------
-- Users may update their own profile but never their own role;
-- only admins change roles.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and coalesce((select role from profiles where id = auth.uid()) = 'admin', false) is not true
     -- service-role connections have auth.uid() = null and bypass RLS anyway;
     -- this guard targets authenticated end-user sessions.
     and auth.uid() is not null then
    raise exception 'changing role requires admin';
  end if;
  return new;
end;
$$;
create trigger trg_profiles_role_guard before update on profiles
  for each row execute function guard_role_change();

-- ---------- Enable RLS everywhere (F-07: v1.2 covered only 5 tables) ----------
alter table profiles          enable row level security;
alter table company_settings  enable row level security;
alter table carrier_leads     enable row level security;
alter table freight_quotes    enable row level security;
alter table lead_activities   enable row level security;
alter table carriers          enable row level security;
alter table documents         enable row level security;
alter table loads             enable row level security;
alter table posts             enable row level security;
alter table subscribers       enable row level security;
alter table contact_messages  enable row level security;
alter table webhook_events    enable row level security;
alter table email_log         enable row level security;

-- ---------- profiles ----------
create policy "own profile read"   on profiles for select using (id = auth.uid());
create policy "staff read profiles" on profiles for select using (is_staff());
create policy "own profile update" on profiles for update using (id = auth.uid());
-- (role changes blocked by trg_profiles_role_guard; inserts happen via
--  the auth signup trigger / service role only)

-- ---------- company_settings ----------
-- Publicly readable: drives PENDING blocks, feature gates, footer credentials.
-- Never store secrets here.
create policy "public read settings" on company_settings for select using (true);
create policy "admin write settings" on company_settings
  for all using (current_user_role() = 'admin');

-- ---------- carrier_leads / freight_quotes / contact_messages ----------
-- No public policies: inserts arrive via service role (Q3).
create policy "staff read leads"   on carrier_leads for select using (is_staff());
create policy "staff update leads" on carrier_leads for update using (is_staff());
create policy "staff read quotes"   on freight_quotes for select using (is_staff());
create policy "staff update quotes" on freight_quotes for update using (is_staff());
create policy "staff read contact"   on contact_messages for select using (is_staff());
create policy "staff update contact" on contact_messages for update using (is_staff());

-- ---------- lead_activities ----------
create policy "staff read activities"   on lead_activities for select using (is_staff());
create policy "staff insert activities" on lead_activities
  for insert with check (is_staff() and created_by = auth.uid());

-- ---------- carriers ----------
create policy "staff manage carriers" on carriers
  for all using (is_staff());
create policy "carrier own record" on carriers
  for select using (profile_id = auth.uid());

-- ---------- documents ----------
create policy "staff manage documents" on documents
  for all using (is_staff());
create policy "carrier own docs read" on documents
  for select using (carrier_id in (select id from carriers where profile_id = auth.uid()));
create policy "carrier own docs upload" on documents
  for insert with check (
    carrier_id in (select id from carriers where profile_id = auth.uid())
    and uploaded_by = auth.uid()
    and status = 'pending'
  );

-- ---------- loads ----------
create policy "staff manage loads" on loads
  for all using (is_staff());
create policy "carrier own loads" on loads
  for select using (carrier_id in (select id from carriers where profile_id = auth.uid()));

-- ---------- posts ----------
create policy "public read published posts" on posts
  for select using (published);
create policy "staff manage posts" on posts
  for all using (is_staff());

-- ---------- subscribers ----------
-- Insert + confirm via service role; staff can view the list (Marketing module).
create policy "staff read subscribers" on subscribers for select using (is_staff());

-- ---------- webhook_events / email_log ----------
create policy "staff read webhook events" on webhook_events for select using (is_staff());
create policy "staff read email log"      on email_log      for select using (is_staff());
