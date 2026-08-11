-- ============================================================================
-- PickLoads — Migration 0024: shipment documents + POD workflow (M-77).
--
-- SCOPE (plan §7, Phase B, row M-77): *"Shipment documents + POD: private
-- storage, signed URLs ≤300s, **explicit visibility matrix**, broker value in
-- `doc_visibility`, document-access history."*
-- Authority: `docs/DIRECTIVE-tracking.md` §16 (the document list and the three
-- audience lists, verbatim), §12 (broker permissions, "BOL when authorized"),
-- §4 (what the public must never see), §15 (document-access history), §19
-- (RLS per audience), §20 (`pod_uploaded` requires an APPROVED POD), §25
-- (bounded queries, no N+1), §26 (document-download errors as a signal).
--
-- Migrations 0001–0004 are FROZEN and untouched. 0017–0023 are untouched too,
-- with ONE deliberate exception argued at length in section 8: this migration
-- REPLACES `shipment_transition_facts()`, because M-72 shipped it with the POD
-- fact as a literal `null` and the replacement SQL written beside it, assigned
-- to this module by name.
--
-- ── WHY A SECOND PRIVATE BUCKET AND NOT A PATH INSIDE `carrier-docs` ──────
--
-- The plan asked for the decision to be made and argued, so:
--
-- `carrier-docs` (0004) is authorized BY CARRIER. Both of its customer
-- policies read `(storage.foldername(name))[1]` and compare it to the caller's
-- `carriers.id`. Every object in that bucket belongs to exactly one carrier
-- and that prefix IS the authorization model — it is what stands between
-- carrier A and carrier B's W-9, SSN and bank details.
--
-- A shipment document has up to FOUR legitimate readers (shipper, carrier,
-- broker partner, staff), none of whom owns a folder, and whether any of them
-- may read it depends on `doc_type`, `status` and `visibility` — columns in a
-- table a storage policy would have to join. Filing shipment documents under
-- `carrier-docs/shipments/…` would force one of two bad outcomes: loosen
-- 0004's carrier-prefix policies (weakening the highest-PII bucket in the
-- product to serve a lower-PII use case), or leave objects in a bucket whose
-- policies cannot express who may read them and rely on the application alone.
--
-- A separate PRIVATE bucket keeps 0004 frozen, lets the policies below be
-- written in the matrix's own terms, and keeps the retention stories separable
-- — a carrier's compliance packet and a shipment's paperwork do not expire
-- together. §16: *"use private storage and signed URLs"*, *"do not put
-- shipment documents in public buckets."* `public` is FALSE below and no cell
-- of the matrix names the `public` audience.
--
-- ── THE MATRIX IS A TABLE ─────────────────────────────────────────────────
--
-- Plan §4 restores *"§16 Document visibility MATRIX (which doc type → which
-- audience)"*. It is `shipment_document_audiences` below: 22 seeded rows, one
-- per (type, audience) pair §16 and §12 license. RLS reads it; nothing
-- interprets it. `src/lib/shipments/documents.ts` holds the identical matrix
-- for the surfaces, and an integration test reads this table back and compares
-- it cell for cell — drift between the app's idea of who may see a POD and the
-- database's idea is the worst bug this module could ship, so it is the one
-- with its own test.
--
-- ── UNAPPROVED DOCUMENTS REACH NOBODY ─────────────────────────────────────
--
-- §16's shipper and carrier lists both say "**approved**". `status` is the
-- `doc_status` enum SHIPPED IN 0001 (pending/approved/rejected/expired) — the
-- same vocabulary M-21's carrier documents and M-58's review queue already
-- use. A second three-value review enum meaning the same thing is the
-- duplication the executive directive forbids.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--
--   -- 1. RESTORE M-72's function FIRST (see section 8): re-run the
--   --    `create or replace function public.shipment_transition_facts(uuid)`
--   --    block from 0019, whose `approved_pod_document_id` is a literal null.
--   --    Do this BEFORE dropping the table or the function references a
--   --    relation that no longer exists and every transition fails.
--   drop policy if exists "staff manage shipment documents"  on shipment_documents;
--   drop policy if exists "shipper member read shipment documents" on shipment_documents;
--   drop policy if exists "carrier member read shipment documents" on shipment_documents;
--   drop policy if exists "broker member read shipment documents"  on shipment_documents;
--   drop policy if exists "anyone read document audience matrix"    on shipment_document_audiences;
--   drop policy if exists "staff manage shipment doc objects" on storage.objects;
--   drop function if exists public.count_shipment_documents_awaiting_review();
--   drop function if exists public.review_shipment_document(uuid, doc_status, uuid, text, shipment_event_source, text);
--   drop function if exists public.add_shipment_document(uuid, shipment_document_type, text, text, text, bigint, uuid, shipment_event_source, shipment_document_visibility, text);
--   drop trigger  if exists trg_shipment_documents_visibility on shipment_documents;
--   drop function if exists public.guard_shipment_document_visibility();
--   drop trigger  if exists trg_shipment_documents_immutable on shipment_documents;
--   drop function if exists public.guard_shipment_document_immutable();
--   drop function if exists public.shipment_document_reaches_audience(shipment_document_type, shipment_document_visibility, doc_status, shipment_document_visibility);
--   drop table if exists shipment_documents cascade;
--   drop table if exists shipment_document_audiences cascade;
--   delete from storage.buckets where id = 'shipment-docs';   -- only if empty
--
--   DESTRUCTIVE: drops every BOL and POD filed against a shipment, and with
--   them the evidence a delivery happened. Take a dump first (`pg_dump -t
--   shipment_documents`) and note that the OBJECTS survive in the bucket —
--   the rows that name them do not, so they become unreachable rather than
--   deleted. Emptying the bucket is a separate, deliberate act.
--
--   Roll back `src/lib/shipments/documents.ts`, `src/app/actions/shipment-
--   documents.ts` and the four surfaces in the SAME deploy. It fails CLOSED
--   either way: with the table gone, `shipment_transition_facts()` restored to
--   0019's literal null again REFUSES every `pod_uploaded`, which is M-72's
--   documented behaviour and not a new failure mode. Shipments, events,
--   assignments, driver tokens and `carrier-docs` are untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The private bucket
-- ---------------------------------------------------------------------------
--
-- Same 10 MB cap and same four MIME types as `carrier-docs`: a POD is a phone
-- photo or a scan. The bucket-level `allowed_mime_types` is the SECOND line —
-- the first is magic-byte sniffing in the upload handler (`sniffMime`, M-21 /
-- audit S-03), because a bucket checks the content type the client CLAIMED.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shipment-docs',
  'shipment-docs',
  false,                                        -- §16, non-negotiable
  10485760,                                     -- 10 MB
  array['application/pdf','image/jpeg','image/png','image/heic']
)
on conflict (id) do nothing;

