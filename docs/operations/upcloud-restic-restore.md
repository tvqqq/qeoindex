# UpCloud Restic Restore Runbook

Status: **QEO-202 pre-deploy runbook**. The procedure becomes an active recovery path only after QEO-202 has provisioned and passed its first restore drill.

Use this runbook when the QeoIndex/Hermes UpCloud host must be rebuilt on a replacement VPS or when selected host-only operational state must be recovered from the encrypted Restic repository.

Design authority: `docs/superpowers/specs/2026-09-13-qeo-202-restic-backup-design.md`.
Implementation plan: `docs/superpowers/plans/2026-09-13-qeo-202-restic-backup.md`.

## Agent objective

Recover the host quickly without confusing the system's sources of truth:

```text
GitHub        -> application source
Supabase      -> canonical application/database data
Restic / R2   -> selected host-only operational state
Secret store  -> standalone runtime credentials
```

A successful restore is **not** a full-machine image restore. Start from a clean VPS and reconstruct only the approved state.

## Hard safety rules

An assisting agent must follow all of these:

1. Never ask the operator to paste Restic, R2, Supabase, DNSE, Telegram, provider, OAuth or other credentials into chat.
2. Never print secret file contents, environment values, signed URLs, tokens or passwords in commands/reports.
3. Never restore directly into `/`, `/opt`, `/etc` or another live system path with `restic restore`.
4. Never restore `/opt/qeoindex/repo`; clone it fresh from GitHub.
5. Never restore canonical Supabase database data from this repository.
6. Never assume the newest snapshot is healthy after corruption or compromise; select a known-good snapshot deliberately.
7. Never enable market/EOD/backup timers before the replacement host passes manual validation.
8. Never blindly overwrite SSH, UFW, sudoers or other security configuration. Inspect and validate restored copies first.
9. If compromise is suspected, do not start restored Hermes state until potentially exposed embedded credentials are rotated or explicitly cleared for reuse.
10. If repository integrity, snapshot identity or restored-file verification fails, stop before modifying live paths.

## Recovery modes

Choose the mode before restoring anything.

### Mode A — normal infrastructure failure

Examples: VPS loss, disk failure, accidental deletion, provider outage.

- Prefer the newest verified successful backup.
- Existing Hermes embedded credentials may be reused if there is no evidence they were exposed.

### Mode B — suspected compromise

Examples: unauthorized shell/root access, leaked host credentials, unknown filesystem modification.

- Select a snapshot known to predate the incident when possible.
- Treat restored Hermes persistent state as quarantined.
- Rotate/replace embedded Telegram/provider/OAuth/API credentials before starting Hermes.
- Reissue R2 credentials rather than reusing credentials from the old host.
- Re-provision all QeoIndex standalone runtime secrets independently.

## Required recovery inputs

Before execution, confirm the operator can provide these **through approved secret/file provisioning, not chat**:

- Cloudflare R2 account/repository endpoint information;
- a temporary R2 credential capable of reading the backup repository;
- the Restic repository password from the off-host secret manager;
- GitHub access if the repository requires authentication;
- replacement QeoIndex runtime secrets for `/opt/qeoindex/env/*`;
- replacement/approved Hermes credentials when Mode B applies.

The replacement VPS does not need the old host's R2 writer credential.

## Target filesystem layout

Use these recovery-only locations:

```text
/etc/restic/qeoindex/             root-only Restic/R2 configuration
/var/tmp/qeo-restore/             temporary restored snapshots
/opt/qeoindex/repo/               fresh GitHub checkout
/opt/qeoindex/env/                independently provisioned runtime secrets
/opt/hermes/data/                 restored Hermes persistent state
/opt/hermes/deploy/               restored Hermes deployment state
```

The QEO-202 implementation uses a deterministic relative snapshot tree rooted at the approved staged content so restore helpers can locate approved files without guessing.

## Phase 0 — replacement VPS preflight

Do not restore into an already questionable host. Start from a clean supported Ubuntu VPS and harden basic access first.

Record, without secret output:

