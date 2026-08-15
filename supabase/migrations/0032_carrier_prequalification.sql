-- ============================================================================
-- PickLoads — Migration 0032: carrier pre-qualification (M-93).
--
-- Three tables, and deliberately not more. `documents`, `signature_requests`,
-- `audit_events` and the `carrier-docs` bucket already model everything else
-- the lifecycle needs; duplicating them would create two answers to
-- "is this document approved?".
--
-- ── WHY A PRE-REGISTRATION EXISTS AT ALL ───────────────────────────────────
--
-- Today `startOnboarding` inserts an unclaimed `carriers` row the moment
-- someone types a company name — before any verification, before payment.
-- That makes `carriers` a table of strangers, and it makes "has this carrier
-- been verified?" unanswerable because the row exists either way.
--
-- A pre-registration is the applicant BEFORE they are a carrier. It expires,
-- it has no auth user, and it is the only thing that can be paid for. A
-- `carriers` row is created once, at account creation, bound to the
-- pre-registration that was actually verified and actually paid.
--
-- ── RLS DOCTRINE ───────────────────────────────────────────────────────────
--
-- Staff-only, on all three. There is NO anon policy and NO authenticated
-- policy, because an applicant is anonymous: they hold an opaque id and reach
-- their own record only through a server action running as the service role,
-- which checks that id and expiry. Phase 27's list — no client-written
-- verification decision, payment confirmation, risk tier, document approval or
-- activation eligibility — is satisfied structurally: `authenticated` has no
-- policy on these tables at all, so RLS denies every verb by default.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- `provider_unavailable` is a first-class outcome, not an error. Phase 20:
-- FMCSA unreachable must never collapse into either VERIFIED or NOT_VERIFIED.
create type carrier_verification_status as enum (
  'pending',
  'verified',
  'manual_review',
  'not_verified',
  'provider_unavailable'
);

create type carrier_risk_tier as enum ('low', 'medium', 'high', 'manual_review');

create type prequal_decision as enum (
  'eligible_to_continue',
  'manual_review',
  'not_eligible'
);

create type onboarding_payment_status as enum (
  'unpaid',
  'session_created',
  'paid',
  'failed',
  'refunded'
);

-- How an entered value compared with what the authority source returned.
-- `unavailable` is distinct from `mismatch`: not knowing is not disagreeing.
create type identity_match_result as enum (
  'exact',
  'normalized',
  'mismatch',
  'unavailable'
);

-- ---------------------------------------------------------------------------
-- 1. Pre-registrations
-- ---------------------------------------------------------------------------

