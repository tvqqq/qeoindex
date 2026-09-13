# QEO-202 UpCloud Restic Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy an encrypted, externally stored Restic backup for selected UpCloud host-only operational state and prove that an agent can safely restore that state onto a clean replacement VPS.

**Architecture:** A root-owned host backup wrapper briefly quiesces Hermes, stages only approved host state into a deterministic root-only tree, restarts Hermes immediately, then backs up that relative tree to a dedicated private Cloudflare R2 Restic repository. Separate systemd services/timers own daily backup and weekly repository maintenance; an external dead-man heartbeat observes success/failure. Restore always lands in quarantine staging first and a fail-closed helper promotes only approved state while leaving service/timer activation to explicit post-secret validation.

**Tech Stack:** Bash, Restic, Cloudflare R2 S3-compatible API, rsync, systemd, curl, Node.js `node:test` contract tests.

**Spec:** `docs/superpowers/specs/2026-09-13-qeo-202-restic-backup-design.md`

## Global Constraints

- Destination is a dedicated private R2 bucket; preferred name `qeoindex-upcloud-restic-prod`.
- Repository data is client-side encrypted by Restic.
- `/opt/hermes/data` is secret-bearing state and is included through a quiesced local staging copy.
- `/opt/qeoindex/env/*`, SSH private keys, canonical Supabase data, Docker layers, caches, `/tmp`, and unbounded logs are excluded.
- Daily backup target is 02:30 `Asia/Ho_Chi_Minh`.
- Weekly maintenance target is Sunday 03:30 `Asia/Ho_Chi_Minh`.
- systemd timers must not use catch-up behavior that runs missed heavy work during a daytime reboot.
- Retention is 14 daily, 8 weekly, 6 monthly, 0 yearly snapshots.
- Stable snapshot tag is `qeo-upcloud-operational`; retention grouping must ignore physical VPS hostname.
- First destructive prune requires an observed dry run before the maintenance timer is enabled in apply mode.
- Restic/R2/heartbeat credentials are root-only, mode `0600`, never committed, printed, logged, or copied into issues/reports.
- Restore never writes directly from Restic into `/`, `/opt`, or `/etc`.
- A suspected-compromise restore must rotate affected Hermes embedded credentials before Hermes starts.
- QEO-202 is not complete until a real temporary restore drill, repository check, representative hash/permission checks, measured backup runtime/size, external success heartbeat, and controlled failure alert all pass.

---

## File structure

Create a focused host-operations package rather than scattering backup logic across application services:

```text
ops/upcloud/restic/
├── README.md
├── backup.sh
├── maintenance.sh
├── restore-host.sh
├── install.sh
├── host-copy.sh
├── common.sh
├── secrets.env.example
├── qeo-restic-backup.service
├── qeo-restic-backup.timer
├── qeo-restic-maintenance.service
└── qeo-restic-maintenance.timer

tests/
└── upcloud-restic-contract.test.ts
```

Responsibilities:

- `common.sh`: root/secret preflight, safe env loading, heartbeat helper, shared constants and cleanup primitives.
- `host-copy.sh`: deterministic staging tree construction only; no network access and no Restic mutation.
- `backup.sh`: orchestrates heartbeat → Hermes quiesce/stage/restart → manifest → Restic snapshot → verification → cleanup.
- `maintenance.sh`: repository check plus explicit `dry-run` or `apply` retention/prune mode.
- `restore-host.sh`: validates a quarantine restore tree and promotes only the approved operational categories; it never starts services or enables timers.
- `install.sh`: installs root-owned scripts and systemd units, creates required directories, reloads systemd, and leaves both timers disabled.
- `secrets.env.example`: variable names only; no endpoints containing secret tokens and no credential values.
- `tests/upcloud-restic-contract.test.ts`: static executable-contract checks for secret safety, scope, timer schedules, retention, and restore fail-closed behavior.

### Installed host layout

