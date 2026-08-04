-- ============================================================================
-- PickLoads — Migration 0008: invoices mirror + shipper quote linkage.
-- Source: docs/UPGRADE-AUDIT.md §5.
--
-- invoices: today an invoice exists only as a Stripe object plus a
-- webhook_events row — an audit ledger, not a queryable billing record. This
-- thin mirror (written by the billing action, updated by the existing
-- idempotent Stripe webhook) gives the carrier invoices page and admin
-- reporting a real source of truth. Stripe stays the system of record.
--
-- freight_quotes.shipper_id: the M-32 Phase-4 fix, exactly as that doc
-- planned. SEQUENCING CONSTRAINT (audit §6.3): this FK + the 0009 RLS policy
-- must land BEFORE any public shipper signup ships.
-- ============================================================================

create type invoice_status as enum ('draft','open','paid','void','uncollectible');

create table invoices (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id),
  load_id uuid references loads(id),
  stripe_invoice_id text unique,
  amount_cents bigint not null,
  currency text not null default 'usd',
  status invoice_status not null default 'open',
  hosted_url text,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_invoices_carrier on invoices (carrier_id, created_at desc);
create trigger trg_invoices_updated_at before update on invoices
  for each row execute function set_updated_at();

-- ---------- freight_quotes: owner FK + directive-level quote fields ---------
alter table freight_quotes
  add column shipper_id uuid references shippers(id),
  add column hazmat boolean,
  add column temp_controlled boolean,
  add column temp_min_f int,
  add column temp_max_f int,
  add column dims_l_in int,
  add column dims_w_in int,
  add column dims_h_in int,
  add column pickup_address text,
  add column pickup_city text,
  add column pickup_state text,
  add column delivery_address text,
  add column delivery_city text,
  add column delivery_state text;
create index idx_freight_quotes_shipper on freight_quotes (shipper_id, created_at desc);

-- One-shot backfill: link historical quotes to shipper companies whose member
-- signed up with the SAME email the quote was submitted under. Runs once at
-- migration time; runtime claiming uses the Supabase-VERIFIED session email
-- only (audit §6.3 — email-change flows must never silently re-link quotes).
with email_owner as (
  select distinct on (lower(u.email)) lower(u.email) as email, sm.shipper_id
  from shipper_memberships sm
  join auth.users u on u.id = sm.profile_id
  where u.email is not null
  order by lower(u.email), sm.created_at
)
update freight_quotes fq
set shipper_id = eo.shipper_id
from email_owner eo
where fq.shipper_id is null
  and lower(fq.email) = eo.email;
