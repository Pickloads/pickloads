-- ============================================================================
-- PickLoads — Migration 0003: auth signup trigger + automatic CRM journaling
-- ============================================================================

-- ---------- Profile auto-creation on signup ----------
-- Every auth.users row gets a profiles row. Role defaults to 'carrier';
-- staff accounts are invite-only and promoted by an admin (audit S-04).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, preferred_language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'preferred_language', 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Automatic status journaling (arch §6: "chaque changement de
-- statut est journalisé automatiquement") ----------
create or replace function public.journal_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into lead_activities (lead_id, type, old_status, new_status, created_by)
    values (new.id, 'status_change', old.status, new.status, auth.uid());
    new.last_activity_at := now();
    -- KPI "< 15 min": first transition out of NEW stamps first contact
    if old.status = 'new' and new.first_contacted_at is null then
      new.first_contacted_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_carrier_leads_journal before update on carrier_leads
  for each row execute function journal_lead_status_change();

create or replace function public.journal_quote_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into lead_activities (quote_id, type, old_status, new_status, created_by)
    values (new.id, 'status_change', old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_freight_quotes_journal before update on freight_quotes
  for each row execute function journal_quote_status_change();

-- ---------- Keep last_activity_at fresh on any journaled activity ----------
create or replace function public.touch_lead_on_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Skip status_change rows: those are inserted from inside a carrier_leads
  -- UPDATE (journal trigger), which already stamps last_activity_at itself.
  -- Updating the same row from within its own BEFORE UPDATE cycle risks
  -- "tuple already modified" errors.
  if new.lead_id is not null and new.type <> 'status_change' then
    update carrier_leads set last_activity_at = now() where id = new.lead_id;
  end if;
  return new;
end;
$$;

create trigger trg_lead_activities_touch after insert on lead_activities
  for each row execute function touch_lead_on_activity();
