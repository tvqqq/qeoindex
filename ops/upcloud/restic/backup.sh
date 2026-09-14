#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

LIB_DIR=/usr/local/lib/qeo-restic
[[ -f "$LIB_DIR/common.sh" ]] || LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$LIB_DIR/common.sh"
# shellcheck source=/dev/null
source "$LIB_DIR/host-copy.sh"

STAGE_ROOT=/var/lib/qeo-backup/stage/current
LOCK_FILE=/var/lock/qeo-restic-backup.lock
HERMES_UNIT=""
HERMES_STOPPED=0
BACKUP_OK=0

restart_hermes_if_needed() {
  if [[ "$HERMES_STOPPED" -eq 1 ]]; then
    hermes_gateway_start "$HERMES_UNIT" >/dev/null
    HERMES_STOPPED=0
  fi
}

cleanup() {
  local rc="$1"
  restart_hermes_if_needed || true
  if [[ "$STAGE_ROOT" == /var/lib/qeo-backup/stage/* ]]; then
    rm -rf -- "$STAGE_ROOT"
  fi
  if [[ "$rc" -ne 0 || "$BACKUP_OK" -ne 1 ]]; then
    heartbeat_fail "${QEO_RESTIC_BACKUP_HEARTBEAT_URL:-}" || true
  fi
}
trap 'cleanup $?' EXIT

source_restic_runtime
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Backup already running" >&2; exit 75; }
heartbeat_start "${QEO_RESTIC_BACKUP_HEARTBEAT_URL:-}" || true
rm -rf -- "$STAGE_ROOT"
install -d -m 0700 "$STAGE_ROOT"

HERMES_UNIT="$(discover_hermes_gateway_unit)"
hermes_gateway_stop "$HERMES_UNIT" >/dev/null
HERMES_STOPPED=1
stage_hermes_data "$STAGE_ROOT"
restart_hermes_if_needed
build_stage "$STAGE_ROOT"

(
  cd "$STAGE_ROOT"
  printf 'contract_version=1\ncreated_utc=%s\nsource_host=%s\n' "$(date -u +%FT%TZ)" "$(hostname)" > qeo-backup-metadata.txt
  find . -type f ! -name qeo-backup-manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > qeo-backup-manifest.sha256
  restic backup . --host qeo-upcloud-operational --tag qeo-upcloud-operational
)
restic snapshots --latest 1 --host qeo-upcloud-operational --tag qeo-upcloud-operational >/dev/null
BACKUP_OK=1
heartbeat_success "${QEO_RESTIC_BACKUP_HEARTBEAT_URL:-}" || true