```text
/usr/local/sbin/qeo-restic-backup
/usr/local/sbin/qeo-restic-maintenance
/usr/local/sbin/qeo-restore-host
/usr/local/lib/qeo-restic/common.sh
/usr/local/lib/qeo-restic/host-copy.sh
/etc/restic/qeoindex/repository-password       # operator-provisioned, 0600
/etc/restic/qeoindex/runtime.env               # operator-provisioned, 0600
/var/lib/qeo-backup/stage/                     # ephemeral plaintext staging, 0700
/var/cache/restic/qeoindex/                    # Restic cache
```

`/etc/restic/qeoindex/runtime.env` contains only the runtime variables required by the installed scripts, including `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, S3-compatible R2 credentials, and the two external heartbeat URLs. The committed example leaves all values empty.

---

### Task 1: Add the executable backup contract and secret-safe host package skeleton

**Files:**
- Create: `ops/upcloud/restic/README.md`
- Create: `ops/upcloud/restic/common.sh`
- Create: `ops/upcloud/restic/host-copy.sh`
- Create: `ops/upcloud/restic/secrets.env.example`
- Create: `tests/upcloud-restic-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `source_restic_runtime()` in `common.sh`; it requires root, `/etc/restic/qeoindex/runtime.env`, and `/etc/restic/qeoindex/repository-password`, validates modes without printing values, exports `RESTIC_PASSWORD_FILE=/etc/restic/qeoindex/repository-password`, and ensures `RESTIC_REPOSITORY` plus AWS R2 credential variables are non-empty.
- Produces `heartbeat_start <url>`, `heartbeat_success <url>`, and `heartbeat_fail <url>`; each uses `curl --fail --silent --show-error --max-time 10 --output /dev/null` and never echoes the URL.
- Produces `build_stage <stage-root>` in `host-copy.sh`; it creates only the deterministic relative tree described below.
- Adds `test:restic` script: `node --test tests/upcloud-restic-contract.test.ts`.

- [ ] **Step 1: Write the contract test before implementation.**

The test must read committed shell/systemd files as text and assert at least:

```ts
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const read = (path: string) => readFile(new URL(path, root), "utf8")

test("Restic package never commits credential values", async () => {
  const example = await read("ops/upcloud/restic/secrets.env.example")
  for (const line of example.split("\n")) {
    if (!line || line.startsWith("#")) continue
    assert.match(line, /^[A-Z0-9_]+=$/)
  }
})

test("host-copy explicitly excludes qeoindex env and private SSH keys", async () => {
  const source = await read("ops/upcloud/restic/host-copy.sh")
  assert.match(source, /\/opt\/qeoindex\/env/)
  assert.match(source, /ssh_host_/)
  assert.match(source, /\.env/)
})
```

Add assertions for `set -Eeuo pipefail`, `umask 077`, root check, fixed secret-file paths, fixed staging root, and absence of `set -x`, `printenv`, `env`, and raw `cat` of secret files.

- [ ] **Step 2: Run the targeted contract test and confirm RED.**

Run:

```bash
node --test tests/upcloud-restic-contract.test.ts
```

Expected: failure because the package files and/or package script do not exist yet.

- [ ] **Step 3: Implement `common.sh`, `host-copy.sh`, and the empty-value secret example.**

`host-copy.sh` must stage these categories beneath the supplied staging root, preserving relative live paths so restore promotion is deterministic:

```text
opt/hermes/data/
opt/hermes/deploy/
opt/qeoindex/deploy/                 # only when the host path exists
etc/systemd/system/qeo-*.service
etc/systemd/system/qeo-*.timer
usr/local/bin/qeo-*
usr/local/sbin/qeo-*
etc/ssh/sshd_config
etc/ssh/sshd_config.d/
etc/ufw/user.rules
etc/ufw/user6.rules
etc/sudoers.d/hermes-qeo             # only when present
etc/docker/daemon.json               # only when present
```

Rules:

- use `rsync -a`/`install`, not `cp -r`;
- exclude `.env` files from `/opt/hermes/deploy`;
- never stage `/opt/qeoindex/env`, `/etc/ssh/ssh_host_*`, `/var/lib/docker`, logs, database dumps, home directories, or arbitrary `/etc` trees;
- missing optional paths are skipped without failure;
- missing `/opt/hermes/data` is a hard failure because it is a required QEO-202 source once Hermes is deployed.

