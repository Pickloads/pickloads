-- ============================================================================
-- PickLoads — integration-lane harness (M-72).
--
-- Loaded by `scripts/run-integration-tests.sh` after the migration chain and
-- the seed. Two things only:
--
--   * `itest.sqlstate_of(stmt)` — run a statement and return the SQLSTATE it
--     raised, or 'OK'. The tests need EXACT codes (PL409 is a concurrency
--     conflict, PL422 is a bad argument, and conflating them would let a
--     validation bug pass as a race), and psql does not print a SQLSTATE on
--     stderr in a form worth parsing.
--   * `itest.open_brokerage_gate()` / `close_brokerage_gate()` — the §2 gate
--     (0017) refuses every shipment INSERT while `brokerage_active` is false,
--     which is the correct launch state and the state the seed ships. An
--     integration test that creates a shipment has to open it deliberately,
--     exactly as the RLS fixtures do.
--
-- The lane runs as the database OWNER, which is stricter than it sounds: the
-- owner has BYPASSRLS-equivalent access, so nothing here can pass because a
-- policy happened to allow it. Every refusal below comes from a trigger, a
-- CHECK, a unique index or the engine.
-- ============================================================================

create schema itest;

create function itest.sqlstate_of(stmt text) returns text
language plpgsql as $$
declare state text;
begin
  execute stmt;
  return 'OK';
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  return state;
end;
$$;

create function itest.open_brokerage_gate() returns void
language sql as $$
  update company_settings set value = 'true'::jsonb where key = 'brokerage_active';
$$;

create function itest.close_brokerage_gate() returns void
language sql as $$
  update company_settings set value = 'false'::jsonb where key = 'brokerage_active';
$$;

-- M-83 — the browser roles need `itest.sqlstate_of` too.
--
-- §19's write proofs have to run as `authenticated`/`anon`, not as the owner:
-- a refusal observed as the owner proves nothing about a policy or a grant.
-- `sqlstate_of` is SECURITY INVOKER, so wrapping it in `set local role` runs
-- the statement with the caller's own privileges and RLS fully in force —
-- but only if the caller may reach the function at all.
grant usage on schema itest to authenticated, anon;
grant execute on function itest.sqlstate_of(text) to authenticated, anon;
