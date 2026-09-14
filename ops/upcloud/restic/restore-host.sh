#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() { echo "Usage: qeo-restore-host --from <restore-root> --mode normal|compromise" >&2; exit 64; }
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "QEO-202 restore requires root" >&2; exit 77; }

RESTORE_ROOT=""
MODE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) [[ $# -ge 2 ]] || usage; RESTORE_ROOT="$2"; shift 2 ;;
    --mode) [[ $# -ge 2 ]] || usage; MODE="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$MODE" == normal || "$MODE" == compromise ]] || usage
[[ -n "$RESTORE_ROOT" ]] || usage
RESTORE_ROOT="$(realpath "$RESTORE_ROOT")"
case "$RESTORE_ROOT" in
  /var/tmp/qeo-restore/*) ;;
  *) echo "Restore root must be inside /var/tmp/qeo-restore/" >&2; exit 64 ;;
esac
for forbidden in / /opt /etc /var /var/tmp; do
  [[ "$RESTORE_ROOT" != "$forbidden" ]] || { echo "Unsafe restore root" >&2; exit 64; }
done

MANIFEST="$RESTORE_ROOT/qeo-backup-manifest.sha256"
METADATA="$RESTORE_ROOT/qeo-backup-metadata.txt"
[[ -f "$MANIFEST" && -f "$METADATA" ]] || { echo "Restore metadata is incomplete" >&2; exit 66; }
grep -qx 'contract_version=1' "$METADATA" || { echo "Unsupported backup contract version" >&2; exit 65; }
(
  cd "$RESTORE_ROOT"
  sha256sum --check qeo-backup-manifest.sha256 >/dev/null
)

promote_dir() {
  local rel="$1" live="/$1"
  [[ -d "$RESTORE_ROOT/$rel" ]] || return 0
  install -d -m 0750 "$live"
  rsync -a "$RESTORE_ROOT/$rel/" "$live/"
}
promote_file_glob() {
  local rel_dir="$1" pattern="$2" mode="$3" live_dir="/$rel_dir"
  [[ -d "$RESTORE_ROOT/$rel_dir" ]] || return 0
  install -d -m 0755 "$live_dir"
  local src
  shopt -s nullglob
  for src in "$RESTORE_ROOT/$rel_dir"/$pattern; do install -m "$mode" "$src" "$live_dir/$(basename "$src")"; done
  shopt -u nullglob
}

promote_dir opt/hermes/data
promote_dir opt/hermes/deploy
promote_dir opt/qeoindex/deploy
promote_file_glob etc/systemd/system 'qeo-*.service' 0644
promote_file_glob etc/systemd/system 'qeo-*.timer' 0644
promote_file_glob usr/local/bin 'qeo-*' 0750
promote_file_glob usr/local/sbin 'qeo-*' 0750
systemctl daemon-reload

printf '%s\n' \
  '[PASS] backup manifest verified' \
  '[PASS] approved operational state promoted' \
  '[PASS] systemd daemon reloaded' \
  '[WAIT] qeoindex runtime secrets must be provisioned independently' \
  '[WAIT] security-sensitive host config requires manual review' \
  '[WAIT] services and timers remain disabled'
if [[ "$MODE" == compromise ]]; then
  echo '[WAIT] Hermes embedded credentials must be rotated before start'
fi