-- Staff only, at the STORAGE layer. Deliberate, and narrower than 0004:
--
-- Customer downloads go through `getShipmentDocumentUrl()`, a server action
-- that resolves the row under the caller's session (so the policies in section
-- 6 decide), audits the access (§15) and mints a ≤300s signed URL with the
-- SERVICE role. There is therefore no customer code path that needs
-- `storage.objects` access, and a storage policy that tried to re-derive the
-- matrix from an object path could only ever be a weaker second opinion.
--
-- Note the consequence, stated plainly: a customer who somehow obtained a
-- storage path could not read the object with their own session even if RLS on
-- `shipment_documents` were misconfigured. Two independent gates, not one.
create policy "staff manage shipment doc objects" on storage.objects
  for all
  using (bucket_id = 'shipment-docs' and public.is_staff())
  with check (bucket_id = 'shipment-docs' and public.is_staff());

-- ---------------------------------------------------------------------------
-- 2 · THE MATRIX, as rows
-- ---------------------------------------------------------------------------
--
-- §16's three audience lists and §12's broker permissions, one row per cell.
-- `staff_only` is NOT a row in here: staff read every document on a shipment
-- they operate, so it is a floor rather than a band, and modelling it as a
-- cell would invite a future edit that deleted staff access to a type.
create table shipment_document_audiences (
  doc_type shipment_document_type not null,
  audience shipment_document_visibility not null,
  primary key (doc_type, audience),
  -- §16 + §4: NO document type is public. Enforced as a CHECK rather than as
  -- an absent row, so a future seed cannot add one by accident.
  constraint shipment_document_audiences_never_public
    check (audience <> 'public'),
  -- `staff_only` is the floor, not a cell (see above).
  constraint shipment_document_audiences_no_staff_cell
    check (audience <> 'staff_only')
);

