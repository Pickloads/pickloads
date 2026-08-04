-- ============================================================================
-- PickLoads — Migration 0010: carrier portal completion columns (M-55).
--
-- Additive only (0001–0009 frozen). Decision D5 (docs/UPGRADE-AUDIT.md §10):
-- carriers self-serve their dispatch PREFERENCES (lanes / home time) while
-- regulated fields (MC/DOT/EIN/insurance/factoring) stay staff-verified via
-- the change-request flow. Dispatcher↔carrier assignment (audit §4 "Admin:
-- assign dispatchers") gets its column now so the carrier overview can show
-- the assigned dispatcher honestly; the admin assignment UI lands in the
-- admin account-management module (M-58).
-- ============================================================================

alter table carriers
  add column preferred_lanes text,
  add column home_time_notes text,
  add column assigned_dispatcher_id uuid references profiles(id);

comment on column carriers.preferred_lanes is
  'Self-serve dispatch preference (D5) — free text, e.g. "Midwest → Southeast, no NYC".';
comment on column carriers.home_time_notes is
  'Self-serve dispatch preference (D5) — free text, e.g. "Home weekends, based in Charlotte".';
comment on column carriers.assigned_dispatcher_id is
  'Staff-assigned dispatcher (M-58 admin UI writes it; carrier overview reads it).';

create index idx_carriers_assigned_dispatcher
  on carriers (assigned_dispatcher_id)
  where assigned_dispatcher_id is not null;

-- No RLS changes: carriers already has member/staff read policies (0002/0009).
-- The preference columns are WRITTEN only by server actions (service role
-- after a server-side membership check) — no member update policy is added,
-- so a compromised session token still cannot touch MC/DOT/EIN/fee columns.
