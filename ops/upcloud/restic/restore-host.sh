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

require_identity() {
  local user="$1" group="$2"
  id -u "$user" >/dev/null 2>&1 || { echo "Required restore user is missing: $user" >&2; exit 67; }
  getent group "$group" >/dev/null 2>&1 || { echo "Required restore group is missing: $group" >&2; exit 67; }
}

semantic_reown_nonroot() {
  local live="$1" user="$2" group="$3"
  [[ -d "$live" ]] || return 0
  if find "$live" -xdev -mindepth 1 -uid 0 ! -gid 0 -print -quit | grep -q .; then
    echo "Ambiguous root-owned group identity under $live; manual ownership review required" >&2
    exit 67
  fi
  chown -h "$user:$group" "$live"
  find "$live" -xdev -mindepth 1 ! -uid 0 -exec chown -h "$user:$group" {} +
}

promote_dir() {
  local rel="$1" live="/$1" owner="$2" group="$3"
  [[ -d "$RESTORE_ROOT/$rel" ]] || return 0
  install -d -m 0750 "$live"
  rsync -a "$RESTORE_ROOT/$rel/" "$live/"
  semantic_reown_nonroot "$live" "$owner" "$group"
}
promote_file_glob() {
  local rel_dir="$1" pattern="$2" mode="$3"
  local live_dir="/$rel_dir"
  [[ -d "$RESTORE_ROOT/$rel_dir" ]] || return 0
  install -d -m 0755 "$live_dir"
  local src
  shopt -s nullglob
  for src in "$RESTORE_ROOT/$rel_dir"/$pattern; do install -m "$mode" "$src" "$live_dir/$(basename "$src")"; done
  shopt -u nullglob
}

require_identity hermes hermes
require_identity qeo qeo

promote_dir opt/hermes/data hermes hermes
promote_dir opt/hermes/deploy hermes hermes
promote_dir opt/qeoindex/deploy qeo qeo
promote_file_glob etc/systemd/system 'qeo-*.service' 0644
promote_file_glob etc/systemd/system 'qeo-*.timer' 0644
promote_file_glob usr/local/bin 'qeo-*' 0750
promote_file_glob usr/local/sbin 'qeo-*' 0750
systemctl daemon-reload

printf '%s\n' \
  '[PASS] backup manifest verified' \
  '[PASS] approved operational state promoted' \
  '[PASS] service-path ownership normalized by semantic identity' \
  '[PASS] systemd daemon reloaded' \
  '[WAIT] qeoindex runtime secrets must be provisioned independently' \
  '[WAIT] security-sensitive host config requires manual review' \
  '[WAIT] services and timers remain disabled'
if [[ "$MODE" == compromise ]]; then
  echo '[WAIT] Hermes embedded credentials must be rotated before start'
fi
