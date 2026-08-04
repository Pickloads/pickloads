-- ============================================================================
-- PickLoads — Migration 0011: remaining directive quote fields (M-56).
--
-- 0008 added addresses/hazmat/temp/dims; the M-56 professional in-portal
-- quote form also needs facility company names, a delivery deadline, special
-- instructions and a contact name. Additive only; no RLS changes (the portal
-- quote insert runs through the server action's service role with a verified
-- membership, and "member read own quotes" / staff policies already cover
-- reads).
-- ============================================================================

alter table freight_quotes
  add column pickup_company text,
  add column delivery_company text,
  add column delivery_deadline date,
  add column special_instructions text,
  add column contact_name text;

comment on column freight_quotes.pickup_company is
  'M-56 portal quote form: pickup facility/company name.';
comment on column freight_quotes.delivery_company is
  'M-56 portal quote form: delivery facility/company name.';
comment on column freight_quotes.delivery_deadline is
  'M-56 portal quote form: latest acceptable delivery date.';
comment on column freight_quotes.special_instructions is
  'M-56 portal quote form: free text (app-capped at 1000 chars).';
comment on column freight_quotes.contact_name is
  'M-56 portal quote form: who to call about this shipment.';
