import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url))
const pkg = JSON.parse(source("package.json"))

const requiredFiles = [
  "ops/upcloud/restic/README.md",
  "ops/upcloud/restic/common.sh",
  "ops/upcloud/restic/host-copy.sh",
  "ops/upcloud/restic/backup.sh",
  "ops/upcloud/restic/maintenance.sh",
  "ops/upcloud/restic/restore-host.sh",
  "ops/upcloud/restic/install.sh",
  "ops/upcloud/restic/secrets.env.example",
  "ops/upcloud/restic/qeo-restic-backup.service",
  "ops/upcloud/restic/qeo-restic-backup.timer",
  "ops/upcloud/restic/qeo-restic-maintenance.service",
  "ops/upcloud/restic/qeo-restic-maintenance.timer",
]

test("QEO-202 host package is complete and has a targeted test command", () => {
  for (const path of requiredFiles) assert.equal(exists(path), true, `${path} must exist`)
  assert.equal(pkg.scripts?.["test:restic"], "node --test tests/upcloud-restic-contract.test.ts")
})

test("QEO-202 committed secret example contains names only", () => {
  const example = source("ops/upcloud/restic/secrets.env.example")
  for (const line of example.split("\n")) {
    if (!line || line.startsWith("#")) continue
    assert.match(line, /^[A-Z0-9_]+=$/)
  }
  for (const name of [
    "RESTIC_REPOSITORY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "QEO_RESTIC_BACKUP_HEARTBEAT_URL",
    "QEO_RESTIC_MAINTENANCE_HEARTBEAT_URL",
  ]) assert.match(example, new RegExp(`^${name}=$`, "m"))
})

test("common runtime preflight is root-only and never dumps secrets", () => {
  const common = source("ops/upcloud/restic/common.sh")
  assert.match(common, /set -Eeuo pipefail/)
  assert.match(common, /umask 077/)
  assert.match(common, /source_restic_runtime/)
  assert.match(common, /\/etc\/restic\/qeoindex\/runtime\.env/)
  assert.match(common, /\/etc\/restic\/qeoindex\/repository-password/)
  assert.match(common, /RESTIC_PASSWORD_FILE/)
  assert.match(common, /AWS_ACCESS_KEY_ID/)
  assert.match(common, /AWS_SECRET_ACCESS_KEY/)
  assert.doesNotMatch(common, /set -x|printenv/)
})

