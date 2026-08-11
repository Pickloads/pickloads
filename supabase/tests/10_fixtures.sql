-- ============================================================================
-- PickLoads — RLS test fixtures (M-61).
--
-- Two competing tenants on each side of the marketplace plus staff and an
-- unaffiliated authenticated user. Loaded as the table OWNER (postgres), so
-- RLS does not apply here — every policy assertion in 20_rls_isolation.sql
-- runs afterwards under `set role authenticated|anon` with a JWT subject.
--
-- Identity map
--   ...00a1  carrier A owner        ...00a2  carrier A member (non-owner)
--   ...00b1  carrier B owner        ...00d1  authenticated outsider (no membership)
--   ...00c1  shipper A owner        ...00c2  shipper B owner
--   ...00e1  dispatcher (staff)     ...00f1  admin (staff)
-- ============================================================================

-- ---------- auth users (profiles are auto-created by 0003's trigger) --------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ownerA@carrier-a.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'memberA@carrier-a.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'ownerB@carrier-b.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ownerA@shipper-a.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ownerB@shipper-b.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'nobody@outsider.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'dispatcher@pickloads.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'admin@pickloads.test');

update profiles set role = 'carrier', full_name = 'Owner A'
  where id in ('00000000-0000-0000-0000-0000000000a1',
               '00000000-0000-0000-0000-0000000000a2',
               '00000000-0000-0000-0000-0000000000b1',
               '00000000-0000-0000-0000-0000000000d1');
update profiles set role = 'shipper'
  where id in ('00000000-0000-0000-0000-0000000000c1',
               '00000000-0000-0000-0000-0000000000c2');
update profiles set role = 'dispatcher' where id = '00000000-0000-0000-0000-0000000000e1';
update profiles set role = 'admin'      where id = '00000000-0000-0000-0000-0000000000f1';

-- ---------- carrier companies + memberships --------------------------------
insert into carriers (id, profile_id, company_name, mc_number, ein, dispatch_fee_pct, active) values
  ('11111111-1111-1111-1111-11111111aaaa', '00000000-0000-0000-0000-0000000000a1',
   'Carrier A LLC', 'MC-100001', 'enc:AAAA', 5.0, true),
  ('11111111-1111-1111-1111-11111111bbbb', '00000000-0000-0000-0000-0000000000b1',
   'Carrier B LLC', 'MC-100002', 'enc:BBBB', 8.0, true);
-- Memberships are the authoritative join (M-57 doctrine). Owners are written
-- by the signup/claim path; carrier A additionally has a NON-OWNER member so
-- the helper's scope can be proved for both membership roles.
insert into carrier_memberships (carrier_id, profile_id, role) values
  ('11111111-1111-1111-1111-11111111aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('11111111-1111-1111-1111-11111111aaaa', '00000000-0000-0000-0000-0000000000a2', 'member'),
  ('11111111-1111-1111-1111-11111111bbbb', '00000000-0000-0000-0000-0000000000b1', 'owner')
on conflict do nothing;

-- ---------- shipper companies + memberships --------------------------------
insert into shippers (id, company_name, industry) values
  ('22222222-2222-2222-2222-2222222aaaaa', 'Shipper A Inc', 'retail'),
  ('22222222-2222-2222-2222-2222222bbbbb', 'Shipper B Inc', 'manufacturing');
insert into shipper_memberships (shipper_id, profile_id, role) values
  ('22222222-2222-2222-2222-2222222aaaaa', '00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('22222222-2222-2222-2222-2222222bbbbb', '00000000-0000-0000-0000-0000000000c2', 'owner');

-- ---------- documents (private-bucket metadata; PII-adjacent) --------------
insert into documents (id, carrier_id, type, storage_path, file_name, uploaded_by, status) values
  ('33333333-3333-3333-3333-33333333aaaa', '11111111-1111-1111-1111-11111111aaaa',
   'w9', '11111111-1111-1111-1111-11111111aaaa/w9-a.pdf', 'w9-a.pdf',
   '00000000-0000-0000-0000-0000000000a1', 'pending'),
  ('33333333-3333-3333-3333-33333333bbbb', '11111111-1111-1111-1111-11111111bbbb',
   'w9', '11111111-1111-1111-1111-11111111bbbb/w9-b.pdf', 'w9-b.pdf',
   '00000000-0000-0000-0000-0000000000b1', 'pending');

-- ---------- loads (fee snapshot trigger fires here) ------------------------
insert into loads (id, carrier_id, broker_name, origin_city, origin_state,
                   dest_city, dest_state, gross_rate, status) values
  ('44444444-4444-4444-4444-44444444aaaa', '11111111-1111-1111-1111-11111111aaaa',
   'Broker A', 'Newark', 'NJ', 'Atlanta', 'GA', 2000, 'booked'),
  ('44444444-4444-4444-4444-44444444bbbb', '11111111-1111-1111-1111-11111111bbbb',
   'Broker B', 'Chicago', 'IL', 'Dallas', 'TX', 2000, 'booked');

-- ---------- fleet ----------------------------------------------------------
insert into trucks (id, carrier_id, unit_number, equipment) values
  ('55555555-5555-5555-5555-55555555aaaa', '11111111-1111-1111-1111-11111111aaaa', 'A-1', 'dry-van'),
  ('55555555-5555-5555-5555-55555555bbbb', '11111111-1111-1111-1111-11111111bbbb', 'B-1', 'reefer');
insert into drivers (id, carrier_id, full_name, cdl_number) values
  ('66666666-6666-6666-6666-66666666aaaa', '11111111-1111-1111-1111-11111111aaaa', 'Driver A', 'CDL-A-1'),
  ('66666666-6666-6666-6666-66666666bbbb', '11111111-1111-1111-1111-11111111bbbb', 'Driver B', 'CDL-B-1');

-- ---------- invoices -------------------------------------------------------
insert into invoices (id, carrier_id, load_id, stripe_invoice_id, amount_cents, status) values
  ('77777777-7777-7777-7777-77777777aaaa', '11111111-1111-1111-1111-11111111aaaa',
   '44444444-4444-4444-4444-44444444aaaa', 'in_test_a', 10000, 'open'),
  ('77777777-7777-7777-7777-77777777bbbb', '11111111-1111-1111-1111-11111111bbbb',
   '44444444-4444-4444-4444-44444444bbbb', 'in_test_b', 16000, 'open');

-- ---------- support threads + messages -------------------------------------
insert into support_threads (id, profile_id, carrier_id, subject, status) values
  ('88888888-8888-8888-8888-88888888aaaa', '00000000-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-11111111aaaa', 'Carrier A question', 'open'),
  ('88888888-8888-8888-8888-88888888bbbb', '00000000-0000-0000-0000-0000000000b1',
   '11111111-1111-1111-1111-11111111bbbb', 'Carrier B question', 'open');
insert into support_messages (id, thread_id, author_id, body, is_staff) values
  ('99999999-9999-9999-9999-99999999aaaa', '88888888-8888-8888-8888-88888888aaaa',
   '00000000-0000-0000-0000-0000000000a1', 'Carrier A private message', false),
  ('99999999-9999-9999-9999-99999999bbbb', '88888888-8888-8888-8888-88888888bbbb',
   '00000000-0000-0000-0000-0000000000b1', 'Carrier B private message', false);

-- ---------- notifications --------------------------------------------------
insert into notifications (id, profile_id, kind, title) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0a01', '00000000-0000-0000-0000-0000000000a1',
   'document_reviewed', 'Notification for A'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0b01', '00000000-0000-0000-0000-0000000000b1',
   'document_reviewed', 'Notification for B');

-- ---------- freight quotes (two owned + one unclaimed public submission) ----
insert into freight_quotes (id, shipper_id, email, pickup_zip, delivery_zip, commodity) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0a01', '22222222-2222-2222-2222-2222222aaaaa',
   'ownerA@shipper-a.test', '07111', '30301', 'Shipper A freight'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0b01', '22222222-2222-2222-2222-2222222bbbbb',
   'ownerB@shipper-b.test', '60601', '75201', 'Shipper B freight'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001', null,
   'walkin@public.test', '10001', '90001', 'Unclaimed public quote');

-- ---------- staff-only ledgers ---------------------------------------------
insert into carrier_leads (id, phone, full_name, email) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0001', '9084045373', 'Lead One', 'lead1@example.test');
insert into contact_messages (id, full_name, email, body) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0002', 'Contact One', 'contact1@example.test', 'Hello');
insert into subscribers (id, email) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0003', 'sub1@example.test');
insert into email_log (id, to_email, template, subject) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0004', 'lead1@example.test', 'welcome', 'Welcome');
insert into webhook_events (id, provider, event_id, event_type, payload) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0005', 'stripe', 'evt_test_1', 'invoice_created', '{}'::jsonb);
insert into audit_events (id, actor_id, action, target_table, target_id) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0006', '00000000-0000-0000-0000-0000000000f1',
   'user.suspend', 'profiles', '00000000-0000-0000-0000-0000000000b1');