- [ ] **Step 4: Add `pnpm test:restic` and run it to GREEN.**

Run:

```bash
pnpm test:restic
bash -n ops/upcloud/restic/common.sh ops/upcloud/restic/host-copy.sh
```

Expected: all contract assertions pass and both scripts parse cleanly.

- [ ] **Step 5: Commit the host package skeleton.**

```bash
git add package.json ops/upcloud/restic tests/upcloud-restic-contract.test.ts
git commit -m "feat: add Restic host backup contract"
```

---

### Task 2: Implement consistent Hermes staging and encrypted daily backup

**Files:**
- Create: `ops/upcloud/restic/backup.sh`
- Modify: `ops/upcloud/restic/common.sh`
- Modify: `ops/upcloud/restic/host-copy.sh`
- Modify: `tests/upcloud-restic-contract.test.ts`

**Interfaces:**
- `backup.sh` is installed as `/usr/local/sbin/qeo-restic-backup` and takes no positional arguments.
- Fixed staging root: `/var/lib/qeo-backup/stage/current`.
- Hermes control interface follows the production user-systemd runtime:
  - runtime user: `hermes`;
  - unit pattern: `hermes-gateway-*.service`;
  - discover exactly one matching user unit on each backup run; never hard-code the generated suffix;
  - stop/start through `runuser -u hermes -- env XDG_RUNTIME_DIR=/run/user/<uid> systemctl --user ...`.
- Backup runs from inside the staging directory using a relative source: `(cd "$STAGE_ROOT" && restic backup . --host qeo-upcloud-operational --tag qeo-upcloud-operational)` so the snapshot tree does not encode the staging prefix. Restic documents relative backup paths as relative snapshot trees; keep this invocation stable.
- Backup writes `qeo-backup-manifest.sha256` and `qeo-backup-metadata.txt` inside staging before snapshot creation. Metadata contains only non-secret values: UTC timestamp, source host name, backup contract version `1`, and source path names.

- [ ] **Step 1: Extend the contract tests for quiesce/restart/cleanup behavior.**

Assert the script contains:

- strict mode and `umask 077`;
- `flock` or equivalent single-run lock;
- Hermes stop before staging `/opt/hermes/data`;
- Hermes restart before the network backup command;
- an `EXIT`/error trap that restarts Hermes if it is still quiesced and removes plaintext staging;
- relative `restic backup .` with `--host qeo-upcloud-operational` and `--tag qeo-upcloud-operational`;
- no `--exclude-caches` substitute for the explicit staging scope;
- no logging of the runtime secret environment.

- [ ] **Step 2: Run `pnpm test:restic` and confirm RED for missing backup behavior.**

- [ ] **Step 3: Implement `backup.sh`.**

Execution order must be:

```text
require root
→ source root-only runtime config
→ acquire non-blocking lock
→ send backup heartbeat /start best-effort
→ create fresh 0700 staging root
→ stop Hermes
→ copy Hermes data into staging
→ restart Hermes immediately
→ stage the remaining approved host state
→ generate SHA-256 manifest + non-secret metadata
→ restic backup relative tree with stable host/tag
→ restic snapshots --latest 1 --host qeo-upcloud-operational --tag qeo-upcloud-operational
→ send heartbeat success
→ cleanup plaintext staging
```

On any handled failure:

```text
restart Hermes if still stopped
→ send heartbeat /fail best-effort
→ remove plaintext staging
→ exit non-zero
```

The heartbeat request itself must never cause backup success to be reported when Restic failed, and failure to reach the heartbeat service must not suppress the actual Restic exit status.

- [ ] **Step 4: Validate shell syntax and contracts.**

Run:

```bash
bash -n ops/upcloud/restic/backup.sh ops/upcloud/restic/common.sh ops/upcloud/restic/host-copy.sh
pnpm test:restic
```

Expected: GREEN.

- [ ] **Step 5: Commit daily backup implementation.**