test("host-copy stages only approved host state", () => {
  const copy = source("ops/upcloud/restic/host-copy.sh")
  assert.match(copy, /build_stage/)
  assert.match(copy, /rsync -a/)
  for (const allowed of [
    "/opt/hermes/data",
    "/opt/hermes/deploy",
    "/opt/qeoindex/deploy",
    "/etc/systemd/system/qeo-",
    "/usr/local/bin/qeo-",
    "/usr/local/sbin/qeo-",
    "/etc/ssh/sshd_config",
    "/etc/ufw/user.rules",
    "/etc/sudoers.d/hermes-qeo",
    "/etc/docker/daemon.json",
  ]) assert.match(copy, new RegExp(allowed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.match(copy, /\.env/)
  assert.match(copy, /ssh_host_/)
  assert.match(copy, /\/opt\/qeoindex\/env/)
  assert.doesNotMatch(copy, /copy_(?:dir|file)[^\n]*\/var\/lib\/docker/)
})

test("daily backup quiesces Hermes only for staging and backs up a relative tree", () => {
  const backup = source("ops/upcloud/restic/backup.sh")
  assert.match(backup, /set -Eeuo pipefail/)
  assert.match(backup, /umask 077/)
  assert.match(backup, /flock/)
  assert.match(backup, /stop hermes/)
  assert.match(backup, /stage_hermes_data/)
  assert.match(backup, /up -d hermes/)
  assert.match(backup, /stop hermes[\s\S]*HERMES_STOPPED=1[\s\S]*stage_hermes_data "\$STAGE_ROOT"[\s\S]*restart_hermes_if_needed[\s\S]*build_stage "\$STAGE_ROOT"[\s\S]*restic backup \./)
  assert.match(backup, /restic backup \. --host qeo-upcloud-operational --tag qeo-upcloud-operational/)
  assert.match(backup, /qeo-backup-manifest\.sha256/)
  assert.match(backup, /qeo-backup-metadata\.txt/)
  assert.match(backup, /trap .*EXIT/)
})

test("maintenance is check-first with exact retention and explicit dry-run/apply modes", () => {
  const maintenance = source("ops/upcloud/restic/maintenance.sh")
  assert.match(maintenance, /restic check/)
  assert.match(maintenance, /--keep-daily 14/)
  assert.match(maintenance, /--keep-weekly 8/)
  assert.match(maintenance, /--keep-monthly 6/)
  assert.match(maintenance, /--group-by paths,tags/)
  assert.match(maintenance, /--tag qeo-upcloud-operational/)
  assert.match(maintenance, /dry-run/)
  assert.match(maintenance, /--dry-run/)
  assert.match(maintenance, /apply/)
  assert.match(maintenance, /--prune/)
  assert.doesNotMatch(maintenance, /--keep-yearly/)
  assert.doesNotMatch(maintenance, /repair/)
  assert.ok(maintenance.indexOf("restic check") < maintenance.indexOf("restic forget"))
})

test("systemd timers use approved ICT schedules and never catch up", () => {
  const daily = source("ops/upcloud/restic/qeo-restic-backup.timer")
  const weekly = source("ops/upcloud/restic/qeo-restic-maintenance.timer")
  assert.match(daily, /OnCalendar=\*-\*-\* 02:30:00 Asia\/Ho_Chi_Minh/)
  assert.match(weekly, /OnCalendar=Sun \*-\*-\* 03:30:00 Asia\/Ho_Chi_Minh/)
  assert.match(daily, /Persistent=false/)
  assert.match(weekly, /Persistent=false/)
})

test("services are low-priority oneshots with fixed commands and no inline secrets", () => {
  const backup = source("ops/upcloud/restic/qeo-restic-backup.service")
  const maintenance = source("ops/upcloud/restic/qeo-restic-maintenance.service")
  for (const unit of [backup, maintenance]) {
    assert.match(unit, /Type=oneshot/)
    assert.match(unit, /Nice=10/)
    assert.match(unit, /IOSchedulingClass=idle/)
    assert.doesNotMatch(unit, /^Environment=/m)
  }
  assert.match(backup, /ExecStart=\/usr\/local\/sbin\/qeo-restic-backup/)
  assert.match(maintenance, /ExecStart=\/usr\/local\/sbin\/qeo-restic-maintenance apply/)
})

test("installer is disabled-first and never broadly starts services", () => {
  const install = source("ops/upcloud/restic/install.sh")
  assert.match(install, /systemctl daemon-reload/)
  assert.match(install, /systemctl disable qeo-restic-backup\.timer qeo-restic-maintenance\.timer/)
  assert.doesNotMatch(install, /enable --now/)
  assert.doesNotMatch(install, /systemctl (?:enable|start) .*\*/)
})

test("restore helper is quarantine-only, allowlisted, and fail-closed", () => {
  const restore = source("ops/upcloud/restic/restore-host.sh")
  assert.match(restore, /--from/)
  assert.match(restore, /--mode/)
  assert.match(restore, /realpath/)
  assert.match(restore, /\/var\/tmp\/qeo-restore\//)
  assert.match(restore, /qeo-backup-manifest\.sha256/)
  assert.match(restore, /sha256sum --check/)
  for (const allowed of ["opt/hermes/data", "opt/hermes/deploy", "opt/qeoindex/deploy"]) {
    assert.match(restore, new RegExp(allowed))
  }
  assert.match(restore, /WAIT.*security-sensitive host config/i)
  assert.match(restore, /WAIT.*Hermes embedded credentials/i)
  assert.match(restore, /promote_file_glob usr\/local\/bin .*0750/)
  assert.match(restore, /promote_file_glob usr\/local\/sbin .*0750/)
  assert.doesNotMatch(restore, /systemctl (?:start|enable)/)
  assert.doesNotMatch(restore, /\/opt\/qeoindex\/env\//)
})
