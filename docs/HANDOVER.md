# QeoIndex engineering handover

Last updated: 2026-09-01.

This document is the canonical fast-start for the active production architecture. The pre-2026-09-01 handover is preserved verbatim at [`docs/HANDOVER-LEGACY.md`](./HANDOVER-LEGACY.md) for historical context; when the two documents conflict, this file wins.

## Production

- Product: QeoIndex.
- Production domain: `https://qeoindex.qeoqeo.com`.
- Vercel project: `tvqqq/stockos`.
- Supabase project: `qeoindex` (`glwhhrmejlonhyorvtzm`, Singapore).
- Canonical stock universe: latest published `vn_top_stocks`, maximum 200 tickers.
- Canonical EOD scheduler: Supabase `pg_cron` job `qeoindex-eod-pipeline-1515-ict` (`15 8 * * 1-5`, 15:15 ICT).

Read `AGENTS.md` before edits. Do not treat scheduler dispatch as execution success; use `system_job_runs` and `system_job_phases` for EOD execution evidence.

## Active Wyckoff contract — 1D + 1W only

Wyckoff operational analysis supports exactly two completed-bar timeframes:

- `1D`: canonical raw timeframe.
- `1W`: deterministic weekly aggregation derived from raw Daily bars.

`1H`, `4H`, and `1M` are not active Wyckoff timeframes. They must not be written to active Wyckoff snapshots, chart-series read models, UI tabs, watchlist columns, or EOD expected-count calculations.

For `N` canonical stocks:

```text
expected Wyckoff snapshots = N × 2
```

At the current maximum universe of 200 tickers this is 400 snapshots per healthy EOD run.

### Raw OHLCV storage

Persistent Wyckoff raw OHLCV stores `1D` only in `market_ohlcv_history`. Weekly bars are derived; raw OHLCV `1H` is no longer required by Wyckoff and the storage-cutover migration removes obsolete intraday rows.

The active history refresh therefore fetches/persists Daily only. Other non-Wyckoff features may still fetch intraday data directly through their own bounded provider paths, but they must not repopulate `market_ohlcv_history` with `1H`.

### Newly listed / limited-history tickers

`market_ohlcv_bootstrap_state` records that a full provider bootstrap has completed. A ticker with genuine listing history shorter than 60 months must transition to bounded Daily delta refresh after a successful full bootstrap instead of repeating an eight-year request every EOD.

## P0 DNSE history reliability

Daily bootstrap keeps the 366-day fast request window for normal tickers. A transient failure on one large window is retried adaptively by recursively splitting only that failed window down toward approximately 183/91/45-day ranges.

Adaptive splitting is limited to transient failures such as timeout/abort/network errors, HTTP 408/425/429 and 5xx. Auth/permission errors and explicit non-transient 4xx such as 404 are not recursively retried. Empty pre-listing subwindows are allowed; successful bars are merged and de-duplicated deterministically before fallback is considered.

This behavior specifically addresses the VGI `HISTORY_REFRESH` failure observed on the old 366-day DNSE request while avoiding a global increase in request count for healthy tickers.

## EOD v3 phase contract

Canonical phase order remains:

1. `EOD_READY`
2. `MARKET_CLOSE_COLLECT`
3. `HISTORY_REFRESH`
4. `NO_TRADE_REPAIR`
5. `WYCKOFF_BUILD`
6. `SUPABASE_VALIDATE`
7. `SUPABASE_PUBLISH`
8. `AI_COUNCIL_DETERMINISTIC`
9. `AI_COUNCIL_LLM`
10. `MARKET_SYNTHESIS`
11. `NOTION_ARCHIVE`
12. `DRIVE_ARCHIVE`
13. `RETENTION_CLEANUP`
14. `COMPLETE`

Key invariants:

- EOD readiness and market-close retry behavior remain fail-closed.
- `HISTORY_REFRESH` uses max-10 ticker batches and persists Daily only.
- `WYCKOFF_BUILD` / validation / publish require exact canonical membership and exactly `universeCount × 2` snapshots.
- AI Council starts only from the healthy Supabase-published Wyckoff run for the same session.
- Notion/Drive archival is downstream of the market-analysis critical path.

## Storage lifecycle / Plan B and Plan C foundation

Supabase is the operational hot store; Google Drive is the intended cold raw archive; Notion is the compact analytical/audit store.

The 2026-09-01 storage cutover introduces `market_ohlcv_archive_ranges`, a range-level cold-archive coverage ledger with date range, row count, SHA-256 and manifest URL. This is the foundation for a future partitioned/cold-history Plan C cutover.

**Important:** raw Daily retention is intentionally fail-closed. Do not age-prune Daily bars merely by date while `1W` is derived from Daily and the active model requires at least 60 completed Weekly bars. Daily pruning can be enabled only after cold-history coverage/hydration is verified end-to-end.

Obsolete intraday rows are a one-time schema-cutover cleanup, not a recurring Daily retention rule.

## Database migration

Active cutover migration:

`supabase/migrations/20260901190000_wyckoff_daily_weekly_storage_cutover.sql`

It:

- removes obsolete `market_ohlcv_history` rows where timeframe is not `1D`;
- tightens raw history to `timeframe = '1D'`;
- removes active Wyckoff snapshots outside `1D/1W`;
- keeps chart-series raw storage at `1D` only;
- creates `market_ohlcv_bootstrap_state`;
- changes `qeo_market_ohlcv_recent` to Daily only;
- creates the Plan C archive-range ledger.

Deploy application code before applying this destructive migration. Then verify production and execute a full manual EOD smoke before treating the cutover as operationally accepted.

## Manual EOD acceptance

A current-session manual smoke is accepted only when evidence shows:

- `EOD_READY`: canonical universe complete for the session;
- `MARKET_CLOSE_COLLECT`: healthy/current-session evidence;
- `HISTORY_REFRESH`: all requested tickers complete, including VGI;
- Wyckoff expected count = `universeCount × 2`;
- `SUPABASE_PUBLISH`: same validation hash and exact canonical ticker set;
- deterministic AI Council completes for the canonical universe;
- archive phases report their real state and do not fake success;
- `COMPLETE` closes the parent run without hidden skipped critical phases.

For fast troubleshooting, inspect `system_job_runs`, `system_job_phases`, latest `wyckoff_scan_runs`, `market_ohlcv_history`, and `eod_archive_checkpoints` before interpreting UI state.
