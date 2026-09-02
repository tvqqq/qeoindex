#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
LOCAL_DB_URL="${QEO_RECOVERY_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
DB_CONTAINER="${QEO_RECOVERY_DB_CONTAINER:-supabase_db_qeoindex}"
ARTIFACT_DIR="${QEO_RECOVERY_ARTIFACT_DIR:-.tmp/qeo-db-recovery}"
TEMP_SEED=0

phase() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ "$TEMP_SEED" == "1" ]]; then
    rm -f supabase/seed.sql
  fi
}
trap cleanup EXIT

phase "local environment validation"
[[ "$LOCAL_DB_URL" != *"$PRODUCTION_PROJECT_REF"* ]] || fail "production project ref is forbidden"
[[ "$LOCAL_DB_URL" == *"127.0.0.1:54322"* || "$LOCAL_DB_URL" == *"localhost:54322"* ]] \
  || fail "recovery rehearsal must target local Supabase port 54322"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v supabase >/dev/null 2>&1 || fail "supabase CLI is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"

# The configured seed path may intentionally be absent in the repository. The
# rehearsal uses its own explicit synthetic seed after migration replay.
if [[ ! -e supabase/seed.sql ]]; then
  printf '%s\n' '-- QEO-26 temporary empty seed; removed on exit.' > supabase/seed.sql
  TEMP_SEED=1
fi

phase "clean migration replay"
supabase start >/dev/null
supabase db reset

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "local Supabase DB container $DB_CONTAINER is not running"
{
  docker --version
  supabase --version
  docker exec "$DB_CONTAINER" postgres --version
} > "$ARTIFACT_DIR/versions.txt"

phase "synthetic seed"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < scripts/db/recovery/seed.sql

phase "baseline capture"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -At -f - \
  < scripts/db/recovery/capture-baseline.sql \
  > "$ARTIFACT_DIR/baseline.txt"
test -s "$ARTIFACT_DIR/baseline.txt" || fail "baseline capture is empty"

phase "ACL snapshot"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -At -f - \
  < scripts/db/recovery/capture-acl-restore.sql \
  > "$ARTIFACT_DIR/acl-restore.sql"
test -s "$ARTIFACT_DIR/acl-restore.sql" || fail "ACL recovery snapshot is empty"
grep -q "revoke all privileges on table public.portfolio_transactions" "$ARTIFACT_DIR/acl-restore.sql" \
  || fail "ACL recovery snapshot is missing portfolio reset"
grep -q "revoke all privileges on table public.qeo_recovery_table_fixture" "$ARTIFACT_DIR/acl-restore.sql" \
  || fail "ACL recovery snapshot is missing synthetic fixture reset"
sha256sum "$ARTIFACT_DIR/acl-restore.sql" > "$ARTIFACT_DIR/acl-restore.sql.sha256"

phase "backup"
docker exec "$DB_CONTAINER" pg_dump \
  -U postgres \
  -d postgres \
  --format=custom \
  --no-owner \
  --table=public.portfolio_transactions \
  --table=public.qeo_recovery_table_fixture \
  > "$ARTIFACT_DIR/pre-destructive.dump"

phase "backup validation"
test -s "$ARTIFACT_DIR/pre-destructive.dump" || fail "backup artifact is empty"
docker exec -i "$DB_CONTAINER" pg_restore --list \
  < "$ARTIFACT_DIR/pre-destructive.dump" \
  > "$ARTIFACT_DIR/backup.list"
test -s "$ARTIFACT_DIR/backup.list" || fail "backup catalog validation failed"
sha256sum "$ARTIFACT_DIR/pre-destructive.dump" > "$ARTIFACT_DIR/pre-destructive.dump.sha256"

phase "destructive rehearsal"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < scripts/db/recovery/destructive.sql

phase "assert destructive state"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < scripts/db/recovery/assert-destroyed.sql

# pg_restore --clean replays object cleanup entries (policies/constraints) before
# recreating a fully dropped table. PostgreSQL requires the relation to exist even
# for DROP POLICY IF EXISTS ... ON <table>, so materialize a disposable placeholder.
# The archive's own DROP TABLE cleanup removes this stub before restoring the real
# table, preserving fail-fast restore semantics without suppressing pg_restore errors.
phase "restore bootstrap"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - <<'SQL'
create table public.qeo_recovery_table_fixture (
  __qeo_restore_stub boolean
);
SQL

phase "restore"
docker exec -i "$DB_CONTAINER" pg_restore \
  -U postgres \
  -d postgres \
  --clean \
  --if-exists \
  --no-owner \
  --exit-on-error \
  < "$ARTIFACT_DIR/pre-destructive.dump"

# Supabase default privileges apply when pg_restore recreates tables. Archive ACL
# entries do not reliably remove every inherited app-role grant, so replay the
# exact pre-destructive observable ACL snapshot before strict parity comparison.
phase "ACL restore"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < "$ARTIFACT_DIR/acl-restore.sql"

phase "restored parity"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < scripts/db/recovery/assert-restored.sql
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -At -f - \
  < scripts/db/recovery/capture-baseline.sql \
  > "$ARTIFACT_DIR/restored.txt"
diff -u "$ARTIFACT_DIR/baseline.txt" "$ARTIFACT_DIR/restored.txt"

printf '\nrecovery rehearsal: PASS\n'
