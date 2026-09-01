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

Persistent Wyckoff raw OHLCV stores `1D` only in `market_ohlcv_history`. Weekly bars are derived; raw OHLCV `1H` is no longer required by Wyckoff.

The 19:00 storage-contract migration rejects new non-Daily writes with a `NOT VALID` check but intentionally preserves historical legacy rows until an explicitly approved destructive cleanup. The one-shot 21:30 clean-rebuild migration removes that preserved legacy state and validates the Daily-only constraint.

The active history refresh therefore fetches/persists Daily only. Other non-Wyckoff features may still fetch intraday data directly through their own bounded provider paths, but they must not repopulate `market_ohlcv_history` with `1H`.

### Newly listed / limited-history tickers

`market_ohlcv_bootstrap_state` records that a full provider bootstrap has completed. A ticker with genuine listing history shorter than 60 months must transition to bounded Daily delta refresh after a successful full bootstrap instead of repeating an eight-year request every EOD.

## P0 DNSE history reliability

Daily bootstrap keeps the 366-day fast request window for normal tickers. A transient failure on one large window is retried adaptively by recursively splitting only that failed branch down to the current 7-day retry floor.

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
- `EOD_READY` requires fresh same-session `stock_orderbook_snapshots` for the exact canonical universe; a clean rebuild must bootstrap those snapshots before dispatching EOD.
- `HISTORY_REFRESH` uses max-10 ticker batches and persists Daily only.
- `WYCKOFF_BUILD` / validation / publish require exact canonical membership and exactly `universeCount × 2` snapshots.
- AI Council starts only from the healthy Supabase-published Wyckoff run for the same session.
- Notion/Drive archival is downstream of the market-analysis critical path.

## Storage lifecycle / Plan B and Plan C foundation

Supabase is the operational hot store; Google Drive is the intended cold raw archive; Notion is the compact analytical/audit store.

The 2026-09-01 storage cutover introduces `market_ohlcv_archive_ranges`, a range-level cold-archive coverage ledger with date range, row count, SHA-256 and manifest URL. This is the foundation for a future partitioned/cold-history Plan C cutover.

**Important:** raw Daily retention is intentionally fail-closed. Do not age-prune Daily bars merely by date while `1W` is derived from Daily and the active model requires at least 60 completed Weekly bars. Daily pruning can be enabled only after cold-history coverage/hydration is verified end-to-end.

The approved clean rebuild is a one-shot maintenance operation, not a recurring retention rule.

## Database migrations

### Storage-contract foundation

`supabase/migrations/20260901190000_wyckoff_daily_weekly_storage_cutover.sql`

It:

- changes the active raw write contract to `timeframe = '1D'` without deleting historical legacy rows;
- changes active Wyckoff snapshot/chart-series writes to `1D/1W` without deleting historical legacy rows;
- creates `market_ohlcv_bootstrap_state`;
- changes `qeo_market_ohlcv_recent` to Daily only;
- creates the Plan C archive-range ledger;
- intentionally leaves the new timeframe checks `NOT VALID` while preserved legacy rows still exist.

### Approved clean rebuild

`supabase/migrations/20260901213000_clean_rebuild_top_stocks_200.sql`

This is the explicit destructive cutover for rebuildable stock operational state. It:

- refuses to run while `market.universe_monthly` or `qeoindex.eod_pipeline` is active;
- purges old/current raw OHLCV and bootstrap state;
- purges canonical universe runs/memberships so the next universe is selected from source evidence again;
- purges active Wyckoff, current orderbook, AI Council run output, market synthesis conclusion and EOD archive checkpoint materializations;
- preserves KFSP ratings/provider history, TTAI quarterly history, auth/user/config data, job audit telemetry, calibration history and verified `market_ohlcv_archive_ranges` cold-archive evidence;
- validates the raw `1D` and Wyckoff `1D/1W` physical constraints after the purge.

### Clean-rebuild market snapshot bootstrap

`supabase/migrations/20260901214500_clean_rebuild_market_snapshot_trigger.sql`

It creates service-role-only `qeo_trigger_market_snapshot_bootstrap()`, which reuses the existing canonical `orderbook-sync` Edge Function already used by production pg_cron. The function exists specifically because the destructive clean rebuild removes `stock_orderbook_snapshots` while `EOD_READY` requires fresh final snapshots before the later `MARKET_CLOSE_COLLECT` phase can run.

Do not bypass or weaken `EOD_READY`. Bootstrap fresh market evidence first and verify it before EOD dispatch.

After applying the one-shot clean rebuild, execute in this order:

1. `qeo_trigger_market_universe_monthly()` and verify a new published `vn_top_stocks` run.
2. Verify exact canonical membership (target 200 under current eligibility/settings).
3. `qeo_trigger_market_snapshot_bootstrap()` and verify its pg_net response succeeds.
4. Verify `stock_orderbook_snapshots` contains the exact canonical ticker set for the current session and every row is fresh enough for `EOD_READY`.
5. `qeo_trigger_eod_pipeline()` for the current completed session.
6. Verify fresh Daily raw history for the exact canonical ticker set.
7. Verify Wyckoff exact membership and `universeCount × 2` snapshots.
8. Verify downstream phases report their real success/failure state.

## Manual EOD acceptance

A current-session manual smoke is accepted only when evidence shows:

- `EOD_READY`: canonical universe complete for the session;
- `MARKET_CLOSE_COLLECT`: healthy/current-session evidence;
- `HISTORY_REFRESH`: all requested tickers complete, including VGI;
- raw persistent OHLCV contains `1D` only and no noncanonical tickers after a clean rebuild;
- Wyckoff expected count = `universeCount × 2`;
- `SUPABASE_PUBLISH`: same validation hash and exact canonical ticker set;
- deterministic AI Council completes for the canonical universe;
- archive phases report their real state and do not fake success;
- `COMPLETE` closes the parent run without hidden skipped critical phases.

For fast troubleshooting, inspect `system_job_runs`, `system_job_phases`, latest `market_universe_runs`, `stock_orderbook_snapshots`, `wyckoff_scan_runs`, `market_ohlcv_history`, `market_ohlcv_bootstrap_state`, and `eod_archive_checkpoints` before interpreting UI state.