insert into shipment_document_audiences (doc_type, audience) values
  -- §16 shipper-visible: the shipper's own commercial correspondence. NOT the
  -- carrier's — quote + carrier rate confirmation together disclose the
  -- margin, which §12 and §18 forbid.
  ('quote', 'shipper'),
  ('shipper_confirmation', 'shipper'),
  -- §16 carrier-visible: "carrier rate confirmation". §4 forbids it reaching
  -- the public and §12 does not list it among a broker's permissions, so this
  -- is its ONE cell.
  ('rate_confirmation', 'carrier'),
  -- §16 names BOL under BOTH lists; §12 grants it to a broker "when
  -- authorized", the authorization being the shipment↔broker_partner link the
  -- policy in section 6 already requires. THIS CELL is why `broker` exists in
  -- `shipment_document_visibility` at all (plan §4).
  ('bol', 'shipper'), ('bol', 'carrier'), ('bol', 'broker'),
  -- §16 "approved operational documents" / "approved shipment paperwork":
  -- accessorial evidence both commercial parties are billed against. A charge
  -- whose evidence one party cannot see is a dispute.
  ('lumper_receipt', 'shipper'), ('lumper_receipt', 'carrier'),
  ('detention_documentation', 'shipper'), ('detention_documentation', 'carrier'),
  ('delivery_receipt', 'shipper'), ('delivery_receipt', 'carrier'),
  -- §16 names POD under both lists; §12 names it outright, with no "when
  -- authorized" qualifier.
  ('pod', 'shipper'), ('pod', 'carrier'), ('pod', 'broker'),
  -- §16 "shipper invoice". §12 forbids brokers seeing "shipper billing"; a
  -- carrier invoice lives in `invoices` under M-31's own policies.
  ('invoice', 'shipper'),
  -- `claim` gets NO cell — §16 staff list, "private claim review". A claim
  -- file mid-review carries the other party's account of events; releasing it
  -- before settlement prejudices the settlement. Staff re-file a settled
  -- outcome as `other` when it is ready to share.
  -- `other` is the escape hatch and is deliberately not a wildcard: the
  -- DEFAULT visibility for the type is `staff_only` (section 4), so widening
  -- a particular row is an explicit act by a human who looked at the file.
  ('other', 'shipper'), ('other', 'carrier'), ('other', 'broker');

alter table shipment_document_audiences enable row level security;

-- Privileges BEFORE policies, and revoke-then-grant in that order: Supabase's
-- default privileges hand `authenticated` and `anon` full DML on every new
-- public table, and a table-level grant is checked IN ADDITION to RLS. Leaving
-- the default in place would mean the matrix — the file that decides who may
-- read a proof of delivery — was editable by any signed-in browser session.
revoke all on shipment_document_audiences from authenticated, anon;
grant select on shipment_document_audiences to authenticated;

-- The matrix is POLICY, not data about anyone: it says "a POD is visible to
-- shippers", never "this POD". Readable by every authenticated role so a
-- policy evaluated as `authenticated` can join it; `anon` is not granted,
-- because no anonymous surface reads documents at all (§4).
create policy "anyone read document audience matrix" on shipment_document_audiences
  for select to authenticated using (true);

comment on table shipment_document_audiences is
  'M-77/§16: the document-type → audience MATRIX, as data. Mirrored by '
  'DOCUMENT_AUDIENCES in src/lib/shipments/documents.ts and pinned cell-for-'
  'cell by tests/integration/shipment-documents.test.ts. No `public` cell '
  'exists and none may be added (CHECK).';

-- ---------------------------------------------------------------------------
-- 3 · shipment_documents
-- ---------------------------------------------------------------------------
--
-- Columns match `ShipmentDocumentRow` in src/lib/shipments/types.ts, which
-- M-77 widened by four fields (`status`, `review_note`, `reviewed_by`,
-- `reviewed_at`) over M-70's original — each argued in that file's comment.
create table shipment_documents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  doc_type shipment_document_type not null,

  -- The row-level RESTRICTION, never the audience list. Section 5's trigger
  -- refuses any value the matrix does not license for the type, so
  -- `rate_confirmation` filed as `shipper` is a write failure and not a code
  -- review. `staff_only` is always legal: narrowing always is.
  visibility shipment_document_visibility not null,

  -- Path inside the PRIVATE `shipment-docs` bucket:
  -- `{shipment_id}/{uuid}-{sanitized name}`. Unique, because two rows naming
  -- one object make deletion ambiguous and a signed URL indistinguishable.
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,

  -- §16's "approved". The 0001 enum, reused (see the header).
  status doc_status not null default 'pending',
  review_note text,

  uploaded_by uuid references profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),

  -- WHO LAST DECIDED, including on a rejection.
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,

  -- SET ONLY ON APPROVAL. §20's POD precondition is written against
  -- `approved_at is not null` (M-72's own replacement SQL, section 8), so the
  -- CHECK below is what makes that expression exactly equivalent to
  -- `status = 'approved'` — the precondition and the review state cannot
  -- disagree, whatever a future writer does.
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,

  constraint shipment_documents_approved_iff_status
    check ((status = 'approved') = (approved_at is not null)),
  constraint shipment_documents_reviewed_when_decided
    check (status = 'pending' or reviewed_at is not null),
  constraint shipment_documents_file_name_present
    check (length(btrim(file_name)) > 0),
  constraint shipment_documents_size_sane
    check (size_bytes is null or (size_bytes > 0 and size_bytes <= 10485760)),
  -- The path must live under the shipment's own prefix. Belt and braces with
  -- the application's path builder: a row whose object sits under ANOTHER
  -- shipment's folder would make the staff storage policy correct and the
  -- table's answer wrong.
  constraint shipment_documents_path_namespaced
    check (storage_path like (shipment_id::text || '/%'))
);

