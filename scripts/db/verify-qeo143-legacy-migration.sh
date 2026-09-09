#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${QEO_Q143_DB_CONTAINER:-supabase_db_qeoindex}"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < tests/portfolio/qeo143-legacy-migration.integration.sql
