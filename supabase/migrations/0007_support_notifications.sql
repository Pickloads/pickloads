-- ============================================================================
-- PickLoads — Migration 0007: support threads/messages + notifications.
-- Source: docs/UPGRADE-AUDIT.md §5 (decision D2: simple threaded messages
-- with open/answered/closed — no SLA engine; schema upgrades to ticketing
-- later without a rewrite).
-- ============================================================================

create type support_status as enum ('open','answered','closed');

create table support_threads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  carrier_id uuid references carriers(id),
  shipper_id uuid references shippers(id),
  subject text not null,
  status support_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_support_threads_owner on support_threads (profile_id, created_at desc);
create index idx_support_threads_inbox on support_threads (status, updated_at desc);
create trigger trg_support_threads_updated_at before update on support_threads
  for each row execute function set_updated_at();

create table support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references support_threads(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  is_staff boolean not null default false,
  created_at timestamptz not null default now(),
  -- New authenticated write surface (audit §6.8): hard body cap in-schema;
  -- the app layer rate-limits and renders escape-first (M-33 discipline).
  constraint support_messages_body_length check (char_length(body) <= 5000)
);
create index idx_support_messages_thread on support_messages (thread_id, created_at);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  kind text not null,               -- 'document_reviewed','load_status',...
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_unread
  on notifications (profile_id, created_at desc)
  where read_at is null;
