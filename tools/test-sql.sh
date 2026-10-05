#!/usr/bin/env bash
# Validates supabase/migrations/*.sql against a local Postgres (no Supabase needed).
# Needs: a local Postgres you can reach as the postgres superuser (e.g. `sudo apt install postgresql`).
# Runs: Supabase stubs -> each migration twice (idempotency) -> RLS/storage, Electromaxx and parts checks. Exits 1 on any failure.
set -euo pipefail
cd "$(dirname "$0")/.."
exec > >(tee /tmp/gv-sql-test.log) 2>&1
trap 'rc=$?; if [ $rc -ne 0 ] || grep -q "FAILURES:" /tmp/gv-sql-test.log; then echo "SQL TESTS FAILED"; exit 1; else echo "SQL TESTS OK"; fi' EXIT
DB=${GV_TEST_DB:-gvtest}
PSQL=${PSQL:-"sudo -u postgres psql -v ON_ERROR_STOP=1 -q"}
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f supabase/tests/local-stub.sql
$PSQL -d "$DB" -f supabase/migrations/0001_init.sql
$PSQL -d "$DB" -f supabase/migrations/0001_init.sql   # second run must succeed too
$PSQL -d "$DB" -f supabase/migrations/0002_electromaxx.sql
$PSQL -d "$DB" -f supabase/migrations/0002_electromaxx.sql
$PSQL -d "$DB" -f supabase/migrations/0003_parts.sql
$PSQL -d "$DB" -f supabase/migrations/0003_parts.sql
$PSQL -d "$DB" -f supabase/tests/rls-test.sql
$PSQL -d "$DB" -c "delete from auth.users"   # fresh users for the next file
$PSQL -d "$DB" -f supabase/tests/electromaxx-test.sql
$PSQL -d "$DB" -c "delete from auth.users"
$PSQL -d "$DB" -f supabase/tests/parts-test.sql
