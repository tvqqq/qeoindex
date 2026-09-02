#!/usr/bin/env bash
set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI is required for local replay verification" >&2
  exit 1
fi

supabase status >/dev/null

echo "Running clean local Supabase migration replay..."
supabase db reset --no-seed

echo "Local migration replay: PASS"
