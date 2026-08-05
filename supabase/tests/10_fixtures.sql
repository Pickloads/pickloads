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
