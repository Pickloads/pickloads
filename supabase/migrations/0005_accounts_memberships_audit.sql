-- ============================================================================
-- PickLoads — Migration 0005: shipper companies, memberships, account status,
-- audit ledger, user preferences.
-- Source: docs/UPGRADE-AUDIT.md §5 (approved §10 defaults D1/D4). Migrations
-- 0001–0004 are FROZEN — everything here is additive.
-- ============================================================================

-- ---------- Shipper companies (freight_quotes finally gets an owner) --------
create table shippers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  industry text,
  shipping_frequency text,          -- from guided registration (M-53)
  regions text[],                   -- served/shipping regions
  phone text,
  billing_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_shippers_updated_at before update on shippers
  for each row execute function set_updated_at();

-- ---------- Multi-user membership (decision D4: DB-ready now, single-user
-- UI at launch — no invite-teammate surface until a post-launch module) ------
create type membership_role as enum ('owner','member');

create table carrier_memberships (
  carrier_id uuid not null references carriers(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (carrier_id, profile_id)
);
create index idx_carrier_memberships_profile on carrier_memberships (profile_id);

create table shipper_memberships (
  shipper_id uuid not null references shippers(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (shipper_id, profile_id)
);
create index idx_shipper_memberships_profile on shipper_memberships (profile_id);

-- Backfill: every claimed carrier (carriers.profile_id from the M-20 wizard)
-- gets an owner membership. carriers.profile_id is KEPT as-is for
-- back-compat; memberships become the authoritative join for RLS helpers.
insert into carrier_memberships (carrier_id, profile_id, role)
select c.id, c.profile_id, 'owner'
from carriers c
where c.profile_id is not null
on conflict (carrier_id, profile_id) do nothing;

-- ---------- Account status + history (approve/suspend) ----------------------
create type account_status as enum ('pending','active','suspended');

alter table profiles
  add column status account_status not null default 'active';

create table account_status_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  old_status account_status,
  new_status account_status not null,
  reason text,
  changed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_account_status_history_profile
  on account_status_history (profile_id, created_at desc);

-- ---------- Generic audit ledger (staff + security-relevant actions) --------
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,             -- 'user.suspend','settings.update',...
  target_table text,
  target_id uuid,
  detail jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index idx_audit_events_recent on audit_events (created_at desc);

-- ---------- Per-user notification preferences -------------------------------
create table user_preferences (
  profile_id uuid primary key references profiles(id) on delete cascade,
  email_load_updates boolean not null default true,
  email_document_reviews boolean not null default true,
  email_marketing boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger trg_user_preferences_updated_at before update on user_preferences
  for each row execute function set_updated_at();
