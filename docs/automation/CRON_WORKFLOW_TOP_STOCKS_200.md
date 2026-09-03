# QeoIndex — Final Cron Workflow: Top Stocks 200

Last updated: 2026-09-03  
Canonical universe: `vn_top_stocks`  
Operational architecture: Supabase-first EOD v3

## 1. Purpose

This document is the production runbook for the canonical Top Stocks universe, market-data collection, Wyckoff EOD build, AI Council, post-analysis Notion archive, and safe retention controls.

The production contract is fail-closed. Supabase is the operational source of truth. Notion is downstream analytical/audit storage and must never gate or rewrite already-published operational evidence. Google Drive is no longer part of the active daily EOD workflow.

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

There are no independent production pg_cron jobs for Wyckoff ingest, AI Council deterministic, AI Council LLM, Notion ingestion, or Drive backup. Those first four are dependency phases inside the one EOD workflow; Drive backup is not active.

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

The single parent job is `qeoindex.eod_pipeline`. Its active telemetry phase order is:

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
11. `RETENTION_CLEANUP`
12. `COMPLETE`

The exact-session Daily repair gate runs between `HISTORY_REFRESH` and `WYCKOFF_BUILD`; its historical function name references no-trade repair, but the active implementation can also repair verified traded final-session bars.

### 5.1 EOD_READY

Fail-closed readiness requires:

- current canonical membership is non-empty and no larger than 200;
- current published KFSP rating date equals the requested EOD session;
- every canonical ticker has same-session rating evidence;
- every canonical ticker has a sufficiently fresh final market snapshot;
- canonical Wyckoff selection matches canonical universe membership exactly.

Run key format: `WYCKOFF-YYYY-MM-DD-EOD-v3`.

Readiness is retried up to four attempts at bounded five-minute intervals when the upstream EOD state is not ready.

### 5.2 MARKET_CLOSE_COLLECT

This phase calls the dedicated market-close collector using a dedicated secret obtained through the service-role/Vault boundary.

Transient failures are retried at +5 and +10 minutes, for a maximum of three attempts. Credential/auth failures are terminal and are not retried.

### 5.3 HISTORY_REFRESH + exact-session repair

Persistent OHLCV is refreshed in durable batches of at most 10 tickers. The active persistent contract is **Daily-only**.

Provider refresh accounting may include bounded recoverable provider failures for the current session, but the following exact-session Daily gate still fails closed unless current-session coverage can be verified/repaired from final market-close snapshots.

Raw Weekly OHLCV is not stored; `1W` is derived deterministically from Daily history.

### 5.4 WYCKOFF_BUILD

For every canonical ticker, the system builds exactly two active timeframes:

- `1D`
- `1W`

Expected snapshot count is dynamic:

`universe_count × 2`

For a full 200-stock universe this is 400 snapshots.

### 5.5 SUPABASE_VALIDATE

Validation occurs before operational publication. It verifies:

- snapshot count equals `universe_count × 2`;
- exact canonical ticker membership;
- supported exchanges;
- deterministic validation hash;
- valid history/probability/scenario contracts;
- no accidental dependence on legacy Notion staging.

### 5.6 SUPABASE_PUBLISH

Validated Wyckoff artifacts are published directly to Supabase. Notion is not read during this phase.

Publication writes/verifies active Wyckoff run/snapshot/chart-series state. The chart read model is based on raw Daily series; Weekly structure is derived from Daily.

### 5.7 AI_COUNCIL_DETERMINISTIC

The deterministic Council consumes the exact current canonical membership. Current published universe count is authoritative.

Freshness verifies exact canonical membership, same-session market evidence, final Daily/Wyckoff evidence, and same-session VNINDEX benchmark. Deterministic output remains the final authority.

### 5.8 AI_COUNCIL_LLM

LLM debate runs only after deterministic Council passes freshness. It is selective and cost-bounded; it is not required to call an LLM for all 200 stocks.

LLM output is advisory and cannot replace deterministic signal authority.

### 5.9 MARKET_SYNTHESIS

This phase dispatches the same-session market-level AI conclusion after stock-level Council evidence is available. It is downstream of operational publication.

