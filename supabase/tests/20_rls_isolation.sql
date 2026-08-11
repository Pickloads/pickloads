-- ============================================================================
-- PickLoads — RLS isolation suite (M-61, audit §6.7).
--
-- Proves the claim 0002/0009/0012 make but no test has ever checked: tenant A
-- cannot read or write tenant B, the anon key can read/write nothing on
-- customer tables, roles are not self-assignable, membership helpers scope to
-- the caller, and staff see exactly what policy grants.
--
-- FAIL LOUDLY: every assertion goes through rls_test.eq/ok/denied/affects,
-- which RAISE EXCEPTION on mismatch. psql runs with ON_ERROR_STOP=1, so a
-- single policy regression aborts the run with a non-zero exit code.
--
-- Run: npm run test:rls   (see scripts/run-rls-tests.sh)
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Assertion harness
-- ---------------------------------------------------------------------------
create schema rls_test;

create table rls_test.results (
  id serial primary key,
  name text not null,
  ok boolean not null default true,
  at timestamptz not null default now()
);

-- SECURITY DEFINER: the ledger must be writable from `set role anon` too.
create function rls_test.record(label text) returns void
language sql security definer set search_path = rls_test as $$
  insert into rls_test.results (name) values (label);
$$;

/** Boolean assertion. */
create function rls_test.ok(cond boolean, label text) returns void
language plpgsql security definer set search_path = rls_test as $$
begin
  if cond is not true then
    raise exception 'RLS ASSERTION FAILED: %', label;
  end if;
  insert into rls_test.results (name) values (label);
end;
$$;

/** Row-count assertion — the workhorse for SELECT isolation. */
create function rls_test.eq(actual bigint, expected bigint, label text) returns void
language plpgsql security definer set search_path = rls_test as $$
begin
  if actual is distinct from expected then
    raise exception 'RLS ASSERTION FAILED: % (expected % row(s), got %)',
      label, expected, actual;
  end if;
  insert into rls_test.results (name) values (label);
end;
$$;

/**
 * The statement MUST be rejected by the database.
 * SECURITY INVOKER on purpose — the statement has to run as the *caller's*
 * role, otherwise RLS would be bypassed and every assertion would pass
 * vacuously. Only policy/guard rejections count: 42501 insufficient_privilege
 * (RLS WITH CHECK / missing policy), 23514 check_violation, P0001
 * raise_exception (the role-guard trigger). Anything else (typo, missing
 * column, FK error) is re-raised so a broken test can never look like a pass.
 */
create function rls_test.denied(stmt text, label text) returns void
language plpgsql as $$
declare
  allowed boolean := false;
  state text;
  msg text;
begin
  begin
    execute stmt;
    allowed := true;
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if state not in ('42501', '23514', 'P0001') then
      raise exception 'RLS TEST BROKEN: % — unexpected SQLSTATE % (%) for: %',
        label, state, msg, stmt;
    end if;
  end;
  if allowed then
    raise exception 'RLS ASSERTION FAILED: % — statement was ALLOWED but must be denied: %',
      label, stmt;
  end if;
  perform rls_test.record(label);
end;
$$;

/**
 * The statement must run without error but touch exactly `expected` rows —
 * how RLS silently filters UPDATE/DELETE (no error, zero rows).
 */
create function rls_test.affects(stmt text, expected bigint, label text) returns void
language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n is distinct from expected then
    raise exception 'RLS ASSERTION FAILED: % (expected % row(s) affected, got %)',
      label, expected, n;
  end if;
  perform rls_test.record(label);
end;
$$;

/**
 * Reading a table must yield zero rows for the current role.
 * A 42501 rejection also counts: several policies call is_staff() /
 * current_user_role(), whose EXECUTE grant 0002 gives to `authenticated`
 * only — so on a real Supabase project the anon key is refused at the
 * function grant before RLS even filters. Both outcomes mean "no data
 * reaches anon"; anything else (rows returned, or a different error) fails.
 */
create function rls_test.reads_nothing(tbl text, label text) returns void
language plpgsql as $$
declare n bigint; state text; msg text;
begin
  begin
    execute format('select count(*) from public.%I', tbl) into n;
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if state <> '42501' then
      raise exception 'RLS TEST BROKEN: % — unexpected SQLSTATE % (%)', label, state, msg;
    end if;
    n := 0;
  end;
  if n <> 0 then
    raise exception 'RLS ASSERTION FAILED: % — read % row(s) that must be invisible', label, n;
  end if;
  perform rls_test.record(label);
end;
$$;

/**
 * The write must change nothing — either rejected outright (42501/23514/
 * P0001) or silently filtered to zero rows. Used where RLS legitimately
 * produces both shapes depending on which policies exist for the command.
 */
create function rls_test.writes_nothing(stmt text, label text) returns void
language plpgsql as $$
declare n bigint; state text; msg text;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if state not in ('42501', '23514', 'P0001') then
      raise exception 'RLS TEST BROKEN: % — unexpected SQLSTATE % (%) for: %',
        label, state, msg, stmt;
    end if;
    n := 0;
  end;
  if n <> 0 then
    raise exception 'RLS ASSERTION FAILED: % — write changed % row(s): %', label, n, stmt;
  end if;
  perform rls_test.record(label);
end;
$$;

grant usage on schema rls_test to authenticated, anon, service_role, public;
grant execute on all functions in schema rls_test to authenticated, anon, service_role, public;

-- Assertions are silent on success (they RAISE on failure); discard the
-- one-empty-row-per-select chatter so the runner output stays readable.
\o /dev/null

-- Identity shorthands used throughout.
--   carrier A owner  00000000-0000-0000-0000-0000000000a1
--   carrier A member 00000000-0000-0000-0000-0000000000a2
--   carrier B owner  00000000-0000-0000-0000-0000000000b1
--   shipper A owner  00000000-0000-0000-0000-0000000000c1
--   shipper B owner  00000000-0000-0000-0000-0000000000c2
--   outsider         00000000-0000-0000-0000-0000000000d1
--   dispatcher       00000000-0000-0000-0000-0000000000e1
--   admin            00000000-0000-0000-0000-0000000000f1

