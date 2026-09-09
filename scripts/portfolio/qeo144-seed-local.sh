#!/usr/bin/env bash
set -euo pipefail

: "${API_URL:?API_URL is required}"
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY is required}"

case "$API_URL" in
  http://127.0.0.1:*|https://127.0.0.1:*|http://localhost:*|https://localhost:*) ;;
  *)
    echo "Refusing to seed QEO-144 acceptance data outside localhost/127.0.0.1: $API_URL" >&2
    exit 1
    ;;
esac

USER_ID="$(API_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" node scripts/portfolio/qeo144-create-local-user.mjs)"
if [[ -z "$USER_ID" ]]; then
  echo "Aborting QEO-144 seed because local acceptance user id is empty" >&2
  exit 1
fi

DB_CONTAINER="${QEO144_DB_CONTAINER:-supabase_db_qeoindex}"
docker exec -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v qeo144_user_id="$USER_ID" -f - \
  < tests/portfolio/qeo144-acceptance-fixture.sql
