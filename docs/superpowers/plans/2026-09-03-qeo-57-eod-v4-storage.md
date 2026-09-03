# QEO-57 — EOD v4 storage lane implementation plan

## Goal

Remove Google Drive from the active daily `qeoindex.eod_pipeline` dependency graph while keeping raw Daily OHLCV retained in Supabase and preserving legacy Drive uploader/checkpoint code as historical recovery evidence.

## Invariants

- Active flow after Notion is `NOTION_ARCHIVE -> RETENTION_CLEANUP -> COMPLETE`.
- `DRIVE_ARCHIVE` is absent from active workflow and Admin business-phase catalogs.
- Retention cleanup does not require a Drive checkpoint.
- `market_ohlcv_history` Daily bars are never age-pruned by this change.
- Weekly remains derived from Daily.
- Legacy Drive archive implementation/checkpoints remain available but are not invoked by daily EOD.

## TDD sequence

1. RED: update EOD contract regression so active workflow/catalog/retention must be Drive-free.
2. GREEN: remove Drive invocation/status from the active workflow and make retention independent from Drive.
3. REFACTOR: align Admin phase/timeline/catalog/telemetry docs and tests.
4. VERIFY: EOD regression, core regression, lint/typecheck/build and GitHub CI.

## Out of scope

- Google OAuth/Picker.
- Shared Drive migration.
- External cold-backup scheduler.
- Destructive raw-history retention.
- Removing historical Drive telemetry or legacy uploader code.
