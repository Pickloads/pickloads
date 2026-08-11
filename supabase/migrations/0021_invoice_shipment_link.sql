-- ============================================================================
-- PickLoads — Migration 0021: shipper-facing invoice linkage.
--
-- WHY THIS EXISTS. `docs/DIRECTIVE-tracking.md` §11 requires the shipper's
-- shipment detail page to show INVOICE STATUS, and
-- `docs/modules/M-70-shipment-domain.md` is explicit about where it may not
-- come from: `gross_shipper_amount` is §18 staff-only, and *"§11's 'invoice
-- status' is a fact about an invoice, not a column on the shipment — M-74
-- reads it from `invoices`, where amounts already live under their own RLS."*
--
-- Except that 0008's `invoices` is CARRIER-shaped: `carrier_id not null`,
-- `load_id` → `loads`, one policy (`member read invoices`) keyed on
-- `my_carrier_ids()`. There is no column a shipper invoice could hang from
-- and no policy under which a shipper could read one. The requirement is
-- unimplementable against the shipped schema, so it needs four things — two
-- columns, one relaxed invariant and one read policy — and nothing more.
--
-- WHAT THIS IS NOT. It is not shipper invoicing. Nothing in M-74 writes an
-- invoice, no Stripe path changes, and `/portal/shipper/billing` keeps its
-- M-56 honest placeholder. This migration makes the READ expressible; raising
-- a shipper invoice is a later module's work.
--
-- WHY `carrier_id` MUST BECOME NULLABLE — a disclosure, not a convenience.
-- The first draft of this migration kept 0008's `carrier_id not null` and
-- planned to name the hauling carrier on a shipper invoice. The RLS suite
-- rejected it, and it was right: 0009's shipped policy is
--
--     create policy "member read invoices" on invoices
--       for select using (carrier_id in (select my_carrier_ids()));
--
-- so a shipper invoice carrying `carrier_id = <the hauling carrier>` is
-- READABLE BY THAT CARRIER — including `amount_cents`, which is the shipper
-- gross. A carrier who knows the gross and their own `carrier_pay` has
-- computed PickLoads' margin, which §18 marks staff-only and §12 puts on the
-- broker must-not-see list. The two parties are on opposite sides of the same
-- deal and the invoice table is shared between them.
--
-- So the linkage is structural: a shipper invoice names NO carrier, and the
-- carrier policy therefore cannot match it under any query. The NOT NULL is
-- replaced by a CHECK that keeps the invariant that actually mattered —
-- every invoice is billed to somebody — while allowing the somebody to be a
-- shipper:
--
--     carrier_id is not null or shipper_id is not null
--
-- Every existing row satisfies it unchanged (all have a carrier), and every
-- existing consumer filters `.eq("carrier_id", …)`, so a null-carrier row is
-- invisible to all of them rather than newly visible to any of them.
--
-- MIGRATIONS 0001–0004 REMAIN FROZEN. 0008 is altered in three ways and no
-- others: two nullable columns are ADDED, and `carrier_id`'s NOT NULL is
-- REPLACED by a weaker CHECK for the reason argued above. No existing policy,
-- trigger, index or column VALUE is modified or dropped, and 0009's carrier
-- policy is left byte-identical.
--
-- SAFETY OF THE NEW POLICY: every pre-existing `invoices` row has
-- `shipper_id = null`, and `null in (select …)` is NULL — never true. So this
-- migration makes exactly zero existing invoices visible to anybody new.
-- `supabase/tests/20_rls_isolation.sql` §10 asserts that, and asserts it
-- against a shipper who genuinely has invoices of their own so the zero is
-- not a vacuous one.
-- ============================================================================

alter table invoices
  add column shipment_id uuid references shipments(id),
  add column shipper_id uuid references shippers(id);

-- See the header: a shipper invoice must name no carrier, or 0009's carrier
-- policy discloses the shipper gross to the hauling carrier.
alter table invoices alter column carrier_id drop not null;
alter table invoices add constraint invoices_party_present
  check (carrier_id is not null or shipper_id is not null);

comment on column invoices.shipment_id is
  'M-74/§11: the brokerage shipment this invoice bills. Null for the M-31 carrier dispatch-fee invoices that predate it.';
comment on column invoices.shipper_id is
  'M-74/§11: the shipper organization billed. Null on carrier invoices; the owner key for the shipper read policy.';

-- Partial: `shipment_id` is null on every carrier invoice, which is most of
-- them, and a partial index neither stores nor scans those rows.
create index idx_invoices_shipment on invoices (shipment_id)
  where shipment_id is not null;
-- The shipper's own invoice list and the §11 "outstanding invoices" tile.
create index idx_invoices_shipper on invoices (shipper_id, created_at desc)
  where shipper_id is not null;

-- The read half only. There is deliberately no shipper INSERT/UPDATE/DELETE
-- policy: 0009's doctrine gives customers SELECT and nothing else, and an
-- invoice a customer can write is not an invoice.
create policy "member read shipper invoices" on invoices
  for select using (shipper_id in (select my_shipper_ids()));

-- ============================================================================
-- ROLLBACK
--
--   drop policy if exists "member read shipper invoices" on invoices;
--   drop index if exists idx_invoices_shipper;
--   drop index if exists idx_invoices_shipment;
--   -- Restoring the NOT NULL FAILS while any shipper invoice exists. That is
--   -- correct: those rows have no carrier and never can. Delete or reassign
--   -- them deliberately first, or leave the column nullable — the CHECK below
--   -- keeps "every invoice is billed to somebody" either way.
--   delete from invoices where carrier_id is null;   -- DESTRUCTIVE, review first
--   alter table invoices drop constraint if exists invoices_party_present;
--   alter table invoices alter column carrier_id set not null;
--   alter table invoices drop column if exists shipper_id;
--   alter table invoices drop column if exists shipment_id;
--
-- DESTRUCTIVE for shipper invoices (they cannot exist without the columns);
-- every pre-0021 CARRIER invoice is untouched, because both new columns are
-- null on them and `carrier_id` still holds its original value. Roll
-- back `src/lib/supabase/database.types.ts` and the shipper shipment detail
-- page in the SAME deploy, or the page selects a column that no longer
-- exists — which fails as an empty invoice section with a logged error, not
-- as a leak. No enum, no trigger, no function is created here, so there is
-- nothing else to unwind.
-- ============================================================================