-- ===========================================================================
-- 1 · CARRIER A vs CARRIER B  (the directive's headline requirement)
-- ===========================================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- own rows visible
select rls_test.eq((select count(*) from carriers), 1, 'carrierA sees exactly 1 carrier');
select rls_test.eq((select count(*) from carriers where id = '11111111-1111-1111-1111-11111111aaaa'), 1, 'carrierA sees its own carrier row');
-- cross-tenant reads blocked, table by table
select rls_test.eq((select count(*) from carriers   where id         = '11111111-1111-1111-1111-11111111bbbb'), 0, 'carrierA cannot select carrierB in carriers');
select rls_test.eq((select count(*) from documents  where carrier_id = '11111111-1111-1111-1111-11111111bbbb'), 0, 'carrierA cannot select carrierB documents');
select rls_test.eq((select count(*) from documents), 1, 'carrierA sees only its own documents');
select rls_test.eq((select count(*) from loads      where carrier_id = '11111111-1111-1111-1111-11111111bbbb'), 0, 'carrierA cannot select carrierB loads');
select rls_test.eq((select count(*) from loads), 1, 'carrierA sees only its own loads');
select rls_test.eq((select count(*) from trucks     where carrier_id = '11111111-1111-1111-1111-11111111bbbb'), 0, 'carrierA cannot select carrierB trucks');
select rls_test.eq((select count(*) from trucks), 1, 'carrierA sees only its own trucks');
select rls_test.eq((select count(*) from drivers    where carrier_id = '11111111-1111-1111-1111-11111111bbbb'), 0, 'carrierA cannot select carrierB drivers');
select rls_test.eq((select count(*) from drivers), 1, 'carrierA sees only its own drivers');
select rls_test.eq((select count(*) from invoices   where carrier_id = '11111111-1111-1111-1111-11111111bbbb'), 0, 'carrierA cannot select carrierB invoices');
select rls_test.eq((select count(*) from invoices), 1, 'carrierA sees only its own invoices');
select rls_test.eq((select count(*) from support_threads  where profile_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'carrierA cannot select carrierB support threads');
select rls_test.eq((select count(*) from support_threads), 1, 'carrierA sees only its own support threads');
select rls_test.eq((select count(*) from support_messages where thread_id  = '88888888-8888-8888-8888-88888888bbbb'), 0, 'carrierA cannot select carrierB support messages');
select rls_test.eq((select count(*) from support_messages), 1, 'carrierA sees only its own support messages');
select rls_test.eq((select count(*) from notifications where profile_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'carrierA cannot select carrierB notifications');
select rls_test.eq((select count(*) from notifications), 1, 'carrierA sees only its own notifications');
-- other tenants' surfaces and staff ledgers are invisible
select rls_test.eq((select count(*) from shippers), 0, 'carrierA cannot select any shipper');
select rls_test.eq((select count(*) from freight_quotes), 0, 'carrierA cannot select freight quotes');
select rls_test.eq((select count(*) from carrier_leads), 0, 'carrierA cannot select CRM leads');
select rls_test.eq((select count(*) from contact_messages), 0, 'carrierA cannot select contact messages');
select rls_test.eq((select count(*) from subscribers), 0, 'carrierA cannot select subscribers');
select rls_test.eq((select count(*) from email_log), 0, 'carrierA cannot select the email journal');
select rls_test.eq((select count(*) from webhook_events), 0, 'carrierA cannot select webhook events');
select rls_test.eq((select count(*) from audit_events), 0, 'carrierA cannot select audit events');
select rls_test.eq((select count(*) from account_status_history), 0, 'carrierA cannot select account status history');
select rls_test.eq((select count(*) from staff_invites), 0, 'carrierA cannot select staff invites');
select rls_test.eq((select count(*) from lead_activities), 0, 'carrierA cannot select lead activities');
select rls_test.eq((select count(*) from profiles), 1, 'carrierA sees only its own profile row');
select rls_test.eq((select count(*) from user_preferences), 1, 'carrierA sees only its own preferences');
select rls_test.eq((select count(*) from carrier_memberships), 1, 'carrierA sees only its own membership');

-- cross-tenant writes blocked
select rls_test.denied($$insert into trucks (carrier_id, equipment) values ('11111111-1111-1111-1111-11111111bbbb','reefer')$$,
  'carrierA cannot insert a truck for carrierB');
select rls_test.denied($$insert into drivers (carrier_id, full_name) values ('11111111-1111-1111-1111-11111111bbbb','Mole')$$,
  'carrierA cannot insert a driver for carrierB');
select rls_test.denied($$insert into documents (carrier_id, type, storage_path, uploaded_by, status) values ('11111111-1111-1111-1111-11111111bbbb','w9','x/y.pdf','00000000-0000-0000-0000-0000000000a1','pending')$$,
  'carrierA cannot insert a document for carrierB');
select rls_test.denied($$insert into support_messages (thread_id, author_id, body, is_staff) values ('88888888-8888-8888-8888-88888888bbbb','00000000-0000-0000-0000-0000000000a1','intrusion',false)$$,
  'carrierA cannot post into carrierB support thread');
select rls_test.denied($$insert into support_messages (thread_id, author_id, body, is_staff) values ('88888888-8888-8888-8888-88888888aaaa','00000000-0000-0000-0000-0000000000a1','fake staff reply',true)$$,
  'carrierA cannot post a message flagged is_staff');
select rls_test.denied($$insert into notifications (profile_id, kind, title) values ('00000000-0000-0000-0000-0000000000a1','x','self-issued')$$,
  'carrierA cannot insert notifications (service-role only)');
select rls_test.denied($$insert into audit_events (actor_id, action) values ('00000000-0000-0000-0000-0000000000a1','forged')$$,
  'carrierA cannot insert audit events');
select rls_test.denied($$insert into loads (carrier_id, gross_rate) values ('11111111-1111-1111-1111-11111111aaaa', 999)$$,
  'carrierA cannot insert loads even for itself (staff-only writes)');
select rls_test.denied($$insert into carriers (company_name) values ('Self-serve Trucking')$$,
  'carrierA cannot create carrier companies');
select rls_test.denied($$insert into staff_invites (email, role, token_hash, invited_by, expires_at) values ('me@x.test','admin','h','00000000-0000-0000-0000-0000000000a1', now())$$,
  'carrierA cannot forge a staff invite');
select rls_test.affects($$update trucks set unit_number = 'HIJACKED' where id = '55555555-5555-5555-5555-55555555bbbb'$$, 0,
  'carrierA update of carrierB truck touches 0 rows');
select rls_test.affects($$delete from trucks where id = '55555555-5555-5555-5555-55555555bbbb'$$, 0,
  'carrierA delete of carrierB truck touches 0 rows');
select rls_test.affects($$update notifications set read_at = now() where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0b01'$$, 0,
  'carrierA cannot mark carrierB notification read');
select rls_test.affects($$update carriers set dispatch_fee_pct = 0 where id = '11111111-1111-1111-1111-11111111aaaa'$$, 0,
  'carrierA cannot edit its own regulated carrier columns (no member UPDATE policy)');
select rls_test.affects($$update profiles set full_name = 'Renamed B' where id = '00000000-0000-0000-0000-0000000000b1'$$, 0,
  'carrierA cannot rename another profile');
select rls_test.affects($$update profiles set full_name = 'Owner A (edited)' where id = '00000000-0000-0000-0000-0000000000a1'$$, 1,
  'carrierA CAN edit its own profile name');
-- own-tenant writes that policy DOES allow (proves the suite is not vacuous)
select rls_test.affects($$insert into trucks (carrier_id, equipment) values ('11111111-1111-1111-1111-11111111aaaa','flatbed')$$, 1,
  'carrierA CAN insert a truck for itself');
select rls_test.affects($$delete from trucks where carrier_id = '11111111-1111-1111-1111-11111111aaaa' and equipment = 'flatbed'$$, 1,
  'carrierA CAN delete its own truck');

-- ===========================================================================
-- 2 · ROLE SELF-PROMOTION (trg_profiles_role_guard, S-04 / audit §6.6)
-- ===========================================================================
select rls_test.denied($$update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'non-admin cannot self-promote to admin');
select rls_test.denied($$update profiles set role = 'dispatcher' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'non-admin cannot self-promote to dispatcher');
select rls_test.eq((select count(*) from profiles where id = '00000000-0000-0000-0000-0000000000a1' and role = 'carrier'), 1,
  'carrierA role is still carrier after promotion attempts');

-- ===========================================================================
-- 3 · MEMBERSHIP HELPERS — owner vs non-owner member vs non-member
-- ===========================================================================
select rls_test.eq((select count(*) from my_carrier_ids()), 1, 'my_carrier_ids scopes carrierA owner to 1 company');
select rls_test.eq((select count(*) from my_shipper_ids()), 0, 'my_shipper_ids is empty for a carrier owner');

-- non-owner MEMBER of carrier A: same visibility as the owner (D4 team model)
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select rls_test.eq((select count(*) from my_carrier_ids()), 1, 'my_carrier_ids scopes carrierA member to 1 company');
select rls_test.eq((select count(*) from carriers where id = '11111111-1111-1111-1111-11111111aaaa'), 1, 'carrierA member reads the carrier via membership (not profile_id)');
select rls_test.eq((select count(*) from trucks), 1, 'carrierA member reads carrierA trucks');
select rls_test.eq((select count(*) from invoices), 1, 'carrierA member reads carrierA invoices');
select rls_test.eq((select count(*) from carriers where id = '11111111-1111-1111-1111-11111111bbbb'), 0, 'carrierA member still cannot read carrierB');

-- authenticated NON-MEMBER: authenticated is not authorized
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select rls_test.eq((select count(*) from my_carrier_ids()), 0, 'my_carrier_ids is empty for a non-member');
select rls_test.eq((select count(*) from my_shipper_ids()), 0, 'my_shipper_ids is empty for a non-member');
select rls_test.eq((select count(*) from carriers), 0, 'non-member sees no carriers');
select rls_test.eq((select count(*) from documents), 0, 'non-member sees no documents');
select rls_test.eq((select count(*) from loads), 0, 'non-member sees no loads');
select rls_test.eq((select count(*) from trucks), 0, 'non-member sees no trucks');
select rls_test.eq((select count(*) from drivers), 0, 'non-member sees no drivers');
select rls_test.eq((select count(*) from invoices), 0, 'non-member sees no invoices');
select rls_test.eq((select count(*) from freight_quotes), 0, 'non-member sees no freight quotes');
select rls_test.eq((select count(*) from support_threads), 0, 'non-member sees no support threads');
select rls_test.eq((select count(*) from notifications), 0, 'non-member sees no notifications');
select rls_test.eq((select count(*) from shippers), 0, 'non-member sees no shippers');

-- ===========================================================================
-- 4 · SHIPPER A vs SHIPPER B  (audit §6.3 — the email-matching weakness)
-- ===========================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.eq((select count(*) from freight_quotes), 1, 'shipperA sees exactly its own quote');
select rls_test.eq((select count(*) from freight_quotes where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0a01'), 1, 'shipperA sees its own quote row');
select rls_test.eq((select count(*) from freight_quotes where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0b01'), 0, 'shipperA cannot select shipperB freight_quotes');
select rls_test.eq((select count(*) from freight_quotes where shipper_id is null), 0, 'shipperA cannot select unclaimed public quotes');
select rls_test.eq((select count(*) from shippers), 1, 'shipperA sees only its own company');
select rls_test.eq((select count(*) from shippers where id = '22222222-2222-2222-2222-2222222bbbbb'), 0, 'shipperA cannot select shipperB company');
select rls_test.eq((select count(*) from my_shipper_ids()), 1, 'my_shipper_ids scopes shipperA to 1 company');
select rls_test.eq((select count(*) from my_carrier_ids()), 0, 'my_carrier_ids is empty for a shipper owner');
select rls_test.eq((select count(*) from carriers), 0, 'shipperA cannot select carriers');
select rls_test.eq((select count(*) from documents), 0, 'shipperA cannot select carrier documents');
select rls_test.eq((select count(*) from loads), 0, 'shipperA cannot select loads');
select rls_test.eq((select count(*) from trucks), 0, 'shipperA cannot select trucks');
-- M-74 (0021) CHANGED THIS ASSERTION, deliberately. It used to read
-- "shipperA cannot select invoices" and expect 0, which was true only because
-- no shipper invoice could exist: `invoices` was carrier-shaped and its one
-- customer policy was keyed on `my_carrier_ids()`. §11 requires the shipper
-- shipment page to show invoice status, so 0021 adds `shipper_id` and a
-- matching read policy. The assertion is REWRITTEN rather than deleted, and
-- it still says the thing that matters: a shipper reads its OWN invoice and
-- none of the carrier billing history sharing the table. §10 below covers the
-- new policy in full.
select rls_test.eq((select count(*) from invoices), 1,
  'shipperA selects exactly ONE invoice — its own (M-74/0021; was 0 before the shipper linkage existed)');
select rls_test.eq((select count(*) from invoices where carrier_id is not null), 0,
  'shipperA still selects NO carrier dispatch-fee invoice');
select rls_test.denied($$insert into freight_quotes (email, pickup_zip, delivery_zip, shipper_id) values ('x@y.test','07111','30301','22222222-2222-2222-2222-2222222aaaaa')$$,
  'shipperA cannot insert freight quotes directly (server action + service role only)');
select rls_test.affects($$update freight_quotes set quoted_rate = 1 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0a01'$$, 0,
  'shipperA cannot self-quote its own request (no member UPDATE policy)');
select rls_test.affects($$update freight_quotes set quoted_rate = 1 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0b01'$$, 0,
  'shipperA cannot edit shipperB freight_quotes');
select rls_test.denied($$insert into shippers (company_name) values ('Ghost Shipping')$$,
  'shipperA cannot create shipper companies');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select rls_test.eq((select count(*) from freight_quotes), 1, 'shipperB sees exactly its own quote');
select rls_test.eq((select count(*) from freight_quotes where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0a01'), 0, 'shipperB cannot select shipperA freight_quotes');

-- ===========================================================================
-- 5 · ANON (the public site's key) — reads nothing, writes nothing
-- The shim grants anon the same table privileges Supabase does, so these
-- assertions prove POLICIES block it, not missing grants.
-- ===========================================================================
reset role;
set request.jwt.claim.sub = '';
set role anon;

select rls_test.reads_nothing('profiles', 'anon reads nothing from profiles');
select rls_test.reads_nothing('carriers', 'anon reads nothing from carriers');
select rls_test.reads_nothing('documents', 'anon reads nothing from documents');
select rls_test.reads_nothing('loads', 'anon reads nothing from loads');
select rls_test.reads_nothing('trucks', 'anon reads nothing from trucks');
select rls_test.reads_nothing('drivers', 'anon reads nothing from drivers');
select rls_test.reads_nothing('invoices', 'anon reads nothing from invoices');
select rls_test.reads_nothing('freight_quotes', 'anon reads nothing from freight_quotes');
select rls_test.reads_nothing('carrier_leads', 'anon reads nothing from carrier_leads');
select rls_test.reads_nothing('lead_activities', 'anon reads nothing from lead_activities');
select rls_test.reads_nothing('contact_messages', 'anon reads nothing from contact_messages');
select rls_test.reads_nothing('subscribers', 'anon reads nothing from subscribers');
select rls_test.reads_nothing('support_threads', 'anon reads nothing from support_threads');
select rls_test.reads_nothing('support_messages', 'anon reads nothing from support_messages');
select rls_test.reads_nothing('notifications', 'anon reads nothing from notifications');
select rls_test.reads_nothing('shippers', 'anon reads nothing from shippers');
select rls_test.reads_nothing('carrier_memberships', 'anon reads nothing from carrier_memberships');
select rls_test.reads_nothing('shipper_memberships', 'anon reads nothing from shipper_memberships');
select rls_test.reads_nothing('user_preferences', 'anon reads nothing from user_preferences');
select rls_test.reads_nothing('audit_events', 'anon reads nothing from audit_events');
select rls_test.reads_nothing('account_status_history', 'anon reads nothing from account_status_history');
select rls_test.reads_nothing('staff_invites', 'anon reads nothing from staff_invites');
select rls_test.reads_nothing('email_log', 'anon reads nothing from email_log');
select rls_test.reads_nothing('webhook_events', 'anon reads nothing from webhook_events');

select rls_test.denied($$insert into carrier_leads (phone) values ('9995551234')$$, 'anon cannot insert carrier_leads');
select rls_test.denied($$insert into freight_quotes (email) values ('anon@x.test')$$, 'anon cannot insert freight_quotes');
select rls_test.denied($$insert into contact_messages (full_name, email, body) values ('a','a@x.test','b')$$, 'anon cannot insert contact_messages');
select rls_test.denied($$insert into subscribers (email) values ('anon@x.test')$$, 'anon cannot insert subscribers');
select rls_test.denied($$insert into documents (carrier_id, type, storage_path) values ('11111111-1111-1111-1111-11111111aaaa','w9','a/b.pdf')$$, 'anon cannot insert documents');
select rls_test.denied($$insert into notifications (profile_id, kind, title) values ('00000000-0000-0000-0000-0000000000a1','x','y')$$, 'anon cannot insert notifications');
select rls_test.denied($$insert into audit_events (action) values ('forged')$$, 'anon cannot insert audit_events');
select rls_test.denied($$insert into posts (slug, locale, title, body_md) values ('anon-post','en','x','y')$$, 'anon cannot insert posts');
select rls_test.writes_nothing($$update company_settings set value = '"hacked"'::jsonb where key = 'mc_number'$$, 'anon cannot write company_settings');
select rls_test.writes_nothing($$update posts set title = 'hacked' where slug = 'published-post'$$, 'anon cannot edit published posts');
select rls_test.writes_nothing($$delete from posts where slug = 'published-post'$$, 'anon cannot delete published posts');
select rls_test.writes_nothing($$update carriers set active = false$$, 'anon cannot deactivate carriers');
select rls_test.writes_nothing($$delete from freight_quotes$$, 'anon cannot delete freight quotes');

-- Intentional public reads (documented exceptions — these MUST keep working)
select rls_test.ok((select count(*) from company_settings) > 0, 'anon CAN read company_settings (public switchboard, by design)');
select rls_test.eq((select count(*) from posts), 1, 'anon reads published posts only');
select rls_test.eq((select count(*) from posts where slug = 'draft-post'), 0, 'anon cannot read draft posts');

-- ===========================================================================
-- 6 · STAFF — dispatcher and admin read exactly what policy allows
-- ===========================================================================
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';

select rls_test.eq((select count(*) from carriers), 2, 'dispatcher reads all carriers');
select rls_test.eq((select count(*) from documents), 2, 'dispatcher reads all documents');
select rls_test.eq((select count(*) from loads), 2, 'dispatcher reads all loads');
select rls_test.eq((select count(*) from trucks), 2, 'dispatcher reads all trucks');
select rls_test.eq((select count(*) from drivers), 2, 'dispatcher reads all drivers');
-- M-74 (0021): 2 → 4. The fixtures gained two SHIPPER invoices; staff read
-- every invoice under 0009's `"staff manage invoices"`, which 0021 did not
-- touch. The count moves because the fixture set grew, not because a policy
-- changed.
select rls_test.eq((select count(*) from invoices), 4, 'dispatcher reads all invoices (2 carrier + 2 shipper)');
select rls_test.eq((select count(*) from shippers), 2, 'dispatcher reads all shippers');
select rls_test.eq((select count(*) from freight_quotes), 3, 'dispatcher reads all freight quotes');
select rls_test.eq((select count(*) from carrier_leads), 1, 'dispatcher reads the CRM');
select rls_test.eq((select count(*) from lead_activities), 1, 'dispatcher reads lead activities');
select rls_test.eq((select count(*) from contact_messages), 1, 'dispatcher reads contact messages');
select rls_test.eq((select count(*) from subscribers), 1, 'dispatcher reads subscribers');
select rls_test.eq((select count(*) from email_log), 1, 'dispatcher reads the email journal');
select rls_test.eq((select count(*) from webhook_events), 1, 'dispatcher reads webhook events');
select rls_test.eq((select count(*) from audit_events), 1, 'dispatcher reads audit events');
select rls_test.eq((select count(*) from account_status_history), 1, 'dispatcher reads account status history');
select rls_test.eq((select count(*) from staff_invites), 1, 'dispatcher reads staff invites');
select rls_test.eq((select count(*) from support_threads), 2, 'dispatcher reads every support thread');
select rls_test.eq((select count(*) from support_messages), 2, 'dispatcher reads every support message');
select rls_test.eq((select count(*) from user_preferences), 2, 'dispatcher reads user preferences');
-- 8 M-61 identities + the 3 broker identities M-71's fixtures add.
select rls_test.eq((select count(*) from profiles), 11, 'dispatcher reads all profiles');
-- staff limits
select rls_test.eq((select count(*) from notifications), 0, 'dispatcher does NOT inherit customer notifications');
select rls_test.affects($$update company_settings set value = '"nope"'::jsonb where key = 'mc_number'$$, 0,
  'dispatcher cannot write company_settings (admin-only policy)');
select rls_test.denied($$update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'dispatcher cannot promote itself to admin');
select rls_test.denied($$insert into audit_events (actor_id, action) values ('00000000-0000-0000-0000-0000000000e1','forged')$$,
  'dispatcher cannot insert audit events (service-role ledger)');
select rls_test.denied($$insert into staff_invites (email, role, token_hash, invited_by, expires_at) values ('x@y.test','admin','h','00000000-0000-0000-0000-0000000000e1', now())$$,
  'dispatcher cannot insert staff invites (service-role only)');
select rls_test.affects($$update documents set status = 'approved' where id = '33333333-3333-3333-3333-33333333aaaa'$$, 1,
  'dispatcher CAN review documents (staff manage policy)');

-- admin
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.affects($$update company_settings set value = '"MC-TEST"'::jsonb where key = 'mc_number'$$, 1,
  'admin CAN write company_settings');
-- Defense in depth: `profiles` has NO staff UPDATE policy (0002 grants only
-- "own profile update"). Even an admin cannot mutate another account from a
-- cookie-bound browser session — role/status changes run service-side inside
-- the admin-gated actions (M-58 staff.ts) and land in audit_events. A stolen
-- admin session token therefore still cannot promote anyone.
select rls_test.writes_nothing($$update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  'admin cannot promote another user from a browser session (service-role only)');
select rls_test.writes_nothing($$update profiles set status = 'suspended' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'admin cannot suspend an account from a browser session (service-role only)');
select rls_test.affects($$update profiles set full_name = 'Root Admin' where id = '00000000-0000-0000-0000-0000000000f1'$$, 1,
  'admin CAN edit its own profile');
select rls_test.eq((select count(*) from profiles where id = '00000000-0000-0000-0000-0000000000d1' and role = 'carrier'), 1,
  'outsider role unchanged after admin promotion attempt');
select rls_test.denied($$insert into audit_events (actor_id, action) values ('00000000-0000-0000-0000-0000000000f1','forged')$$,
  'admin cannot insert audit events from a browser session either');

reset role;
set request.jwt.claim.sub = '';

-- ---------------------------------------------------------------------------
-- M-69 — Production Integrity Pack (migrations 0014–0016)
--
-- 0014/0016 add columns, 0015 adds a switchboard row; none of them touch a
-- policy. These assertions prove exactly that: the new unsubscribe credential
-- inherits `subscribers`' zero-anon-grant posture, the new referral gate is
-- readable by anon (the public site reads it with the anon key) but not
-- writable, and the new deadhead column stays inside `loads`' existing
-- tenant isolation.
-- ---------------------------------------------------------------------------
set role anon;
set request.jwt.claim.sub = '';

-- P-1: the unsubscribe token is a credential printed in every marketing
-- send. The anon key must never be able to enumerate them (the endpoints run
-- service-side, decision Q3).
select rls_test.reads_nothing('subscribers',
  'anon cannot read subscribers.unsubscribe_token (M-69/P-1)');
select rls_test.writes_nothing($$update subscribers set unsubscribed_at = now()$$,
  'anon cannot unsubscribe anyone directly (M-69/P-1)');

-- P-2: the gate itself is public (the anon-key site read) but immutable.
select rls_test.eq((select count(*) from company_settings where key = 'referral_program_active'), 1,
  'referral_program_active is seeded and anon-readable (M-69/P-2)');
select rls_test.ok(
  (select value = 'false'::jsonb from company_settings where key = 'referral_program_active'),
  'referral_program_active defaults to FALSE — the promise stays dark (M-69/P-2)');
select rls_test.writes_nothing(
  $$update company_settings set value = 'true'::jsonb where key = 'referral_program_active'$$,
  'anon cannot switch the referral promise on (M-69/P-2)');

-- P-7: deadhead miles are load data, not public data. (reads_nothing, not a
-- bare count: `loads` policies call my_carrier_ids(), which anon may not
-- EXECUTE — a 42501 here is a PASS, exactly as for every other tenant table.)
select rls_test.reads_nothing('loads', 'anon reads no loads.deadhead_miles (M-69/P-7)');

-- Cross-tenant: carrierA still sees only its own loads, new column included.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select rls_test.eq((select count(*) from loads where carrier_id <> '11111111-1111-1111-1111-11111111aaaa'), 0,
  'carrierA sees no other tenant loads/deadhead data (M-69/P-7)');
select rls_test.eq((select count(*) from subscribers), 0,
  'carrierA still cannot read subscribers after 0014 (M-69/P-1)');

reset role;
set request.jwt.claim.sub = '';

-- ===========================================================================
-- 7 · M-71 — shipment schema (migrations 0017–0018)
--
-- Three axes now: shipper A/B, carrier A/B and broker A/B, plus broker C —
-- an organization an admin has NOT activated, which must grant nothing even
-- though its membership row exists.
--
-- Identity extension
--   broker A owner   00000000-0000-0000-0000-00000000ab01
--   broker B owner   00000000-0000-0000-0000-00000000ab02
--   broker C member  00000000-0000-0000-0000-00000000ab03  (org NOT active)
--   shipment A       ffffffff-ffff-ffff-ffff-ffffffff0a01  (shipper/carrier/broker A)
--   shipment B       ffffffff-ffff-ffff-ffff-ffffffff0b01  (shipper/carrier/broker B)
-- ===========================================================================

/**
 * Exact-SQLSTATE rejection. rls_test.denied() accepts any of three policy
 * shapes, which is right for RLS but too loose for a constraint proof: a
 * CHECK test that passes because a TRIGGER fired first proves nothing about
 * the CHECK. This variant names the code it demands and re-raises anything
 * else, so each database guarantee below is attributed to the object that
 * actually produced it.
 */
create function rls_test.rejects_with(stmt text, expected_state text, label text)
returns void language plpgsql as $$
declare
  allowed boolean := false;
  state text;
  msg text;
begin
  begin
    execute stmt;
    allowed := true;
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if state <> expected_state then
      raise exception 'RLS TEST BROKEN: % — expected SQLSTATE %, got % (%) for: %',
        label, expected_state, state, msg, stmt;
    end if;
  end;
  if allowed then
    raise exception 'RLS ASSERTION FAILED: % — statement was ALLOWED but must be rejected with %: %',
      label, expected_state, stmt;
  end if;
  perform rls_test.record(label);
end;
$$;
grant execute on function rls_test.rejects_with(text, text, text)
  to authenticated, anon, service_role, public;

-- ---------------------------------------------------------------------------
-- 7a · SHIPPER A vs SHIPPER B  (§19 "Shipper A cannot view Shipper B's")
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';

select rls_test.eq((select count(*) from shipments), 1, 'shipperA sees exactly 1 shipment');
select rls_test.eq((select count(*) from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 1, 'shipperA sees its own shipment row');
select rls_test.eq((select count(*) from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0, 'shipperA cannot select shipperB shipment');
select rls_test.eq((select count(*) from shipments where tracking_number = 'PL-2026-000202'), 0, 'shipperA cannot select shipperB shipment BY TRACKING NUMBER (§5 is an identifier, not an access grant)');
select rls_test.eq((select count(*) from shipment_parties), 2, 'shipperA sees both parties of its own shipment');
select rls_test.eq((select count(*) from shipment_parties where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0, 'shipperA cannot select shipperB shipment parties');
select rls_test.eq((select count(*) from shipment_assignments), 1, 'shipperA sees the assignment on its own shipment');
select rls_test.eq((select count(*) from shipment_assignments where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0, 'shipperA cannot select shipperB assignments');
select rls_test.eq((select count(*) from broker_partners), 0, 'shipperA cannot select any broker organization');
select rls_test.eq((select count(*) from broker_partner_memberships), 0, 'shipperA cannot select broker memberships');
select rls_test.eq((select count(*) from my_broker_partner_ids()), 0, 'my_broker_partner_ids is empty for a shipper owner');
-- §19: no customer may write a shipment at all — there is no INSERT/UPDATE/
-- DELETE policy, so "carrier users cannot edit financial fields" is not a
-- column list to maintain, it is the absence of a grant.
select rls_test.affects($$update shipments set margin = 0 where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$, 0,
  'shipperA cannot edit financial fields on its OWN shipment');
select rls_test.affects($$update shipments set status = 'delivered' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$, 0,
  'shipperA cannot change its own shipment status (§20 transitions are server-side)');
select rls_test.affects($$update shipments set public_tracking_enabled = true where id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'$$, 0,
  'shipperA cannot publish shipperB shipment to the public tracking page');
select rls_test.affects($$delete from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$, 0,
  'shipperA cannot delete its own shipment');
select rls_test.affects($$update shipment_parties set public_contact = true where id = 'fafafafa-fafa-fafa-fafa-fafafafa0a02'$$, 0,
  'shipperA cannot flip a private contact to public');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select rls_test.eq((select count(*) from shipments), 1, 'shipperB sees exactly 1 shipment');
select rls_test.eq((select count(*) from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0, 'shipperB cannot select shipperA shipment');
select rls_test.eq((select count(*) from shipment_parties where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0, 'shipperB cannot select shipperA shipment parties');

-- ---------------------------------------------------------------------------
-- 7b · CARRIER A vs CARRIER B  (§19 "Carrier A cannot view Carrier B's")
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select rls_test.eq((select count(*) from shipments), 1, 'carrierA sees exactly 1 shipment');
select rls_test.eq((select count(*) from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0, 'carrierA cannot select carrierB shipment');
select rls_test.eq((select count(*) from shipment_assignments), 1, 'carrierA sees only its own assignment');
select rls_test.eq((select count(*) from shipment_assignments where carrier_id = '11111111-1111-1111-1111-11111111bbbb'), 0, 'carrierA cannot select carrierB assignments');
select rls_test.eq((select count(*) from shipment_parties where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0, 'carrierA cannot select carrierB shipment parties');
select rls_test.eq((select count(*) from broker_partners), 0, 'carrierA cannot select broker organizations');
select rls_test.affects($$update shipments set carrier_pay = 99999 where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$, 0,
  'carrierA cannot edit carrier_pay on the shipment it hauls (§19 financial-write rejection)');
select rls_test.affects($$update shipments set margin = 0, gross_shipper_amount = 0 where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$, 0,
  'carrierA cannot edit shipper financial data (§20 impossible-transition list)');
select rls_test.affects($$update shipments set status = 'delivered' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'$$, 0,
  'carrierA cannot mark another carrier shipment delivered (§20)');
select rls_test.affects($$update shipment_assignments set released_at = now() where id = 'fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0b01'$$, 0,
  'carrierA cannot release carrierB assignment');

-- non-owner MEMBER of carrier A reaches the same shipment through membership
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select rls_test.eq((select count(*) from shipments), 1, 'carrierA member reads carrierA shipment via membership');
select rls_test.eq((select count(*) from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0, 'carrierA member still cannot read carrierB shipment');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select rls_test.eq((select count(*) from shipments), 1, 'carrierB sees exactly 1 shipment');
select rls_test.eq((select count(*) from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0, 'carrierB cannot select carrierA shipment');

-- ---------------------------------------------------------------------------
-- 7c · BROKER A vs BROKER B  (§19 "Broker A cannot view Broker B's", §12)
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';
select rls_test.eq((select count(*) from my_broker_partner_ids()), 1, 'my_broker_partner_ids scopes brokerA to 1 organization');
select rls_test.eq((select count(*) from shipments), 1, 'brokerA sees exactly the 1 shipment explicitly linked to it');
select rls_test.eq((select count(*) from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0, 'brokerA cannot select brokerB shipment');
select rls_test.eq((select count(*) from broker_partners), 1, 'brokerA sees only its own broker organization');
select rls_test.eq((select count(*) from broker_partners where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0b01'), 0, 'brokerA cannot select brokerB organization');
-- §12 "approved contact channels": the private party row stays invisible.
select rls_test.eq((select count(*) from shipment_parties), 1, 'brokerA sees ONLY the public_contact party (§12 approved channels)');
select rls_test.eq((select count(*) from shipment_parties where id = 'fafafafa-fafa-fafa-fafa-fafafafa0a02'), 0, 'brokerA cannot see the shipment private contact');
-- §12 must-not-see: carrier operational detail.
select rls_test.eq((select count(*) from shipment_assignments), 0, 'brokerA reads NO carrier assignment detail (§12)');
select rls_test.eq((select count(*) from carriers), 0, 'brokerA cannot select carrier records (§12 carrier packet/insurance)');
select rls_test.eq((select count(*) from documents), 0, 'brokerA cannot select carrier documents (§12)');
select rls_test.eq((select count(*) from invoices), 0, 'brokerA cannot select shipper billing (§12)');
select rls_test.eq((select count(*) from freight_quotes), 0, 'brokerA cannot select freight quotes (§12)');
select rls_test.affects($$update shipments set status = 'delivered' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$, 0,
  'brokerA cannot write the shipment it is linked to');
select rls_test.affects($$update shipments set broker_partner_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0a01' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'$$, 0,
  'brokerA cannot link itself to another shipment (the link is an admin write)');
select rls_test.affects($$update broker_partners set active = true where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0c01'$$, 0,
  'brokerA cannot activate an unapproved broker organization');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab02';
select rls_test.eq((select count(*) from shipments), 1, 'brokerB sees exactly its own linked shipment');
select rls_test.eq((select count(*) from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0, 'brokerB cannot select brokerA shipment');
select rls_test.eq((select count(*) from shipment_parties where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0, 'brokerB cannot select brokerA shipment parties');

-- broker C: the membership row EXISTS, the organization is not activated —
-- §12's admin-approval gate, enforced inside my_broker_partner_ids().
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab03';
select rls_test.eq((select count(*) from broker_partner_memberships), 1, 'brokerC member CAN see that it holds a membership (non-vacuous fixture)');
select rls_test.eq((select count(*) from my_broker_partner_ids()), 0, 'an UNAPPROVED broker organization grants nothing (§12 admin approval)');
select rls_test.eq((select count(*) from shipments), 0, 'brokerC member sees no shipments');
select rls_test.eq((select count(*) from broker_partners), 0, 'brokerC member cannot even read its own unapproved organization');

-- ---------------------------------------------------------------------------
-- 7d · AUTHENTICATED NON-MEMBER
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select rls_test.eq((select count(*) from shipments), 0, 'non-member sees no shipments');
select rls_test.eq((select count(*) from shipment_parties), 0, 'non-member sees no shipment parties');
select rls_test.eq((select count(*) from shipment_assignments), 0, 'non-member sees no shipment assignments');
select rls_test.eq((select count(*) from broker_partners), 0, 'non-member sees no broker organizations');
select rls_test.eq((select count(*) from broker_partner_memberships), 0, 'non-member sees no broker memberships');

-- ---------------------------------------------------------------------------
-- 7e · ANON — §19 forbids direct anonymous SELECT on ANY of these tables.
-- The shim grants anon the same table privileges Supabase does, so a pass
-- here proves the POLICY (its absence) blocks it, not a missing grant.
-- ---------------------------------------------------------------------------
reset role;
set request.jwt.claim.sub = '';
set role anon;

select rls_test.reads_nothing('shipments', 'anon reads nothing from shipments (§19 no anonymous SELECT)');
select rls_test.reads_nothing('shipment_parties', 'anon reads nothing from shipment_parties');
select rls_test.reads_nothing('shipment_assignments', 'anon reads nothing from shipment_assignments');
select rls_test.reads_nothing('broker_partners', 'anon reads nothing from broker_partners');
select rls_test.reads_nothing('broker_partner_memberships', 'anon reads nothing from broker_partner_memberships');
select rls_test.writes_nothing($$update shipments set public_tracking_enabled = true$$,
  'anon cannot enable public tracking on anything');
select rls_test.writes_nothing($$update shipments set status = 'delivered'$$,
  'anon cannot mark a shipment delivered (§20 impossible transition)');
select rls_test.writes_nothing($$delete from shipment_assignments$$,
  'anon cannot delete assignments');

-- ---------------------------------------------------------------------------
-- 7f · STAFF — dispatcher and admin see the whole desk (non-vacuity for
-- every zero above), and are still bound by the tracking-number trigger.
-- ---------------------------------------------------------------------------
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select rls_test.eq((select count(*) from shipments), 2, 'dispatcher reads all shipments');
select rls_test.eq((select count(*) from shipment_parties), 3, 'dispatcher reads all shipment parties');
select rls_test.eq((select count(*) from shipment_assignments), 2, 'dispatcher reads all shipment assignments');
select rls_test.eq((select count(*) from broker_partners), 3, 'dispatcher reads all broker organizations, active or not');
select rls_test.affects($$update shipments set status = 'arrived_at_delivery' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$, 1,
  'dispatcher CAN advance a shipment status (proves every 0 above is a policy result, not an empty table)');
select rls_test.rejects_with($$update shipments set tracking_number = 'PL-2026-123456' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$,
  'P0001', 'dispatcher cannot rewrite a tracking number either (§5 immutability)');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.eq((select count(*) from shipments), 2, 'admin reads all shipments');
select rls_test.eq((select count(*) from shipment_parties), 3, 'admin reads all shipment parties');
select rls_test.affects($$update broker_partners set active = true where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0c01'$$, 1,
  'admin CAN approve a broker organization');
select rls_test.affects($$update broker_partners set active = false where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0c01'$$, 1,
  'admin CAN revoke a broker organization (one write kills access everywhere)');

-- ---------------------------------------------------------------------------
-- 7g · INSERT rejection for customer roles.
--
-- Run with the §2 gate OPEN on purpose: the BEFORE INSERT gate fires before
-- RLS WITH CHECK, so with the gate closed every one of these would be
-- rejected by the gate and would prove nothing about the policies. Opening it
-- first makes 42501 — "no INSERT policy applies to you" — the only possible
-- outcome.
-- ---------------------------------------------------------------------------
reset role;
set request.jwt.claim.sub = '';
update company_settings set value = 'true'::jsonb where key = 'brokerage_active';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-000301','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  '42501', 'shipperA cannot insert a shipment even for its own company (service role only)');
select rls_test.rejects_with($$insert into shipment_parties (shipment_id, party_role, company_name) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','third_party','Ghost')$$,
  '42501', 'shipperA cannot insert a shipment party');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select rls_test.rejects_with($$insert into shipment_assignments (shipment_id, carrier_id) values ('ffffffff-ffff-ffff-ffff-ffffffff0b01','11111111-1111-1111-1111-11111111aaaa')$$,
  '42501', 'carrierA cannot assign itself to carrierB shipment');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, broker_partner_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-000302','22222222-2222-2222-2222-2222222aaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeee0a01','Newark','NJ','Atlanta','GA','dry-van')$$,
  '42501', 'brokerA cannot insert a shipment');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-000303','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  '42501', 'a NON-MEMBER cannot insert a shipment');
select rls_test.rejects_with($$insert into broker_partners (company_name, active) values ('Self-serve Brokerage', true)$$,
  '42501', 'a non-member cannot self-register a broker organization (§12 admin-invited only)');
select rls_test.rejects_with($$insert into broker_partner_memberships (broker_partner_id, profile_id) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0a01','00000000-0000-0000-0000-0000000000d1')$$,
  '42501', 'a non-member cannot join a broker organization');

set role anon;
set request.jwt.claim.sub = '';
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-000304','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  '42501', 'anon cannot insert a shipment');
select rls_test.rejects_with($$insert into shipment_parties (shipment_id, party_role) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','third_party')$$,
  '42501', 'anon cannot insert a shipment party');

-- ---------------------------------------------------------------------------
-- 7h · Constraints and triggers, asserted as the TABLE OWNER.
--
-- `reset role` here is postgres — RLS is bypassed entirely. Anything that
-- still fails can only be a CHECK, a unique index or a trigger, which is
-- exactly the point: these are the guarantees that survive the service role,
-- not just the browser session.
-- ---------------------------------------------------------------------------
reset role;
set request.jwt.claim.sub = '';

-- §5 format CHECK (gate is currently OPEN, so the CHECK is what rejects).
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-26-1','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  '23514', 'malformed tracking number rejected by shipments_tracking_number_format');
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('pl-2026-000401','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  '23514', 'lowercase tracking number rejected — only the canonical form is storable');
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-0004010','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  '23514', 'seven-digit sequence rejected (truncation would resolve to another customer shipment)');

-- The owner CAN insert a well-formed shipment while the gate is open.
select rls_test.affects($$insert into shipments (id, tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('ffffffff-ffff-ffff-ffff-ffffffff0c01','PL-2026-000401','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  1, 'a well-formed shipment inserts while brokerage_active is true (non-vacuous)');

-- §5 uniqueness.
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-000101','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  '23505', 'duplicate tracking number rejected by shipments_tracking_number_key (the 23505 the generator retries on)');

-- §20 — `cancelled` must record a reason.
select rls_test.rejects_with($$update shipments set status = 'cancelled' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0c01'$$,
  '23514', 'cancelled without a cancellation_reason rejected (§20)');
select rls_test.affects($$update shipments set status = 'cancelled', cancellation_reason = 'shipper withdrew' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0c01'$$,
  1, 'cancelled WITH a reason is accepted (non-vacuous)');

-- §5 immutability — the headline M-71 requirement.
select rls_test.rejects_with($$update shipments set tracking_number = 'PL-2026-777777' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$,
  'P0001', 'tracking_number UPDATE rejected by trg_shipments_tracking_number_immutable — as the TABLE OWNER, with RLS bypassed');
select rls_test.rejects_with($$update shipments set tracking_number = null where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$,
  'P0001', 'tracking_number cannot be nulled either');
select rls_test.rejects_with($$update shipments set tracking_number = 'PL-2026-777777'$$,
  'P0001', 'a bulk tracking-number rewrite is rejected too (row-level trigger, no set-level escape)');
select rls_test.affects($$update shipments set origin_city = 'Elizabeth' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$,
  1, 'a non-tracking-number UPDATE still succeeds — the trigger is column-scoped, not a table lock');
select rls_test.ok((select tracking_number = 'PL-2026-000101' from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'),
  'tracking number is unchanged after every rewrite attempt');
select rls_test.ok((select updated_at > created_at from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'),
  'trg_shipments_updated_at stamped the row (set_updated_at idiom)');

-- One unreleased assignment per shipment ("reassignment is a new row").
select rls_test.rejects_with($$insert into shipment_assignments (shipment_id, carrier_id) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111bbbb')$$,
  '23505', 'a second UNRELEASED assignment on one shipment is rejected by shipment_assignments_one_active');
select rls_test.affects($$update shipment_assignments set released_at = now(), release_reason = 'test reassignment' where id = 'fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01'$$,
  1, 'releasing the active assignment succeeds');
select rls_test.affects($$insert into shipment_assignments (shipment_id, carrier_id) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111bbbb')$$,
  1, 'a reassignment AFTER release is allowed — append-only history, not a lock (non-vacuous)');

-- §2 gate — close it again and prove it refuses the owner.
update company_settings set value = 'false'::jsonb where key = 'brokerage_active';
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-000501','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  'P0001', 'trg_shipments_brokerage_gate refuses INSERT while brokerage_active is false — as the TABLE OWNER (the service role has strictly fewer privileges)');
select rls_test.affects($$update shipments set delay_minutes = 30 where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$,
  1, 'the closed gate does NOT block updates to an in-flight shipment (INSERT-only by design — freight already moving must stay operable)');
select rls_test.affects($$update shipments set status = 'cancelled', cancellation_reason = 'gate closed mid-flight' where id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'$$,
  1, 'an in-flight shipment can still be CANCELLED while the gate is closed');

-- Fail-closed: with the key removed entirely the gate must still refuse.
delete from company_settings where key = 'brokerage_active';
select rls_test.rejects_with($$insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-000502','22222222-2222-2222-2222-2222222aaaaa','Newark','NJ','Atlanta','GA','dry-van')$$,
  'P0001', 'the §2 gate FAILS CLOSED when brokerage_active is missing entirely');
insert into company_settings (key, value, description) values
  ('brokerage_active', 'false', 'restored by the M-71 suite');

reset role;
set request.jwt.claim.sub = '';

-- ===========================================================================
-- 8 · M-72 — shipment_events (migration 0019)
--
-- §7's visibility bands, proved per audience. The fixtures put ONE event of
-- each of the five bands on shipment A, so every count below is a statement
-- about the band list in that audience's policy rather than about how many
-- rows happen to exist. Every zero is paired with a positive control.
--
-- §7's one absolute sentence — "a staff-only note must never appear in the
-- customer timeline" — is asserted four times: once per customer audience,
-- plus anon.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 8a · Shipper A — bands ['public', 'shipper']
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';

select rls_test.eq((select count(*) from shipment_events), 2,
  'shipperA sees exactly 2 events — the public and shipper bands, out of 7 rows');
select rls_test.eq((select count(*) from shipment_events where visibility = 'public'), 1,
  'shipperA sees the public band (positive control — the 2 above is not an empty table)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'shipper'), 1,
  'shipperA sees its own shipper band');
select rls_test.eq((select count(*) from shipment_events where visibility = 'staff_only'), 0,
  'shipperA CANNOT read a staff_only event (§7: a staff-only note must never appear in a customer timeline)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'carrier'), 0,
  'shipperA cannot read the carrier band (the counterparty''s correspondence about their own load)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'broker'), 0,
  'shipperA cannot read the broker band');
select rls_test.eq((select count(*) from shipment_events
                    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0,
  'shipperA sees no event of shipperB''s shipment, not even its public one');
select rls_test.eq((select count(*) from shipment_events
                    where internal_message is not null), 0,
  'no row shipperA can read carries an internal_message');
select rls_test.writes_nothing($$insert into shipment_events (shipment_id, event_type, source, visibility) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','internal_note','shipper','public')$$,
  'shipperA cannot insert an event (no customer write policy exists)');
select rls_test.writes_nothing($$update shipment_events set public_message = 'edited' where id = 'ecececec-ecec-ecec-ecec-ecececec0a01'$$,
  'shipperA cannot edit an event it can read');
select rls_test.writes_nothing($$delete from shipment_events where id = 'ecececec-ecec-ecec-ecec-ecececec0a01'$$,
  'shipperA cannot delete an event it can read (§7: do not delete event history)');

-- Shipper B sees only its own shipment's public event.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select rls_test.eq((select count(*) from shipment_events), 1,
  'shipperB sees exactly 1 event — the public one on its OWN shipment');
select rls_test.eq((select count(*) from shipment_events
                    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0,
  'shipperB sees nothing of shipperA''s timeline');
select rls_test.eq((select count(*) from shipment_events where visibility = 'staff_only'), 0,
  'shipperB cannot read the staff_only note about its own detention dispute');

-- ---------------------------------------------------------------------------
-- 8b · Carrier A — bands ['public', 'carrier']
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

select rls_test.eq((select count(*) from shipment_events), 2,
  'carrierA sees exactly 2 events — the public and carrier bands');
select rls_test.eq((select count(*) from shipment_events where visibility = 'carrier'), 1,
  'carrierA sees its own carrier band (positive control)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'shipper'), 0,
  'carrierA CANNOT read a shipper-band event (§7 bands do not nest)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'staff_only'), 0,
  'carrierA cannot read a staff_only event');
select rls_test.eq((select count(*) from shipment_events where visibility = 'broker'), 0,
  'carrierA cannot read the broker band');
select rls_test.writes_nothing($$insert into shipment_events (shipment_id, event_type, status, source, visibility) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','status_change','delivered','carrier','public')$$,
  'carrierA cannot insert a status_change event directly (§20: transitions go through the engine, not the table)');

-- A carrier A MEMBER (not the owner) reaches the same rows through membership.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select rls_test.eq((select count(*) from shipment_events), 2,
  'a carrierA member sees the same 2 events (membership, not ownership — M-57)');

-- Carrier B is assigned a different shipment and sees only its own.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select rls_test.eq((select count(*) from shipment_events
                    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0,
  'carrierB sees no event of carrierA''s shipment');
select rls_test.eq((select count(*) from shipment_events), 1,
  'carrierB sees exactly the public event on its OWN shipment (positive control)');

-- ---------------------------------------------------------------------------
-- 8c · Broker A — bands ['public', 'broker']
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';

select rls_test.eq((select count(*) from shipment_events), 2,
  'brokerA sees exactly 2 events — the public and broker bands (§12: status and timeline)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'broker'), 1,
  'brokerA sees its own broker band (positive control)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'shipper'), 0,
  'brokerA cannot read the shipper band (§12: no shipper billing or commercial correspondence)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'carrier'), 0,
  'brokerA cannot read the carrier band (§12: the carrier''s private packet is on the must-not-see list)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'staff_only'), 0,
  'brokerA cannot read a staff_only event (§12: no internal margin)');
select rls_test.writes_nothing($$insert into shipment_events (shipment_id, event_type, source, visibility) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','public_update','dispatcher','public')$$,
  'brokerA cannot insert an event');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab02';
select rls_test.eq((select count(*) from shipment_events
                    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0,
  'brokerB sees no event of brokerA''s linked shipment');
select rls_test.eq((select count(*) from shipment_events), 1,
  'brokerB sees exactly the public event on its OWN linked shipment (positive control)');

-- Broker C's organization is invited but NOT admin-approved (§12).
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab03';
select rls_test.eq((select count(*) from shipment_events), 0,
  'a member of an UNAPPROVED broker organization reads no event at all (my_broker_partner_ids filters on active)');

-- ---------------------------------------------------------------------------
-- 8d · Non-member and anon
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select rls_test.reads_nothing('shipment_events',
  'an authenticated non-member reads no shipment event');
select rls_test.writes_nothing($$insert into shipment_events (shipment_id, event_type, source) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','internal_note','shipper')$$,
  'a non-member cannot insert an event');

set role anon;
set request.jwt.claim.sub = '';
select rls_test.reads_nothing('shipment_events',
  'anon reads NO shipment event — §19 forbids anonymous shipment SELECT; M-73 goes through the service role');
select rls_test.rejects_with($$insert into shipment_events (shipment_id, event_type, source) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','public_update','dispatcher')$$,
  '42501', 'anon cannot insert a shipment event');

-- ---------------------------------------------------------------------------
-- 8e · Staff — the control that makes every zero above a policy result
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select rls_test.eq((select count(*) from shipment_events), 7,
  'the dispatcher reads all 7 events across both shipments (so the counts above are policy, not an empty table)');
select rls_test.eq((select count(*) from shipment_events where visibility = 'staff_only'), 2,
  'the dispatcher reads both staff_only notes');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.eq((select count(*) from shipment_events), 7,
  'the admin reads all 7 events');
select rls_test.affects($$insert into shipment_events (id, shipment_id, event_type, source, visibility, internal_message) values ('ecececec-ecec-ecec-ecec-ecececec0a06','ffffffff-ffff-ffff-ffff-ffffffff0a01','internal_note','admin','staff_only','staff can append')$$,
  1, 'staff CAN append an event (non-vacuous: the customer refusals above are not a missing grant)');
select rls_test.writes_nothing($$update shipment_events set internal_message = 'edited by staff' where id = 'ecececec-ecec-ecec-ecec-ecececec0a06'$$,
  'even STAFF cannot edit an event — the append-only trigger is not an RLS policy');

-- ---------------------------------------------------------------------------
-- 8f · Table guarantees, asserted as the TABLE OWNER with RLS bypassed.
--
-- Anything that still fails here can only be a CHECK, a unique index or a
-- trigger — the guarantees that survive the service role, not just the browser
-- session (BYPASSRLS is not BYPASSTRIGGER, and disabling a trigger needs table
-- ownership, which the API role does not have).
-- ---------------------------------------------------------------------------
reset role;
set request.jwt.claim.sub = '';

-- §7: "Do not delete event history silently."
select rls_test.rejects_with($$update shipment_events set public_message = 'rewritten' where id = 'ecececec-ecec-ecec-ecec-ecececec0a01'$$,
  'P0001', 'an event UPDATE is refused by trg_shipment_events_append_only — as the TABLE OWNER, with RLS bypassed');
select rls_test.rejects_with($$delete from shipment_events where id = 'ecececec-ecec-ecec-ecec-ecececec0a01'$$,
  'P0001', 'an event DELETE is refused by the same trigger');
select rls_test.rejects_with($$delete from shipment_events$$,
  'P0001', 'a bulk delete is refused too (row-level trigger, no set-level escape)');
select rls_test.rejects_with($$delete from shipments where id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'$$,
  'P0001', 'a shipment with events cannot be deleted — the ON DELETE CASCADE fires the append-only trigger (documented consequence, not an accident)');
select rls_test.eq((select count(*) from shipment_events), 8,
  'every row survives every deletion attempt');

-- Idempotency: a retried write cannot double-append.
select rls_test.rejects_with($$insert into shipment_events (shipment_id, event_type, source, idempotency_key) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','internal_note','dispatcher','idem-a-1')$$,
  '23505', 'a duplicate idempotency_key is rejected by shipment_events_idempotency_key');
select rls_test.rejects_with($$insert into shipment_events (shipment_id, event_type, source, idempotency_key) values ('ffffffff-ffff-ffff-ffff-ffffffff0b01','internal_note','dispatcher','idem-a-1')$$,
  '23505', 'the idempotency key is GLOBAL — the same key on another shipment is still a replay, not a new event');
select rls_test.affects($$insert into shipment_events (shipment_id, event_type, source, idempotency_key) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','internal_note','dispatcher','idem-a-2')$$,
  1, 'a DIFFERENT idempotency key inserts normally (non-vacuous)');
select rls_test.affects($$insert into shipment_events (shipment_id, event_type, source) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','internal_note','dispatcher')$$,
  1, 'many events may carry a NULL idempotency key — the index is partial');

-- Provider dedupe (§9 Mode C): unique per shipment, not globally.
select rls_test.rejects_with($$insert into shipment_events (shipment_id, event_type, source, external_event_id) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','location_update','eld','prov-evt-a-1')$$,
  '23505', 'a duplicate provider event id on the SAME shipment is rejected (§9: prevent duplicate provider events)');
select rls_test.affects($$insert into shipment_events (shipment_id, event_type, source, external_event_id) values ('ffffffff-ffff-ffff-ffff-ffffffff0b01','location_update','eld','prov-evt-a-1')$$,
  1, 'the same provider event id on a DIFFERENT shipment is allowed — provider ids are unique within a stream');

-- Shape CHECKs.
select rls_test.rejects_with($$insert into shipment_events (shipment_id, event_type, source) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','status_change','dispatcher')$$,
  '23514', 'a status_change with no status is rejected by shipment_events_status_change_has_status');
select rls_test.rejects_with($$insert into shipment_events (shipment_id, event_type, status, source) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','correction','delivered','admin')$$,
  '23514', 'a correction with no reason is rejected by shipment_events_correction_has_reason (§20: mandatory reason)');
select rls_test.affects($$insert into shipment_events (shipment_id, event_type, status, source, internal_message) values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','correction','delivered','admin','keyed against the wrong shipment')$$,
  1, 'a correction WITH a reason is accepted (non-vacuous)');

-- The write functions are not reachable from a browser session.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.rejects_with($$select apply_shipment_transition('ffffffff-ffff-ffff-ffff-ffffffff0a01','in_transit','arrived_at_delivery','dispatcher')$$,
  '42501', 'even an ADMIN session cannot call apply_shipment_transition — EXECUTE is granted to service_role only');
select rls_test.rejects_with($$select apply_shipment_correction('ffffffff-ffff-ffff-ffff-ffffffff0a01','in_transit','picked_up','typo')$$,
  '42501', 'nor apply_shipment_correction');
select rls_test.rejects_with($$select shipment_transition_facts('ffffffff-ffff-ffff-ffff-ffffffff0a01')$$,
  '42501', 'nor even the SECURITY DEFINER facts read');

set role anon;
set request.jwt.claim.sub = '';
select rls_test.rejects_with($$select append_shipment_event('ffffffff-ffff-ffff-ffff-ffffffff0a01','public_update','dispatcher')$$,
  '42501', 'anon cannot call append_shipment_event');

reset role;
set request.jwt.claim.sub = '';

-- ===========================================================================
-- 9 · M-73 / 0020 — `shipment_tracking_access` (§19 access log + enumeration)
-- ===========================================================================
--
-- Four things are proved here, in order of how badly each would hurt:
--
--   9a  the table CANNOT hold the attempted secondary value — asserted as an
--       exact column set, so adding such a column fails this suite;
--   9b  nobody but staff can read the ledger (anon, shipper, carrier, broker);
--   9c  nobody at all can WRITE it through a browser session, staff included —
--       the ledger is written by the service role or not at all;
--   9d  it is append-only for every role, table owner included.

-- Two ledger rows to assert against: one granted access to shipment A, one
-- enumeration miss with no shipment at all. Written as the table OWNER, which
-- is what the service-role client is in this fixture database.
reset role;
set request.jwt.claim.sub = '';
insert into shipment_tracking_access
  (id, shipment_id, tracking_number_attempted, outcome, ip, user_agent) values
  ('ada00000-0000-0000-0000-00000000a001', 'ffffffff-ffff-ffff-ffff-ffffffff0a01',
   'PL-2026-000101', 'granted', '198.51.100.10', 'Mozilla/5.0 (test)'),
  ('ada00000-0000-0000-0000-00000000a002', null,
   'PL-2026-999999', 'not_found', '198.51.100.99', 'curl/8.0');

-- ---------------------------------------------------------------------------
-- 9a · THE COLUMN THAT MUST NOT EXIST
-- ---------------------------------------------------------------------------
--
-- M-70's doc and 0020's header both say the attempted SECONDARY VALUE is never
-- stored "in any form, hashed or otherwise". A comment cannot enforce that, and
-- a future migration adding `secondary_hash` for the best of reasons would slip
-- through review. An EXACT column-set assertion cannot: it fails on any added
-- column, which forces the decision back into a review.
select rls_test.ok(
  (select array_agg(column_name::text order by column_name)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'shipment_tracking_access')
  = array['accessed_at','id','ip','outcome','profile_id','shipment_id',
          'tracking_number_attempted','user_agent'],
  'shipment_tracking_access has EXACTLY the 8 columns of M-70''s ShipmentTrackingAccessRow — no column exists that could hold the attempted secondary value (§4)');

-- The positive half: the attempted NUMBER is stored, because that is the thing
-- being guessed and the ledger is useless without it.
select rls_test.eq((select count(*) from shipment_tracking_access
                     where tracking_number_attempted = 'PL-2026-999999'), 1,
  'the attempted tracking NUMBER is stored — an enumeration ledger that does not record the guess records nothing');

-- ---------------------------------------------------------------------------
-- 9b · Reads — staff only
-- ---------------------------------------------------------------------------
set role anon;
set request.jwt.claim.sub = '';
select rls_test.reads_nothing('shipment_tracking_access',
  'anon reads NOTHING from the access ledger (§19: no anon SELECT — an anon policy would publish our enumeration telemetry to the party generating it)');

set role authenticated;
-- Shipper A owns shipment A, whose access row this is. Still nothing: §15 makes
-- access history an ADMIN capability, and the rows carry third-party IPs.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select rls_test.reads_nothing('shipment_tracking_access',
  'the OWNING shipper cannot read the access ledger for their own shipment (the rows carry third-party IPs and user agents)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select rls_test.reads_nothing('shipment_tracking_access',
  'the assigned carrier cannot read the access ledger');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';
select rls_test.reads_nothing('shipment_tracking_access',
  'a broker partner cannot read the access ledger');

-- The control that makes every zero above a POLICY result and not an empty
-- table.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select rls_test.eq((select count(*) from shipment_tracking_access), 2,
  'the dispatcher reads both ledger rows (so the zeros above are policy, not an empty table)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.eq((select count(*) from shipment_tracking_access where outcome = 'not_found'), 1,
  'the admin reads the enumeration row, whose shipment_id is null');

-- ---------------------------------------------------------------------------
-- 9c · Writes — nobody, through a session
-- ---------------------------------------------------------------------------
--
-- 0020 creates ONE policy (staff SELECT) and no write policy at all. A staff
-- session that could insert here could forge the evidence, so the absence is
-- the feature.
select rls_test.writes_nothing($$insert into shipment_tracking_access (tracking_number_attempted, outcome) values ('PL-2026-000101','granted')$$,
  'even an ADMIN session cannot INSERT into the access ledger — every row arrives through the service role');
set role anon;
set request.jwt.claim.sub = '';
select rls_test.writes_nothing($$insert into shipment_tracking_access (tracking_number_attempted, outcome) values ('PL-2026-000101','granted')$$,
  'anon cannot INSERT into the access ledger');
select rls_test.writes_nothing($$delete from shipment_tracking_access$$,
  'anon cannot DELETE from the access ledger');

-- ---------------------------------------------------------------------------
-- 9d · Append-only, asserted as the TABLE OWNER with RLS bypassed
-- ---------------------------------------------------------------------------
--
-- Anything that still fails here is a trigger, not a policy — the guarantee
-- that survives the service role (BYPASSRLS is not BYPASSTRIGGER).
reset role;
set request.jwt.claim.sub = '';
select rls_test.rejects_with($$update shipment_tracking_access set outcome = 'granted' where id = 'ada00000-0000-0000-0000-00000000a002'$$,
  'P0001', 'an access-log UPDATE is refused by trg_shipment_tracking_access_append_only — as the TABLE OWNER, with RLS bypassed');
select rls_test.rejects_with($$delete from shipment_tracking_access where id = 'ada00000-0000-0000-0000-00000000a002'$$,
  'P0001', 'an access-log DELETE is refused by the same trigger');
select rls_test.rejects_with($$delete from shipment_tracking_access$$,
  'P0001', 'a bulk delete is refused too (row-level trigger, no set-level escape)');
select rls_test.eq((select count(*) from shipment_tracking_access), 2,
  'both ledger rows survive every tampering attempt');
select rls_test.affects($$insert into shipment_tracking_access (tracking_number_attempted, outcome, ip) values ('PL-2026-000303','bad_secondary','203.0.113.7')$$,
  1, 'the service role CAN append (non-vacuous: the refusals above are not a missing grant)');

-- Bounds: 0020's CHECKs, not just the application's truncation.
select rls_test.rejects_with($$insert into shipment_tracking_access (tracking_number_attempted, outcome) values (repeat('X', 65), 'not_found')$$,
  '23514', 'a 65-character attempted number is rejected by the length CHECK — the ledger is not free storage for a script');
select rls_test.rejects_with($$insert into shipment_tracking_access (tracking_number_attempted, outcome, user_agent) values ('PL-2026-000404','not_found', repeat('U', 513))$$,
  '23514', 'a 513-character user agent is rejected by the length CHECK');

reset role;
set request.jwt.claim.sub = '';

-- ===========================================================================
-- 10 · M-74 / migration 0021 — shipper-facing invoices (§11 "invoice status")
--
-- 0021 adds `invoices.shipment_id` + `invoices.shipper_id` and ONE policy:
-- `"member read shipper invoices"`, `shipper_id in (select my_shipper_ids())`.
-- Everything below is about that one policy, because a new SELECT policy on a
-- table that already holds every carrier's billing history is the highest-risk
-- line in this module.
--
-- The three questions worth answering:
--   a. does a shipper see EXACTLY their own invoice — not the other shipper's,
--      and not any of the CARRIER invoices that predate the column?
--   b. does the migration make any EXISTING row newly visible? (Every pre-0021
--      row has shipper_id null, and `null in (…)` is NULL, never true.)
--   c. can a shipper WRITE one? (0009's doctrine: customers get SELECT.)
-- ===========================================================================

reset role;
set request.jwt.claim.sub = '';
set role authenticated;

-- ---------------------------------------------------------------------------
-- 10a · Shipper A vs shipper B
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.eq((select count(*) from invoices), 1,
  'shipper A sees EXACTLY one invoice — its own (not shipper B''s, and not either CARRIER invoice)');
select rls_test.eq((select count(*) from invoices
                     where id = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0a01'), 1,
  'shipper A reads its own invoice by id');
select rls_test.eq((select count(*) from invoices
                     where id = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0b01'), 0,
  'shipper A cannot read shipper B''s invoice by id (§3: not through URL manipulation either)');
select rls_test.eq((select count(*) from invoices
                     where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0,
  'shipper A cannot reach shipper B''s invoice through its SHIPMENT id');
select rls_test.eq((select count(*) from invoices where carrier_id is not null
                      and shipper_id is null), 0,
  'shipper A sees NONE of the pre-0021 carrier dispatch-fee invoices');
select rls_test.eq((select count(*) from invoices where amount_cents = 240000), 1,
  'the amount a shipper sees is its OWN invoice amount — §11 invoice status, read from `invoices`');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select rls_test.eq((select count(*) from invoices), 1,
  'shipper B sees exactly one invoice — the mirror case, so neither zero above is an empty table');
select rls_test.eq((select count(*) from invoices
                     where id = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0a01'), 0,
  'shipper B cannot read shipper A''s invoice');

-- ---------------------------------------------------------------------------
-- 10b · The migration widened nothing that already existed
-- ---------------------------------------------------------------------------
--
-- Carrier A's own invoice must still be readable by carrier A (0009's policy,
-- untouched) and still unreadable by everyone else. If 0021 had been written
-- with `using (true)` or with a null-tolerant predicate, one of these flips.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select rls_test.eq((select count(*) from invoices
                     where id = '77777777-7777-7777-7777-77777777aaaa'), 1,
  'carrier A still reads its own dispatch-fee invoice (0009 untouched by 0021)');
select rls_test.eq((select count(*) from invoices
                     where id = '77777777-7777-7777-7777-77777777bbbb'), 0,
  'carrier A still cannot read carrier B''s invoice');
select rls_test.eq((select count(*) from invoices where shipper_id is not null), 0,
  'carrier A cannot read a SHIPPER invoice for the shipment carrier A is hauling — 0021 makes that STRUCTURAL by leaving carrier_id null, so 0009''s carrier policy cannot match it and the shipper gross (and therefore the margin) stays staff-only');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';
select rls_test.reads_nothing('invoices',
  'a broker partner reads no invoice at all (§12: "shipper billing" is on the must-not-see list)');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select rls_test.reads_nothing('invoices',
  'a profile with no membership reads no invoice');

reset role;
set request.jwt.claim.sub = '';
set role anon;
select rls_test.reads_nothing('invoices',
  'anon reads no invoice — 0021 added no anon policy');

-- ---------------------------------------------------------------------------
-- 10c · Customers read; they do not write
-- ---------------------------------------------------------------------------
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.writes_nothing($$update invoices set status = 'paid' where id = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0a01'$$,
  'a shipper cannot mark its own invoice paid — 0021 adds a SELECT policy and nothing else');
select rls_test.writes_nothing($$update invoices set amount_cents = 1 where id = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0a01'$$,
  'a shipper cannot rewrite its own invoice amount');
select rls_test.writes_nothing($$delete from invoices where id = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0a01'$$,
  'a shipper cannot delete its own invoice');
select rls_test.denied($$insert into invoices (carrier_id, shipper_id, amount_cents) values ('11111111-1111-1111-1111-11111111aaaa','22222222-2222-2222-2222-2222222aaaaa', 1)$$,
  'a shipper cannot raise an invoice against itself');
select rls_test.writes_nothing($$update invoices set shipper_id = '22222222-2222-2222-2222-2222222aaaaa' where id = '77777777-7777-7777-7777-77777777bbbb'$$,
  'a shipper cannot CLAIM another party''s invoice by writing its own shipper_id onto it');

-- ---------------------------------------------------------------------------
-- 10d · Staff, the non-vacuity control
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.eq((select count(*) from invoices), 4,
  'the admin reads all four invoices — so every zero above is a POLICY result, not an empty table');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select rls_test.eq((select count(*) from invoices where shipment_id is not null), 2,
  'the dispatcher reads both shipment-linked invoices');

-- ---------------------------------------------------------------------------
-- 10e · The schema half, asserted as the TABLE OWNER
-- ---------------------------------------------------------------------------
--
-- Anything that fails here is a constraint, not a policy.
reset role;
set request.jwt.claim.sub = '';
select rls_test.ok(
  (select count(*) from information_schema.columns
    where table_name = 'invoices' and column_name in ('shipment_id','shipper_id')) = 2,
  '0021 added exactly the two columns §11 needs');
select rls_test.ok(
  (select is_nullable from information_schema.columns
    where table_name = 'invoices' and column_name = 'carrier_id') = 'YES',
  'invoices.carrier_id is nullable — a shipper invoice must name NO carrier (see 0021''s header)');
select rls_test.rejects_with($$insert into invoices (amount_cents) values (1)$$,
  '23514', 'an invoice naming NEITHER a carrier nor a shipper is refused by invoices_party_present — the invariant the NOT NULL used to carry survives, in the form that actually mattered');
select rls_test.affects($$insert into invoices (carrier_id, amount_cents) values ('11111111-1111-1111-1111-11111111aaaa', 1)$$,
  1, 'a carrier-only invoice still inserts (non-vacuous: the refusal above is the CHECK, not a broken statement)');
select rls_test.affects($$delete from invoices where amount_cents = 1$$,
  1, 'clean-up, so the staff counts above stay meaningful for any later section');
select rls_test.rejects_with($$insert into invoices (shipper_id, shipment_id, amount_cents) values ('22222222-2222-2222-2222-2222222aaaaa','00000000-0000-0000-0000-0000000000ff', 1)$$,
  '23503', 'a shipment_id that does not exist is refused by invoices_shipment_id_fkey — an invoice cannot point at a shipment that was never created');
select rls_test.ok(
  (select count(*) from pg_indexes where tablename = 'invoices'
     and indexname in ('idx_invoices_shipment','idx_invoices_shipper')) = 2,
  'both §25 indexes exist (the §11 detail lookup and the outstanding-invoices tile)');

reset role;
set request.jwt.claim.sub = '';

-- ===========================================================================
-- 11 · M-75 / 0022 — the dispatcher write path (§14, §19)
-- ===========================================================================
--
-- 0022 adds FOUR functions and NOTHING else: no table, no policy, no enum, no
-- trigger, no grant on any table. So there is no new row-access surface to
-- prove — the whole security question is *who may EXECUTE them*, and the
-- answer must be exactly what 0019 established: `service_role`, and nobody
-- else. An admin session that could call `create_shipment` directly would
-- bypass M-75's §2 service-layer gate, its Zod validation and its audit
-- writer in one step, which is precisely the hole the grant model closes.
--
-- Proved from BOTH a browser-reachable roles: an authenticated ADMIN (the
-- strongest session that exists) and anon. Then the schema facts, asserted as
-- the table OWNER so nothing can pass because a policy allowed it.
-- ===========================================================================

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';

select rls_test.rejects_with($$select create_shipment('{"tracking_number":"PL-2026-000001"}'::jsonb)$$,
  '42501', 'even an ADMIN session cannot call create_shipment — EXECUTE is service_role only (M-75 §2 gate and audit writer live above it)');
select rls_test.rejects_with($$select assign_shipment_carrier('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111aaaa')$$,
  '42501', 'nor assign_shipment_carrier');
select rls_test.rejects_with($$select release_shipment_assignment('ffffffff-ffff-ffff-ffff-ffffffff0a01')$$,
  '42501', 'nor release_shipment_assignment');
select rls_test.rejects_with($$select set_shipment_eta('ffffffff-ffff-ffff-ffff-ffffffff0a01','delivery',now(),'manual')$$,
  '42501', 'nor set_shipment_eta');

set role anon;
set request.jwt.claim.sub = '';
select rls_test.rejects_with($$select create_shipment('{"tracking_number":"PL-2026-000002"}'::jsonb)$$,
  '42501', 'anon cannot call create_shipment');
select rls_test.rejects_with($$select set_shipment_eta('ffffffff-ffff-ffff-ffff-ffffffff0a01','delivery',now(),'manual')$$,
  '42501', 'anon cannot call set_shipment_eta');

reset role;
set request.jwt.claim.sub = '';

-- The grant model itself, read out of the catalog rather than inferred from
-- the four refusals above: a function that is EXECUTE-able by PUBLIC would
-- make every one of them pass for the wrong reason.
select rls_test.ok(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_shipment','assign_shipment_carrier',
                        'release_shipment_assignment','set_shipment_eta')
      and p.prosecdef) = 4,
  'all four 0022 functions are SECURITY DEFINER (M-72''s model, unchanged)');
select rls_test.ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_shipment','assign_shipment_carrier',
                        'release_shipment_assignment','set_shipment_eta')),
  'service_role CAN execute all four — the non-vacuity control for the 42501s above');
select rls_test.ok(
  (select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  or has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_shipment','assign_shipment_carrier',
                        'release_shipment_assignment','set_shipment_eta')) = false,
  'NEITHER authenticated NOR anon holds EXECUTE on any of the four (the REVOKE FROM PUBLIC held)');

-- M-78 (0025) INVERTED this assertion. It read, through M-77:
--
--   'M-75 did NOT create shipment_exceptions or shipment_eta_history — both
--    are M-78''s, and a half-created table is a specification that has
--    started to rot'
--
-- The deferral is over. Both tables now exist, both carry M-70's column lists,
-- and §13 below proves what each audience may read from them. Keeping the old
-- assertion would fail the suite; deleting it without saying so would erase
-- the record of a deliberate deferral being honoured.
select rls_test.ok(
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('shipment_exceptions','shipment_eta_history')) = 2,
  'M-78 created BOTH tables M-71 deferred — the deferral was honoured, not forgotten');

-- §5 immutability survives everything M-75 added. Asserted as the OWNER, so
-- the refusal can only be the 0017 trigger.
select rls_test.rejects_with($$update shipments set tracking_number = 'PL-2026-123456' where tracking_number = 'PL-2026-000101'$$,
  'P0001', 'no M-75 path changes a tracking number — the 0017 immutability trigger still refuses the table owner (§5)');

-- ===========================================================================
-- §12 · M-76 — driver update links (migration 0023)
--
-- The section exists to prove FOUR things the module is accountable for:
--
--   1. THE CARRIER READ POLICY ON `shipments` WAS NOT WIDENED.
--      `docs/modules/M-71-shipment-schema.md` says it in those words: *"Do
--      not widen 'carrier member read shipments' into a FOR ALL."* Asserted
--      as a CATALOG FACT (`pg_policies.cmd`), not inferred from a refusal, so
--      a future `for all` fails here even if every behavioural assertion
--      still happened to pass.
--   2. `token_hash` IS UNREACHABLE from any browser role — at the COLUMN
--      privilege level, which is stronger than any policy.
--   3. Carrier A reads its own links and nothing of carrier B's; anon reads
--      nothing at all; nobody writes.
--   4. All four 0023 functions are service_role-only, read out of `pg_proc`.
-- ===========================================================================

reset role;
set request.jwt.claim.sub = '';

-- ---- 1 · the policy was not widened ---------------------------------------
select rls_test.ok(
  (select cmd from pg_policies
    where schemaname = 'public' and tablename = 'shipments'
      and policyname = 'carrier member read shipments') = 'SELECT',
  'M-76 did NOT widen "carrier member read shipments" — it is still FOR SELECT (M-71''s explicit instruction)');

select rls_test.ok(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('shipments','shipment_events','shipment_parties','shipment_assignments')
      and cmd <> 'SELECT'
      and policyname not like 'staff %') = 0,
  'no NON-staff policy on any shipment table is anything but SELECT — carriers still have no write surface');

select rls_test.ok(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'shipments') = 4,
  'shipments still carries exactly 4 policies (staff/shipper/carrier/broker) — M-76 added none');

-- ---- 2 · the credential column -------------------------------------------
select rls_test.ok(
  has_column_privilege('authenticated', 'shipment_driver_tokens', 'token_hash', 'SELECT') = false,
  'authenticated CANNOT select shipment_driver_tokens.token_hash — column-level REVOKE, stronger than any policy');
select rls_test.ok(
  has_column_privilege('anon', 'shipment_driver_tokens', 'token_hash', 'SELECT') = false,
  'anon cannot select token_hash either');
select rls_test.ok(
  has_column_privilege('authenticated', 'shipment_driver_tokens', 'expires_at', 'SELECT'),
  'authenticated CAN select expires_at — the non-vacuity control for the two refusals above');
select rls_test.ok(
  has_table_privilege('authenticated', 'shipment_driver_tokens', 'INSERT') = false
    and has_table_privilege('authenticated', 'shipment_driver_tokens', 'UPDATE') = false
    and has_table_privilege('authenticated', 'shipment_driver_tokens', 'DELETE') = false,
  'authenticated holds NO write privilege on shipment_driver_tokens at all');
-- The ledger keeps a table-level SELECT for `authenticated` on purpose: its
-- policy is `is_staff()`, and revoking the privilege would make that policy
-- dead code and §15''s "view access history" unimplementable. What matters is
-- that a CARRIER session reaching the table reads ZERO rows — a policy result,
-- asserted below — while anon cannot reach it at all.
select rls_test.ok(
  has_table_privilege('anon', 'shipment_driver_token_access', 'SELECT') = false,
  'ANON holds no SELECT on the driver-link access ledger — it is the platform''s own enumeration telemetry');
select rls_test.ok(
  has_table_privilege('authenticated', 'shipment_driver_token_access', 'INSERT') = false
    and has_table_privilege('authenticated', 'shipment_driver_token_access', 'UPDATE') = false
    and has_table_privilege('authenticated', 'shipment_driver_token_access', 'DELETE') = false,
  'no browser role can WRITE the ledger — a staff session that could would be able to forge the evidence');

-- The exact column list of both tables. Adding a column able to carry a token
-- (a prefix, "the last four", a hash of an attempt) is a TEST FAILURE.
select rls_test.ok(
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'shipment_driver_tokens')
  = 'id,shipment_id,carrier_id,token_hash,driver_id,driver_name,issued_by,'
    'issued_by_role,issued_at,expires_at,revoked_at,revoked_by,revoke_reason,'
    'consent_status,consent_at,last_used_at,use_count,created_at',
  'shipment_driver_tokens has EXACTLY the M-70 column list — no second credential column crept in');
select rls_test.ok(
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'shipment_driver_token_access')
  = 'id,token_id,shipment_id,outcome,detail,ip,user_agent,accessed_at',
  'the access ledger has no column a presented token could arrive through');

-- ---- 3 · who reads what ---------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';  -- carrier A owner

select rls_test.eq((select count(*) from shipment_driver_tokens),
  3, 'carrier A reads its OWN three driver links (active + revoked + expired)');
select rls_test.eq((select count(*) from shipment_driver_tokens
                     where carrier_id = '11111111-1111-1111-1111-11111111bbbb'),
  0, 'carrier A reads NONE of carrier B''s driver links (§13 "no access to other carrier records")');
select rls_test.eq((select count(*) from shipment_driver_tokens where revoked_at is null and expires_at > now()),
  1, 'carrier A sees exactly one LIVE link — the lifecycle is legible, not just the row count');
select rls_test.reads_nothing('shipment_driver_token_access',
  'carrier A reads NOTHING of the access ledger — it carries other people''s IPs, and §15 makes access history ADMIN business');
select rls_test.writes_nothing(
  $$update shipment_driver_tokens set expires_at = now() + interval '30 days'$$,
  'carrier A cannot extend a driver link''s expiry (no UPDATE policy, no UPDATE privilege)');
select rls_test.writes_nothing(
  $$update shipment_driver_tokens set revoked_at = null$$,
  'carrier A cannot un-revoke a link by writing the column directly');
select rls_test.denied(
  $$insert into shipment_driver_tokens (shipment_id, carrier_id, token_hash, issued_by_role, expires_at)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111aaaa',
            'v1:' || repeat('e', 64), 'carrier', now() + interval '1 day')$$,
  'carrier A cannot mint a driver link with a hash it chose — issuance is a service-role function');

-- A carrier MEMBER (not the owner) gets the same view: membership, not
-- ownership, is the key — the same rule 0018 applies to shipments.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select rls_test.eq((select count(*) from shipment_driver_tokens),
  3, 'a carrier A MEMBER reads the same three links — membership, not ownership');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';  -- carrier B owner
select rls_test.eq((select count(*) from shipment_driver_tokens),
  1, 'carrier B reads exactly its own one link');
select rls_test.eq((select count(*) from shipment_driver_tokens
                     where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'),
  0, 'carrier B reads none of shipment A''s links');

-- A shipper is not a party to the carrier's crew logistics at all.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.reads_nothing('shipment_driver_tokens',
  'a SHIPPER reads no driver link — which truck and which driver is carrier operational data (§12''s must-not-see list, applied to §13)');

-- A broker partner likewise.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';
select rls_test.reads_nothing('shipment_driver_tokens',
  'a BROKER PARTNER reads no driver link');

-- A non-member.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select rls_test.reads_nothing('shipment_driver_tokens',
  'an authenticated outsider reads no driver link');

set role anon;
set request.jwt.claim.sub = '';
select rls_test.reads_nothing('shipment_driver_tokens',
  'ANON reads no driver link — §19''s no-anon-SELECT rule holds for the credential table too');
select rls_test.reads_nothing('shipment_driver_token_access',
  'ANON reads nothing of the access ledger — it is the platform''s own enumeration telemetry');

-- Staff, which is what makes every zero above a POLICY result rather than an
-- empty table.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';  -- dispatcher
select rls_test.eq((select count(*) from shipment_driver_tokens),
  4, 'a DISPATCHER reads all four links — the non-vacuity control for every zero above');
select rls_test.eq((select count(*) from shipment_driver_token_access),
  3, 'a DISPATCHER reads the whole access ledger, enumeration rows included');
select rls_test.writes_nothing(
  $$update shipment_driver_tokens set revoke_reason = 'tampered'$$,
  'even STAFF cannot edit a driver link directly — revocation is a function, not an UPDATE');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';  -- admin
select rls_test.eq((select count(*) from shipment_driver_tokens),
  4, 'an ADMIN reads all four links');

-- ---- 4 · the function grants ---------------------------------------------
select rls_test.rejects_with(
  $$select redeem_shipment_driver_token('v1:' || repeat('a', 64))$$,
  '42501', 'even an ADMIN session cannot redeem a driver link — EXECUTE is service_role only');
select rls_test.rejects_with(
  $$select issue_shipment_driver_token('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111aaaa','v1:' || repeat('f', 64), now() + interval '1 day')$$,
  '42501', 'nor issue one');
select rls_test.rejects_with(
  $$select revoke_shipment_driver_token('fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a01')$$,
  '42501', 'nor revoke one');
select rls_test.rejects_with(
  $$select set_driver_token_consent('v1:' || repeat('a', 64), true)$$,
  '42501', 'nor record consent on somebody else''s behalf');

set role anon;
set request.jwt.claim.sub = '';
select rls_test.rejects_with(
  $$select redeem_shipment_driver_token('v1:' || repeat('a', 64))$$,
  '42501', 'ANON cannot redeem a driver link — the page reaches it through a server route holding the service role');

reset role;
set request.jwt.claim.sub = '';

select rls_test.ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('issue_shipment_driver_token','revoke_shipment_driver_token',
                        'redeem_shipment_driver_token','set_driver_token_consent')
      and p.prosecdef) = 4,
  'all four 0023 functions are SECURITY DEFINER');
select rls_test.ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('issue_shipment_driver_token','revoke_shipment_driver_token',
                        'redeem_shipment_driver_token','set_driver_token_consent')),
  'service_role CAN execute all four — the non-vacuity control for the 42501s above');
select rls_test.ok(
  (select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  or has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('issue_shipment_driver_token','revoke_shipment_driver_token',
                        'redeem_shipment_driver_token','set_driver_token_consent')) = false,
  'NEITHER authenticated NOR anon holds EXECUTE on any of the four (the REVOKE FROM PUBLIC held)');

-- ---- Table guarantees, as the table OWNER ---------------------------------
-- Everything below can only be refused by a trigger or a CHECK: the owner
-- bypasses RLS entirely, so a pass here is a statement about the SCHEMA.
select rls_test.rejects_with(
  $$update shipment_driver_tokens set shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'
      where id = 'fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a01'$$,
  'P0001', 'a driver link is scoped to ONE shipment — the owner cannot re-point it (§13)');
select rls_test.rejects_with(
  $$update shipment_driver_tokens set carrier_id = '11111111-1111-1111-1111-11111111bbbb'
      where id = 'fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a01'$$,
  'P0001', 'nor hand it to another carrier');
select rls_test.rejects_with(
  $$update shipment_driver_tokens set token_hash = 'v1:' || repeat('9', 64)
      where id = 'fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a01'$$,
  'P0001', 'nor swap the credential under it');
select rls_test.rejects_with(
  $$update shipment_driver_tokens set revoked_at = null
      where id = 'fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfd0a02'$$,
  'P0001', 'revocation is ONE-WAY, even for the owner (§13 "revocable" means killed, not paused)');
select rls_test.rejects_with(
  $$update shipment_driver_token_access set outcome = 'granted'$$,
  'P0001', 'the access ledger is APPEND-ONLY for the owner — evidence, not state');
select rls_test.rejects_with(
  $$delete from shipment_driver_token_access$$,
  'P0001', 'and cannot be cleared');
select rls_test.rejects_with(
  $$insert into shipment_driver_tokens (shipment_id, carrier_id, token_hash, issued_by_role, expires_at)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111aaaa',
            'not-a-hash', 'dispatcher', now() + interval '1 day')$$,
  '23514', 'the token_hash CHECK refuses anything that is not v<n>:<64 hex>');
select rls_test.rejects_with(
  $$insert into shipment_driver_tokens (shipment_id, carrier_id, token_hash, issued_by_role, expires_at)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111aaaa',
            'v1:' || repeat('a', 64), 'dispatcher', now() + interval '1 day')$$,
  '23505', 'token_hash is UNIQUE — one link cannot open two shipments');
select rls_test.rejects_with(
  $$insert into shipment_driver_tokens (shipment_id, carrier_id, token_hash, issued_by_role, expires_at)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111aaaa',
            'v1:' || repeat('7', 64), 'driver', now() + interval '1 day')$$,
  '23514', 'issued_by_role is limited to admin/dispatcher/carrier — a DRIVER cannot issue their own link');
select rls_test.rejects_with(
  $$insert into shipment_driver_tokens (shipment_id, carrier_id, token_hash, issued_by_role, expires_at)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111aaaa',
            'v1:' || repeat('8', 64), 'dispatcher', now() - interval '1 day')$$,
  '23514', 'expires_at must follow issued_at — a link cannot be born expired');
select rls_test.rejects_with(
  $$insert into shipment_driver_tokens (shipment_id, carrier_id, token_hash, issued_by_role, expires_at, consent_status)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','11111111-1111-1111-1111-11111111aaaa',
            'v1:' || repeat('6', 64), 'dispatcher', now() + interval '1 day', 'granted')$$,
  '23514', 'consent cannot be GRANTED without a timestamp — an undated consent is not one');

-- The `consent_status` default is the privacy-first one, restated as a fact
-- about the DDL rather than about any row.
select rls_test.ok(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'shipment_driver_tokens'
      and column_name = 'consent_status') like '%pending%',
  'consent_status DEFAULTS to pending — §9/§13 consent is actively granted, never inherited');

-- ===========================================================================
-- M-77 — §16 shipment documents: the MATRIX, enforced by RLS (migration 0024)
--
-- What this block proves that no other lane can:
--
--   * the matrix is enforced by POLICIES, on real rows, per session — the unit
--     lane proves the TypeScript predicate and the integration lane proves the
--     two representations agree, but only here does a `shipper` ROLE actually
--     fail to read a rate confirmation;
--   * the two NARROWING clauses (`status <> 'approved'`, `visibility =
--     'staff_only'`) bite for every audience;
--   * anon reads nothing at all — §4 gives documents no public surface;
--   * no browser role can WRITE the table, so `add_shipment_document()` and
--     `review_shipment_document()` are the only doors and the per-uploader
--     allow-list cannot be bypassed by a hand-rolled insert.
--
-- The fixtures put SEVEN documents on shipment A, one per matrix outcome, so
-- every count below is a statement about a band list rather than about an
-- empty table.
-- ===========================================================================

\echo '--- M-77 · §16 document visibility matrix (0024) ---'

-- ---- 1 · the matrix table itself -----------------------------------------
-- It is POLICY, not data about anyone: readable by every authenticated role
-- so a policy can join it, unreachable by anon, and writable by nobody.
select rls_test.ok(
  has_table_privilege('authenticated', 'shipment_document_audiences', 'SELECT'),
  'authenticated CAN read the §16 matrix — a policy that joins it has to');
select rls_test.ok(
  has_table_privilege('anon', 'shipment_document_audiences', 'SELECT') = false,
  'ANON cannot read the §16 matrix');
select rls_test.ok(
  has_table_privilege('authenticated', 'shipment_document_audiences', 'INSERT') = false
    and has_table_privilege('authenticated', 'shipment_document_audiences', 'UPDATE') = false
    and has_table_privilege('authenticated', 'shipment_document_audiences', 'DELETE') = false,
  'no browser role can EDIT the matrix — changing who may see a POD is a migration, not an UPDATE');
select rls_test.ok(
  (select count(*) from shipment_document_audiences where audience = 'public') = 0,
  'the matrix contains NO public cell (§4, §16)');
select rls_test.ok(
  (select count(*) from shipment_document_audiences where audience = 'staff_only') = 0,
  'the matrix contains no staff_only cell either — staff access is the FLOOR, not a band');
-- The §16 sentences, as rows. If one of these is missing the directive is not
-- implemented, whatever the policies say.
select rls_test.ok(
  (select count(*) from shipment_document_audiences
    where (doc_type, audience) in (
      ('bol','shipper'), ('bol','carrier'), ('bol','broker'),
      ('pod','shipper'), ('pod','carrier'), ('pod','broker'),
      ('rate_confirmation','carrier'), ('invoice','shipper'))) = 8,
  '§16/§12''s eight named cells are all present');
select rls_test.ok(
  (select count(*) from shipment_document_audiences where doc_type = 'claim') = 0,
  '`claim` has NO customer cell — §16 "private claim review"');
select rls_test.ok(
  (select count(*) from shipment_document_audiences
    where doc_type = 'rate_confirmation' and audience <> 'carrier') = 0,
  'the carrier rate confirmation reaches the CARRIER and nobody else (§4, §12)');

-- ---- 2 · the table's own guarantees, as the OWNER -------------------------
-- The owner bypasses RLS entirely, so a pass here is a statement about the
-- SCHEMA: only a trigger or a CHECK can refuse it.
reset role;
select rls_test.rejects_with(
  $$insert into shipment_documents (shipment_id, doc_type, visibility, storage_path, file_name)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'rate_confirmation', 'shipper',
            'ffffffff-ffff-ffff-ffff-ffffffff0a01/x-rc.pdf', 'x.pdf')$$,
  'PL422',
  'a rate confirmation CANNOT be filed as shipper-visible — §4 is a database rule here');
select rls_test.rejects_with(
  $$insert into shipment_documents (shipment_id, doc_type, visibility, storage_path, file_name)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'bol', 'public',
            'ffffffff-ffff-ffff-ffff-ffffffff0a01/x-pub.pdf', 'x.pdf')$$,
  'PL422',
  'NO document may be filed public (§16 "do not put shipment documents in public buckets")');
select rls_test.rejects_with(
  $$insert into shipment_documents (shipment_id, doc_type, visibility, storage_path, file_name)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'claim', 'shipper',
            'ffffffff-ffff-ffff-ffff-ffffffff0a01/x-cl.pdf', 'x.pdf')$$,
  'PL422',
  'a claim document cannot be widened to a customer at all');
select rls_test.rejects_with(
  $$update shipment_documents set storage_path = 'ffffffff-ffff-ffff-ffff-ffffffff0a01/relink.pdf'
     where id = 'fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a01'$$,
  'PL409',
  'a filed document cannot be re-pointed at a different object — approval would survive the swap');
select rls_test.rejects_with(
  $$update shipment_documents set doc_type = 'pod'
     where id = 'fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a01'$$,
  'PL409',
  'an approved BOL cannot be re-typed into an approved POD');
select rls_test.rejects_with(
  $$update shipment_documents set status = 'approved'
     where id = 'fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a06'$$,
  '23514',
  'status cannot reach `approved` without approved_at — §20''s POD fact reads the timestamp');
select rls_test.rejects_with(
  $$insert into shipment_documents (shipment_id, doc_type, visibility, storage_path, file_name)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'bol', 'shipper',
            'ffffffff-ffff-ffff-ffff-ffffffff0b01/hijack.pdf', 'x.pdf')$$,
  '23514',
  'an object under ANOTHER shipment''s prefix is refused');
-- Non-vacuity: a LEGAL insert succeeds, so the seven refusals above are the
-- constraints biting rather than the table being unwritable.
insert into shipment_documents (shipment_id, doc_type, visibility, storage_path, file_name)
values ('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'bol', 'shipper',
        'ffffffff-ffff-ffff-ffff-ffffffff0a01/legal-control.pdf', 'ok.pdf');
select rls_test.ok(
  (select count(*) from shipment_documents
    where storage_path = 'ffffffff-ffff-ffff-ffff-ffffffff0a01/legal-control.pdf') = 1,
  'NON-VACUITY: a matrix-legal, correctly-prefixed document DOES insert');
-- …and remove it again so the counts below stay the fixture's.
delete from shipment_documents
 where storage_path = 'ffffffff-ffff-ffff-ffff-ffffffff0a01/legal-control.pdf';

-- ---- 3 · privileges -------------------------------------------------------
select rls_test.ok(
  has_table_privilege('authenticated', 'shipment_documents', 'INSERT') = false
    and has_table_privilege('authenticated', 'shipment_documents', 'UPDATE') = false
    and has_table_privilege('authenticated', 'shipment_documents', 'DELETE') = false,
  'no browser role can WRITE shipment_documents — the two SECURITY DEFINER functions are the only doors');
select rls_test.ok(
  has_table_privilege('anon', 'shipment_documents', 'SELECT') = false,
  'ANON holds no SELECT on shipment_documents (§4: documents have no public surface)');
-- The function grants, as a real browser role. Run as ADMIN, the most
-- privileged session a browser can hold: if even that cannot reach them, no
-- session can.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.rejects_with(
  $$select add_shipment_document('ffffffff-ffff-ffff-ffff-ffffffff0a01', 'invoice',
      'ffffffff-ffff-ffff-ffff-ffffffff0a01/x.pdf', 'x.pdf')$$,
  '42501',
  'add_shipment_document is service_role only — a session cannot reach it to bypass the per-role allow-list');
select rls_test.rejects_with(
  $$select review_shipment_document('fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a06', 'approved')$$,
  '42501',
  'review_shipment_document is service_role only — nobody self-approves their own POD');
select rls_test.rejects_with(
  $$select shipment_transition_facts('ffffffff-ffff-ffff-ffff-ffffffff0a01')$$,
  '42501',
  'the §20 fact read stays service_role only after M-77 replaced it (unchanged from 0019)');
-- The one function M-77 DOES open to a session, and the reason it is safe:
-- it returns a COUNT and nothing else, scoped by my_shipper_ids() inside.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.eq(count_shipment_documents_awaiting_review(), 1,
  'shipper A CAN count its own pending documents — a number, never a row (§11, §16)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select rls_test.eq(count_shipment_documents_awaiting_review(), 0,
  'shipper B counts ZERO — the scope comes from my_shipper_ids(), not from an argument');
set role anon;
set request.jwt.claim.sub = '';
select rls_test.rejects_with(
  $$select count_shipment_documents_awaiting_review()$$,
  '42501',
  'ANON cannot even count — there is no anonymous document surface at all');
reset role;
set request.jwt.claim.sub = '';

-- ---- 4 · who reads what, per §16 -----------------------------------------
set role authenticated;

-- SHIPPER A: BOL + POD + invoice. NOT the rate confirmation, NOT the claim,
-- NOT the pending POD, NOT the narrowed BOL.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.eq((select count(*) from shipment_documents), 3,
  'shipper A reads EXACTLY 3 of the 8 documents — the §16 shipper band, approved and unnarrowed');
select rls_test.eq((select count(*) from shipment_documents where doc_type = 'rate_confirmation'), 0,
  'shipper A CANNOT read the carrier rate confirmation (§16 lists it carrier-visible only)');
select rls_test.eq((select count(*) from shipment_documents where doc_type = 'claim'), 0,
  'shipper A cannot read the private claim review (§16 staff-only)');
select rls_test.eq((select count(*) from shipment_documents where status <> 'approved'), 0,
  'shipper A cannot read a PENDING document — §16''s "approved" is load-bearing');
select rls_test.eq((select count(*) from shipment_documents where visibility = 'staff_only'), 0,
  'a staff_only NARROWING hides an approved BOL from its own audience');
select rls_test.eq(
  (select count(*) from shipment_documents
    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0,
  'shipper A reads NOTHING of shipper B''s shipment documents');
select rls_test.writes_nothing(
  $$update shipment_documents set status = 'approved'
     where id = 'fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a06'$$,
  'shipper A cannot approve a document — self-service approval would defeat §20 entirely');

-- SHIPPER B: nothing of shipment A. The mirror that makes A''s 3 a policy result.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select rls_test.eq(
  (select count(*) from shipment_documents
    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0,
  'shipper B reads NOTHING of shipment A''s documents');

-- CARRIER A: BOL + POD + rate confirmation. NOT the invoice (§16 names the
-- SHIPPER invoice), not the claim, not the pending POD.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select rls_test.eq((select count(*) from shipment_documents), 3,
  'carrier A reads EXACTLY 3 — the §16 carrier band');
select rls_test.eq((select count(*) from shipment_documents where doc_type = 'rate_confirmation'), 1,
  'carrier A CAN read its own rate confirmation — §16 carrier-visible, and it is their contract');
select rls_test.eq((select count(*) from shipment_documents where doc_type = 'invoice'), 0,
  'carrier A cannot read the SHIPPER invoice');
select rls_test.eq((select count(*) from shipment_documents where doc_type = 'claim'), 0,
  'carrier A cannot read the private claim review');
select rls_test.eq(
  (select count(*) from shipment_documents
    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0b01'), 0,
  '§19 PROOF: CARRIER A CANNOT READ CARRIER B''S SHIPMENT DOCUMENTS');

-- A carrier MEMBER (not the owner) gets the same view: membership, not
-- ownership, is the key — the same rule 0018 applies to shipments.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select rls_test.eq((select count(*) from shipment_documents), 3,
  'a carrier A MEMBER reads the same three — membership is the key, not ownership');

-- CARRIER B: the mirror image.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select rls_test.eq(
  (select count(*) from shipment_documents
    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0,
  'carrier B reads NOTHING of shipment A — the non-vacuity mirror');
select rls_test.eq((select count(*) from shipment_documents), 1,
  'carrier B reads its OWN shipment''s BOL, so its zero above is a policy result');

-- BROKER A: §12''s "POD; BOL, when authorized" — and nothing else.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';
select rls_test.eq((select count(*) from shipment_documents), 2,
  'broker A reads EXACTLY the BOL and the POD (§12)');
select rls_test.eq((select count(*) from shipment_documents where doc_type = 'invoice'), 0,
  'broker A cannot see shipper billing (§12)');
select rls_test.eq((select count(*) from shipment_documents where doc_type = 'rate_confirmation'), 0,
  'broker A cannot see the carrier rate confirmation (§12: not the carrier''s private packet)');
select rls_test.eq((select count(*) from shipment_documents where visibility = 'staff_only'), 0,
  'a narrowed BOL is hidden from the broker too');

-- BROKER B: another organization''s shipment is not theirs.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab02';
select rls_test.eq(
  (select count(*) from shipment_documents
    where shipment_id = 'ffffffff-ffff-ffff-ffff-ffffffff0a01'), 0,
  'broker B reads NOTHING of broker A''s shipment documents');

-- BROKER C: invited, NOT approved. §12 requires verification before access.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab03';
select rls_test.reads_nothing('shipment_documents',
  'an UNAPPROVED broker organization reads no document at all (§12)');

-- An authenticated outsider with no membership anywhere.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select rls_test.reads_nothing('shipment_documents',
  'an unaffiliated authenticated user reads no shipment document');

-- ANON.
set role anon;
set request.jwt.claim.sub = '';
select rls_test.reads_nothing('shipment_documents',
  'ANON reads NOTHING — §4 gives shipment documents no public surface at all');
select rls_test.reads_nothing('shipment_document_audiences',
  'ANON cannot even read the matrix');

-- STAFF — which is what makes every zero above a POLICY result rather than an
-- empty table.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select rls_test.eq((select count(*) from shipment_documents), 8,
  'a DISPATCHER reads all eight — every customer zero above is a band decision, not an empty table');
select rls_test.eq((select count(*) from shipment_documents where status = 'pending'), 1,
  'staff see the pending document the customers cannot — that IS the review queue');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.eq((select count(*) from shipment_documents), 8,
  'an ADMIN reads all eight');

-- ---- 5 · §20''s POD fact, from the fixtures --------------------------------
reset role;
select rls_test.ok(
  (shipment_transition_facts('ffffffff-ffff-ffff-ffff-ffffffff0a01') ->> 'approved_pod_document_id')
    = 'fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfc0a02',
  'M-77 completed M-72''s deferred fact: the APPROVED POD is resolved, not a literal null');
select rls_test.ok(
  (shipment_transition_facts('ffffffff-ffff-ffff-ffff-ffffffff0b01') ->> 'approved_pod_document_id')
    is null,
  'a shipment with no approved POD still resolves to null — the precondition still refuses');
select rls_test.ok(
  (shipment_transition_facts('ffffffff-ffff-ffff-ffff-ffffffff0a01') ->> 'closeout_completed_at')
    is null,
  'closeout is STILL a caller assertion — M-77 changed one fact, not two');

-- ===========================================================================
-- §14 · M-78 — ETA history and §21 exceptions (migration 0025)
--
-- The section exists to prove FOUR things this module is accountable for:
--
--   1. THE BASE TABLES ARE STAFF-ONLY. Not "customers see a filtered set" —
--      customers see NOTHING, at any column. That is the design: §21 forbids
--      exposing `internal_description` and `resolution`, a ROW policy cannot
--      restrict a COLUMN, and staff share the `authenticated` role with
--      customers so a column-level REVOKE would blind dispatch. Asserted here
--      by reading the table as five different sessions.
--   2. THE ACCESSOR IS THE CUSTOMER PATH, and its RETURN TYPE is the
--      allow-list. `my_shipment_exceptions()` resolves the audience from the
--      caller's own memberships — never from an argument — so a shipper
--      cannot ask for the staff view.
--   3. §21'S FORBIDDEN COLUMNS ARE UNREACHABLE, proved by SENTINEL: every
--      fixture row carries a unique string in `internal_description` and
--      `resolution`, and no customer path returns one.
--   4. THE WRITE PATH IS service_role ONLY, exactly as 0019/0022/0024.
--
-- Non-vacuity throughout: every zero is mirrored by a staff read that is not
-- zero, so an empty table can never be mistaken for a policy result.
-- ===========================================================================

reset role;
set request.jwt.claim.sub = '';

-- ---- 1 · Catalog facts, not inferred from a refusal --------------------

select rls_test.ok(
  (select relrowsecurity from pg_class where relname = 'shipment_exceptions'),
  'RLS is ENABLED on shipment_exceptions');
select rls_test.ok(
  (select relrowsecurity from pg_class where relname = 'shipment_eta_history'),
  'RLS is ENABLED on shipment_eta_history');

-- EXACTLY ONE policy on each, and it is the staff one. A second permissive
-- policy is how a customer band would arrive by accident.
select rls_test.eq((select count(*) from pg_policies
   where tablename = 'shipment_exceptions'), 1,
  'shipment_exceptions carries exactly ONE policy — no customer band exists at the table level');
select rls_test.eq((select count(*) from pg_policies
   where tablename = 'shipment_eta_history'), 1,
  'shipment_eta_history carries exactly ONE policy');

-- The WRITE grants were revoked, which is checked IN ADDITION to RLS. Without
-- this, a future permissive policy would inherit a write privilege nobody
-- meant to give. SELECT survives because `is_staff()` evaluates inside an
-- `authenticated` session and the policy needs a grant to filter.
select rls_test.ok(
  (select bool_or(has_table_privilege('authenticated', 'shipment_exceptions', p))
     from unnest(array['INSERT','UPDATE','DELETE']) p) = false,
  'authenticated holds NO WRITE privilege on shipment_exceptions — every write goes through the service-role functions');
select rls_test.ok(
  has_table_privilege('authenticated', 'shipment_exceptions', 'SELECT'),
  'NON-VACUITY: authenticated DOES hold SELECT, so every customer zero below is a POLICY result and not a permission error');
select rls_test.ok(
  (select bool_or(has_table_privilege('anon', 'shipment_eta_history', p))
     from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p) = false,
  'anon holds NO privilege at all on shipment_eta_history');
select rls_test.ok(
  (select bool_or(has_table_privilege('anon', 'shipment_exceptions', p))
     from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p) = false,
  'anon holds NO privilege at all on shipment_exceptions');

-- ---- 2 · The base tables reach NO customer ----------------------------

set role authenticated;

-- ZERO ROWS is zero columns. That is the whole design: the customer holds
-- SELECT (so the policy has something to filter) and the policy returns
-- nothing, so `internal_description` and `resolution` are unreachable without
-- a column-level REVOKE — which could not work anyway, because staff and
-- customers share the `authenticated` role.

-- SHIPPER A owns shipment A and still reads nothing FROM THE TABLE.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.reads_nothing('shipment_exceptions',
  '§21 PROOF: the SHIPPER of the shipment reads NOTHING from the exception TABLE — the internal commentary is unreachable at every column');
select rls_test.reads_nothing('shipment_eta_history',
  'the shipper reads NOTHING from the ETA history table — reason_internal lives there');

-- CARRIER A hauls shipment A. Same answer.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select rls_test.reads_nothing('shipment_exceptions',
  'the assigned CARRIER reads nothing from the exception table either');

-- BROKER A is linked to shipment A. Same answer.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';
select rls_test.reads_nothing('shipment_exceptions',
  'the linked BROKER PARTNER reads nothing from the exception table');

-- ANON — refused at the PRIVILEGE layer, before RLS is consulted at all.
set role anon;
set request.jwt.claim.sub = '';
select rls_test.rejects_with($$select count(*) from shipment_exceptions$$,
  '42501', 'ANON cannot select exceptions AT ALL — §4 gives them no anonymous table surface');
select rls_test.rejects_with($$select count(*) from shipment_eta_history$$,
  '42501', 'ANON cannot select the ETA history');

-- STAFF — which is what makes every zero above a POLICY result.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select rls_test.eq((select count(*) from shipment_exceptions), 4,
  'a DISPATCHER reads all four exception rows — every customer zero above is a policy decision, not an empty table');
select rls_test.eq((select count(*) from shipment_eta_history), 3,
  'a DISPATCHER reads all three ETA history rows');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.eq((select count(*) from shipment_exceptions), 4,
  'an ADMIN reads all four');

-- ---- 3 · The accessor, per audience -----------------------------------

-- SHIPPER A: the two PUBLISHED exceptions on their own shipment. Not the
-- unpublished one (§21: nothing honest to say yet), not shipment B's.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01')), 2,
  '§21 PROOF: the shipper reads exactly the TWO published exceptions through the accessor');
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01')
    where exception_type = 'damaged_freight'), 0,
  'the UNPUBLISHED exception reaches nobody — a blank alarm is worse than silence (§21)');
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01')
    where resolved_at is not null), 1,
  'a RESOLVED exception is still returned, with its resolved_at — the customer sees it closed, not vanished');
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0b01')), 0,
  '§19 PROOF: SHIPPER A READS NOTHING OF SHIPMENT B THROUGH THE ACCESSOR');