```bash
git add ops/upcloud/restic tests/upcloud-restic-contract.test.ts
git commit -m "feat: add encrypted UpCloud Restic backup"
```

---

### Task 3: Implement retention, repository checking, and prune safety

**Files:**
- Create: `ops/upcloud/restic/maintenance.sh`
- Modify: `tests/upcloud-restic-contract.test.ts`

**Interfaces:**
- Installed command: `/usr/local/sbin/qeo-restic-maintenance MODE` where `MODE` is exactly `dry-run` or `apply`.
- Both modes run `restic check` first and abort retention work if it fails.
- Retention command uses exactly:

```text
--keep-daily 14
--keep-weekly 8
--keep-monthly 6
--group-by paths,tags
--tag qeo-upcloud-operational
```

- `dry-run` adds `--dry-run` and must not prune.
- `apply` runs `forget ... --prune` only after repository check succeeds.
- Weekly service will call `apply`, but its timer remains disabled until the initial manual `dry-run` has been reviewed during rollout.

- [ ] **Step 1: Add contract tests for exact retention values, tag/grouping, two modes, and check-before-prune order.**

Also assert there is no `--keep-yearly`, no hostname grouping, and no repository repair command in normal maintenance.

- [ ] **Step 2: Run `pnpm test:restic` and confirm RED.**

- [ ] **Step 3: Implement `maintenance.sh` with strict mode, single-run lock, external maintenance heartbeat, `restic check`, and explicit mode parsing.**

Reject missing/unknown modes with exit code `64` and a non-secret usage message.

- [ ] **Step 4: Validate.**

Run:

```bash
bash -n ops/upcloud/restic/maintenance.sh
pnpm test:restic
```

Expected: GREEN.

- [ ] **Step 5: Commit maintenance policy.**

```bash
git add ops/upcloud/restic/maintenance.sh tests/upcloud-restic-contract.test.ts
git commit -m "feat: add Restic retention maintenance"
```

---

### Task 4: Add systemd scheduling and safe installer

**Files:**
- Create: `ops/upcloud/restic/qeo-restic-backup.service`
- Create: `ops/upcloud/restic/qeo-restic-backup.timer`
- Create: `ops/upcloud/restic/qeo-restic-maintenance.service`
- Create: `ops/upcloud/restic/qeo-restic-maintenance.timer`
- Create: `ops/upcloud/restic/install.sh`
- Modify: `tests/upcloud-restic-contract.test.ts`
- Modify: `ops/upcloud/restic/README.md`

**Interfaces:**
- Daily timer: `OnCalendar=*-*-* 02:30:00 Asia/Ho_Chi_Minh`.
- Weekly timer: `OnCalendar=Sun *-*-* 03:30:00 Asia/Ho_Chi_Minh`.
- Both explicitly set `Persistent=false`.
- Services are `Type=oneshot`, run as root because selected sources require root metadata access, use `Nice=10`, `IOSchedulingClass=idle`, and do not contain secret environment values.
- Backup service executes `/usr/local/sbin/qeo-restic-backup`.
- Maintenance service executes `/usr/local/sbin/qeo-restic-maintenance apply`.
- `install.sh` installs scripts as root-owned `0750`, libraries `0640`, units `0644`, creates root-only secret/cache/staging directories, runs `systemctl daemon-reload`, and leaves both timers disabled.

- [ ] **Step 1: Add contract tests for exact schedules, `Persistent=false`, low-priority settings, exact `ExecStart`, no `Environment=` credential assignment, and disabled-first installer behavior.**

The installer contract test must reject `systemctl enable --now` and wildcard enable/start commands.

- [ ] **Step 2: Run tests and confirm RED.**

- [ ] **Step 3: Implement units and installer.**

`install.sh` may use `systemctl disable qeo-restic-backup.timer qeo-restic-maintenance.timer` to establish the disabled-first state, but must not stop unrelated QeoIndex services.

- [ ] **Step 4: Run static/unit validation.**

```bash
bash -n ops/upcloud/restic/install.sh
pnpm test:restic
pnpm scan:secrets
```

