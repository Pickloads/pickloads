-- ============================================================================
-- PickLoads — Migration 0001: enum types & tables
-- Source: Production Architecture v1.2 §4, corrected per the approved
-- pre-build audit (findings F-03, F-04, F-07, F-08, F-09, F-14, S-02, O-06).
-- Every deviation from the v1.2 SQL is tagged with its audit finding.
-- ============================================================================

-- ---------- Enum types ----------
create type user_role as enum ('admin','dispatcher','carrier','shipper');

-- Pipeline CRM complet (Lead → Active Carrier)
create type lead_status as enum
  ('new','call','qualified','appointment','agreement','waiting_documents','active','inactive','lost');

create type activity_type as enum ('note','call','sms','email','status_change','callback','appointment');
create type priority_level as enum ('low','normal','high','urgent');
create type doc_type as enum ('mc_authority','coi','w9','voided_check','noa','dispatch_agreement','other');
create type doc_status as enum ('pending','approved','rejected','expired');

-- v1.2: New Authority Program
create type lead_type as enum ('dispatch','new_authority');

-- F-14: loads.status was free text in v1.2 — now a proper enum
create type load_status as enum ('booked','in_transit','delivered','invoiced','paid','cancelled');

-- ---------- updated_at helper (F-14: no timestamps maintenance in v1.2) ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Profiles (extension de auth.users) ----------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null default 'carrier',
  full_name text,
  phone text,
  company_name text,
  preferred_language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- ---------- Company settings (audit F-07 — referenced in arch §9, never defined) ----------
-- Key/value store driving the "PENDING" blocks, feature gates and launch flags.
-- The day MC/DOT activate, admin edits 3 keys and the whole site updates.
create table company_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
create trigger trg_company_settings_updated_at before update on company_settings
  for each row execute function set_updated_at();

-- ---------- Leads carriers ("Need a dispatcher?" + "Start your trucking company") ----------
create table carrier_leads (
  id uuid primary key default gen_random_uuid(),
  lead_type lead_type not null default 'dispatch',
  truck_type text,
  trailer_type text,
  home_state text,
  truck_count text,                 -- text on purpose: form options are ranges ("2–5")
  phone text not null,
  full_name text,
  email text,
  mc_number text,
  source text not null default 'website',
  locale text not null default 'en',
  status lead_status not null default 'new',
  assigned_to uuid references profiles(id),
  priority priority_level not null default 'normal',
  tags text[] not null default '{}',
  callback_at timestamptz,          -- prochain rappel planifié
  last_activity_at timestamptz,
  first_contacted_at timestamptz,   -- powers the "< 15 min" dashboard KPI
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_carrier_leads_pipeline on carrier_leads (status, assigned_to, callback_at);
create index idx_carrier_leads_created on carrier_leads (created_at desc);
create trigger trg_carrier_leads_updated_at before update on carrier_leads
  for each row execute function set_updated_at();

-- ---------- Demandes de devis shippers ----------
create table freight_quotes (
  id uuid primary key default gen_random_uuid(),
  pickup_zip text,
  delivery_zip text,
  pickup_date date,
  commodity text,
  weight_lbs int,
  pallets text,
  equipment text,
  frequency text,
  company_name text,
  email text not null,
  phone text,
  locale text not null default 'en',
  status lead_status not null default 'new',
  quoted_rate numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- F-14: v1.2 had no indexes on freight_quotes
create index idx_freight_quotes_status on freight_quotes (status, created_at desc);
create trigger trg_freight_quotes_updated_at before update on freight_quotes
  for each row execute function set_updated_at();

-- ---------- Historique CRM ----------
-- F-04: in v1.2 this table was declared BEFORE freight_quotes (broken FK order)
-- and allowed zero or two parents. Now ordered correctly + XOR constraint.
create table lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references carrier_leads(id) on delete cascade,
  quote_id uuid references freight_quotes(id) on delete cascade,
  type activity_type not null,
  body text,
  old_status lead_status,
  new_status lead_status,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint lead_activities_exactly_one_parent
    check (num_nonnulls(lead_id, quote_id) = 1)
);
create index idx_lead_activities_lead on lead_activities (lead_id, created_at desc);
create index idx_lead_activities_quote on lead_activities (quote_id, created_at desc);

-- ---------- Carriers actifs (après onboarding) ----------
create table carriers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id),
  company_name text not null,
  mc_number text,
  dot_number text,
  ein text,                         -- S-01: encrypt at application layer before insert (see docs/modules/M-01.md §Security)
  home_state text,
  factoring_company text,
  insurance_expiry date,
  dispatch_fee_pct numeric not null default 5.0
    check (dispatch_fee_pct >= 0 and dispatch_fee_pct <= 100),
  agreement_signed_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- F-14: v1.2 had no index for the portal's "my data" lookups
create index idx_carriers_profile on carriers (profile_id);
create index idx_carriers_insurance_expiry on carriers (insurance_expiry) where active;
create trigger trg_carriers_updated_at before update on carriers
  for each row execute function set_updated_at();

