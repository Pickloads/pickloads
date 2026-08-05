#!/usr/bin/env bash
# ============================================================================
# PickLoads — integration test runner (M-72).
#
# THE RESTORED TIER. `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 records that the
# tracking directive's §27 integration tier — eleven named tests — was
# "diagnosed absent, then dropped entirely" by the extension audit, and
# restores it as **M-83b**. This script is its FIRST INSTALMENT: the lane
# itself, plus the four §27 tests M-72 is in a position to prove (create
# shipment · assign carrier · create shipment event · update status), plus the
# idempotent replay the engine's contract rests on. M-83b adds the remaining
# seven as their modules land.
#
# WHY A SEPARATE LANE. `npm test` (vitest) runs secretless with no database —
# that is deliberate and every existing suite depends on it. `npm run test:rls`
# runs pure SQL as five different Postgres roles. Neither can answer the
# question this lane exists for: *does the TypeScript engine's verdict and the
# SQL write path agree, end to end, against a real PostgreSQL 16?* So the tests
# are vitest (they import `src/lib/shipments/transitions.ts` directly) but they
# reach a live database through `psql`, which needs no new dependency and no
# network — `pg` as a devDependency would add a package to keep `npm audit` at
# zero for, to do something a subprocess already does.
#
# The database is built the same way the RLS suite builds its own: shim →
# every migration in order → seed. It does NOT load `supabase/tests/
# 10_fixtures.sql`: this lane creates its own shipments THROUGH the engine,
# which is the point of an integration test.
#
# Usage:   npm run test:integration
# Env:     PGHOST (default /tmp/pgsock)   PGPORT (default 5433)
#          PGUSER (default postgres)      INTEGRATION_TEST_DB (default
#                                         pickloads_integration)
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-/tmp/pgsock}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"
export INTEGRATION_TEST_DB="${INTEGRATION_TEST_DB:-pickloads_integration}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "✖ psql not found — install PostgreSQL 16 client tools." >&2
  exit 1
fi

if ! psql -d postgres -c 'select 1' >/dev/null 2>&1; then
  cat >&2 <<EOF
✖ Cannot reach PostgreSQL at PGHOST=$PGHOST PGPORT=$PGPORT.

  Start a local PG16 (the M-01 validation pattern):
    initdb -D /tmp/pgdata
    pg_ctl -D /tmp/pgdata -l /tmp/pg16.log \\
      -o "-k /tmp/pgsock -p 5433 -c listen_addresses=" start
EOF
  exit 1
fi

echo "▸ Integration lane — PG at $PGHOST:$PGPORT, database $INTEGRATION_TEST_DB"
psql -d postgres -q -c "drop database if exists $INTEGRATION_TEST_DB" \
                 -c "create database $INTEGRATION_TEST_DB"

run() { psql -d "$INTEGRATION_TEST_DB" -v ON_ERROR_STOP=1 -q -f "$1"; }

run "$ROOT/supabase/tests/00_shim.sql"
for f in "$MIGRATIONS"/*.sql; do
  run "$f"
done
run "$ROOT/supabase/seed.sql"
run "$ROOT/tests/integration/00_harness.sql"

npx vitest run --config "$ROOT/vitest.integration.config.ts"
