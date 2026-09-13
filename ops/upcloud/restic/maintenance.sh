#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

LIB_DIR=/usr/local/lib/qeo-restic
[[ -f "$LIB_DIR/common.sh" ]] || LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$LIB_DIR/common.sh"

MODE="${1:-}"
case "$MODE" in
  dry-run|apply) ;;
  *) echo "Usage: qeo-restic-maintenance <dry-run|apply>" >&2; exit 64 ;;
esac

source_restic_runtime
exec 9>/var/lock/qeo-restic-maintenance.lock
flock -n 9 || { echo "Maintenance already running" >&2; exit 75; }
heartbeat_start "${QEO_RESTIC_MAINTENANCE_HEARTBEAT_URL:-}" || true
trap 'rc=$?; if [[ $rc -ne 0 ]]; then heartbeat_fail "${QEO_RESTIC_MAINTENANCE_HEARTBEAT_URL:-}" || true; fi; exit $rc' EXIT

restic check
RETENTION=(--keep-daily 14 --keep-weekly 8 --keep-monthly 6 --group-by paths,tags --tag qeo-upcloud-operational)
if [[ "$MODE" == dry-run ]]; then
  restic forget "${RETENTION[@]}" --dry-run
else
  restic forget "${RETENTION[@]}" --prune
fi
heartbeat_success "${QEO_RESTIC_MAINTENANCE_HEARTBEAT_URL:-}" || true
trap - EXIT