On a Linux validation host with systemd tooling available, additionally run:

```bash
systemd-analyze verify \
  ops/upcloud/restic/qeo-restic-backup.service \
  ops/upcloud/restic/qeo-restic-backup.timer \
  ops/upcloud/restic/qeo-restic-maintenance.service \
  ops/upcloud/restic/qeo-restic-maintenance.timer
```

- [ ] **Step 5: Commit systemd deployment artifacts.**

```bash
git add ops/upcloud/restic tests/upcloud-restic-contract.test.ts
git commit -m "feat: schedule UpCloud Restic backup"
```

---

### Task 5: Implement the fail-closed replacement-VPS restore helper

**Files:**
- Create: `ops/upcloud/restic/restore-host.sh`
- Modify: `tests/upcloud-restic-contract.test.ts`
- Modify: `docs/operations/upcloud-restic-restore.md`
- Modify: `ops/upcloud/restic/README.md`

**Interfaces:**
- Installed command:

```text
qeo-restore-host --from <restore-root> --mode normal|compromise
```

- The helper consumes an already-restored quarantine tree; it never performs network Restic restore itself and therefore cannot accidentally restore directly into live paths.
- It requires root and a restore tree containing `qeo-backup-manifest.sha256` plus metadata contract version `1`.
- It validates the manifest from inside the restore root before promotion.
- It rejects restore roots `/`, `/opt`, `/etc`, `/var`, `/var/tmp`, and any path outside `/var/tmp/qeo-restore/`.
- It promotes only approved categories:

```text
opt/hermes/data
opt/hermes/deploy
opt/qeoindex/deploy
etc/systemd/system/qeo-*.service
etc/systemd/system/qeo-*.timer
usr/local/bin/qeo-*
usr/local/sbin/qeo-*
```

- SSH/UFW/sudoers/Docker daemon files remain reference-only and are reported as `WAIT: manual security-config review`; the helper does not install them automatically.
- It never reads or creates `/opt/qeoindex/env/*`.
- It runs `systemctl daemon-reload` after unit promotion but never starts/enables services or timers.
- In `compromise` mode it always reports `WAIT: rotate Hermes embedded credentials before start`; no bypass flag is provided.

- [ ] **Step 1: Add contract tests for rejected live roots, manifest gate, exact allowlisted promotion roots, absence of service/timer activation, and compromise WAIT state.**

- [ ] **Step 2: Run `pnpm test:restic` and confirm RED.**

- [ ] **Step 3: Implement `restore-host.sh` using `realpath`, exact prefix validation, `sha256sum --check`, and `rsync -a`/`install` for promotion.**

The helper's final output is a fixed non-secret checklist:

```text
[PASS] backup manifest verified
[PASS] approved operational state promoted
[PASS] systemd daemon reloaded
[WAIT] qeoindex runtime secrets must be provisioned independently
[WAIT] security-sensitive host config requires manual review
[WAIT] services and timers remain disabled
```

Compromise mode adds:

```text
[WAIT] Hermes embedded credentials must be rotated before start
```

- [ ] **Step 4: Align the operational runbook with the actual helper interface and deterministic relative snapshot layout.**

Replace any earlier conceptual interface that included `--snapshot`; snapshot selection/restoration remains a separate quarantine step exactly as the runbook requires.

- [ ] **Step 5: Validate and commit.**

```bash
bash -n ops/upcloud/restic/restore-host.sh
pnpm test:restic
pnpm scan:secrets
git diff --check
git add ops/upcloud/restic docs/operations/upcloud-restic-restore.md tests/upcloud-restic-contract.test.ts
git commit -m "feat: add safe UpCloud restore helper"
```

---

### Task 6: Repository verification, PR review, and pre-deploy acceptance

**Files:**
- Modify only if validation reveals a contract/documentation defect.

**Interfaces:**
- Branch: `tvq9612/qeo-202-setup-encrypted-restic-backup-for-upcloud-operational-state`.
- PR targets `main`.
- No production host mutation occurs in this task.

- [ ] **Step 1: Run the repository gates on the exact final head.**