```bash
whoami
hostnamectl
uname -a
free -h
df -h
swapon --show
ss -lntup
sudo ufw status verbose
```

Confirm:

- host identity is the intended replacement VPS;
- SSH access is stable;
- unexpected public ports are absent;
- enough disk space exists for repository restore staging;
- no QeoIndex/Hermes production timers are active yet.

If any of those assumptions are false, stop and resolve them before recovery.

## Phase 1 — install recovery prerequisites

Install only the prerequisites needed for recovery and the normal runtime:

- Git;
- Docker Engine + Docker Compose plugin;
- Restic;
- rsync;
- tools already required by the approved QeoIndex/Hermes deployment.

Verify versions without installing extra control planes:

```bash
git --version
docker --version
docker compose version
restic version
rsync --version | head -n 1
```

Do not install local PostgreSQL, Redis, Kubernetes or another backup database as part of this restore.

## Phase 2 — prepare Restic access

Create the root-only directory:

```bash
sudo install -d -m 0700 -o root -g root /etc/restic/qeoindex
```

Provision these files through the operator's approved secret path:

```text
/etc/restic/qeoindex/repository-password
/etc/restic/qeoindex/runtime.env
```

Required permissions:

```bash
sudo chown root:root /etc/restic/qeoindex/repository-password /etc/restic/qeoindex/runtime.env
sudo chmod 0600 /etc/restic/qeoindex/repository-password /etc/restic/qeoindex/runtime.env
```

`runtime.env` must expose only the variables required by Restic's S3-compatible backend and QEO-202 heartbeat integration. Do not `cat`, `env`, `set -x`, `printenv` or otherwise dump it.

Load the credential file only in the root recovery shell and set the Restic repository/password-file variables using the deployed QEO-202 configuration. Never embed credential values in command arguments.

## Phase 3 — inspect repository before restore

First prove that the repository opens and identify candidate snapshots:

```bash
restic snapshots --host qeo-upcloud-operational --tag qeo-upcloud-operational
```

Then run the repository integrity gate defined by the deployed QEO-202 tooling. At minimum:

```bash
restic check
```

Do not continue if `restic check` fails.

### Snapshot selection

Normal infrastructure failure:

- select the newest snapshot that corresponds to a successful backup heartbeat and has no known integrity incident.

Suspected corruption/compromise:

- select a snapshot whose timestamp predates the suspected event;
- record the selected snapshot ID and timestamp;
- do not silently fall back to `latest`.

Set only a non-secret shell variable for the chosen snapshot:

```bash
SNAPSHOT_ID='<verified-restic-snapshot-id>'
```

The placeholder above is an operator/agent input, not a credential.

## Phase 4 — restore to quarantine staging

Create a unique temporary target:

```bash
RESTORE_ROOT="/var/tmp/qeo-restore/${SNAPSHOT_ID}"
sudo install -d -m 0700 -o root -g root "$RESTORE_ROOT"
```

Restore there only:

```bash
sudo -E restic restore "$SNAPSHOT_ID" --target "$RESTORE_ROOT"
```

Never change `--target` to `/`, `/opt`, `/etc` or another live prefix.

After restore, inspect only metadata/path names first:

```bash
sudo find "$RESTORE_ROOT" -xdev -maxdepth 5 -printf '%M %u:%g %p\n' | sed -n '1,250p'
```

Do not dump restored secret-bearing file contents.

## Phase 5 — verify the restored snapshot

Before copying anything into live paths, verify that the snapshot contains the expected QEO-202 layout and no unexpected broad filesystem capture.

Required checks:

- `qeo-backup-manifest.sha256` exists and validates from inside the restore root;
- Hermes persistent state exists;
- Hermes deployment state exists;
- QeoIndex host-only deployment/operational state exists when present on the source host;
- expected systemd units/timers exist;
- expected root-owned wrappers exist;
- prohibited material such as `/opt/qeoindex/env/*`, SSH private keys, Docker layer storage and canonical database dumps is absent;
- representative source/restore hashes match backup-drill expectations when recorded;
- restored permissions are compatible with the expected live ownership/modes.

