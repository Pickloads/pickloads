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
  ('stats',                '{"fee":"5%","avg_rate":null,"support":"24/7","states":"48"}', 'Home stats tiles; null values render as hidden until real figures exist'),
  ('packet_downloads_live','false',                              'Carrier packet download buttons — off until lawyer-approved PDFs are uploaded'),
  ('load_ticker_mode',     '"sample"',                           'Home load board ticker: sample | live (Phase 3)')
on conflict (key) do nothing;