### 5.10 NOTION_ARCHIVE

Notion is a post-analysis audit/archive layer, not an operational source of truth.

Current Top Stocks databases:

- `Top Stocks 200 — Universe History`
- `Top Stocks 200 — EOD Archive 2026`
- `Top Stocks 200 — EOD Runs`

The archive records universe-run provenance, ticker/rank, Wyckoff evidence, Council state, validation hashes, and run-level status. Legacy v1/v2 databases remain historical evidence.

### 5.11 RETENTION_CLEANUP

Safe retention cleanup is independent of Google Drive. It removes only explicitly approved telemetry/staging/build artifacts.

**Raw `market_ohlcv_history` Daily bars are not age-pruned.** This is intentional because:

- `1D` is the canonical raw Wyckoff source;
- `1W` is derived from `1D`;
- the data volume for the current 200-ticker Daily-only universe is small relative to the complexity and failure surface of daily external cold archive;
- no external cold-history hydration/restore path has been production-proven.

The existing archive coverage ledger and preflight helpers remain historical/future Plan C foundations, but they do not authorize current raw-history deletion.

## 6. Google Drive policy

Google Drive is **not part of daily EOD**. The old service-account uploader and its historical checkpoint schema may remain as legacy/recovery code until separately cleaned, but active EOD must not call it, display it as an active phase, or let its status influence parent success.

Do not add Google OAuth/Picker merely to restore the old daily backup behavior.

If future requirements justify external disaster backup, design it as a separate cold-export job, preferably coarse-grained (for example weekly incremental Daily export with manifest/checksum), with independent failure semantics and a verified restore procedure before changing raw Supabase retention.

## 7. Failure semantics

Operational failures before `SUPABASE_PUBLISH` stop the run and preserve the previous published operational read model.

Downstream synthesis/Notion failures are recorded independently according to their current phase contract. They do not authorize deletion of raw Daily history.

Important distinction:

- Operational truth: Supabase.
- Analytical interpretation: Wyckoff/AI Council derived from verified evidence.
- Analytical/audit archive: Notion.
- Raw history retention authority: current fail-closed Supabase policy; external archive is not an active prerequisite.

## 8. Admin observability

`/admin/jobs` shows the parent `qeoindex.eod_pipeline` plus the active ordered phase timeline. `DRIVE_ARCHIVE` must not appear as an active phase.

Each phase records status, timestamps, duration, sanitized summary/error, and model/token usage where applicable.

## 9. Manual recovery runbook

### Universe refresh

Use the same authenticated monthly-universe execution path as the scheduler. Never insert memberships manually unless performing a documented emergency recovery.

### EOD recovery/backfill

Use the authenticated `/api/qeoindex/eod` workflow entrypoint with an explicit historical session timestamp when recovering a completed prior trading day.

After a manual EOD run verify:

- parent `system_job_runs` status;
- exact-session Daily raw coverage;
- `universe_count × 2` Wyckoff snapshot coverage;
- deterministic Council coverage;
- real Market Synthesis and Notion statuses;
- `RETENTION_CLEANUP` completes without deleting raw Daily OHLCV;
- no `DRIVE_ARCHIVE` phase is created by the new run;
- `COMPLETE` closes the parent run.

## 10. Historical-data policy

Do not rewrite or delete historical thesis, Analysis Log, AI Council, Wyckoff, market, telemetry, audit, or source evidence merely because it belongs to the old Top100 or old Drive-archive era.

Historical `DRIVE_ARCHIVE` telemetry/checkpoints remain audit evidence. Removing Drive from the active workflow does not require deleting historical rows or old backup files.

## 11. Release verification checklist

A production cutover is complete only when all are true:

- GitHub EOD v3/core regression tests pass;
- lint passes, including the active retention step;
- TypeScript passes;
- production build passes;
- feature PR merged once to `main`;
- Vercel Git deployment reaches READY;
- Admin EOD timeline contains 12 active telemetry phases and no `DRIVE_ARCHIVE`;
- a fresh production EOD smoke proves `NOTION_ARCHIVE → RETENTION_CLEANUP → COMPLETE` without Drive;
- raw Daily OHLCV remains retained in Supabase.