create table carrier_pre_registrations (
  -- Opaque and unguessable. This id is the applicant's only credential
  -- between the pre-check and account creation, so it is a random UUID and
  -- never a sequence. Phase 1: no sequential public ids, no enumeration.
  id uuid primary key default gen_random_uuid(),

  -- What the applicant TYPED. Never overwritten with provider data — the
  -- comparison between the two is the whole point of identity matching, and
  -- silently correcting the entered value would destroy the evidence.
  legal_name_entered text not null,
  usdot_number_entered text not null,
  mc_number_entered text,
  email text not null,
  phone text,
  locale text not null default 'en',

  verification_status carrier_verification_status not null default 'pending',
  risk_tier carrier_risk_tier,
  decision prequal_decision,
  manual_review_required boolean not null default false,

  -- Explainability (Phase 4). Machine-readable codes only — never prose, and
  -- never the full rule set, which is not shown to the applicant.
  reason_codes text[] not null default '{}',

  payment_status onboarding_payment_status not null default 'unpaid',

  -- Set once, at account creation. Its presence means this pre-registration
  -- has been spent and cannot be reused by another applicant (Phase 10).
  claimed_carrier_id uuid references carriers(id) on delete set null,
  claimed_at timestamptz,

  -- Phase 1 requires expiry. A verification is a point-in-time statement
  -- about an authority that can be revoked tomorrow.
  expires_at timestamptz not null default (now() + interval '30 days'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pre_registration_claim_is_atomic
    check ((claimed_carrier_id is null) = (claimed_at is null))
);

create trigger trg_carrier_pre_registrations_updated_at
  before update on carrier_pre_registrations
  for each row execute function set_updated_at();

-- Staff queue reads: newest first, filtered by decision.
create index idx_pre_registrations_review
  on carrier_pre_registrations (decision, created_at desc);

-- A carrier row may be claimed by exactly one pre-registration. Without this,
-- two paid applicants could both bind to the same carrier.
create unique index pre_registrations_one_claim_per_carrier
  on carrier_pre_registrations (claimed_carrier_id)
  where claimed_carrier_id is not null;

comment on table carrier_pre_registrations is
  'M-93: an applicant BEFORE they are a carrier. Expires; has no auth user; the only thing that can be paid for.';
comment on column carrier_pre_registrations.legal_name_entered is
  'M-93: what the applicant typed. NEVER overwritten with provider data — the entered-vs-returned comparison is the evidence.';

-- ---------------------------------------------------------------------------
-- 2. Authority verifications
-- ---------------------------------------------------------------------------

create table carrier_verifications (
  id uuid primary key default gen_random_uuid(),

  -- Exactly one of these is set: a pre-check verification, or a periodic
  -- re-verification of an existing carrier (Phase 19).
  pre_registration_id uuid
    references carrier_pre_registrations(id) on delete cascade,
  carrier_id uuid references carriers(id) on delete cascade,

  provider text not null default 'fmcsa_qcmobile',
  -- The authority's own identifier for the record — USDOT as returned.
  provider_record_id text,

  status carrier_verification_status not null,

  -- Normalized provider output. Nullable throughout: `provider_unavailable`
  -- means we know nothing, and a zero here would be a lie.
  legal_name text,
  dba_name text,
  usdot_number text,
  mc_number text,
  allowed_to_operate boolean,
  out_of_service boolean,
  out_of_service_date date,

  -- ── NO INSURANCE COLUMNS, ON PURPOSE ────────────────────────────────────
  --
  -- CORRECTED 2026-08-15. This comment previously said QCMobile exposes no
  -- insurance data. It does — the live response carries bipd/cargo/bond
  -- on-file, required and required-amount indicators. FMCSA's published
  -- element list is incomplete, and the earlier claim was taken from it.
  --
  -- The columns still do not exist, now for a better reason than absence of
  -- data. Those indicators describe a FEDERAL FILING. PickLoads insurance
  -- compliance is judged from the uploaded COI and carriers.insurance_expiry,
  -- and nothing in the activation gate reads a filing. A persisted
  -- fmcsa_insurance_ok column would sit beside the COI status inviting exactly
  -- the merge Phase 14 forbids — and a null in it would be unreadable: "we
  -- never checked" and "they have nothing on file" look identical.
  --
  -- The indicators ARE normalized, as FmcsaInsuranceIndicators in
  -- src/lib/carrier-authority/provider.ts, for the staff compliance view.
  -- They are not stored, and no rule consumes them.

  name_match identity_match_result,
  mc_match identity_match_result,
  dot_match identity_match_result,

  -- Phase 2/21: the raw payload is NOT stored. A digest is enough to prove
  -- two checks saw the same upstream record, and it cannot leak an address,
  -- a phone number or anything else we did not decide to keep.
  raw_response_sha256 text,

  checked_at timestamptz not null default now(),
  -- The provider's own `retrievalDate` — source freshness, distinct from
  -- when WE asked.
  source_retrieved_at timestamptz,
  next_verification_at timestamptz,

  created_at timestamptz not null default now(),

  constraint verification_targets_exactly_one
    check (
      (pre_registration_id is not null and carrier_id is null)
      or (pre_registration_id is null and carrier_id is not null)
    )
);

create index idx_verifications_pre_registration
  on carrier_verifications (pre_registration_id, checked_at desc);
create index idx_verifications_carrier
  on carrier_verifications (carrier_id, checked_at desc);
-- Phase 19: the daily cron asks "what is due?".
create index idx_verifications_due
  on carrier_verifications (next_verification_at)
  where next_verification_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Onboarding payments
-- ---------------------------------------------------------------------------

create table carrier_onboarding_payments (
  id uuid primary key default gen_random_uuid(),
  pre_registration_id uuid not null
    references carrier_pre_registrations(id) on delete cascade,

  provider text not null default 'stripe',
  provider_session_id text,
  provider_payment_intent_id text,

  -- Recorded from the SERVER-side price, never from the browser (Phase 9).
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',

  status onboarding_payment_status not null default 'session_created',
  -- Stripe test mode. A test payment must never be mistaken for revenue.
  test_mode boolean not null default true,

  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint onboarding_payments_session_unique
    unique (provider, provider_session_id)
);

create trigger trg_carrier_onboarding_payments_updated_at
  before update on carrier_onboarding_payments
  for each row execute function set_updated_at();

-- ── DUPLICATE-PAYMENT PROTECTION ───────────────────────────────────────────
-- At most one PAID row per applicant. A double-submitted Checkout, a replayed
-- webhook that slipped past event-level idempotency, or two sessions opened in
-- two tabs cannot produce two captured fees for one onboarding.
create unique index onboarding_payments_one_paid_per_pre_registration
  on carrier_onboarding_payments (pre_registration_id)
  where status = 'paid';

comment on index onboarding_payments_one_paid_per_pre_registration is
  'M-93 Phase 9: duplicate-payment protection at the database, not in the handler — a webhook that arrives twice cannot charge twice.';

-- ---------------------------------------------------------------------------
-- 4. RLS — staff only
-- ---------------------------------------------------------------------------

alter table carrier_pre_registrations   enable row level security;
alter table carrier_verifications       enable row level security;
alter table carrier_onboarding_payments enable row level security;

create policy "staff manage pre registrations" on carrier_pre_registrations
  for all using (is_staff());
create policy "staff manage carrier verifications" on carrier_verifications
  for all using (is_staff());
create policy "staff manage onboarding payments" on carrier_onboarding_payments
  for all using (is_staff());

-- No `authenticated` policy is defined on any of the three, and that is the
-- control rather than an omission: with RLS enabled and no matching policy,
-- Postgres denies. A signed-in carrier cannot read another applicant's
-- verification, cannot write their own risk tier, and cannot mark themselves
-- paid — there is no policy under which any of those statements could match.
