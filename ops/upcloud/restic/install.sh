#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "QEO-202 install requires root" >&2; exit 77; }
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install -d -m 0700 /etc/restic/qeoindex /var/lib/qeo-backup/stage
install -d -m 0750 /var/cache/restic/qeoindex /usr/local/lib/qeo-restic
install -m 0640 "$SRC_DIR/common.sh" /usr/local/lib/qeo-restic/common.sh
install -m 0640 "$SRC_DIR/host-copy.sh" /usr/local/lib/qeo-restic/host-copy.sh
install -m 0750 "$SRC_DIR/backup.sh" /usr/local/sbin/qeo-restic-backup
install -m 0750 "$SRC_DIR/maintenance.sh" /usr/local/sbin/qeo-restic-maintenance
install -m 0750 "$SRC_DIR/restore-host.sh" /usr/local/sbin/qeo-restore-host
for unit in qeo-restic-backup.service qeo-restic-backup.timer qeo-restic-maintenance.service qeo-restic-maintenance.timer; do
  install -m 0644 "$SRC_DIR/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl disable qeo-restic-backup.timer qeo-restic-maintenance.timer >/dev/null 2>&1 || true
echo "QEO-202 Restic package installed; timers remain disabled"
