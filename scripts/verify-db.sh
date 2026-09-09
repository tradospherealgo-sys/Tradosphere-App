#!/usr/bin/env bash
#
# Applies every migration in order to a throwaway Postgres container, then runs
# the SQL tests in supabase/tests/ against it.
#
# This is the only way to find out whether a migration is actually valid before
# it reaches a real project: typecheck and lint say nothing about SQL. It uses a
# plain Postgres image plus the shim in supabase/tests/00_shim.sql rather than
# the Supabase CLI, so it needs nothing but Docker.
#
# Usage: ./scripts/verify-db.sh
set -euo pipefail

CONTAINER=tradosphere-verify-db
IMAGE=postgres:17-alpine
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "==> starting $IMAGE"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=verify \
  -e POSTGRES_DB=tradosphere \
  "$IMAGE" >/dev/null

until docker exec "$CONTAINER" pg_isready -U postgres -d tradosphere >/dev/null 2>&1; do
  sleep 1
done

run_sql() {
  docker exec -i "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 --quiet -U postgres -d tradosphere < "$1"
}

# Migrations run as ONE transaction per file, because that is how Supabase
# applies them. Under psql's default per-statement autocommit this harness
# once accepted a migration that added an enum value and then used it in the
# same file — legal statement by statement, rejected outright (SQLSTATE
# 55P04) on a real deployment. Matching the production transaction boundary
# is the whole point of running these at all.
run_migration() {
  docker exec -i "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 --quiet --single-transaction -U postgres -d tradosphere < "$1"
}

echo "==> applying supabase shim"
run_sql "$ROOT/supabase/tests/00_shim.sql"

echo "==> applying migrations"
for file in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$file")"
  run_migration "$file"
done

echo "==> running sql tests"
for file in "$ROOT"/supabase/tests/[1-9]*.sql; do
  [ -e "$file" ] || continue
  echo "    $(basename "$file")"
  run_sql "$file"
done

echo "==> OK: all migrations applied and all sql tests passed"
