# QeoIndex — Canonical Top Stocks 200 EOD Runbook

Last updated: 2026-09-04  
Canonical universe: `vn_top_stocks`  
Operational architecture: `supabase-first-eod-v4-dag`

## 1. Source of truth

- Supabase is the operational source of truth for canonical universe membership, raw Daily OHLCV, Wyckoff publication, AI Council evidence and durable job telemetry.
- Notion is a downstream analytical/audit summary only. It does not gate EOD publication or retention.
- Google Drive is not part of the active EOD runtime graph.
- Scheduler dispatch is not proof of execution success; use `system_job_runs` and `system_job_phases`.

## 2. Canonical universe

The current stock set is the latest successfully published `vn_top_stocks` run, with a maximum of 200 tickers.

Runtime consumers must use the exact same published membership. A failed universe refresh preserves the previous successfully published run.

## 3. Scheduler ownership

The canonical scheduled parent is Supabase `pg_cron` job:

- `qeoindex-eod-pipeline-1515-ict`
- schedule: `15 8 * * 1-5`
- effective dispatch: 15:15 ICT on trading weekdays

KFSP Rating and TTAI refresh are dependencies inside the EOD v4 workflow. Their standalone admin entries are manual recovery capabilities rather than independent daily scheduler ownership.

The active scheduler/admin catalog is authoritative for other market/universe maintenance jobs. Legacy Vercel EOD cron paths are not scheduler owners.

## 4. EOD v4 dependency DAG

### Current session

1. `KFSP_RATING_REFRESH`
   - refresh the current rating snapshot;
   - freeze exact canonical universe identity for the run.
2. Run two bounded sibling branches in parallel:
   - `TTAI_REFRESH` for the frozen universe;
   - `MARKET_CLOSE_COLLECT` for same-session final market evidence.
3. `EOD_READY`
   - validate the frozen `universeRunId` and exact ticker membership;
   - require same-session rating and final market evidence;
   - bounded retry for known not-ready conditions.
4. `HISTORY_REFRESH`
   - persist Daily-only OHLCV;
   - batch size 10 with bounded concurrency;
   - account for every requested ticker.
5. Verified no-trade Daily repair when required.
6. `WYCKOFF_BUILD`
   - exactly `1D + 1W`;
   - `1W` is derived from Daily;
   - current-session ticker failures are isolated by the v4 fault-isolation contract.
7. `SUPABASE_VALIDATE`
   - exact canonical membership;
   - exact snapshot count;
   - deterministic validation hash.
8. `SUPABASE_PUBLISH`
   - publish the canonical operational Wyckoff read model.
9. `AI_COUNCIL_DETERMINISTIC`.
10. `MARKET_SYNTHESIS`.
11. `AI_COUNCIL_LLM`
    - selective and cost-bounded;
    - deterministic Council remains the signal authority.
12. `RETENTION_CLEANUP`
    - Supabase-only safe cleanup of approved transient/terminal evidence;
    - never age-prunes canonical raw Daily history.
13. Notion analytical summary
    - one downstream run-level analytical/audit summary;
    - not operational state.
14. `COMPLETE`
    - closes the parent run with `architecture = supabase-first-eod-v4-dag`.

### Historical backfill

Historical recovery stays Supabase-only:

- it verifies the historical session against persistent ratings and `market_ohlcv_history`;
- it never substitutes today's provider market data for the historical session;
- market-close collection is explicitly skipped;
- the active run-key suffix is still `EOD-v4`.

Run key format:

`WYCKOFF-YYYY-MM-DD-EOD-v4`

## 5. Active Wyckoff/storage contract

For `N` canonical tickers:

- expected Wyckoff snapshots = `N × 2`;
- active timeframes = `1D`, `1W`;
- persistent raw OHLCV = `1D` only;
- `1H`, `4H`, and `1M` are not active Wyckoff persistence contracts.

At the current maximum universe of 200 tickers, a healthy EOD run expects 400 Wyckoff snapshots.

## 6. Retry and failure semantics

### MARKET_CLOSE_COLLECT

Retryable classes include transient network/socket errors, timeout/readiness conditions, HTTP 408/429 and provider 5xx responses.

The current branch uses bounded attempts with five-minute spacing. Credential/authentication failures are terminal and are not retried as provider-readiness failures.

### EOD_READY

READY uses bounded retry for known not-ready conditions. It must not be weakened to accept stale or incomplete membership/evidence.

### Ticker-local failures

Current-session history/build failures may be isolated per ticker. A run with unresolved ticker failures terminates as explicit partial coverage rather than reporting false full success.

### Publication

Failures before verified Supabase publication preserve the previous healthy published operational read model.

## 7. Retention contract

The active retention path is Supabase-only and calls approved cleanup RPCs for telemetry/staging/raw-evidence/build-artifact classes.

It must not delete `market_ohlcv_history` Daily bars merely because they are old. Weekly analysis is derived from Daily, and no independently verified cold-history hydration/restore path is currently part of the production EOD graph.

Legacy archive concepts are not retention authority:

- `eod_archive_checkpoints`;
- `market_ohlcv_archive_ranges`;
- Drive manifest/SHA archive state;
- per-ticker Notion operational archive state.

Those objects are QEO-65 deletion candidates only after zero-consumer dependency proof.

## 8. Manual recovery acceptance

After a manual current-session or historical EOD run, verify:

- parent `system_job_runs` terminal state;
- phase-level status/summary in `system_job_phases`;
- exact canonical universe identity;
- Daily history accounting for every requested ticker;
- Wyckoff snapshot count = `universeCount × 2`;
- Supabase publish validation hash and exact ticker membership;
- deterministic Council coverage;
- market synthesis real status;
- LLM debate real status;
- retention real status;
- downstream Notion analytical-summary status;
- `COMPLETE` telemetry contains `supabase-first-eod-v4-dag`.

## 9. Release verification

Before merge/deploy:

- `pnpm test:manifest`;
- `pnpm test:current`;
- `pnpm lint:touched`;
- `pnpm typecheck`;
- `pnpm build`;
- DB-changing releases additionally require drift, replay and generated-type gates.

Production acceptance requires the verified GitHub head to be green, Vercel production deployment to reach READY, and runtime smoke evidence from the deployed architecture.
