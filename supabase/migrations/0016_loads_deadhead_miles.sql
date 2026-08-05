-- ============================================================================
-- PickLoads — Migration 0016: `loads.deadhead_miles` (M-69 / P-7).
--
-- WHY: src/lib/loads.ts formatRpm() divides gross_rate by loads.miles —
-- LOADED miles only — and the dispatcher board, the carrier loads table and
-- the admin dashboard all label the result "RPM" / "Avg RPM". The uploaded
-- carrier-management skill (and every dispatcher who uses the number to
-- decide) defines true RPM over DEADHEAD + LOADED miles. The displayed value
-- is therefore systematically optimistic, and it is the number lane
-- decisions are made on.
--
-- M-69 does NOT silently change any displayed value: the existing figure is
-- relabelled "Loaded RPM" (which is exactly what it has always been) and a
-- second helper, formatTrueRpm(), computes gross / (deadhead + loaded) and
-- renders "—" until deadhead data exists. This column is what lets that
-- second number become real as dispatchers start capturing it.
--
-- NULLABLE ON PURPOSE. NULL means "not captured", which is honestly
-- different from 0 ("the truck was already there"). formatTrueRpm() renders
-- "—" for NULL and never guesses. Every existing row stays NULL; no
-- backfill, no default — a default of 0 would invent data and make true RPM
-- silently equal loaded RPM, which is the exact defect this fixes.
--
-- The CHECK mirrors the shape of the existing numeric guards on `loads`.
-- No trigger touched: compute_load_fee() (F-03) reads gross_rate and
-- fee_pct_applied only, so the fee snapshot is unaffected.
--
-- No RLS change: policies on `loads` are column-agnostic (0002/0009).
--
-- ROLLBACK:
--   alter table loads drop column if exists deadhead_miles;
--   Lossless for every shipped surface: formatTrueRpm() is additive and only
--   ever renders where a "True RPM" label already says the data may be
--   missing. Dropping the column discards captured deadhead figures — take a
--   `select id, deadhead_miles from loads where deadhead_miles is not null`
--   dump first if any have been entered.
-- ============================================================================

alter table loads
  add column if not exists deadhead_miles integer;

-- Idempotent without a DROP (a drop/re-add would briefly leave the table
-- unconstrained, and emits a NOTICE on every fresh apply).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loads_deadhead_miles_nonneg'
  ) then
    alter table loads
      add constraint loads_deadhead_miles_nonneg
      check (deadhead_miles is null or deadhead_miles >= 0);
  end if;
end $$;

comment on column loads.deadhead_miles is
  'M-69/P-7: empty miles driven to the pickup. NULL = not captured (renders '
  'as "—"), never 0-by-default. True RPM = gross_rate / (deadhead_miles + '
  'miles); loads.miles alone gives LOADED RPM, which is what the board '
  'labelled "RPM" before M-69.';