-- §25: every read this module performs is one of these three shapes.
-- Newest-first per shipment — the document list on all four surfaces.
create index idx_shipment_documents_shipment
  on shipment_documents (shipment_id, uploaded_at desc);
-- The POD precondition lookup in `shipment_transition_facts()` (section 8),
-- partial so it stays small: approved PODs are a fraction of all documents.
create index idx_shipment_documents_approved_pod
  on shipment_documents (shipment_id, approved_at desc)
  where doc_type = 'pod' and approved_at is not null;
-- M-58's review queue and the shipper dashboard's "awaiting review" tile.
create index idx_shipment_documents_pending
  on shipment_documents (status, uploaded_at desc)
  where status = 'pending';

comment on table shipment_documents is
  'M-77/§16: shipment documents. PRIVATE bucket `shipment-docs`, signed URLs '
  '≤300s minted server-side (SIGNED_URL_TTL_SECONDS), audience decided by '
  'shipment_document_audiences + `status` + `visibility`. Every download is '
  'journalled to audit_events as `document.download` (§15) — never the URL.';

-- ---------------------------------------------------------------------------
-- 4 · Immutability — what a document IS cannot change
-- ---------------------------------------------------------------------------
--
-- The same reasoning M-71 applied to `tracking_number` and M-76 to a token
-- hash. A row names one object in a bucket; letting `storage_path`,
-- `shipment_id` or `doc_type` be edited would let an approved POD be
-- re-pointed at a different file, or a rejected document be re-typed into an
-- approved one — a laundering path that leaves the approval intact and swaps
-- what was approved. Corrections are a NEW row plus a rejection of the old,
-- which is also what leaves a history behind.
--
-- `uploaded_by` and `uploaded_at` are frozen for the same reason `created_at`
-- is stripped in 0022: a provenance that can be rewritten answers nothing.
create or replace function public.guard_shipment_document_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.shipment_id is distinct from old.shipment_id
     or new.doc_type is distinct from old.doc_type
     or new.storage_path is distinct from old.storage_path
     or new.uploaded_by is distinct from old.uploaded_by
     or new.uploaded_at is distinct from old.uploaded_at then
    raise exception
      'shipment_documents.%: a filed document is immutable — file a new document and reject the old one (DIRECTIVE-tracking §16)',
      case
        when new.shipment_id is distinct from old.shipment_id then 'shipment_id'
        when new.doc_type    is distinct from old.doc_type    then 'doc_type'
        when new.storage_path is distinct from old.storage_path then 'storage_path'
        when new.uploaded_by is distinct from old.uploaded_by then 'uploaded_by'
        else 'uploaded_at'
      end
      using errcode = 'PL409';
  end if;
  return new;
end;
$$;

create trigger trg_shipment_documents_immutable
  before update on shipment_documents
  for each row execute function public.guard_shipment_document_immutable();

-- ---------------------------------------------------------------------------
-- 5 · `visibility` may NARROW, never WIDEN
-- ---------------------------------------------------------------------------
--
-- A CHECK cannot do this: the legal set depends on a row in another table. So
-- a trigger, firing on INSERT and UPDATE, is the enforcement point — and it is
-- the reason §4's *"never show carrier rate confirmations [publicly]"* is a
-- database property here rather than an application convention.
create or replace function public.guard_shipment_document_visibility()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.visibility = 'staff_only' then
    return new;                       -- narrowing is always legal
  end if;
  if not exists (
    select 1 from shipment_document_audiences m
    where m.doc_type = new.doc_type and m.audience = new.visibility
  ) then
    raise exception
      'a % document may not be filed as % — the §16 matrix does not license that audience',
      new.doc_type, new.visibility
      using errcode = 'PL422';
  end if;
  return new;
end;
$$;

create trigger trg_shipment_documents_visibility
  before insert or update on shipment_documents
  for each row execute function public.guard_shipment_document_visibility();