-- The RETURN TYPE is the allow-list. Read out of the catalog rather than
-- inferred: a future `alter function` that added a column would pass every
-- assertion above and fail this one.
reset role;
select rls_test.ok(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_shipment_exceptions'
     and 'internal_description' = any (p.proargnames)) = 0,
  '§21 PROOF: `internal_description` is NOT in my_shipment_exceptions() OUT columns — the projection is a TYPE, not a string');
select rls_test.ok(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_shipment_exceptions'
     and 'resolution' = any (p.proargnames)) = 0,
  '§21 PROOF: `resolution` is NOT in my_shipment_exceptions() OUT columns either');
select rls_test.ok(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_shipment_exceptions'
     and 'public_description' = any (p.proargnames)) = 1,
  'NON-VACUITY: `public_description` IS an OUT column, so the two zeros above are omissions and not a typo');

set role authenticated;

-- CARRIER A hauls shipment A: same two published rows.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01')), 2,
  'the assigned CARRIER reads the two published exceptions on the load they are hauling');
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0b01')), 0,
  '§19 PROOF: CARRIER A READS NOTHING OF CARRIER B''S SHIPMENT');

-- BROKER A, linked to shipment A (§12's "status and timeline").
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab01';
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01')), 2,
  'the linked BROKER PARTNER reads the two published exceptions (§12)');

