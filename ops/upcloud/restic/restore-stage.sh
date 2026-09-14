#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

LIB_DIR=/usr/local/lib/qeo-restic
[[ -f "$LIB_DIR/common.sh" ]] || LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$LIB_DIR/common.sh"

usage() { echo "Usage: qeo-restic-restore-stage --snapshot <snapshot-id> --target <quarantine-root>" >&2; exit 64; }
require_root
SNAPSHOT=""
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot) [[ $# -ge 2 ]] || usage; SNAPSHOT="$2"; shift 2 ;;
    --target) [[ $# -ge 2 ]] || usage; TARGET="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$SNAPSHOT" =~ ^[0-9a-fA-F]{8,64}$ ]] || { echo "Snapshot must be an explicit hexadecimal ID" >&2; exit 64; }
[[ -n "$TARGET" ]] || usage
TARGET="$(realpath -m "$TARGET")"
case "$TARGET" in
  /var/tmp/qeo-restore/*) ;;
  *) echo "Restore target must be inside /var/tmp/qeo-restore/" >&2; exit 64 ;;
esac
[[ ! -e "$TARGET" ]] || { echo "Restore target already exists" >&2; exit 73; }
install -d -m 0700 /var/tmp/qeo-restore "$TARGET"
cleanup_on_failure() {
  local rc="$?"
  if [[ "$rc" -ne 0 && "$TARGET" == /var/tmp/qeo-restore/* ]]; then rm -rf -- "$TARGET"; fi
  exit "$rc"
}
trap cleanup_on_failure EXIT
source_restic_runtime
restic restore "$SNAPSHOT" --target "$TARGET"
[[ -f "$TARGET/qeo-backup-manifest.sha256" && -f "$TARGET/qeo-backup-metadata.txt" ]] || {
  echo "Restored snapshot is missing QEO-202 metadata" >&2
  exit 66
}
trap - EXIT
printf '[PASS] snapshot %s restored to quarantine %s\n' "$SNAPSHOT" "$TARGET"
