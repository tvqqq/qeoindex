# QeoIndex — Final Cron Workflow: Top Stocks 200

Last updated: 2026-09-01  
Canonical universe: `vn_top_stocks`  
Operational architecture: Supabase-first EOD v3

## 1. Purpose

This document is the production runbook for the canonical Top Stocks universe, market-data collection, Wyckoff EOD build, AI Council, post-analysis archive, and retention controls.

The production contract is intentionally fail-closed. Supabase is the operational source of truth. Notion and Google Drive are downstream archive/audit systems and must never gate or rewrite already-published operational evidence.

## 2. Canonical Top Stocks universe

A stock is eligible only when all selector gates pass:

- `average_volume_50_sessions > 250000`
- `market_cap_billion > 10`
- at least 4 of the latest 5 weekday observations have verified trading volume `> 0`
- supported exchange: HOSE, HNX, or UPCOM

Selection order:

1. `market_cap_billion DESC`
2. `average_volume_50_sessions DESC`
3. `ticker ASC`
4. maximum 200 stocks

The list is published monthly and remains fixed between successful monthly refreshes. A failed monthly run preserves the previous successfully published universe.

Canonical identity:

- Universe key: `vn_top_stocks`
- Maximum size: `200`
- Runtime cache namespace: `market-universe:v1`
- Logo bucket: `stock-logo`
- Logo object contract: `stock-logo/{TICKER}.png`

All runtime consumers use the same membership: market board, orderbook, bubbles, Qeo Composite, rating/detail views, scanner/Wyckoff, AI Council, and EOD workflows.

## 3. Production scheduler inventory

Supabase `pg_cron` is the scheduler owner for market/universe/EOD jobs.

| Job | UTC schedule | Effective ICT dispatch window | Purpose |
| --- | --- | --- | --- |
| `kfsp-rating-daily-7am-ict` | `0 0 * * *` | 07:00 daily | Publish current KFSP/TTAI rating snapshot used as selector/detail evidence. |
| `kfsp-ttai-history-daily-0710-ict` | `10 0 * * *` | 07:10 daily | Refresh TTAI historical evidence. |
| `market-universe-monthly-0710-ict` | `10 0 1 * *` | 07:10 on day 1 monthly | Recompute and atomically publish `vn_top_stocks`. |
| `sync-universe-5m` | `*/5 2-4 * * 1-5` | **09:00–11:30 Mon–Fri** | Morning canonical-universe market/orderbook synchronization. SQL time guard prevents provider calls after the morning close. |
| `sync-universe-5m-afternoon` | `*/5 6-7 * * 1-5` | **13:00–14:40 Mon–Fri** | Afternoon canonical-universe synchronization. SQL time guard prevents calls before 13:00 or after 14:40. |
| `sync-universe-eod-1445` | `45 7 * * 1-5` | 14:45 Mon–Fri | Final orderbook/EOD snapshot collection before analytical EOD workflow. |
| `qeoindex-eod-pipeline-1515-ict` | `15 8 * * 1-5` | 15:15 Mon–Fri | Start the single durable EOD v3 dependency workflow. |

The two five-minute jobs call the same `orderbook-sync` Edge Function. They are separate physical schedules only because the Vietnamese trading day has a lunch break. No provider HTTP request is dispatched between 11:30 and 13:00.

There are no independent production pg_cron jobs for Wyckoff ingest, AI Council deterministic, AI Council LLM, or Notion ingestion. Those are dependency phases inside the one EOD workflow.

Legacy Vercel EOD cron paths are not scheduled:

- `/api/ai-council/eod`
- `/api/wyckoff/ingest`
- `/api/ai-council/daily`
- `/api/ai-council/debate-daily`

## 4. Monthly universe workflow

`market-universe-monthly-0710-ict` executes the following contract:

1. Load the latest successfully published KFSP snapshot.
2. Apply market-cap and AvgVol50 strict filters.
3. Apply the 4-of-5 positive-volume activity gate.
4. Deterministically sort candidates.
5. Select at most 200.
6. Resolve complete stock detail metadata.
7. Guarantee a logo object for every selected ticker in Supabase Storage.
8. Write the candidate run and memberships.
9. Verify count, rank uniqueness, detail completeness, and logo coverage.
10. Atomically mark the new run `published`.
11. Invalidate canonical-universe cache only after successful publication.

A failed run never replaces the current published snapshot.

## 5. EOD v3 dependency workflow

The single parent job is `qeoindex.eod_pipeline`. Its operational phase order is:

1. `EOD_READY`
2. `MARKET_CLOSE_COLLECT`
3. `HISTORY_REFRESH`
4. `WYCKOFF_BUILD`
5. `SUPABASE_VALIDATE`
6. `SUPABASE_PUBLISH`
7. `AI_COUNCIL_DETERMINISTIC`
8. `AI_COUNCIL_LLM`
9. `MARKET_SYNTHESIS`
10. `NOTION_ARCHIVE`
11. `DRIVE_ARCHIVE`
12. `RETENTION_CLEANUP`
13. `COMPLETE`