-- BROKER C: invited, NOT approved. §12 requires verification before access.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ab03';
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01')), 0,
  'an UNAPPROVED broker organization reads no exception at all (§12)');

-- An authenticated outsider with no membership anywhere.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01')), 0,
  'an unaffiliated authenticated user reads no exception');

-- ---- 4 · The SENTINEL sweep, in SQL -----------------------------------
--
-- The three §21 strings the fixtures planted, searched for across the whole
-- customer payload. This is the database-level twin of the DTO sentinel sweep
-- in tests/unit/shipment-dto.test.ts, and it can fail for reasons the unit
-- test cannot see (a widened accessor, a new policy, a column-level grant).

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select rls_test.eq(
  (select count(*) from my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01') x
    where to_jsonb(x)::text like '%SENTINEL-INTERNAL-%'
       or to_jsonb(x)::text like '%SENTINEL-RESOLUTION-%'), 0,
  '§21 SENTINEL SWEEP: NO internal description and NO resolution text reaches the shipper, anywhere in the payload');

-- NON-VACUITY: staff DO get the sentinels, so a clean sweep above can never be
-- the result of a fixture that never carried them.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select rls_test.ok(
  (select bool_or(to_jsonb(e)::text like '%SENTINEL-INTERNAL-%')
     from shipment_exceptions e),
  'NON-VACUITY: a DISPATCHER does see the internal sentinels — the sweep above is a real result');
