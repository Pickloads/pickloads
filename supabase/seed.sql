-- ============================================================================
-- PickLoads — Seed: company_settings defaults (arch §9 + audit F-13)
-- These keys drive the "PENDING" credential blocks, launch gates and feature
-- flags. The day the MC activates, an admin edits mc_number / usdot_number /
-- bond_status in the dashboard and the whole site updates.
-- ============================================================================

insert into company_settings (key, value, description) values
  ('mc_number',            '{"status":"pending","value":null}',  'FMCSA MC number — footer, compliance block, FAQ'),
  ('usdot_number',         '{"status":"pending","value":null}',  'USDOT number — footer, compliance block'),
  ('bond_status',          '{"status":"in_process","value":"BMC-84 $75K"}', 'Surety bond display state'),
  ('brokerage_active',     'false',                              'Gates shipper brokerage messaging ("Launching Soon" vs live)'),
  ('testimonials_visible', 'false',                              'V4 sample testimonials stay hidden until 5+ verified reviews exist'),
  -- Owner decisions A1/C (2026-08-12): this row is not read by src/ — the
  -- tiles render from src/lib/pricing.ts and the v4 catalogue — but it is
  -- editable in the admin settings screen, where a stale "24/7" reads as
  -- current business configuration and is exactly how a retired claim gets
  -- copied back onto a page. Values corrected to the approved model.
  ('stats',                '{"fee":"5% owner-operator","avg_rate":null,"support":"7 days","states":"48 contiguous"}', 'Home stats tiles (display reference only — src/lib/pricing.ts is the pricing source of truth); null values render as hidden until real figures exist'),
  ('packet_downloads_live','false',                              'Carrier packet download buttons — off until lawyer-approved PDFs are uploaded'),
  ('load_ticker_mode',     '"sample"',                           'Home load board ticker: sample | live (Phase 3)'),
  ('shipper_signup_enabled','true',                              'Decision D1: public shipper self-signup (quote-request wording only, no brokerage claims). Legal can flip off without a deploy.'),
  ('referral_program_active','false',                            'M-69/P-2: gates the CtaBand referral-bonus line sitewide. Approved V4 copy stays in the codebase and the 5 i18n catalogues; it renders only when this is true. Flip to true the day the referral programme (directive §32 J) actually pays out.'),
  ('location_retention_days','90',                               'M-80/§9: days of shipment location history to keep. The daily cron DELETES readings older than this (purge_expired_shipment_locations). Integer 1–3650; unreadable or out of range falls back to 90 — never to "keep forever".')
on conflict (key) do nothing;