If a restored Hermes SQLite database is present, run an integrity check against the staged copy before it is promoted. Do not start Hermes against an unchecked restored SQLite file.

The metadata contract version must be `1`. Stop on an unsupported version.

## Phase 6 — clone application source fresh

Create the normal application location and clone the repository from GitHub instead of recovering source from Restic:

```bash
sudo install -d -m 0755 -o qeo -g qeo /opt/qeoindex
sudo -u qeo git clone https://github.com/tvqqq/qeoindex.git /opt/qeoindex/repo
```

If authenticated Git transport is required, provision it through the approved host mechanism without exposing credentials in chat/logs.

Check out the operator-approved production revision. Do not infer a historical application commit from the Restic snapshot unless the recovery incident explicitly requires a coordinated rollback and that rollback has been approved.

## Phase 7 — promote approved operational state

Prefer the installed QEO-202 restore helper:

```bash
sudo qeo-restore-host --from "$RESTORE_ROOT" --mode normal
```

For suspected compromise:

```bash
sudo qeo-restore-host --from "$RESTORE_ROOT" --mode compromise
```

The helper consumes the already-restored quarantine tree. It does not choose/download a snapshot and must not start services or timers.

Expected helper responsibilities:

- verify restore-root safety and manifest/version;
- restore Hermes deploy/state;
- restore QeoIndex host-only deploy state when present;
- install approved QeoIndex systemd units and root-owned wrappers;
- run `systemctl daemon-reload`;
- leave SSH/UFW/sudoers/Docker daemon copies as reference-only material for manual review;
- leave services/timers disabled;
- print PASS/WAIT only, with no secret values.

If the helper is unavailable, follow the same allowlist manually using `rsync`/`install`; do not copy arbitrary `/etc` trees wholesale.

## Phase 8 — re-provision standalone secrets

Recreate QeoIndex runtime secrets independently under:

```text
/opt/qeoindex/env/
```

Use the existing project contract: real production env files are host-side secret files, not Git or Restic state.

Verify only filenames, owners and modes. Do not print values.

Typical permission check:

```bash
sudo find /opt/qeoindex/env -maxdepth 1 -type f -printf '%M %u:%g %p\n'
```

Expected secret files are root-/service-readable only according to the deployed worker contract, normally mode `0600` where documented.

### Compromise-mode gate

When Mode B is active, rotate or replace all potentially exposed embedded Hermes credentials before the Hermes service is allowed to start. The agent must report `WAITING FOR SECRET ROTATION` rather than weaken this gate.

## Phase 9 — validate security-sensitive host configuration

Any restored copy of these categories is reference material until validated:

- SSH configuration;
- UFW rules;
- sudoers fragments;
- systemd units that run as root;
- root-owned wrappers;
- Docker daemon configuration.

Validate sudoers before installation/activation:

```bash
sudo visudo -cf /etc/sudoers
```

Validate relevant systemd units using the host's available systemd verification tooling, inspect unit ownership/mode, then reload systemd.

Check network exposure again:

```bash
ss -lntup
sudo ufw status verbose
```

Do not open new public ports merely to make recovery easier.

## Phase 10 — manual service activation

Start services one at a time. Do not enable timers first.

Recommended order:

1. infrastructure/runtime prerequisites;
2. Hermes only after its normal/compromise secret gate passes;
3. QeoIndex realtime worker;
4. QeoIndex EOD worker manual smoke path;
5. monitoring/backup support services.

For every service:

- start manually;
- inspect bounded status/log output without dumping environment variables;
- verify RAM/disk/network impact;
- verify no unexpected public port appears;
- only then move to the next service.

Do not use `docker inspect` output in reports when it would expose environment values.

## Phase 11 — timer activation gate

Before enabling production timers, confirm all applicable checks are PASS:

```text
[PASS] Restic repository integrity
[PASS] selected snapshot deliberately verified
[PASS] restore occurred only in quarantine staging
[PASS] GitHub source cloned fresh
[PASS] backup manifest verified
[PASS] Hermes restored state verified
[PASS] QeoIndex standalone secrets re-provisioned
[PASS] compromise-mode rotations complete or not applicable
[PASS] systemd/sudoers/security config validated
[PASS] Hermes manual smoke
[PASS] realtime worker manual smoke
[PASS] EOD manual/non-destructive smoke
[PASS] no unexpected public ports
[PASS] host resource headroom acceptable
```

Only after those checks may the operator-approved timers be enabled.

The agent must list exactly which timers it plans to enable before enabling them. Do not use broad wildcard activation.

## Phase 12 — close the recovery loop

After the replacement host is operational:

1. revoke the temporary R2 restore credential;
2. provision the normal least-privilege backup credential for the new host;
3. run one fresh backup using the deployed QEO-202 backup service;
4. verify a new snapshot appears with host/tag `qeo-upcloud-operational`;
5. verify the external backup success heartbeat;
6. record backup runtime and size;
7. remove `/var/tmp/qeo-restore/<snapshot-id>` after recovery evidence is captured and no further inspection is needed;
8. verify no temporary plaintext recovery/staging copy remains.

Do not delete the original Restic repository history as part of normal host replacement.

## Agent fast-path checklist

When helping during an outage, use this ordering and report only status/evidence, never secret values:

```text
1. IDENTIFY mode: normal failure or suspected compromise
2. VERIFY clean replacement VPS + disk/network/access
3. INSTALL Git/Docker/Restic/rsync
4. PROVISION Restic password + temporary R2 read credential off-chat
5. CHECK repository integrity
6. SELECT known-good snapshot explicitly
7. RESTORE to /var/tmp/qeo-restore/<id> only
8. VERIFY manifest/layout/permissions/integrity
9. CLONE qeoindex fresh from GitHub
10. RUN qeo-restore-host --from <restore-root> --mode normal|compromise
11. RE-PROVISION /opt/qeoindex/env secrets independently
12. ROTATE Hermes embedded secrets first if compromise mode
13. VALIDATE sudoers/systemd/UFW/ports
14. START + smoke services one by one
15. ENABLE exact timers only after PASS gates
16. REVOKE temporary R2 restore credential
17. RUN fresh backup and verify external heartbeat
18. CLEAN temporary plaintext restore data
```

## Agent final recovery report

Use this shape:

```text
RECOVERY MODE
- normal failure / suspected compromise

RESTIC
- repository reachable: PASS/FAIL
- restic check: PASS/FAIL
- selected snapshot: <id + timestamp only>
- restore staging: PASS/FAIL
- manifest verification: PASS/FAIL

SOURCE OF TRUTH
- GitHub fresh clone: PASS/FAIL
- Supabase restored from Restic: NO
- qeoindex env secrets restored from Restic: NO

HERMES
- persistent state verification: PASS/FAIL
- SQLite integrity when applicable: PASS/FAIL/NA
- compromise credential rotation: PASS/FAIL/NA
- manual smoke: PASS/FAIL

QEOINDEX
- operational state promoted: PASS/FAIL
- standalone secrets re-provisioned: PASS/FAIL
- realtime smoke: PASS/FAIL
- EOD smoke: PASS/FAIL

SECURITY
- sudoers/systemd validation: PASS/FAIL
- unexpected public ports: NONE / list
- temporary restore credential revoked: PASS/FAIL

SCHEDULERS
- enabled only after acceptance: PASS/FAIL
- exact enabled timers: <names, no wildcards>

BACKUP LOOP
- fresh replacement-host backup: PASS/FAIL
- external success heartbeat: PASS/FAIL
- temporary plaintext staging removed: PASS/FAIL

OVERALL
- RECOVERED / BLOCKED
- blocker if any: <non-secret description>
```

## Completion rule

Do not report recovery complete until the required services have passed manual smoke tests, runtime secrets are independently provisioned, any compromise-specific rotations are complete, exact production timers are deliberately enabled, a fresh Restic backup succeeds from the replacement VPS, and temporary plaintext restore material has been removed.