select rls_test.ok(
  (select bool_or(to_jsonb(h)::text like '%SENTINEL-ETA-INTERNAL-%')
     from shipment_eta_history h),
  'NON-VACUITY: a DISPATCHER does see reason_internal on the ETA history');

-- ---- 5 · The write path is service_role ONLY --------------------------

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select rls_test.rejects_with(
  $$select open_shipment_exception('ffffffff-ffff-ffff-ffff-ffffffff0a01','weather')$$,
  '42501', 'an ADMIN SESSION cannot call open_shipment_exception');
select rls_test.rejects_with(
  $$select resolve_shipment_exception('fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01','done')$$,
  '42501', 'nor resolve_shipment_exception');
select rls_test.rejects_with(
  $$select update_shipment_exception('fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01')$$,
  '42501', 'nor update_shipment_exception');
select rls_test.rejects_with(
  $$select backfill_shipment_exceptions()$$,
  '42501', 'nor the backfill');

set role anon;
set request.jwt.claim.sub = '';
select rls_test.rejects_with(
  $$select open_shipment_exception('ffffffff-ffff-ffff-ffff-ffffffff0a01','weather')$$,
  '42501', 'anon cannot call open_shipment_exception');
select rls_test.rejects_with(
  $$select my_shipment_exceptions('ffffffff-ffff-ffff-ffff-ffffffff0a01')$$,
  '42501', 'anon cannot even call the ACCESSOR — /track goes through the service role behind the §4 two-factor check');