insert into account_status_history (id, profile_id, old_status, new_status, changed_by) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0007', '00000000-0000-0000-0000-0000000000b1',
   'active', 'suspended', '00000000-0000-0000-0000-0000000000f1');
insert into staff_invites (id, email, role, token_hash, invited_by, expires_at) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0008', 'newstaff@pickloads.test', 'dispatcher',
   'sha256-placeholder-hash', '00000000-0000-0000-0000-0000000000f1', now() + interval '7 days');
insert into user_preferences (profile_id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b1');
insert into lead_activities (id, lead_id, type, body, created_by) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0009', 'cccccccc-cccc-cccc-cccc-cccccccc0001',
   'note', 'Internal CRM note', '00000000-0000-0000-0000-0000000000e1');

-- ---------- posts (public read is INTENTIONAL for published rows only) ------
insert into posts (id, slug, locale, title, body_md, published, published_at) values
  ('dddddddd-dddd-dddd-dddd-dddddddd0001', 'published-post', 'en', 'Published', '# hi', true, now()),
  ('dddddddd-dddd-dddd-dddd-dddddddd0002', 'draft-post', 'en', 'Draft', '# wip', false, null);

-- ===========================================================================
-- M-71 — shipment schema fixtures (migrations 0017–0018)
--
-- Adds a THIRD axis to the two-tenant model: broker organizations. Identity
-- map extension
--   ...00ab01  broker A owner        ...00ab02  broker B owner
--   ...00ab03  member of broker C, which an admin has NOT activated
--
-- NOTE ON PROFILE ROLES. Broker access is ORGANIZATION-scoped, never
-- role-scoped: §12 calls it "optional role or organization type", and every
-- policy in 0018 keys off `broker_partner_memberships` + `broker_partners.
-- active`, never off `profiles.role`. `user_role` (0001, frozen) is therefore
-- deliberately NOT extended with a 'broker' value — doing so would break
-- every exhaustive `Record<UserRole, …>` in the codebase for zero security
-- gain. These fixtures leave the broker users on the enum's default role to
-- make that concrete: their profile role is immaterial and the assertions
-- below still hold.
-- ===========================================================================

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ab01', 'ownerA@broker-a.test'),
  ('00000000-0000-0000-0000-00000000ab02', 'ownerB@broker-b.test'),
  ('00000000-0000-0000-0000-00000000ab03', 'member@broker-c-inactive.test');

