#!/usr/bin/env bash
#
# Runs the full E2E suite — including the authenticated order-lifecycle tier —
# against a local Supabase stack and a production build of the app.
#
#   npx supabase start        # once; prints the keys used below
#   ./scripts/e2e-local.sh
#
# Why a production build rather than `next dev`: the lifecycle tests assert on
# server-action behaviour and revalidation, which behave differently under the
# dev overlay. This is also the closest thing to a deployment smoke test.
#
# The Supabase keys are read from `supabase status` rather than written down
# here. They are local-only development keys that grant nothing beyond the
# throwaway container on 127.0.0.1, but a JWT committed to a repository trips
# every secret scanner that looks at it, and asking the CLI also means the
# script keeps working if the local JWT secret is ever changed.
#
# NEXT_PUBLIC_* are read at BUILD time (they are inlined into the client
# bundle), which is why the build runs inside this script rather than before
# it. MARKET_DATA_TEST_FIXTURE arms the non-production fixture provider so
# orders have a deterministic price to fill against — see
# src/lib/market-data/providers/test-fixture.ts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! STACK_ENV="$(npx supabase status -o env 2>/dev/null)"; then
  echo "Could not read local Supabase status — run 'npx supabase start' first." >&2
  exit 1
fi
eval "$(printf '%s\n' "$STACK_ENV" | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"

export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
# Deliberately not 3000: a dev server left running there would answer the
# readiness probe, and the suite would then run against someone else's build
# with someone else's Supabase config — which looks exactly like a login bug.
PORT="${E2E_PORT:-3100}"
export PORT
export NEXT_PUBLIC_SITE_URL="http://localhost:$PORT"

export MARKET_DATA_TEST_FIXTURE='{"TESTCO":1000}'

export E2E_SEED=1
export E2E_TEST_EMAIL="e2e-lifecycle@test.invalid"
export E2E_TEST_PASSWORD="e2e-not-a-real-password"
export E2E_BASE_URL="http://localhost:$PORT"

if ! curl -sf "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" -o /dev/null \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"; then
  echo "Local Supabase is not reachable at $NEXT_PUBLIC_SUPABASE_URL — run 'npx supabase start' first." >&2
  exit 1
fi

echo "==> building"
npm run build

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Set E2E_PORT to a free port." >&2
  exit 1
fi

echo "==> starting server on port $PORT"
npm run start >/tmp/tradosphere-e2e-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

until curl -sf "$E2E_BASE_URL/api/market/status" -o /dev/null; do
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "server died; log follows:" >&2
    tail -40 /tmp/tradosphere-e2e-server.log >&2
    exit 1
  fi
  sleep 1
done

echo "==> running playwright"
npx playwright test "$@"