reset role;
set request.jwt.claim.sub = '';

select rls_test.ok(
  (select bool_and(p.prosecdef) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('open_shipment_exception','resolve_shipment_exception',
                       'update_shipment_exception','backfill_shipment_exceptions',
                       'my_shipment_exceptions')),
  'all five 0025 functions are SECURITY DEFINER (the 0019 model, unchanged)');
select rls_test.ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('open_shipment_exception','resolve_shipment_exception',
                       'update_shipment_exception','backfill_shipment_exceptions')),
  'service_role CAN execute all four writers — the non-vacuity control for the 42501s above');
select rls_test.ok(
  (select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  or has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('open_shipment_exception','resolve_shipment_exception',
                       'update_shipment_exception','backfill_shipment_exceptions')) = false,
  'NEITHER authenticated NOR anon holds EXECUTE on any writer (the REVOKE FROM PUBLIC held)');

-- ---- 6 · Lifecycle and append-only, as the OWNER ----------------------
--
-- Asserted as the table owner, so a refusal can ONLY be the trigger and never
-- a policy. This is the same technique §11 uses for tracking-number
-- immutability.

select rls_test.rejects_with(
  $$update shipment_eta_history set new_eta_at = now() where new_eta_at is not null$$,
  'PL409', 'shipment_eta_history is APPEND-ONLY — even the owner cannot rewrite what an ETA used to be (§6, §10)');
