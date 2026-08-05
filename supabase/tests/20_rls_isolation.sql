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
select rls_test.eq((select count(*) from invoices), 0, 'shipperA cannot select invoices');
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
select rls_test.eq((select count(*) from invoices), 2, 'dispatcher reads all invoices');
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
select rls_test.eq((select count(*) from profiles), 8, 'dispatcher reads all profiles');
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
