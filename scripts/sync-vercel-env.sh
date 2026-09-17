#!/usr/bin/env bash
# One-off: pushes every KEY=VALUE in .env.local to the linked Vercel project
# (Production + Preview), without ever writing secrets to git.
#
# NEXT_PUBLIC_* vars are added as --type config (plain, build-time visible —
# required so Next.js can inline them; they're documented as public-safe
# anyway, e.g. the Supabase anon key is RLS-protected). Everything else is
# added as --type secret (hidden after save, injected at request runtime
# only — fine for server-only secrets like SUPABASE_SERVICE_ROLE_KEY).
#
# Re-run any time .env.local changes. Existing vars are removed and
# re-added so this is safe to run repeatedly.
#
# Requires: `npx vercel link` already run in this repo.
#   ./scripts/sync-vercel-env.sh

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo ".env.local not found" >&2
  exit 1
fi

while IFS='=' read -r key value; do
  # Skip blank lines, comments, and keys with no value.
  [[ -z "$key" || "$key" == \#* ]] && continue
  [[ -z "$value" ]] && continue
  # Vercel CLI/dev-only var — never push this one.
  [[ "$key" == "VERCEL_OIDC_TOKEN" ]] && continue

  if [[ "$key" == NEXT_PUBLIC_* ]]; then
    type="config"
  else
    type="secret"
  fi

  for target in production preview; do
    npx vercel env rm "$key" "$target" --yes </dev/null >/dev/null 2>&1 || true
    npx vercel env add "$key" "$target" --type "$type" --value "$value" --yes </dev/null >/dev/null 2>&1 \
      && echo "  ok    $key -> $target ($type)" \
      || echo "  FAIL  $key -> $target"
  done
done < <(grep -E '^[A-Z0-9_]+=' .env.local | sed -E 's/^([A-Z0-9_]+)=("?)(.*)\2$/\1=\3/')

echo
echo "Done. Redeploy to apply: npx vercel --prod --force --yes"
