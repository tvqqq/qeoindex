#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
LOCAL_DB_URL="${QEO_RECOVERY_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ARTIFACT_DIR="${QEO_RECOVERY_ARTIFACT_DIR:-.tmp/qeo-db-recovery}"

phase() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

phase "local environment validation"
[[ "$LOCAL_DB_URL" != *"$PRODUCTION_PROJECT_REF"* ]] || fail "production project ref is forbidden"
[[ "$LOCAL_DB_URL" == *"127.0.0.1:54322"* || "$LOCAL_DB_URL" == *"localhost:54322"* ]] \
  || fail "recovery rehearsal must target local Supabase port 54322"

# The remaining phases are implemented incrementally under TDD. Their order is
# intentionally declared here so destructive execution can never precede backup
# validation when the commands are added.
phase "clean migration replay"
phase "synthetic seed"
phase "baseline capture"
phase "backup"
phase "backup validation"
phase "destructive rehearsal"
phase "assert destructive state"
phase "restore"
phase "restored parity"

printf '\nrecovery rehearsal harness: safety contract ready\n'