The verified no-trade Daily repair is a helper inside the history/build path rather than an independent scheduler phase.

### 5.1 EOD_READY

Fail-closed readiness requires:

- current canonical membership is non-empty and no larger than 200;
- current published KFSP rating date equals the requested EOD session;
- every canonical ticker has same-session rating evidence;
- every canonical ticker has a sufficiently fresh final market snapshot;
- canonical Wyckoff selection matches canonical universe membership exactly.

Run key format:

`WYCKOFF-YYYY-MM-DD-EOD-v3`

Readiness is retried up to four attempts at bounded five-minute intervals when the upstream EOD state is not ready.

### 5.2 MARKET_CLOSE_COLLECT

This phase calls the dedicated market-close collector using a dedicated secret obtained through the service-role/Vault boundary.

Transient failures are retried at +5 and +10 minutes, for a maximum of three attempts. Retryable classes include network/socket timeout, HTTP 408/429/5xx, provider readiness, and temporary validation/coverage failures.

Credential/auth failures are terminal and are not retried.

### 5.3 HISTORY_REFRESH

Persistent OHLCV is refreshed in durable batches of at most 10 tickers.

The phase requires the completed ticker count to equal the canonical universe count. Provider/runtime errors stop the operational pipeline rather than being mislabeled as incomplete analysis.

### 5.4 WYCKOFF_BUILD

For every canonical ticker, the system builds five timeframes:

- `1H`
- `4H`
- `1D`
- `1W`
- `1M`

Expected snapshot count is dynamic:

`universe_count × 5`

For a full 200-stock universe this is 1,000 snapshots.

### 5.5 SUPABASE_VALIDATE

Validation occurs before any operational publication. It verifies:

- snapshot count equals `universe_count × 5`;
- exact canonical ticker membership;
- supported exchanges;
- deterministic validation hash;
- valid history/probability/scenario contracts;
- no accidental dependence on legacy Notion staging.

### 5.6 SUPABASE_PUBLISH

Validated in-memory Wyckoff snapshots are published directly to Supabase by the direct publisher. Notion is not read during this phase.

Publication writes/verifies:

- `wyckoff_scan_runs`
- `wyckoff_universe_memberships`
- `wyckoff_analysis_snapshots`
- `wyckoff_chart_series`

Chart-series coverage is exactly two operational read models per canonical ticker:

- `1H`
- `1D`

A full 200-stock universe therefore requires 400 fresh chart-series identities before the Wyckoff run can be marked `published`.

### 5.7 AI_COUNCIL_DETERMINISTIC

The deterministic Council consumes the exact current canonical membership. It does not hard-code 100 or 200 as the expected stock count; the current published universe count is authoritative.

Freshness gate verifies:

- exact canonical membership, including no missing and no unexpected ticker;
- same-session market evidence;
- same-session or verified no-trade carry-forward Wyckoff `1D` evidence;
- same-session VNINDEX benchmark.

Deterministic output remains the final authority.

### 5.8 AI_COUNCIL_LLM

LLM debate runs only after deterministic Council passes freshness. It is intentionally selective and cost-bounded; it is not required to call an LLM for all 200 stocks.

LLM output is advisory and cannot replace deterministic signal authority.

### 5.9 MARKET_SYNTHESIS

This phase dispatches the same-session market-level AI conclusion after stock-level Council evidence is available. It is downstream of operational publication.

### 5.10 NOTION_ARCHIVE

Notion is a post-analysis audit/archive layer, not an operational source of truth.

Current Top Stocks databases:

- `Top Stocks 200 — Universe History`
  - data source: `af1c5fac-8e28-42ac-8e08-c322cb2dcdf7`
- `Top Stocks 200 — EOD Archive 2026`
  - data source: `a00636bc-4fa6-4f9a-9c1c-11ff04b1314c`
- `Top Stocks 200 — EOD Runs`
  - data source: `ea4f1552-dff1-434b-a647-ac7cb0330932`

The archive records universe-run provenance, ticker/rank, Wyckoff evidence, Council state, validation hashes, and run-level status. Legacy v1/v2 databases are retained as historical evidence and labeled legacy/deprecated rather than rewritten.

### 5.11 DRIVE_ARCHIVE

Google Drive is intended for raw, immutable archive packages/manifest evidence.

The production implementation authenticates with a Google **service account** and targets a folder inside a Google Workspace **Shared Drive**. Runtime requests explicitly support Shared Drives (`supportsAllDrives=true`, and list operations include `includeItemsFromAllDrives=true`).

Required Vercel Production environment variables:

- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` — complete service-account JSON key; server-only secret.
- `GOOGLE_DRIVE_ARCHIVE_FOLDER_ID` — root archive folder ID inside the Shared Drive.
- `GOOGLE_DRIVE_RETENTION_BACKFILL_COMPLETE` — keep `false` until the historical archive backfill and retention preflight have both been explicitly verified.

Recommended Drive setup:

1. Enable Google Drive API in the Google Cloud project.
2. Create a service account and JSON key.
3. Create or select a Google Workspace Shared Drive.
4. Create an archive root folder, e.g. `QeoIndex Raw Archive`.
5. Add the service-account `client_email` as a Shared Drive member with permission to create/manage archive files.
6. Set the two archive credentials in Vercel Production and redeploy once.
7. Run an EOD archive smoke test and verify the manifest URL, SHA-256, file count and `eod_archive_checkpoints.drive_status='archived'`.
8. Backfill every historical date that is eligible for retention.
9. Only after `qeo_archive_retention_preflight(...)` returns safe may `GOOGLE_DRIVE_RETENTION_BACKFILL_COMPLETE=true` be enabled.

Archive layout is generated automatically:

- `{YEAR}/{MONTH}/1D/{TICKER}-{DATE}.csv.gz`
- `{YEAR}/{MONTH}/1H/{TICKER}-{DATE}.csv.gz`
- `{YEAR}/{MONTH}/manifest-{DATE}.json`

The runtime is fail-closed when Drive credentials are not configured:

- Drive archive status becomes `blocked`;
- no raw Supabase history is deleted;
- `RETENTION_CLEANUP` remains blocked.

A successful Drive archive must provide a manifest URL, SHA-256 integrity value, and positive row/file counts before retention can be considered safe.

### 5.12 RETENTION_CLEANUP

Retention is controlled by the private `eod_archive_checkpoints` ledger and the service-role-only function `qeo_archive_retention_preflight(date)`.

Current age thresholds:

- `1H` raw OHLCV: eligible only when older than 90 days;
- `1D` raw OHLCV: eligible only when older than 480 days.

Deletion is permitted only when every eligible historical session has verified Notion and Drive archive coverage. Any missing checkpoint, manifest, SHA-256, or row coverage returns `safe=false` and blocks deletion.

There are no blanket truncates in the retention path.

## 6. Failure semantics

Operational failures before `SUPABASE_PUBLISH` stop the run and preserve the previous published operational read model.

Archive failures after successful operational publication are recorded independently. A blocked Notion/Drive archive does not roll back a verified Supabase publication, but it prevents retention.

Important distinction:

- Operational truth: Supabase.
- Analytical interpretation: Wyckoff/AI Council derived from verified evidence.
- Archive/audit: Notion and Drive.
- Retention authority: verified archive checkpoint only.

## 7. Admin observability

`/admin/jobs` shows the parent `qeoindex.eod_pipeline` plus the ordered phase timeline. Each phase records:

- status;
- start/end timestamp;
- duration;
- sanitized summary;
- error code/message when failed;
- model/token usage where applicable.

`/admin/universe` shows:

- selected count / 200;
- universe run ID;
- KFSP source date;
- current selector settings;
- next-run selector settings;
- last and next scheduled refresh;
- detail completeness;
- logo coverage;
- rank/ticker/company/exchange/sector/market-cap/AvgVol50 rows.

## 8. Manual recovery runbook

### Universe refresh

Use the same authenticated monthly-universe execution path as the scheduler. Never insert memberships manually unless performing a documented emergency recovery.

After a manual universe refresh verify:

1. run status is `published`;
2. selected count is <= 200;
3. exact strict filters pass;
4. activity positive days >= 4;
5. detail count equals selected count;
6. logo count equals selected count;
7. rank is deterministic;
8. runtime consumers resolve the same `run_id`.

### EOD recovery/backfill

Use the authenticated `/api/qeoindex/eod` workflow entrypoint with an explicit historical session timestamp when recovering a completed prior trading day.

Do not run a same-day historical-looking EOD before final market evidence exists.

After a manual EOD run verify:

- parent `system_job_runs` status;
- all operational phases through `AI_COUNCIL_LLM`/`MARKET_SYNTHESIS`;
- published Wyckoff run count;
- `universe_count × 5` snapshot coverage;
- `universe_count × 2` chart-series coverage;
- deterministic Council coverage;
- archive checkpoint statuses;
- retention remains blocked unless Drive archive verification is complete.

## 9. Historical-data policy

Do not rewrite or delete historical thesis, Analysis Log, AI Council, Wyckoff, market, telemetry, audit, or source evidence merely because it belongs to the old Top100 era.

Legacy current-membership materializations may be removed only after zero active runtime references and dependency preflight. Historical evidence remains immutable/auditable.

## 10. Release verification checklist

A production cutover is complete only when all are true:

- Supabase migrations applied;
- required Edge Functions deployed;
- canonical monthly universe successfully published;
- 200/200 detail/logo coverage when 200 stocks qualify;
- GitHub regression tests pass;
- lint passes;
- TypeScript passes;
- production build passes;
- feature PR merged once to `main`;
- Vercel Git deployment reaches READY without a second manual production deploy;
- production pg_cron inventory matches this runbook;
- one completed historical/current EOD v3 smoke run proves Supabase-first phase order;
- any missing Drive credential is surfaced as `blocked`, never silently treated as archived;
- retention remains fail-closed until verified archive coverage exists.
