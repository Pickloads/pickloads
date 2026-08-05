-- ============================================================================
-- PickLoads — Migration 0015: `referral_program_active` switchboard key
--                             (M-69 / P-2).
--
-- WHY: src/components/sections/CtaBand.tsx renders
--   "// Refer a carrier who signs up → earn a referral bonus."
-- on the home page, every /blog/[slug], all 8 /dispatch/[equipment] pages,
-- /truck-dispatch, the 6 state pages — × 5 locales. No referral programme
-- exists (§32 J / M-95 is unbuilt), so today that is a live promise the
-- company cannot honour.
--
-- The standing design boundary forbids changing approved marketing language
-- without owner approval, so the string is NOT deleted: it stays in
-- CtaBand.tsx and in all five i18n catalogues, and renders only when this
-- flag is true. The promise stops today; it returns with one setting flip on
-- the day the referral programme ships. Same pattern as brokerage_active /
-- shipper_signup_enabled / packet_downloads_live (arch §9, audit F-13).
--
-- Idempotent upsert: `company_settings` is key/value, so a new key is data,
-- not DDL. `on conflict (key) do nothing` means re-running this migration —
-- or running it after supabase/seed.sql already inserted the key on a fresh
-- database — never clobbers an operator's chosen value.
--
-- supabase/seed.sql carries the same row for fresh installs.
--
-- ROLLBACK:
--   delete from company_settings where key = 'referral_program_active';
--   Safe: the accessor (src/lib/company-settings.ts) treats a MISSING key as
--   false — the fail-closed default for every promise-bearing flag — so
--   deleting the row simply keeps the referral line hidden. Nothing errors.
-- ============================================================================

insert into company_settings (key, value, description) values
  ('referral_program_active', 'false',
   'M-69/P-2: gates the CtaBand referral-bonus line sitewide. Approved V4 copy stays in the codebase and the 5 i18n catalogues; it renders only when this is true. Flip to true the day the referral programme (directive §32 J) actually pays out.')
on conflict (key) do nothing;
