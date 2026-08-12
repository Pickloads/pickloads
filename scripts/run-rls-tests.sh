#!/usr/bin/env bash
# ============================================================================
# PickLoads — RLS isolation test runner (M-61).
#
# Builds a throwaway database on a LOCAL PostgreSQL 16, applies the Supabase
# shim + every migration in order + the seed, loads two-tenant fixtures, then
# runs the RLS assertion suite. Any failed assertion raises a PL/pgSQL
# exception; ON_ERROR_STOP turns that into a non-zero exit — the suite fails
# loudly, never silently.
#
# Usage:   npm run test:rls
# Env:     PGHOST (default /tmp/pgsock)   PGPORT (default 5433)
#          PGUSER (default postgres)      RLS_TEST_DB (default pickloads_rls)
#
# This suite is NOT part of `npm test` (vitest): it needs a live PG16 and the
# rest of the test lane runs on placeholder env with no database.
# ============================================================================
set -euo pipefail

# Windows PostgreSQL has no unix-domain sockets at all, so the /tmp/pgsock
# default cannot ever connect there — the suite failed at "cannot reach
# PostgreSQL" and looked like a missing server rather than a wrong default.
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW* | MSYS* | CYGWIN* | Windows_NT) DEFAULT_PGHOST="localhost" ;;
  *) DEFAULT_PGHOST="/tmp/pgsock" ;;
esac
export PGHOST="${PGHOST:-$DEFAULT_PGHOST}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"
DB="${RLS_TEST_DB:-pickloads_rls}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"

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

# The null device, named for the platform psql itself is running on. The
# assertion file discards its per-select chatter with `\o :discard`, and `\o`
# is interpreted by psql — not the shell — so a hard-coded /dev/null is a
# literal, nonexistent path to a native Windows psql and aborts the suite.
# MSYS/Cygwin translate paths on the command line but not inside a .sql file,
# which is why this has to be passed in rather than written there.
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW* | MSYS* | CYGWIN* | Windows_NT) DISCARD="NUL" ;;
  *) DISCARD="/dev/null" ;;
esac

echo "▸ RLS suite — PG at $PGHOST:$PGPORT, database $DB"
psql -d postgres -q -c "drop database if exists $DB" \
                 -c "create database $DB"

run() { psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$1"; }

run "$TESTS/00_shim.sql"
for f in "$MIGRATIONS"/*.sql; do
  run "$f"
done
run "$ROOT/supabase/seed.sql"
run "$TESTS/10_fixtures.sql"

# The assertion file prints its own PASS lines; -q keeps psql chatter out.
psql -d "$DB" -v ON_ERROR_STOP=1 -v discard="$DISCARD" -q -f "$TESTS/20_rls_isolation.sql"

COUNT=$(psql -d "$DB" -At -c "select count(*) from rls_test.results where ok")
echo "✔ RLS isolation suite: $COUNT assertions passed"
