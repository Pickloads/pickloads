-- ============================================================================
-- PickLoads — local PostgreSQL 16 shim for Supabase-managed schemas.
--
-- Repo copy of the M-01 validation shim (previously kept out-of-tree in
-- /tmp/pgshim) so `npm run test:rls` is reproducible on any machine with a
-- local PG16. It recreates just enough of Supabase's platform surface for the
-- migrations and RLS policies to run unchanged:
--   * auth.users + auth.uid()          (session identity)
--   * storage.buckets/objects/foldername (0004 bucket policies)
--   * the anon / authenticated / service_role roles
--
-- GRANT PARITY (M-61): on a real Supabase project BOTH `anon` and
-- `authenticated` hold table-level SELECT/INSERT/UPDATE/DELETE on `public`;
-- Row Level Security — not missing grants — is what stops the anon key. The
-- shim therefore grants anon the same privileges, so an anon assertion that
-- passes here proves the POLICY blocks it, not a grant that production does
-- not actually have. (The historical M-01 shim granted `authenticated` only,
-- which would have made every anon assertion pass vacuously.)
-- ============================================================================

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_upper(string_to_array(name, '/'), 1) - 1]
$$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

grant usage on schema public to authenticated, anon, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, anon;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, anon;