-- ---------------------------------------------------------------------------
-- 6 · The ONE predicate, and the four policies built on it
-- ---------------------------------------------------------------------------
--
-- Identical in structure to `documentReachesAudience()` in
-- src/lib/shipments/documents.ts, clause for clause and in the same order, so
-- the app's answer and RLS's answer cannot disagree:
--
--   1. not approved                → nobody but staff
--   2. visibility = 'staff_only'   → nobody but staff
--   3. otherwise                   → the matrix row for the type
--
-- No role hierarchy, no fallthrough, no "shipper implies broker". The bands do
-- not nest, exactly as M-70's event bands do not.
create or replace function public.shipment_document_reaches_audience(
  p_doc_type shipment_document_type,
  p_visibility shipment_document_visibility,
  p_status doc_status,
  p_audience shipment_document_visibility
)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_status = 'approved'
     and p_visibility <> 'staff_only'
     and exists (
       select 1 from shipment_document_audiences m
       where m.doc_type = p_doc_type and m.audience = p_audience
     )
$$;

revoke all on function public.shipment_document_reaches_audience(
  shipment_document_type, shipment_document_visibility, doc_status,
  shipment_document_visibility) from public;
grant execute on function public.shipment_document_reaches_audience(
  shipment_document_type, shipment_document_visibility, doc_status,
  shipment_document_visibility) to authenticated, service_role;

alter table shipment_documents enable row level security;

-- Staff. Same honest note 0018 records: this is the existing staff idiom and
-- it does NOT distinguish dispatcher from admin at the database level —
-- dispatcher least-privilege is query-level (`src/lib/staff-scope.ts`) until
-- M-83's restrictive policies.
create policy "staff manage shipment documents" on shipment_documents
  for all using (is_staff());

-- §16 shipper-visible. Two independent conditions and BOTH must hold: the
-- matrix licenses the type for shippers, AND this caller belongs to THIS
-- shipment's shipper organization. The second is what makes "shipper A cannot
-- read shipper B's POD" true.
create policy "shipper member read shipment documents" on shipment_documents
  for select using (
    shipment_document_reaches_audience(doc_type, visibility, status, 'shipper')
    and exists (
      select 1 from shipments s
      where s.id = shipment_documents.shipment_id
        and s.shipper_id in (select my_shipper_ids())
    )
  );

-- §16 carrier-visible. `shipments.carrier_id` is the denormalised active
-- assignment 0022 maintains; a released carrier stops reading the shipment and
-- its documents in the same write.
create policy "carrier member read shipment documents" on shipment_documents
  for select using (
    shipment_document_reaches_audience(doc_type, visibility, status, 'carrier')
    and exists (
      select 1 from shipments s
      where s.id = shipment_documents.shipment_id
        and s.carrier_id in (select my_carrier_ids())
    )
  );

-- §12 broker partner — "POD; BOL, when authorized". The authorization is the
-- `broker_partner_id` link, and `my_broker_partner_ids()` (0018) already
-- filters on `broker_partners.active`, so an unapproved or de-activated
-- organization reads nothing here either.
--
-- M-81 owns the broker SURFACE. This band is live now because the matrix is
-- what M-77 was scoped to deliver and a band with no policy is a band that
-- cannot be tested; the RLS suite exercises it against a real broker member
-- today.
create policy "broker member read shipment documents" on shipment_documents
  for select using (
    shipment_document_reaches_audience(doc_type, visibility, status, 'broker')
    and exists (
      select 1 from shipments s
      where s.id = shipment_documents.shipment_id
        and s.broker_partner_id in (select my_broker_partner_ids())
    )
  );

-- NO customer WRITE policy of any kind. §13 lets a carrier upload a BOL and a
-- POD — through `add_shipment_document()` below, which is `security definer`
-- and granted to `service_role` only, so the server action is the single door
-- and the doc-type allow-list per uploader role cannot be bypassed by a
-- hand-rolled insert.
--
-- Same revoke-then-grant as the matrix table, and here it is load-bearing: a
-- default INSERT privilege plus no insert POLICY is refused by RLS today, but
-- a future permissive policy written for one column would inherit a write
-- grant nobody meant to give. Taking the privilege away makes the write path
-- a property of the schema rather than of the current policy set.
revoke all on shipment_documents from authenticated, anon;
grant select on shipment_documents to authenticated;

-- ---------------------------------------------------------------------------
-- 7 · The two write functions
-- ---------------------------------------------------------------------------
--
-- Both do the row write and the §7 event in ONE statement, for the reason
-- 0022 gives about assignments: a document that exists with no
-- `document_uploaded` event is a file nobody can explain, and an event with no
-- document is a timeline entry that lies. §25's "no N+1" is the smaller half
-- of the argument; atomicity is the larger.

