# QEO-202 UpCloud Restic host package

This package implements the approved encrypted operational-state backup contract. It is source-only until the production rollout and restore drill in QEO-202 Tasks 7-8.

- `qeo-restic-backup` discovers exactly one `hermes-gateway-*.service` user-systemd unit, quiesces it only while `/opt/hermes/data` is staged, restarts Hermes before network upload, and writes to the configured encrypted Restic repository.
- `qeo-restic-maintenance dry-run|apply` checks repository integrity before retention/prune.
- `qeo-restore-host --from <quarantine-root> --mode normal|compromise` promotes only approved paths and never starts services.
- `install.sh` installs root-owned artifacts but leaves both timers disabled.

Runtime credentials live only under `/etc/restic/qeoindex/` and are never committed. See `docs/operations/upcloud-restic-restore.md` for replacement-VPS recovery.
