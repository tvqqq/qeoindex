# QEO-26 — Destructive DB backup/restore rehearsal

Rehearsal date: 2026-09-02 ICT  
Production project explicitly forbidden: `glwhhrmejlonhyorvtzm`

## Selected non-production mechanism

QEO-26 uses a disposable PostgreSQL 17 database service in the dedicated GitHub Actions `DB Safety` workflow.

This environment is:

- ephemeral and destroyed after the job;
- PostgreSQL 17, matching the production major version;
- isolated from production data and credentials;
- capable of real `pg_dump` + destructive DDL + restore execution;
- free of Supabase development-branch cost/authorization requirements.

The reusable script is `scripts/db-recovery-rehearsal.sh`. It refuses the production project ref/host and requires an explicit `TARGET_ENV` of `local`, `development`, `staging`, or `rehearsal`.

## Representative destructive classes

The fixture covers both required destructive patterns:

1. **Legacy column removal** — `insights_stock_ratings_rehearsal.score_4m` is dropped with `CASCADE`; the dependent parity view is proven removed.
2. **Legacy table removal** — `wyckoff_universe_memberships_rehearsal` is dropped and proven absent.

The fixture contains representative rows and canonical score parity before destructive DDL.

## Backup before destructive DDL

Before either DROP executes, the script creates:

- `schema.sql` via PostgreSQL 17 `pg_dump --schema-only`;
- `data.sql` via PostgreSQL 17 `pg_dump --data-only`;
- `backup.sha256` covering both dumps;
- `before-meta.txt` containing data and schema/security assertions.

Metadata captured before and after restore includes:

- rating row count;
- legacy-membership row count;
- legacy↔canonical score mismatch count;
- RLS enabled state;
- policy count;
- PUBLIC SELECT grant evidence;
- dependent view count;
- function count.

## Restore procedure

For the isolated rehearsal schema:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "DROP SCHEMA IF EXISTS qeo_recovery_rehearsal CASCADE;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f data.sql
sha256sum -c backup.sha256
```

The reusable script then compares `before-meta.txt` and `after-meta.txt` byte-for-byte and also asserts each expected count explicitly.

For QEO-18/QEO-19/QEO-20, reuse this sequence but replace the fixture schema/data and destructive statement with that issue's exact migration plus its own business-level parity assertions. Do not treat this generic rehearsal as consumer/parity proof for a future exact DROP.

## Verified execution evidence

GitHub Actions:

- Workflow: `DB Safety`
- Run: **#11** / ID `33583283940`
- Job: `db-safety` / ID `100101964094`
- Head: `de72158abbcb8b12679ff3ae88096cddde6ca344`
- Result: **success**

Observed execution evidence:

- DB safety contract tests: **11/11 pass**;
- migration-ledger reconciliation: **PASS**;
- representative legacy column DROP: **PASS**;
- representative legacy table DROP: **PASS**;
- schema restore: **PASS**;
- data restore: two rows restored into each fixture table;
- score parity mismatch after restore: **0**;
- schema/security metadata before vs after restore: exact parity;
- `schema.sql` SHA check: **OK**;
- `data.sql` SHA check: **OK**;
- final script result: `QEO-26 recovery rehearsal PASS`.

Uploaded artifact:

- Name: `qeo-26-recovery-rehearsal`
- Artifact ID: `9829145807`
- Artifact ZIP SHA-256: `1033fbdb7a8afd54d45bdcdbf486f540bb809490e69c83ac21445ffc8af88060`
- Retention: 14 days

## Safety result

No production destructive rehearsal was performed. Production was not used as a restore target and no production data was copied into the fixture.
