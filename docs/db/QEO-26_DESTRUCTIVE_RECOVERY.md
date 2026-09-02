# QEO-26 — Destructive DB recovery rehearsal

This runbook defines the mandatory non-production recovery gate before destructive database refactors such as QEO-18, QEO-19, and QEO-20.

## Safety boundary

The rehearsal is local-only. `scripts/db/rehearse-destructive-recovery.sh` rejects the production project ref `glwhhrmejlonhyorvtzm` and rejects database targets that do not use local Supabase port `54322` on `127.0.0.1` or `localhost`.

Do not weaken or bypass these guards. Production is never a rollback-test environment.

## Representative destructive classes

The reusable rehearsal covers two destructive classes without depending on a real legacy object that may later be removed:

1. synthetic compatibility column: `public.portfolio_transactions.qeo_recovery_legacy_target`;
2. independent synthetic table-drop fixture: `public.qeo_recovery_table_fixture`.

The synthetic compatibility column and table fixture are created only after local migration replay. They use deterministic local-only IDs/ticker `QEO`, the table fixture has RLS and explicit service-role ACLs, and both are included in the validated custom-format backup. No production rows are copied into the rehearsal database.

QEO-19 moved the table-drop rehearsal away from `public.wyckoff_universe_memberships`. QEO-20 similarly moved the compatibility-column rehearsal away from `public.portfolio_transactions.target_price`, so the recovery gate remains runnable after the real legacy objects are removed from the application schema.

## What the gate proves

For each rehearsal pass the harness performs, in order:

1. clean local migration replay;
2. deterministic synthetic seed;
3. baseline capture for representative data and schema metadata;
4. targeted PostgreSQL custom-format backup of the two representative tables;
5. backup catalog validation plus SHA-256 capture;
6. destructive column/table removal;
7. explicit assertion that the destructive state actually occurred;
8. restore from the validated backup;
9. exact app-role ACL replay plus explicit restored data/RLS assertions;
10. deterministic baseline-vs-restored parity diff.

The captured baseline covers table data plus columns, indexes, RLS state, policies, table privileges, and functions that reference the representative objects. The targeted custom dump restores table schema/data and table-owned indexes, policies and ACLs while avoiding destructive reset of unrelated Supabase-managed schemas.

## Local command

Requirements:

- Docker-compatible runtime;
- Supabase CLI;
- repository checkout containing `supabase/config.toml`;
- local port `54322` available.

Run:

```bash
pnpm test:db-recovery
pnpm db:recovery:rehearse
```

Optional isolated artifact directory:

```bash
QEO_RECOVERY_ARTIFACT_DIR=.tmp/qeo-db-recovery/manual \
  pnpm db:recovery:rehearse
```

Artifacts include:

- `versions.txt`;
- `baseline.txt`;
- `acl-restore.sql`;
- `acl-restore.sql.sha256`;
- `pre-destructive.dump`;
- `pre-destructive.dump.sha256`;
- `backup.list`;
- `restored.txt`.

A successful run ends with `recovery rehearsal: PASS`. Any failed backup validation, destructive assertion, restore assertion, ACL replay, or parity diff exits non-zero.

## CI acceptance

`.github/workflows/db-recovery-rehearsal.yml` runs:

1. the static safety/contract regression tests;
2. an actual local Supabase rehearsal pass;
3. a second independent rehearsal pass after another clean reset;
4. evidence artifact upload;
5. local Supabase cleanup.

QEO-26 can be considered complete only when both actual passes succeed on the same reviewed PR head. A static test pass alone is not recovery evidence.

## Reuse for future destructive migrations

Before adding a new destructive migration:

1. identify the exact legacy object being removed and its canonical replacement;
2. add deterministic synthetic fixture data that exercises the destructive class without creating a production-only dependency;
3. extend baseline capture with any additional schema/data contract that matters;
4. extend the destructive assertion so CI proves the object was really removed;
5. extend the restore assertion and baseline diff to prove exact recovery;
6. keep the production-ref/local-port hard guard unchanged;
7. obtain a green two-pass recovery workflow before production rollout.

If an object has already been removed from production, do not fabricate it as current production state. Use an isolated synthetic fixture such as `qeo_recovery_legacy_target` or `qeo_recovery_table_fixture` for the destructive class instead.
