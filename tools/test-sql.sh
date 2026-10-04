#!/usr/bin/env bash
# Validates supabase/migrations/0001_init.sql against a local Postgres (no Supabase needed).
# Needs: a local Postgres you can reach as the postgres superuser (e.g. `sudo apt install postgresql`).
# Runs: Supabase stubs -> migration twice (idempotency) -> RLS/storage policy checks.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${GV_TEST_DB:-gvtest}
PSQL=${PSQL:-"sudo -u postgres psql -v ON_ERROR_STOP=1 -q"}
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f supabase/tests/local-stub.sql
$PSQL -d "$DB" -f supabase/migrations/0001_init.sql
$PSQL -d "$DB" -f supabase/migrations/0001_init.sql   # second run must succeed too
$PSQL -d "$DB" -f supabase/tests/rls-test.sql
