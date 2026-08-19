-- ============================================================================
-- PickLoads — Migration 0033: who reviewed a pre-registration, and when (M-94).
--
-- ── WHY THIS IS NOT JUST AN AUDIT ROW ──────────────────────────────────────
--
-- `audit_events` already records that a staff member resolved a manual review,
-- and it remains the authority on WHAT HAPPENED. But a review QUEUE has to
-- answer a different question, on every row, at a glance: *has anyone picked
-- this up, who was it, and what did they say?* Answering that from a ledger
-- means a join against a jsonb `detail` column for every row on the page, and
-- it means two dispatchers can spend an afternoon working the same applicant
-- because neither can see the other did.
--
-- So the outcome lives on the row and the ledger keeps the history. Neither
-- replaces the other: `review_note` is the current explanation, `audit_events`
-- is every explanation ever given.
--
-- ── WHAT THESE COLUMNS DELIBERATELY DO NOT DO ──────────────────────────────
--
-- They do not activate anything. `carriers.active` is not written by this
-- migration, by the staff UI, or by any code path M-94 adds. A staff review
-- resolves a PRE-REGISTRATION — it decides whether an applicant may continue
-- to the fee and the documents — and `evaluateActivationEligibility()` still
-- has to be satisfied in full afterwards. There is no override column here and
-- there is not meant to be one: an override belongs at the approval step, with
-- an actor and a reason, not as a flag that silently changes what the rules
-- are.
--
-- Note also what is NOT reset: `verification_status`. That column is the
-- PROVIDER's statement about the carrier, and a human clearing an applicant
-- after an FMCSA outage has not made FMCSA answer. Keeping the two separate is
-- what lets a later activation gate tell "FMCSA verified this" apart from "a
-- dispatcher decided it was fine", which are not the same fact.
-- ============================================================================

alter table carrier_pre_registrations
  -- Nullable: the overwhelming majority of pre-registrations are decided by
  -- the engine and never touched by a person.
  add column reviewed_by uuid references profiles(id),
  add column reviewed_at timestamptz,
  -- Required BY THE ACTION, not by the column: a decision with no reason is
  -- not a review. It is nullable here because rows that predate a review have
  -- no note, and a NOT NULL would have to be filled with a lie.
  add column review_note text;

-- A review is a single event: an actor and a time, or neither. A row stamped
-- with a reviewer but no timestamp (or the reverse) is a half-written review
-- and there is no reading of it that is useful.
alter table carrier_pre_registrations
  add constraint pre_registration_review_is_whole
    check ((reviewed_by is null) = (reviewed_at is null));

-- The queue's own query: open manual reviews, newest first. Partial, because
-- the queue is a small slice of the table and will stay that way — the
-- engine's whole purpose is that most applicants never appear here.
create index idx_pre_registrations_open_review
  on carrier_pre_registrations (created_at desc)
  where decision = 'manual_review' and claimed_carrier_id is null;

comment on column carrier_pre_registrations.reviewed_by is
  'M-94: the staff member who resolved a manual review. Never an applicant — the table has no authenticated policy, so only staff or the service role can write it.';
comment on column carrier_pre_registrations.review_note is
  'M-94: why the reviewer decided what they decided. Operational text, shown only to staff.';

-- ── NO NEW POLICY ──────────────────────────────────────────────────────────
--
-- 0032's "staff manage pre registrations" is `for all using (is_staff())` and
-- covers every column, including these three. Adding a policy here would mean
-- two rules governing one table, which is how a table ends up with two
-- different answers about who may write it.