-- ---------- broker organizations -------------------------------------------
-- A and B are admin-approved (active). C is invited but NOT approved, which
-- is the §12 state my_broker_partner_ids() must treat as "no access".
insert into broker_partners (id, company_name, mc_number, active, approved_by, approved_at) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0a01', 'Broker A Partners', 'MC-200001', true,
   '00000000-0000-0000-0000-0000000000f1', now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0b01', 'Broker B Partners', 'MC-200002', true,
   '00000000-0000-0000-0000-0000000000f1', now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0c01', 'Broker C Unapproved', 'MC-200003', false, null, null);

insert into broker_partner_memberships (broker_partner_id, profile_id, role) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0a01', '00000000-0000-0000-0000-00000000ab01', 'owner'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0b01', '00000000-0000-0000-0000-00000000ab02', 'owner'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0c01', '00000000-0000-0000-0000-00000000ab03', 'owner');

-- ---------- shipments ------------------------------------------------------
-- The §2 gate (trg_shipments_brokerage_gate) refuses INSERT while
-- brokerage_active is false, and it refuses it for the table OWNER too — so
-- even this fixture load has to open the gate deliberately. It is closed
-- again immediately afterwards, both because `false` is the seeded launch
-- state every other assertion assumes and because 20_rls_isolation.sql proves
-- the closed gate rejects an insert.
update company_settings set value = 'true'::jsonb where key = 'brokerage_active';

