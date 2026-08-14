-- ============================================================================
-- PickLoads — Migration 0031: signature requests (M-92, SignWell send side).
--
-- Two things, both minimal:
--   1. `signature_requests` — there was no signature-request architecture at
--      all. The provider's document id and its lifecycle had nowhere to live,
--      so "has this carrier already been sent an agreement?" was unanswerable
--      and every send was a fresh document.
--   2. Five columns on `carriers` that the agreement template needs and the
--      schema did not have.
--
-- Doctrine unchanged from 0002/0009: NO anon policies. Writes happen in server
-- actions with the service role after authorization; RLS is defense in depth
-- for authenticated portal reads.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Carrier fields the dispatch agreement needs
-- ---------------------------------------------------------------------------
--
-- THERE IS DELIBERATELY NO `mailing_state` COLUMN. An earlier draft added one
-- on the reasoning that a mailing address is not an operating address. True in
-- principle, wrong here: `home_state` already exists, is collected at
-- onboarding step 1, and is the only state this system has. A second state
-- column would be a duplicate that nothing ever writes, and the agreement's
-- `carrier_state` field would read a permanently-null column with a fallback.
-- It reads `home_state` directly instead.
--
-- Street, city and ZIP are genuinely new. Audited across every migration: the
-- only `city`/`state` columns in the schema belong to SHIPMENT STOPS
-- (0019 shipment_events, 0027 shipment_locations) — freight geography, not a
-- carrier's mailing address. Mapping those would be a category error.
--
-- Every column is nullable. An agreement can be sent with gaps; SignWell
-- leaves the field for the signer to complete, and NOT NULL would break every
-- existing carrier row.

alter table carriers
  add column dba text,
  add column rep_title text,
  add column address_line1 text,
  add column city text,
  add column postal_code text;

comment on column carriers.dba is
  'M-92: "doing business as" name for the dispatch agreement. Distinct from company_name (the legal entity).';
comment on column carriers.rep_title is
  'M-92: title of the authorized representative who signs (e.g. "Owner", "President"). The NAME comes from the owner membership profile, not from here — one source of truth for a person.';

-- ---------------------------------------------------------------------------
-- 2. Signature request lifecycle
-- ---------------------------------------------------------------------------
--
-- `not_sent` is deliberately ABSENT from this enum. The absence of a row is
-- what "not sent" means; encoding it as a status would create two ways to say
-- the same thing and a race between them.

create type signature_request_status as enum (
  'sent',
  'viewed',
  'carrier_signed',
  'awaiting_countersignature',
  'completed',
  'declined',
  'expired'
);

create table signature_requests (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  provider text not null default 'signwell',
  -- The provider's document id. Nullable for exactly as long as it takes the
  -- API call to return: the row is written AFTER a successful create, so in
  -- practice it is always set. Kept not-null to make that a schema fact.
  provider_document_id text not null,
  agreement_type text not null default 'dispatch_agreement',
  status signature_request_status not null default 'sent',
  -- Whether the provider treated this as a test document. Recorded so a
  -- test-mode agreement can never be mistaken for an executed one.
  test_mode boolean not null default false,
  sent_by uuid references profiles(id),
  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  carrier_signed_at timestamptz,
  completed_at timestamptz,
  declined_at timestamptz,
  expired_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint signature_requests_provider_document_unique
    unique (provider, provider_document_id)
);

create trigger trg_signature_requests_updated_at
  before update on signature_requests
  for each row execute function set_updated_at();

create index idx_signature_requests_carrier
  on signature_requests (carrier_id, created_at desc);

-- ── THE DUPLICATE-SEND GUARANTEE ───────────────────────────────────────────
--
-- Requirement: "if there is already an active SignWell request for the same
-- carrier and agreement type, return that request instead of creating
-- another."
--
-- A SELECT-then-INSERT in the action cannot promise that. Two clicks 50ms
-- apart — or a double-submit, or a retry — both read "no active request" and
-- both create a SignWell document. The carrier gets two agreements and only
-- one of them is tracked.
--
-- This partial unique index makes the database refuse the second row. The
-- action still checks first (so the normal path returns the existing request
-- rather than raising), but correctness does not depend on that check winning
-- a race. Terminal states are excluded from the index so a declined or expired
-- request can legitimately be superseded.
create unique index signature_requests_one_active_per_carrier
  on signature_requests (carrier_id, agreement_type)
  where status in (
    'sent', 'viewed', 'carrier_signed', 'awaiting_countersignature'
  );

comment on index signature_requests_one_active_per_carrier is
  'M-92: at most one in-flight agreement per carrier per type. Enforced here rather than in the action so a concurrent double-send cannot create two SignWell documents.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table signature_requests enable row level security;

-- Staff see and manage everything.
create policy "staff manage signature requests" on signature_requests
  for all using (is_staff());

-- A carrier member reads their own carrier's requests. READ ONLY: the row is
-- written by the server action (service role) after it has authorized the
-- caller, so there is no INSERT/UPDATE policy for `authenticated` at all.
-- Without one, RLS denies those verbs by default — which is the intent.
create policy "member read own signature requests" on signature_requests
  for select using (carrier_id in (select my_carrier_ids()));
