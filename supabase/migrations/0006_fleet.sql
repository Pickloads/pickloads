-- ============================================================================
-- PickLoads — Migration 0006: fleet (trucks & drivers).
-- Source: docs/UPGRADE-AUDIT.md §5. CRUD UI lands in the trucks-and-drivers
-- module; the schema ships now so RLS/types are stable for it.
-- ============================================================================

create table trucks (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  unit_number text,
  equipment text not null,          -- keep in sync with the 8 equipment slugs
  year int,
  make text,
  model text,
  vin text,
  plate text,
  plate_state text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_trucks_carrier on trucks (carrier_id);
create trigger trg_trucks_updated_at before update on trucks
  for each row execute function set_updated_at();

create table drivers (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  cdl_number text,
  cdl_state text,
  cdl_expiry date,
  medical_card_expiry date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_drivers_carrier on drivers (carrier_id);
create trigger trg_drivers_updated_at before update on drivers
  for each row execute function set_updated_at();

-- Extension point (deliberately NOT added yet): nullable loads.driver_id /
-- loads.truck_id FKs are additive ALTERs for the load-detail module.