insert into shipments (
  id, tracking_number, shipper_id, carrier_id, dispatcher_id, quote_id,
  broker_partner_id, load_id, status,
  origin_city, origin_state, destination_city, destination_state,
  equipment, gross_shipper_amount, carrier_pay, margin,
  public_tracking_enabled, tracking_mode, location_visibility, public_access_hash
) values
  ('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'PL-2026-000101',
   '22222222-2222-2222-2222-2222222aaaaa', '11111111-1111-1111-1111-11111111aaaa',
   '00000000-0000-0000-0000-0000000000e1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0a01',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeee0a01', '44444444-4444-4444-4444-44444444aaaa',
   'in_transit', 'Newark', 'NJ', 'Atlanta', 'GA', 'dry-van',
   2400, 2000, 400, true, 'manual', 'approximate', 'sha256-secondary-a'),
  ('ffffffff-ffff-ffff-ffff-ffffffff0b01', 'PL-2026-000202',
   '22222222-2222-2222-2222-2222222bbbbb', '11111111-1111-1111-1111-11111111bbbb',
   '00000000-0000-0000-0000-0000000000e1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0b01',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeee0b01', '44444444-4444-4444-4444-44444444bbbb',
   'picked_up', 'Chicago', 'IL', 'Dallas', 'TX', 'reefer',
   3100, 2600, 500, false, 'manual', 'hidden', 'sha256-secondary-b');

update company_settings set value = 'false'::jsonb where key = 'brokerage_active';

-- ---------- shipment parties ----------------------------------------------
-- Shipment A carries one shareable contact and one that is not: §12 lets a
-- broker partner see "approved contact channels" and nothing else, so the
-- pair is what makes that policy testable rather than trivially true.
insert into shipment_parties (id, shipment_id, party_role, organization_id,
                              company_name, contact_name, phone, email, public_contact) values
  ('fafafafa-fafa-fafa-fafa-fafafafa0a01', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'consignee', null, 'Atlanta DC', 'Receiving Desk', '4045550100',
   'dock@atlanta-dc.test', true),
  ('fafafafa-fafa-fafa-fafa-fafafafa0a02', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'shipper', '22222222-2222-2222-2222-2222222aaaaa', 'Shipper A Inc',
   'Private Buyer', '9735550100', 'buyer@shipper-a.test', false),
  ('fafafafa-fafa-fafa-fafa-fafafafa0b01', 'ffffffff-ffff-ffff-ffff-ffffffff0b01',
   'consignee', null, 'Dallas DC', 'Receiving Desk', '2145550100',
   'dock@dallas-dc.test', true);

