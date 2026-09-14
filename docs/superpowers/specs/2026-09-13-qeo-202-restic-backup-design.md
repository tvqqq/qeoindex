# QEO-202 UpCloud Restic Backup Design

Status: approved design, not yet deployed.

## Goal

Provide a small, encrypted, externally stored backup for operational state that exists only on the UpCloud host, with a recovery procedure that can rebuild the operational filesystem state on a replacement VPS without restoring canonical Supabase data, Docker layers, build caches, or repository source.

The recovery contract is intentionally split by source of truth:

- GitHub rebuilds application source.
- Supabase remains canonical application/database persistence.
- Restic rebuilds selected host-only operational state.
- The operator's off-host password/secret store re-provisions standalone runtime credentials.

The operational restore runbook is `docs/operations/upcloud-restic-restore.md`.

## Destination

Use a dedicated private Cloudflare R2 bucket as the Restic repository destination through R2's S3-compatible API.

Preferred bucket name: `qeoindex-upcloud-restic-prod`.

Properties:

- private bucket only;
- no public custom domain;
- client-side Restic encryption is mandatory;
- dedicated bucket-scoped R2 API credentials;
- normal backup credential is limited to the object access Restic requires for this bucket;
- restore should use a newly issued temporary read-capable credential where practical;
- R2 lifecycle rules must not independently expire Restic repository objects;
- bucket-lock/immutability is not part of the initial rollout because Restic retention/prune must be proven first.

The repository must remain usable if the UpCloud VPS or UpCloud account is unavailable.

## Backup scope

### Include

- `/opt/hermes/data` via the consistency procedure below;
- `/opt/hermes/deploy` except any separately stored plaintext secret file;
- `/opt/qeoindex/deploy` and host-only operational compose/runbook state;
- selected QeoIndex/Hermes systemd units and timers required to recreate the host;
- selected root-owned QeoIndex diagnostic/operational wrapper scripts;
- selected host configuration required for safe reconstruction, captured as reviewed files rather than an unrestricted `/etc` backup.

### Exclude

- `/opt/qeoindex/repo`; GitHub is the source of truth;
- `/opt/qeoindex/env/*`; these credentials are re-provisioned from the off-host secret source;
- Docker images, layers, volumes that are rebuildable, and `/var/lib/docker`;
- `node_modules`, build output and caches;
- `/tmp`, system journal history and unbounded logs;
- canonical Supabase database data;
- SSH private keys;
- arbitrary home-directory state not explicitly reviewed for inclusion.

## Hermes consistency and secret-bearing state

`/opt/hermes/data` is not ordinary data. QEO-198 defines the mounted Hermes `/opt/data` directory as persistent data/config/session state and allows Telegram/provider credentials to live inside that persistent state.

Therefore:

1. The Restic repository is classified as **secret-bearing encrypted backup storage**.
2. Standalone QeoIndex runtime secrets remain excluded because they are independently reproducible.
3. Hermes persistent state is included because removing embedded credentials selectively risks producing an incomplete or non-restorable Hermes state.

To avoid copying a mutating Hermes state while keeping outage short, use the production Hermes runtime contract: user `hermes`, exactly one discoverable `hermes-gateway-*.service` user-systemd unit, with the generated suffix discovered at runtime rather than hard-coded.

1. gracefully stop the discovered Hermes user-systemd gateway service;
2. copy `/opt/hermes/data` into a root-only local staging tree;
3. restart Hermes immediately;
4. run Restic against the staging tree rather than the live Hermes data directory;
5. securely remove the plaintext staging tree after the Restic command exits;
6. use shell cleanup/trap handling so Hermes is restarted and staging is removed on failures.

The staging directory must be root-owned and mode `0700` or stricter. It must never be exposed through a web service or committed to Git.

If the Hermes persistent store contains SQLite databases, the rollout validation must include an integrity check against the restored database copy before QEO-202 is accepted.

## Schedule

Daily backup target: **02:30 Asia/Ho_Chi_Minh**.

Weekly maintenance target: **03:30 Sunday Asia/Ho_Chi_Minh**.

Rules:

- backup/maintenance must not run during the market/realtime/EOD pressure window;
- the timer must not use a catch-up configuration that can unexpectedly run a missed heavy backup/prune immediately after a daytime reboot;
- backup and maintenance services should use low CPU/I/O scheduling priority where practical;
- weekly prune is separate from the daily backup so repository maintenance cannot extend every daily backup window.

## Retention

Initial Restic snapshot policy:

- keep 14 daily snapshots;
- keep 8 weekly snapshots;
- keep 6 monthly snapshots;
- no yearly retention.