create or replace function public.add_shipment_document(
  p_shipment_id uuid,
  p_doc_type shipment_document_type,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_actor uuid default null,
  p_source shipment_event_source default 'dispatcher',
  p_visibility shipment_document_visibility default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc shipment_documents%rowtype;
  v_event_id uuid;
  v_visibility shipment_document_visibility;
  v_existing shipment_events%rowtype;
begin
  -- Replay protection lives here rather than in the caller: a retried upload
  -- must not produce a second document row pointing at a second copy of the
  -- same file. The key is derived from the storage path, which is already
  -- unique per object.
  if p_idempotency_key is not null then
    select * into v_existing from shipment_events
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'document_id', (v_existing.metadata ->> 'document_id')::uuid,
        'shipment_id', v_existing.shipment_id,
        'event_id', v_existing.id,
        'replayed', true);
    end if;
  end if;

  if not exists (select 1 from shipments where id = p_shipment_id) then
    raise exception 'shipment % does not exist', p_shipment_id
      using errcode = 'PL404';
  end if;

  -- The DEFAULT band, when the caller does not choose: `staff_only` for the
  -- types with no customer audience and for `other` (whose contents nobody has
  -- looked at yet), otherwise the type's widest licensed band. This mirrors
  -- DEFAULT_DOCUMENT_VISIBILITY in src/lib/shipments/documents.ts.
  v_visibility := coalesce(
    p_visibility,
    (select m.audience from shipment_document_audiences m
      where m.doc_type = p_doc_type
      order by case m.audience
                 when 'shipper' then 1 when 'carrier' then 2 else 3 end
      limit 1),
    'staff_only');

  insert into shipment_documents (
    shipment_id, doc_type, visibility, storage_path, file_name,
    mime_type, size_bytes, uploaded_by
  ) values (
    p_shipment_id, p_doc_type, v_visibility, p_storage_path, p_file_name,
    p_mime_type, p_size_bytes, p_actor
  ) returning * into v_doc;

  -- §7: `staff_only` band. A document that has not been reviewed is not a
  -- customer-facing fact — the customer-visible event is the APPROVAL, in
  -- `review_shipment_document()` below. Publishing "your carrier uploaded a
  -- POD" before anyone checked it invites the call this module exists to
  -- prevent.
  insert into shipment_events (
    shipment_id, event_type, source, created_by, visibility,
    internal_message, metadata, idempotency_key
  ) values (
    p_shipment_id, 'document_uploaded', p_source, p_actor, 'staff_only',
    null,
    -- NEVER the storage path: metadata is read by the staff timeline and by
    -- M-79's notification payloads, and a path is the argument a signed URL is
    -- minted from.
    jsonb_build_object(
      'document_id', v_doc.id,
      'doc_type', v_doc.doc_type,
      'file_name', v_doc.file_name,
      'visibility', v_doc.visibility),
    p_idempotency_key
  ) returning id into v_event_id;

  return jsonb_build_object(
    'document_id', v_doc.id,
    'shipment_id', p_shipment_id,
    'event_id', v_event_id,
    'visibility', v_doc.visibility,
    'replayed', false);
end;
$$;

revoke all on function public.add_shipment_document(
  uuid, shipment_document_type, text, text, text, bigint, uuid,
  shipment_event_source, shipment_document_visibility, text) from public;
grant execute on function public.add_shipment_document(
  uuid, shipment_document_type, text, text, text, bigint, uuid,
  shipment_event_source, shipment_document_visibility, text) to service_role;

comment on function public.add_shipment_document(
  uuid, shipment_document_type, text, text, text, bigint, uuid,
  shipment_event_source, shipment_document_visibility, text) is
  'M-77/§16: file a shipment document and its `document_uploaded` event '
  'atomically. Lands at status `pending` — §16 says customers see APPROVED '
  'documents, so nothing is visible to anyone but staff until '
  'review_shipment_document() runs. EXECUTE: service_role only.';