-- ---------- shipment assignments -------------------------------------------
insert into shipment_assignments (id, shipment_id, carrier_id, driver_id, truck_id,
                                  dispatcher_id, assigned_by) values
  ('fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   '11111111-1111-1111-1111-11111111aaaa', '66666666-6666-6666-6666-66666666aaaa',
   '55555555-5555-5555-5555-55555555aaaa', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000e1'),
  ('fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0b01', 'ffffffff-ffff-ffff-ffff-ffffffff0b01',
   '11111111-1111-1111-1111-11111111bbbb', '66666666-6666-6666-6666-66666666bbbb',
   '55555555-5555-5555-5555-55555555bbbb', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000e1');

-- ===========================================================================
-- M-72 — shipment_events fixtures (migration 0019)
--
-- Five events on shipment A, ONE PER §7 VISIBILITY BAND. That shape is the
-- whole point: with a single event per shipment, "shipper A sees 1 row" would
-- be true whether the band filter worked or not. With all five present, every
-- audience assertion is a statement about the band list in its policy.
--
-- Shipment B carries a public and a staff_only event so the cross-tenant
-- assertions ("carrier A sees nothing of shipment B") are also non-vacuous.
--
-- Inserted directly, as the table owner: trg_shipment_events_append_only
-- refuses UPDATE and DELETE, never INSERT. The suite proves that separately.
-- ===========================================================================

insert into shipment_events (
  id, shipment_id, event_type, status, event_time, source, created_by,
  city, state, public_message, internal_message, visibility, metadata,
  external_event_id, idempotency_key
) values
  -- public — what an unauthenticated /track visitor may eventually see (M-73).
  ('ecececec-ecec-ecec-ecec-ecececec0a01', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'status_change', 'in_transit', now() - interval '6 hours', 'dispatcher',
   '00000000-0000-0000-0000-0000000000e1', 'Newark', 'NJ',
   'Picked up and on the way', null, 'public', '{}'::jsonb, null, null),

  -- shipper — the customer's own logistics.
  ('ecececec-ecec-ecec-ecec-ecececec0a02', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'appointment_rescheduled', null, now() - interval '5 hours', 'dispatcher',
   '00000000-0000-0000-0000-0000000000e1', null, null,
   'Delivery appointment moved to Thursday 09:00', null, 'shipper',
   '{"appointment_kind":"delivery"}'::jsonb, null, null),

  -- carrier — their own contractual correspondence, not the shipper's.
  ('ecececec-ecec-ecec-ecec-ecececec0a03', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'email_logged', null, now() - interval '4 hours', 'dispatcher',
   '00000000-0000-0000-0000-0000000000e1', null, null,
   null, 'Rate confirmation emailed to the carrier', 'carrier', '{}'::jsonb,
   null, null),

  -- broker — §12's "BOL, when authorized" band.
  ('ecececec-ecec-ecec-ecec-ecececec0a04', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'document_approved', null, now() - interval '3 hours', 'admin',
   '00000000-0000-0000-0000-0000000000f1', null, null,
   'BOL released to the broker partner', null, 'broker', '{}'::jsonb, null, null),

  -- staff_only — §7's absolute rule. Must reach NO customer audience.
  ('ecececec-ecec-ecec-ecec-ecececec0a05', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'internal_note', null, now() - interval '2 hours', 'dispatcher',
   '00000000-0000-0000-0000-0000000000e1', null, null,
   null, 'Margin is thin on this lane; do not re-quote below 2400', 'staff_only',
   '{"margin_note":true}'::jsonb, 'prov-evt-a-1', 'idem-a-1'),

  -- shipment B, for the cross-tenant assertions.
  ('ecececec-ecec-ecec-ecec-ecececec0b01', 'ffffffff-ffff-ffff-ffff-ffffffff0b01',
   'status_change', 'picked_up', now() - interval '8 hours', 'dispatcher',
   '00000000-0000-0000-0000-0000000000e1', 'Chicago', 'IL',
   'Loaded and rolling', null, 'public', '{}'::jsonb, null, null),
  ('ecececec-ecec-ecec-ecec-ecececec0b02', 'ffffffff-ffff-ffff-ffff-ffffffff0b01',
   'internal_note', null, now() - interval '7 hours', 'dispatcher',
   '00000000-0000-0000-0000-0000000000e1', null, null,
   null, 'Shipper B disputes detention on the last three loads', 'staff_only',
   '{}'::jsonb, null, null);

-- ===========================================================================
-- M-74 — shipper-facing invoices (migration 0021)
--
-- Two SHIPPER invoices, one per tenant, each linked to that tenant's
-- shipment. They exist alongside the two CARRIER invoices above, which is the
-- shape the assertions need: with only shipper invoices present, "shipper A
-- sees exactly 1 invoice" would be true whether the new policy scoped
-- correctly or simply returned everything a shipper is allowed to see.
--
-- `carrier_id` IS NULL on both, and that is the whole point. 0009's shipped
-- carrier policy is keyed on `carrier_id`, so a shipper invoice naming the
-- hauling carrier would be readable BY that carrier — handing them the
-- shipper gross and therefore PickLoads' margin. 0021 relaxed the NOT NULL to
-- `invoices_party_present` exactly so this row can exist without a carrier;
-- §10b asserts that carrier A, who hauled shipment A, still reads none of it.
-- ===========================================================================

insert into invoices (id, carrier_id, load_id, shipment_id, shipper_id,
                      stripe_invoice_id, amount_cents, status, issued_at, due_at) values
  ('7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0a01', null,
   null, 'ffffffff-ffff-ffff-ffff-ffffffff0a01', '22222222-2222-2222-2222-2222222aaaaa',
   'in_test_shipper_a', 240000, 'open', now() - interval '2 days', now() + interval '28 days'),
  ('7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0b01', null,
   null, 'ffffffff-ffff-ffff-ffff-ffffffff0b01', '22222222-2222-2222-2222-2222222bbbbb',
   'in_test_shipper_b', 310000, 'paid', now() - interval '9 days', now() + interval '21 days');

-- ===========================================================================
-- M-76 — driver update links (migration 0023)
--
-- FOUR links, and the shape is the point:
--
--   * shipment A gets THREE — one active, one revoked, one expired — so
--     "carrier A sees exactly 3" is a statement about the POLICY rather than
--     about the table, and so the lifecycle assertions have something to
--     distinguish;
--   * shipment B gets ONE, so every "carrier A sees nothing of B" assertion
--     is non-vacuous.
--
-- The hashes are literals in 0023's `v1:<64 hex>` format, which is all the
-- CHECK constraint requires. They are NOT hashes of any real token — there is
-- no token here at all, which is the fixture-level version of the guarantee
-- the migration makes: a driver link cannot be exercised from this file.
--
-- `expires_at > issued_at` is a CHECK, so the expired row backdates BOTH.
-- ===========================================================================

insert into shipment_driver_tokens (
  id, shipment_id, carrier_id, token_hash, driver_id, driver_name,
  issued_by, issued_by_role, issued_at, expires_at, revoked_at, revoked_by,
  revoke_reason, consent_status, consent_at, use_count
) values
  -- ACTIVE, consent granted.
  ('fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a01', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   '11111111-1111-1111-1111-11111111aaaa', 'v1:' || repeat('a', 64),
   '66666666-6666-6666-6666-66666666aaaa', 'Driver A One',
   '00000000-0000-0000-0000-0000000000e1', 'dispatcher',
   now() - interval '1 hour', now() + interval '23 hours',
   null, null, null, 'granted', now() - interval '50 minutes', 2),
  -- REVOKED (still inside its window — revocation outranks expiry).
  ('fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a02', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   '11111111-1111-1111-1111-11111111aaaa', 'v1:' || repeat('b', 64),
   null, 'Driver A Two',
   '00000000-0000-0000-0000-0000000000e1', 'carrier',
   now() - interval '2 hours', now() + interval '22 hours',
   now() - interval '90 minutes', '00000000-0000-0000-0000-0000000000e1',
   'wrong driver', 'pending', null, 0),
  -- EXPIRED.
  ('fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a03', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   '11111111-1111-1111-1111-11111111aaaa', 'v1:' || repeat('c', 64),
   null, 'Driver A Three',
   '00000000-0000-0000-0000-0000000000e1', 'dispatcher',
   now() - interval '3 days', now() - interval '2 days',
   null, null, null, 'denied', now() - interval '3 days', 5),
  -- Carrier B's, on shipment B.
  ('fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0b01', 'ffffffff-ffff-ffff-ffff-ffffffff0b01',
   '11111111-1111-1111-1111-11111111bbbb', 'v1:' || repeat('d', 64),
   '66666666-6666-6666-6666-66666666bbbb', 'Driver B One',
   '00000000-0000-0000-0000-0000000000e1', 'dispatcher',
   now() - interval '1 hour', now() + interval '23 hours',
   null, null, null, 'pending', null, 1);

-- The access ledger: one granted, one enumeration miss (no token, no
-- shipment), one rate-limited burst. The middle row is what makes "a carrier
-- cannot read the enumeration feed" a meaningful assertion.
insert into shipment_driver_token_access
  (token_id, shipment_id, outcome, detail, ip, user_agent) values
  ('fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a01', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'granted', null, '198.51.100.10', 'itest-ua'),
  (null, null, 'not_found', null, '203.0.113.4', 'scanner/1.0'),
  (null, null, 'rate_limited', 'fails=8 total=9', '203.0.113.4', 'scanner/1.0');

-- ===========================================================================
-- M-77 — shipment_documents fixtures (migration 0024)
--
-- ONE ROW PER MATRIX OUTCOME, which is what makes the audience assertions in
-- 20_rls_isolation.sql statements about the §16 MATRIX rather than about the
-- table's emptiness. On shipment A:
--
--   bol   approved  → shipper + carrier + broker    (three bands at once)
--   pod   approved  → shipper + carrier + broker
--   rate_confirmation approved → carrier ONLY       (§4: never the public,
--                                 §16: not the shipper, §12: not the broker)
--   invoice approved → shipper ONLY                 (§12: no shipper billing)
--   claim  approved  → NOBODY but staff             (§16 private claim review)
--   pod    PENDING   → nobody                       ("approved" is load-bearing)
--   bol    approved but visibility narrowed to staff_only → nobody
--
-- Shipment B carries an approved BOL so "carrier A reads nothing of shipment
-- B" is non-vacuous on the document table too.
--
-- Loaded as the OWNER, so RLS does not apply here — but the VISIBILITY trigger
-- and both CHECKs do, which is why every `visibility` below is one the matrix
-- licenses for its type.
-- ===========================================================================

insert into shipment_documents (
  id, shipment_id, doc_type, visibility, storage_path, file_name,
  mime_type, size_bytes, status, uploaded_by, reviewed_by, reviewed_at,
  approved_by, approved_at
) values
  -- BOL — the three-band row, and the §12 "BOL, when authorized" case.
  ('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a01', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'bol', 'shipper', 'ffffffff-ffff-ffff-ffff-ffffffff0a01/aaaa-bol.pdf', 'bol.pdf',
   'application/pdf', 240000, 'approved',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '2 hours', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '2 hours'),
  -- POD — §12 names it outright, with no "when authorized" qualifier.
  ('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a02', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'pod', 'shipper', 'ffffffff-ffff-ffff-ffff-ffffffff0a01/bbbb-pod.jpg', 'pod.jpg',
   'image/jpeg', 910000, 'approved',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '1 hour', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '1 hour'),
  -- Carrier rate confirmation — the row §4 forbids the public and §16 gives
  -- the carrier alone. If any customer assertion below is wrong, THIS is the
  -- row that leaks a rate.
  ('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a03', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'rate_confirmation', 'carrier',
   'ffffffff-ffff-ffff-ffff-ffffffff0a01/cccc-ratecon.pdf', 'ratecon.pdf',
   'application/pdf', 120000, 'approved',
   '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '3 hours', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '3 hours'),
  -- Shipper invoice — §12 forbids a broker seeing shipper billing.
  ('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a04', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'invoice', 'shipper', 'ffffffff-ffff-ffff-ffff-ffffffff0a01/dddd-invoice.pdf',
   'invoice.pdf', 'application/pdf', 60000, 'approved',
   '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '30 minutes', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '30 minutes'),
  -- Private claim review — approved, and still staff-only by TYPE.
  ('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a05', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'claim', 'staff_only', 'ffffffff-ffff-ffff-ffff-ffffffff0a01/eeee-claim.pdf',
   'claim.pdf', 'application/pdf', 30000, 'approved',
   '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '20 minutes', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '20 minutes'),
  -- PENDING POD — the "approved" clause, made testable.
  ('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a06', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'pod', 'shipper', 'ffffffff-ffff-ffff-ffff-ffffffff0a01/ffff-pod2.jpg',
   'pod-unchecked.jpg', 'image/jpeg', 800000, 'pending',
   '00000000-0000-0000-0000-0000000000a1', null, null, null, null),
  -- APPROVED but NARROWED — the `visibility` clause, made testable.
  ('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a07', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'bol', 'staff_only', 'ffffffff-ffff-ffff-ffff-ffffffff0a01/gggg-bol2.pdf',
   'bol-held.pdf', 'application/pdf', 210000, 'approved',
   '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '10 minutes', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '10 minutes'),
  -- Shipment B, so every cross-tenant zero is a POLICY result.
  ('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0b01', 'ffffffff-ffff-ffff-ffff-ffffffff0b01',
   'bol', 'shipper', 'ffffffff-ffff-ffff-ffff-ffffffff0b01/aaaa-bol.pdf', 'bol-b.pdf',
   'application/pdf', 200000, 'approved',
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '5 hours', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '5 hours');

-- ===========================================================================
-- M-78 — shipment_exceptions + shipment_eta_history fixtures (migration 0025)
--
-- ONE ROW PER §21 OUTCOME, which is what makes the assertions in
-- 20_rls_isolation.sql statements about the POLICY and the ACCESSOR rather
-- than about an empty table. On shipment A:
--
--   facility_delay  OPEN,     public description  → reaches the customer bands
--   damaged_freight OPEN,     NO public description → reaches NOBODY but staff
--   traffic         RESOLVED, public description  → still reaches them, closed
--
-- Shipment B carries one so "carrier A reads nothing of shipment B" is
-- non-vacuous on the exception path too.
--
-- EVERY ROW CARRIES A SENTINEL in `internal_description` and `resolution`.
-- That is the point: the §21 assertions search for those strings, and a
-- fixture with empty internal fields would make "no blame leaked" true for the
-- wrong reason.
--
-- Loaded as the OWNER, so RLS does not apply here — but both CHECKs do.
-- ===========================================================================

insert into shipment_exceptions (
  id, shipment_id, exception_type, severity,
  public_description, internal_description,
  opened_at, resolved_at, opened_by, assigned_to,
  customer_notified_at, resolution
) values
  -- OPEN, published. The row every customer band should reach.
  ('fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'facility_delay', 'high',
   'phrase:exception.facility_delay',
   'SENTINEL-INTERNAL-receiver-dock-blame-do-not-leak',
   now() - interval '4 hours', null,
   '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000e1',
   now() - interval '3 hours', null),
  -- OPEN, NOT published. §21: nothing honest to say yet → nobody but staff.
  ('fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a02', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'damaged_freight', 'critical',
   null,
   'SENTINEL-INTERNAL-claim-exposure-do-not-leak',
   now() - interval '2 hours', null,
   '00000000-0000-0000-0000-0000000000e1', null, null, null),
  -- RESOLVED, published. The closed half of the lifecycle.
  ('fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a03', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'traffic', 'low',
   'phrase:exception.traffic',
   'SENTINEL-INTERNAL-driver-took-the-wrong-route-do-not-leak',
   now() - interval '2 days', now() - interval '1 day',
   '00000000-0000-0000-0000-0000000000e1', null, null,
   'SENTINEL-RESOLUTION-settled-with-carrier-do-not-leak'),
  -- Shipment B, so every cross-tenant zero is a POLICY result.
  ('fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0b01', 'ffffffff-ffff-ffff-ffff-ffffffff0b01',
   'weather', 'medium',
   'phrase:exception.weather',
   'SENTINEL-INTERNAL-shipment-b-do-not-leak',
   now() - interval '5 hours', null,
   '00000000-0000-0000-0000-0000000000e1', null, null, null);

-- §10's ETA history. Two rows on shipment A so "the previous value was
-- preserved" is a fact with a row behind it, and one on shipment B for the
-- cross-tenant zero.
insert into shipment_eta_history (
  shipment_id, eta_kind, previous_eta_at, new_eta_at,
  eta_source, eta_confidence, delay_minutes,
  reason_public, reason_internal, changed_by, changed_at
) values
  ('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'delivery',
   null, now() + interval '2 days', 'manual', 'medium', null,
   null, null, '00000000-0000-0000-0000-0000000000e1', now() - interval '6 hours'),
  ('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'delivery',
   now() + interval '2 days', now() + interval '3 days',
   'dispatcher_adjusted', 'low', 120,
   'phrase:delay.facility', 'SENTINEL-ETA-INTERNAL-receiver-blame-do-not-leak',
   '00000000-0000-0000-0000-0000000000e1', now() - interval '3 hours'),
  ('ffffffff-ffff-ffff-ffff-ffffffff0b01', 'pickup',
   null, now() + interval '1 day', 'manual', 'high', null,
   null, null, '00000000-0000-0000-0000-0000000000e1', now() - interval '5 hours');