```bash
pnpm test:restic
pnpm verify:pr
pnpm build
git diff --check
```

Expected: all GREEN.

- [ ] **Step 2: Review the complete diff specifically for credential leakage and destructive host behavior.**

Confirm:

- no committed endpoint contains a heartbeat token;
- no access key, repository password, signed URL, or real `.env` value exists;
- installer leaves timers disabled;
- restore helper cannot start/enable services;
- scripts never back up `/opt/qeoindex/env`, SSH private keys, Supabase dumps, Docker storage, logs, or repository source;
- scripts cannot prune before `restic check` succeeds.

- [ ] **Step 3: Update PR #474 to include the implementation plan/artifacts and wait for required `Verify / verify` on the exact head.**

Do not merge a stale head.

- [ ] **Step 4: Update QEO-202 with pre-deploy evidence and keep the issue `In Progress`.**

Record only filenames/check results, never credentials.

---

### Task 7: Production R2 provisioning and disabled-first UpCloud installation

**Files:**
- No committed secret files.
- Source artifacts are those produced by Tasks 1–5.

**Interfaces:**
- R2 bucket: `qeoindex-upcloud-restic-prod`.
- Host root secret directory: `/etc/restic/qeoindex` mode `0700`.
- Runtime secret files: `repository-password` and `runtime.env`, each `0600`.
- Installed timers start disabled.

- [ ] **Step 1: Create/verify the private R2 bucket and bucket-scoped object credential without exposing values in chat, shell history, issue comments, or logs.**

Do not configure a public domain, public bucket access, independent R2 lifecycle deletion, or Bucket Lock in the initial rollout.

- [ ] **Step 2: Generate a unique Restic repository password through the operator's approved secret manager and preserve an off-host recovery copy before repository initialization.**

- [ ] **Step 3: On UpCloud, install Restic/rsync/curl if absent, install the repo package with `sudo ops/upcloud/restic/install.sh`, and provision the two root-only secret files.**

Verify only metadata:

```bash
sudo stat -c '%a %U:%G %n' /etc/restic/qeoindex /etc/restic/qeoindex/repository-password /etc/restic/qeoindex/runtime.env
```

Expected directory `700`; files `600`; owner/group `root:root`.

- [ ] **Step 4: Initialize the repository exactly once if it does not already exist, then prove it opens without printing credentials.**

Use the same loaded root-only runtime environment as the installed wrapper. Never put the repository password or R2 secret on a command line.

- [ ] **Step 5: Verify timers remain disabled and inspect their next schedule without enabling them.**

```bash
systemctl is-enabled qeo-restic-backup.timer || true
systemctl is-enabled qeo-restic-maintenance.timer || true
systemctl list-timers qeo-restic-backup.timer qeo-restic-maintenance.timer --all
```

Expected: both disabled.

---

### Task 8: Real backup, dry-run retention, restore drill, alert drill, and final activation

**Files:**
- Update: `docs/operations/upcloud-restic-restore.md` only if real evidence reveals a command/path mismatch.
- Update active architecture/security docs in the same PR if rollout creates a durable contract not already represented there.

**Interfaces:**
- Acceptance requires real UpCloud + real R2 evidence.
- Production timers may be enabled only after this task's manual gates pass.

- [ ] **Step 1: Run the daily backup manually and measure it.**

```bash
sudo /usr/local/sbin/qeo-restic-backup
```

Capture only non-secret evidence:

- exit status;
- start/end timestamps and runtime;
- Restic processed/source size and stored/additional bytes;
- latest snapshot ID/timestamp/tag;
- Hermes service recovered to its pre-backup running state;
- no unexpected public port/resource regression.

- [ ] **Step 2: Verify repository integrity and run the first retention dry run.**

```bash
sudo /usr/local/sbin/qeo-restic-maintenance dry-run
```

Expected: repository check succeeds; proposed retention reflects 14 daily / 8 weekly / 6 monthly grouped by paths/tags; no snapshot/object deletion occurs.

- [ ] **Step 3: Perform the mandatory temporary restore drill exactly through the documented quarantine path.**