-- ---------- Documents uploadés (liés au Storage) ----------
create table documents (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  type doc_type not null,
  storage_path text not null,       -- private bucket 'carrier-docs'
  -- F-14: file metadata absent from v1.2
  file_name text,
  file_size_bytes bigint,
  mime_type text,
  uploaded_by uuid references profiles(id),
  status doc_status not null default 'pending',
  reviewed_by uuid references profiles(id),
  review_note text,
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_documents_review_queue on documents (status, created_at);
create index idx_documents_carrier on documents (carrier_id);
create trigger trg_documents_updated_at before update on documents
  for each row execute function set_updated_at();

-- ---------- Loads (Phase 3) ----------
-- F-03: v1.2 hard-coded `dispatch_fee generated always as (gross_rate * 0.05)`,
-- contradicting per-carrier fees (4.5 / 5 / 8 %). The fee percentage is now
-- SNAPSHOTTED per load at booking time (fee_pct_applied) and the fee amount is
-- computed by trigger — historical invoices stay correct if a carrier's rate changes.
-- F-09: dispatcher_id added — the Dispatch dashboard reports per-dispatcher
-- performance, which had no data source in v1.2.
create table loads (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id),
  dispatcher_id uuid references profiles(id),
  broker_name text,
  broker_mc text,
  origin_city text,
  origin_state text,
  dest_city text,
  dest_state text,
  pickup_date date,
  delivery_date date,
  equipment text,
  gross_rate numeric check (gross_rate is null or gross_rate >= 0),
  miles int check (miles is null or miles > 0),
  fee_pct_applied numeric not null,
  dispatch_fee numeric not null default 0,
  status load_status not null default 'booked',
  rate_con_path text,
  bol_path text,
  pod_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_loads_carrier on loads (carrier_id, status);
create index idx_loads_dispatcher on loads (dispatcher_id, created_at desc);
create index idx_loads_status on loads (status, delivery_date);
create trigger trg_loads_updated_at before update on loads
  for each row execute function set_updated_at();

-- Fee snapshot + computation (F-03)
create or replace function public.compute_load_fee()
returns trigger
language plpgsql
as $$
begin
  -- Snapshot the carrier's current fee when the load is created,
  -- unless the caller explicitly provided one (admin override).
  if tg_op = 'INSERT' and new.fee_pct_applied is null then
    select c.dispatch_fee_pct into new.fee_pct_applied
      from carriers c where c.id = new.carrier_id;
  end if;
  new.dispatch_fee := round(coalesce(new.gross_rate, 0) * new.fee_pct_applied / 100.0, 2);
  return new;
end;
$$;
-- fee_pct_applied is NOT NULL, so allow the trigger to fill it: declare column default -1 sentinel? No —
-- instead relax: make the column nullable at insert time via BEFORE trigger ordering.
alter table loads alter column fee_pct_applied drop not null;
create trigger trg_loads_fee before insert or update of gross_rate, fee_pct_applied on loads
  for each row execute function compute_load_fee();
-- After the trigger runs, fee_pct_applied is always set; enforce it:
alter table loads add constraint loads_fee_pct_applied_present
  check (fee_pct_applied is not null and fee_pct_applied >= 0 and fee_pct_applied <= 100);

-- ---------- Blog (CMS minimal) ----------
create table posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  locale text not null default 'en',
  title text not null,
  excerpt text,
  category text,
  body_md text not null,
  cover_style text,
  published boolean not null default false,
  published_at timestamptz,
  author_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- F-14: v1.2 had a globally-unique slug, which breaks per-locale articles
  constraint posts_slug_locale_unique unique (slug, locale)
);
create index idx_posts_listing on posts (locale, published, published_at desc);
create trigger trg_posts_updated_at before update on posts
  for each row execute function set_updated_at();

-- ---------- Newsletter ----------
-- Double opt-in (audit S-05): a row exists from signup, `confirmed_at` set on click.
create table subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  locale text not null default 'en',
  confirm_token uuid not null default gen_random_uuid(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Contact messages (audit F-08 — required by the Contact form and
-- the Notifications dashboard, absent from v1.2) ----------
create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email text not null,
  phone text,
  subject text,
  body text not null,
  locale text not null default 'en',
  handled boolean not null default false,
  handled_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_contact_messages_inbox on contact_messages (handled, created_at desc);

-- ---------- Webhook events (audit S-02 — signature-verified, idempotent) ----------
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,           -- 'stripe' | 'dropbox_sign'
  event_id text not null,           -- provider's id, dedup key
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received',  -- received | processed | failed
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint webhook_events_dedup unique (provider, event_id)
);
create index idx_webhook_events_failed on webhook_events (status, created_at desc);

-- ---------- Email log (audit O-06 — feeds the Notifications dashboard module) ----------
create table email_log (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null,
  subject text not null,
  provider_message_id text,
  status text not null default 'sent',      -- sent | failed
  error text,
  lead_id uuid references carrier_leads(id) on delete set null,
  quote_id uuid references freight_quotes(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_email_log_recent on email_log (created_at desc);