-- The §16 staff approval step, and — via section 8 — §20's POD precondition.
create or replace function public.review_shipment_document(
  p_document_id uuid,
  p_decision doc_status,
  p_actor uuid default null,
  p_note text default null,
  p_source shipment_event_source default 'dispatcher',
  p_public_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc shipment_documents%rowtype;
  v_event_id uuid;
  v_now timestamptz := now();
begin
  if p_decision not in ('approved', 'rejected', 'expired') then
    raise exception 'review decision must be approved, rejected or expired (got %)', p_decision
      using errcode = 'PL422';
  end if;

  -- FOR UPDATE: two reviewers deciding at once must serialize, or the event
  -- and the row disagree about which decision won.
  select * into v_doc from shipment_documents where id = p_document_id for update;
  if not found then
    raise exception 'document % does not exist', p_document_id
      using errcode = 'PL404';
  end if;

  update shipment_documents set
    status      = p_decision,
    review_note = p_note,
    reviewed_by = p_actor,
    reviewed_at = v_now,
    -- The CHECK in section 3 requires these two to move WITH the status. An
    -- un-approval therefore clears them, which is what makes
    -- `approved_at is not null` a faithful reading of "currently approved"
    -- rather than "was approved once".
    approved_by = case when p_decision = 'approved' then p_actor else null end,
    approved_at = case when p_decision = 'approved' then v_now  else null end
  where id = p_document_id
  returning * into v_doc;

  -- §7: an APPROVAL is a customer-facing fact — it is the moment the document
  -- becomes readable — so it is published at the widest band the matrix
  -- licenses for the type, and `staff_only` when the matrix licenses none or
  -- the row has been narrowed. A REJECTION stays staff-only: it is a
  -- conversation with the uploader, not news for the customer.
  insert into shipment_events (
    shipment_id, event_type, source, created_by, visibility,
    public_message, internal_message, metadata
  ) values (
    v_doc.shipment_id,
    'document_approved',
    p_source,
    p_actor,
    case
      when p_decision <> 'approved' then 'staff_only'::shipment_event_visibility
      when v_doc.visibility = 'staff_only' then 'staff_only'::shipment_event_visibility
      when exists (select 1 from shipment_document_audiences m
                    where m.doc_type = v_doc.doc_type and m.audience = 'shipper')
        then 'shipper'::shipment_event_visibility
      when exists (select 1 from shipment_document_audiences m
                    where m.doc_type = v_doc.doc_type and m.audience = 'carrier')
        then 'carrier'::shipment_event_visibility
      else 'staff_only'::shipment_event_visibility
    end,
    case when p_decision = 'approved' then p_public_message else null end,
    p_note,
    jsonb_build_object(
      'document_id', v_doc.id,
      'doc_type', v_doc.doc_type,
      'decision', p_decision,
      'file_name', v_doc.file_name)
  ) returning id into v_event_id;

  return jsonb_build_object(
    'document_id', v_doc.id,
    'shipment_id', v_doc.shipment_id,
    'status', v_doc.status,
    'event_id', v_event_id);
end;
$$;

revoke all on function public.review_shipment_document(
  uuid, doc_status, uuid, text, shipment_event_source, text) from public;
grant execute on function public.review_shipment_document(
  uuid, doc_status, uuid, text, shipment_event_source, text) to service_role;

comment on function public.review_shipment_document(
  uuid, doc_status, uuid, text, shipment_event_source, text) is
  'M-77/§16 + §20: the staff approval step. Approving sets approved_at, which '
  'is exactly what shipment_transition_facts() reads for `pod_uploaded`. '
  'Un-approving CLEARS it, so the precondition tracks the current decision. '
  'EXECUTE: service_role only.';

-- ---------------------------------------------------------------------------
-- 7b · The §11 "documents awaiting review" tile
-- ---------------------------------------------------------------------------
--
-- M-74 shipped this tile returning `null` — *"not measured"*, never `0` —
-- because `shipment_documents` did not exist. It exists now, so the honest
-- answer is a number; but a SHIPPER cannot produce it with a plain count,
-- because §16 says customers see APPROVED documents and 0024's policy above
-- enforces exactly that. A pending POD is invisible to them by design.
--
-- So the count comes from a `security definer` function that returns A NUMBER
-- AND NOTHING ELSE. No id, no file name, no doc type — a shipper learns "two
-- documents on your shipments are being checked", which is what the tile
-- claims, and learns nothing about what they are. The alternative (a policy
-- letting shippers read pending rows) would disclose the file names of
-- documents nobody has looked at yet, which is precisely what "approved" is
-- protecting them from.
--
-- The shipper id is not a parameter: it is derived from `my_shipper_ids()`
-- inside the function, so a caller cannot count another organization's queue.
create or replace function public.count_shipment_documents_awaiting_review()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::integer
  from shipment_documents d
  join shipments s on s.id = d.shipment_id
  where d.status = 'pending'
    and s.shipper_id in (select my_shipper_ids())
$$;

revoke all on function public.count_shipment_documents_awaiting_review() from public;
grant execute on function public.count_shipment_documents_awaiting_review()
  to authenticated, service_role;

comment on function public.count_shipment_documents_awaiting_review() is
  'M-77/§11: how many documents on the CALLER''s shipments are awaiting staff '
  'review. Returns a count only — never a row, an id or a file name — because '
  '§16 keeps unapproved documents out of customer hands. Scope comes from '
  'my_shipper_ids(), never from an argument.';

-- ---------------------------------------------------------------------------
-- 8 · §20's POD PRECONDITION — completing M-72's deliberate deferral
-- ---------------------------------------------------------------------------
--
-- This is the module's headline, and it is a REPLACEMENT of a function shipped
-- in 0019 rather than a new object. That is not a violation of "0017–0023 are
-- untouched": 0019's file is untouched. What 0019 wrote was a function with
-- ONE literal null and, immediately above it, the exact SQL that replaces it,
-- addressed to this module by name:
--
--     `approved_pod_document_id` — §20: "`pod_uploaded` requires an approved
--     POD document." M-77 owns `shipment_documents`. Until it lands there is
--     no table to select from, so this returns null and the engine REFUSES
--     every transition into `pod_uploaded`. That is the honest behaviour: a
--     precondition that cannot be checked must fail, not pass. M-77 completes
--     it by replacing the literal below with
--       (select d.id from shipment_documents d
--         where d.shipment_id = s.id and d.doc_type = 'pod'
--           and d.approved_at is not null
--         order by d.approved_at desc limit 1)
--     and nothing else in the engine changes.
--
-- That expression is used BELOW VERBATIM. Not paraphrased, not "improved" with
-- an extra `and d.status = 'approved'` — because section 3's CHECK
-- (`(status = 'approved') = (approved_at is not null)`) makes the two
-- conditions the same condition, and re-stating it would invite a future
-- reader to wonder which one is authoritative.
--
-- NOTHING ELSE IN THE FUNCTION CHANGES. Every other key, its type and its
-- derivation are byte-identical to 0019's; `closeout_completed_at` is still a
-- literal null because closeout is still a human assertion M-75's surface
-- supplies. `src/lib/shipments/transitions.ts` and `apply-transition.ts` are
-- not edited by this module at all — which was the promise 0019 made, and this
-- is the proof it was kept.
--
-- The consequence, stated as the regression-to-green it is: the integration
-- assertion *"refuses pod_uploaded — M-77 owns documents, so the fact is
-- null"* is now FALSE, and is replaced by the walk it was a placeholder for —
-- upload → approve → `pod_uploaded` succeeds; upload → (no approval) →
-- `pod_uploaded` still refuses.
create or replace function public.shipment_transition_facts(p_shipment_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'shipment_id', s.id,
    'tracking_number', s.tracking_number,
    'status', s.status,
    'carrier_id', s.carrier_id,
    'shipper_id', s.shipper_id,
    'pickup_appointment_at', s.pickup_appointment_at,
    'delivery_appointment_at', s.delivery_appointment_at,
    'cancellation_reason', s.cancellation_reason,
    'active_assignment_id', (
      select a.id from shipment_assignments a
      where a.shipment_id = s.id and a.released_at is null
      limit 1
    ),
    'pickup_confirmed_at', (
      select max(e.event_time) from shipment_events e
      where e.shipment_id = s.id
        and e.status in ('arrived_at_pickup', 'loading')
    ),
    'delivered_at', (
      select max(e.event_time) from shipment_events e
      where e.shipment_id = s.id and e.status = 'delivered'
    ),
    -- M-77 (0024) — 0019's replacement SQL, verbatim. Served by
    -- `idx_shipment_documents_approved_pod`.
    'approved_pod_document_id', (
      select d.id from shipment_documents d
      where d.shipment_id = s.id and d.doc_type = 'pod'
        and d.approved_at is not null
      order by d.approved_at desc limit 1
    ),
    'closeout_completed_at', null,      -- M-75 asserts it (unchanged from 0019)
    'event_count', (
      select count(*) from shipment_events e where e.shipment_id = s.id
    )
  )
  from shipments s
  where s.id = p_shipment_id
$$;

revoke all on function public.shipment_transition_facts(uuid) from public;
grant execute on function public.shipment_transition_facts(uuid) to service_role;

comment on function public.shipment_transition_facts(uuid) is
  'M-72/§20 precondition read, ONE query (§25). M-77 (0024) completed '
  '`approved_pod_document_id` with 0019''s own replacement SQL: `pod_uploaded` '
  'is now reachable, and reachable ONLY with an approved POD document. '
  '`closeout_completed_at` remains a caller assertion (M-75). '
  'EXECUTE: service_role only.';