select rls_test.rejects_with(
  $$delete from shipment_eta_history$$,
  'PL409', 'nor delete an ETA history row');

select rls_test.rejects_with(
  $$update shipment_exceptions set exception_type = 'traffic' where id = 'fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a02'$$,
  'PL409', '§21: what an exception IS cannot change — re-typing damaged_freight as traffic is refused');
select rls_test.rejects_with(
  $$update shipment_exceptions set resolved_at = null where id = 'fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a03'$$,
  'PL409', '§21: a resolution is ONE-WAY — re-opening means logging a new exception');
select rls_test.rejects_with(
  $$update shipment_exceptions set customer_notified_at = null where id = 'fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01'$$,
  'PL409', '§17: customer_notified_at cannot be cleared — un-telling somebody is not a state');
select rls_test.rejects_with(
  $$update shipment_exceptions set severity = 'critical' where id = 'fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a03'$$,
  'PL409', '§21: a CLOSED exception is read-only for triage fields');
select rls_test.rejects_with(
  $$insert into shipment_exceptions (shipment_id, exception_type, resolved_at, resolution)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','other', now(), null)$$,
  '23514', 'a resolved exception with NO resolution text is refused by CHECK — the log would be useless six months later');
select rls_test.rejects_with(
  $$insert into shipment_exceptions (shipment_id, exception_type)
    values ('ffffffff-ffff-ffff-ffff-ffffffff0a01','other')$$,
  '23514', 'an exception with NEITHER description is refused — it says nothing to anybody');

-- NON-VACUITY: a legal triage UPDATE on an OPEN exception still succeeds, so
-- the six refusals above are rules and not a broken trigger.
select rls_test.affects(
  $$update shipment_exceptions set severity = 'critical'
     where id = 'fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfb0a01'$$, 1,
  'NON-VACUITY: re-severitying an OPEN exception IS allowed — the trigger blocks rules, not writes');
