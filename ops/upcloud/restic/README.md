# QEO-202 UpCloud Restic host package

This package implements the approved encrypted operational-state backup contract. It is source-only until the production rollout and restore drill in QEO-202 Tasks 7-8.

- `qeo-restic-backup` discovers exactly one `hermes-gateway-*.service` user-systemd unit, quiesces it only while `/opt/hermes/data` is staged, restarts Hermes before network upload, and writes to the configured encrypted Restic repository.
- `qeo-restic-maintenance init|dry-run|apply` checks repository integrity before retention/prune.
- `qeo-restic-restore-stage --snapshot <id> --target /var/tmp/qeo-restore/<id>` downloads one explicit snapshot into a fresh quarantine tree and never promotes or starts anything.
- `qeo-restore-host --from <quarantine-root> --mode normal|compromise` promotes only approved paths and never starts services.
- `install.sh` installs root-owned artifacts but leaves both timers disabled.

Runtime credentials live only under `/etc/restic/qeoindex/` and are never committed. See `docs/operations/upcloud-restic-restore.md` for replacement-VPS recovery.


## Replacement-host identity

Fresh replacement hosts may set `QEO_RESTIC_BACKUP_HOST` and `QEO_RESTIC_BACKUP_TAG` in the root-only runtime env. Both default to `qeo-upcloud-operational` for backward compatibility. Use a semantic identity such as `qeo-onidel-operational` after a provider migration.

Backup discovery supports exactly one Hermes gateway across system or per-user systemd. Zero or multiple discovered gateways are a hard failure; the helper never guesses which runtime to quiesce.