Retention is an operational disaster-recovery policy, not a historical archive policy.

Snapshots use the stable tag:

`qeo-upcloud-operational`

Retention grouping must not depend on the physical VPS hostname. Use stable path/tag grouping so a replacement VPS can continue the same operational repository history.

Before the first destructive prune, run the equivalent retention command in dry-run mode and review the proposed snapshot removals.

## Restic and object-storage secrets

Host layout:

```text
/etc/restic/qeoindex/
├── repository-password
└── r2.env
```

Requirements:

- root ownership;
- files mode `0600`;
- directory inaccessible to non-root users;
- Restic password is random and unique, not reused from an application/provider password;
- R2 access credential is dedicated to this repository/bucket;
- neither value is committed, printed in CI, copied into Linear/GitHub comments, or returned in agent reports;
- the Restic repository password has an off-host recovery copy in the operator's password/secret manager;
- recovery must not depend on the failed VPS to obtain the repository password.

The normal R2 writer credential is not required to be preserved as recovery material: a replacement host can be issued a new temporary read-capable restore credential.

## Failure observability

Use an external dead-man heartbeat for the daily backup and weekly repository maintenance. Healthchecks-style semantics are preferred:

- send start immediately before the operation;
- send success only after the complete operation and verification step succeeds;
- send failure on a handled error;
- allow the external service to alert on a missing success heartbeat when the VPS or network disappears entirely.

Heartbeat URLs/tokens are credentials. They must be stored only in a root-readable host secret file and never be logged verbatim.

Beszel may measure resource usage but is not the authority for backup success because it shares the host failure domain.

## Restore contract

Restores always land in a temporary staging target first. Never run `restic restore` directly into `/`, `/opt`, or `/etc` on a replacement host.

Recovery order:

1. create and harden a clean replacement VPS;
2. install Docker, Git, Restic and rsync without enabling QeoIndex/Hermes timers;
3. clone a fresh QeoIndex checkout from GitHub;
4. obtain the Restic password from the off-host secret manager;
5. issue a temporary R2 restore credential;
6. inspect snapshots and run a repository integrity check;
7. restore the selected snapshot into `/var/tmp/qeo-restore/<snapshot-id>`;
8. verify expected files, ownership/modes and representative hashes before copying anything live;
9. restore approved Hermes deploy/state, QeoIndex host-only deploy state, wrappers and systemd units;
10. re-provision `/opt/qeoindex/env/*` from the independent secret source;
11. validate sudoers/systemd/SSH/UFW material before applying or activating it;
12. keep market, EOD, Hermes and backup timers disabled until manual smoke tests pass;
13. start services deliberately and validate each runtime boundary;
14. enable timers only after operational acceptance;
15. revoke the temporary R2 restore credential;
16. run and verify a fresh backup from the replacement host.

If the original VPS may have been compromised, restored Hermes state remains quarantined until all embedded Telegram/provider/OAuth/API credentials that could have been exposed are rotated or explicitly verified safe. Do not start Hermes first and rotate later.

## Restore automation boundary

Implementation may provide root-owned helpers such as:

```text
qeo-restore-host
qeo-restore-activate
```

`qeo-restore-host` may automate deterministic filesystem work:

- verify the staged restore tree layout;
- create required directories;
- restore Hermes deploy/state;
- install approved units and root-owned wrappers;
- apply documented ownership and modes;
- run `systemctl daemon-reload`;
- print a PASS/WAIT checklist.

It must stop before service/timer activation when runtime secrets are absent or when security-sensitive host configuration has not been reviewed.

`qeo-restore-activate` may be added only if it fails closed on missing secrets/config validation and performs explicit preflight checks before starting services.

## Initial restore drill

QEO-202 is not complete until the first real repository is used to restore a representative snapshot into a temporary directory and the following pass:

- Hermes state representative files are restorable;
- Hermes deploy/compose files match the source hashes;
- QeoIndex operational deploy files match expected hashes;
- representative systemd units are restored and parseable;
- root wrapper ownership, executable mode and content are correct;
- Restic repository integrity check passes;
- any restored Hermes SQLite database passes its integrity check when applicable;
- backup source size, uploaded/snapshot size and runtime are recorded;
- an external success heartbeat is observed;
- a controlled failure path produces an external alert without leaking credentials.

## Non-goals

- full-machine image backup;
- bare-metal restore of Ubuntu;
- backup of canonical Supabase data;
- backup of Docker images/layers;
- using Restic as the primary secret manager;
- automatic restoration of unreviewed `/etc` state;
- automatic activation of market/EOD workloads before smoke validation.