Select the real snapshot ID explicitly, restore to:

```text
/var/tmp/qeo-restore/<snapshot-id>
```

Then verify:

- `qeo-backup-manifest.sha256` passes;
- representative Hermes data/deploy files restore;
- representative QeoIndex deploy file restores when present;
- representative systemd unit parses;
- root-wrapper mode/content is correct;
- `/opt/qeoindex/env`, SSH private keys, Docker layers and database dumps are absent;
- any restored Hermes SQLite DB passes `PRAGMA integrity_check` when applicable.

Do not promote this drill restore onto live production paths.

- [ ] **Step 4: Run a controlled external-alert failure drill without corrupting the repository.**

Use a harmless pre-Restic validation failure (for example temporarily point the wrapper at a missing test-only required staging source through a dedicated local test harness, not by modifying/deleting production data) and prove the backup check emits a failure/missing-success alert while no credential value appears in logs. Restore the normal configuration immediately after the drill.

- [ ] **Step 5: Verify external success heartbeat and cleanup.**

Confirm the successful manual backup is visible to the external dead-man monitor. Remove `/var/tmp/qeo-restore/<snapshot-id>` and confirm no plaintext staging remains under `/var/lib/qeo-backup/stage`.

- [ ] **Step 6: Enable only the daily timer.**

```bash
sudo systemctl enable --now qeo-restic-backup.timer
```

Verify next trigger resolves to 02:30 ICT.

- [ ] **Step 7: After the first retention dry-run output is explicitly accepted, enable the weekly maintenance timer.**

```bash
sudo systemctl enable --now qeo-restic-maintenance.timer
```

Verify next trigger resolves to Sunday 03:30 ICT and `Persistent=false` remains effective.

- [ ] **Step 8: Update QEO-202 with measured acceptance evidence.**

Record:

```text
backup manual run: PASS/FAIL
repository encryption/open: PASS/FAIL
restic check: PASS/FAIL
retention dry run: PASS/FAIL
restore drill: PASS/FAIL
representative hash/permission verification: PASS/FAIL
Hermes SQLite integrity: PASS/FAIL/NA
backup runtime: <duration>
source size: <non-secret size>
repository added/stored bytes: <non-secret size>
success heartbeat: PASS/FAIL
failure alert drill: PASS/FAIL
daily timer: ENABLED/DISABLED
weekly maintenance timer: ENABLED/DISABLED
plaintext staging cleanup: PASS/FAIL
```

Only mark QEO-202 Done when every required acceptance item is PASS (or explicit NA where allowed) and no credential was committed or printed.

---

## Plan self-review

### Spec coverage

- R2 destination and encryption: Tasks 7–8.
- Exact include/exclude scope: Tasks 1–2 plus contract tests.
- Hermes consistency and embedded-secret treatment: Task 2; compromise restore in Task 5.
- 02:30 daily / Sunday 03:30 scheduling with no catch-up: Task 4.
- 14D/8W/6M retention and first dry-run: Tasks 3 and 8.
- Root-only secret handling/off-host password recovery: Tasks 1, 4, 7.
- External dead-man observability: Tasks 2–4 and failure drill in Task 8.
- Staged replacement-VPS restore: Task 5 plus real drill in Task 8.
- Measured size/runtime and representative restore proof: Task 8.
- No production mutation before source/CI validation: Task 6 precedes Tasks 7–8.

### Placeholder scan

No `TBD`, `TODO`, deferred implementation, unspecified error handling, or unnamed tests remain in this plan. Operator-supplied secret values are intentionally absent; those are provisioned through the approved secret channel rather than encoded in source or the plan.

### Interface consistency

- Snapshot tag is consistently `qeo-upcloud-operational`.
- Installed backup/maintenance/restore command names are consistent across tasks.
- Restore helper consumes `--from` + `--mode` only; snapshot selection and `restic restore` stay outside the helper.
- Staging and quarantine roots are distinct: `/var/lib/qeo-backup/stage` for backup preparation, `/var/tmp/qeo-restore` for disaster-recovery restore.
- systemd services call the exact installed command interfaces defined above.
