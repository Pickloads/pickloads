-- ============================================================================
-- PickLoads — Migration 0012: staff invites (M-58, audit §5 sketch + S-04).
--
-- Staff accounts stay invite-only, but the mechanics move in-app: an admin
-- creates an invite → the invitee gets a tokenized link → the accept action
-- creates the auth user and assigns the role via the SERVICE ROLE only
-- (the 0002 guard_role_change trigger keeps blocking self-promotion).
--
-- Token handling: only a SHA-256 hash is stored — the raw token exists once,
-- inside the invite email. Single-use (accepted_at) and expiring.
-- ============================================================================

create table staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role user_role not null check (role in ('admin','dispatcher')),
  token_hash text not null unique,   -- sha256 hex; never the raw token
  invited_by uuid not null references profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_staff_invites_email on staff_invites (lower(email));

alter table staff_invites enable row level security;

-- Staff can SEE pending/accepted invites (admin UI list); all writes happen
-- via the service role inside the admin-gated server actions — end-user
-- sessions (staff included) never insert/update/delete invite rows directly.
create policy "staff read invites" on staff_invites
  for select using (is_staff());
