# N+1 Query Audit & Remediation Design

Date: 2026-09-02
Status: Proposed after code + production-stat audit
Base commit: `9e3aabc13270c6cfedd0b69e262fa969d9cf3371`

## 1. Goal

Remove the material N+1 database-read pattern from the active 200-ticker Wyckoff EOD path without weakening fail-closed validation, canonical-universe checks, workflow phase telemetry, or historical OHLCV coverage.

A separate follow-up should handle external-service N+1 patterns (Notion Research Changes and signal-monitor write amplification). They are intentionally excluded from the first implementation because they have different failure modes and are not the current Postgres hot path.

## 2. Verified findings

### P0-A — Wyckoff build reads one ticker per Postgres request

`lib/wyckoff-v2-cache-read.ts` loads `market_ohlcv_history` with `.eq("ticker", ticker)` and a 1,700-row Daily limit.

`lib/qeoindex-eod-workflow-steps.ts::buildAllSnapshots()` calls that one-ticker loader inside `Promise.all(...)` batches of ten.

The active workflow invokes `buildAllSnapshots()` independently in:

1. `WYCKOFF_BUILD`
2. `SUPABASE_VALIDATE`
3. `SUPABASE_PUBLISH`

For the canonical 200-ticker universe, this implies roughly 600 direct history SELECT requests per full EOD run before chart-series reads are counted. Concurrency limits wall-clock latency but does not remove N+1 round trips or database work.

### P0-B — Chart-series loader also issues one RPC per ticker

`lib/wyckoff-v2-chart-series.ts::loadWyckoffV2ChartSeriesRows()` already receives an array of tickers, but calls `qeo_market_ohlcv_recent` once per ticker with `p_tickers: [ticker]`.

The current RPC already accepts `text[]` and applies a per-ticker `row_number()` partition, so the API contract is structurally capable of batch reads.

`tests/wyckoff-v2-chart-series.test.ts` currently locks in the inefficient behavior by explicitly asserting 100 tickers produce 100 RPC calls and every request has exactly one ticker. That regression must be reversed.

At 200 tickers, the active publisher adds roughly 200 more history RPC requests. Combined with P0-A, the hot path is approximately 800 market-history round trips per full 200-ticker EOD run.

### Production evidence

`pg_stat_statements` on production showed two patterns consistent with the code audit:

- direct PostgREST reads selecting the full OHLCV projection from `market_ohlcv_history`: **2,200 calls**, ~**143.9s total execution**, ~**65.4ms mean execution**;
- PostgREST calls to `qeo_market_ohlcv_recent`: **740 calls**, ~**142.2s total execution**, ~**192.2ms mean execution**.

These counters span more than one operation/run, so they are not a per-run latency measurement. They are evidence that the per-ticker request patterns are materially exercised in production.

### Existing good pattern

`lib/ai-council-eod-market.ts` reads persistent OHLCV by bounded ticker batches with `.in("ticker", batch)`. Chunked writes in OHLCV refresh and publisher paths are also deliberate batching, not N+1 defects.

## 3. Secondary findings outside the first fix

### P2 — Research Changes performs one Notion query per thesis

`lib/research-data.ts::loadChanges()` loads theses once, then executes one filtered Analysis Log query per thesis via `Promise.all(theses.map(...))`. This is an external Notion N+1 pattern. It is partially mitigated by the 60-second UI read cache but should be fixed in a separate Notion-focused change.

### P2 — Signal monitor has external request/write amplification

`lib/signal-monitor.ts` may fetch fallback Daily history per buy candidate and performs per-row Notion updates/events. Those calls are external/provider or write-side operations, not the Postgres read N+1 responsible for the current EOD database pressure.

## 4. Constraints

- Canonical universe remains capped at 200 tickers.
- Daily Wyckoff build still requires `DAILY_V2_CACHE_LIMIT = 1700`; do not reduce historical depth just to reduce payload size.
- `market_ohlcv_history` remains canonical hot history and must not be pruned as part of this work.
- Preserve `WYCKOFF_BUILD`, `SUPABASE_VALIDATE`, and `SUPABASE_PUBLISH` as separate observable phases.
- Validation must continue to fail closed on missing tickers, missing timeframes, hash mismatches, or canonical-universe mismatches.
- New DB objects/RPC changes remain service-role only.
- Migrations must pass clean replay, generated-type drift, and migration-ledger checks.
- Avoid unbounded responses. Batch size must be explicit and tested.

## 5. Architecture

### Stage A — Replace per-ticker history requests with bounded multi-ticker RPC reads

Rewrite `qeo_market_ohlcv_recent(text[], integer)` so it is efficient for bounded batches and can serve both use cases:

- chart series: 260 Daily bars per ticker;
- full Wyckoff build: 1,700 Daily bars per ticker.

Keep default `p_limit = 260`, raise the hard maximum to `DAILY_V2_CACHE_LIMIT` (1,700), and implement the query as `unnest(p_tickers) CROSS JOIN LATERAL (...) ORDER BY bar_time DESC LIMIT p_limit`. The existing `(ticker, timeframe, bar_time desc)` lookup index matches this access pattern.

Use `WYCKOFF_HISTORY_QUERY_BATCH_SIZE = 10`. A full 200-ticker build becomes 20 RPCs instead of 200. A batch contains at most 17,000 Daily rows, keeping response size bounded.

Add `loadWyckoffV2CachedHistories(supabase, tickers)` returning a `Map<ticker, history>` and keep `loadWyckoffV2CachedTickerHistory()` only as a compatibility wrapper.

### Stage B — Build once per EOD run and reuse immutable build artifacts

Batching alone reduces calls about 10x but still rebuilds the same 200 tickers three times. Preserve workflow phase boundaries by persisting a small run-scoped build artifact instead of passing a large snapshot payload through workflow state.

Create `public.wyckoff_build_artifacts` with one row per `(run_id, ticker)`:

- `run_id uuid` referencing `system_job_runs(id)` with `on delete cascade`;
- `run_key text`;
- `scan_date date`;
- `ticker text`;
- `snapshots jsonb` containing the two deterministic Wyckoff snapshots for that ticker;
- `chart_series jsonb` containing the one Daily chart-series row derived from the same 1,700-bar history;
- `provider text`;
- `created_at timestamptz`.

The table is service-role only and ephemeral. Terminal artifacts older than one day are cleaned by the job-telemetry retention RPC; the parent run cascade is a final safety net.

`WYCKOFF_BUILD` performs the only full OHLCV read, builds snapshots + chart series, validates the set, and stages artifacts.

`SUPABASE_VALIDATE` loads staged artifacts by `run_id`, reconstructs snapshots, recomputes validation/hash, and checks canonical membership. It performs no market-history read.

`SUPABASE_PUBLISH` loads the exact same staged artifact set, verifies the expected hash, then publishes snapshots + chart series. It performs no market-history read.

This keeps phase telemetry and fail-closed semantics while eliminating both N+1 and the triple rebuild.

## 6. Expected query-count improvement

For a 200-ticker full EOD run:

| Path | Current | After Stage A only | After Stage A + B |
| --- | ---: | ---: | ---: |
| Full-history reads used for snapshot build | ~600 requests | ~60 batched RPCs | ~20 batched RPCs |
| Chart-series history reads | ~200 RPCs | ~20 batched RPCs | 0 additional reads |
| Total market-history round trips in these paths | ~800 | ~80 | ~20 |

The final target is therefore roughly a **40x reduction in round trips** for these code paths, while historical row depth remains unchanged.

## 7. Acceptance criteria

1. For 100 tickers and batch size 10, history-loader tests observe exactly 10 RPC calls, never 100.
2. Active EOD build code contains no `loadWyckoffV2CachedTickerHistory()` call inside a per-stock async map.
3. The chart-series test no longer asserts one RPC per ticker.
4. `WYCKOFF_BUILD` stages exactly one artifact per canonical ticker and exactly two snapshots + one Daily chart series per artifact.
5. `SUPABASE_VALIDATE` and `SUPABASE_PUBLISH` read staged artifacts and do not query `market_ohlcv_history` / `qeo_market_ohlcv_recent`.
6. Validation hash remains identical from build → validate → publish.
7. Missing/corrupt/stale artifact sets fail closed.
8. Clean Supabase replay, generated Database types, DB contract tests, TypeScript, lint, and production build pass.
9. Production smoke confirms the 200-ticker run completes with expected snapshot/chart-series counts.
10. Post-deploy `pg_stat_statements` / run telemetry shows the market-history request count no longer scales at one request per ticker per phase.

## 8. Out of scope

- OHLCV retention/archival changes.
- Changing canonical universe size.
- Provider API batching for DNSE/KFSP.
- Notion Research Changes N+1 remediation; create a separate follow-up after the Postgres hot path is fixed.
- Broad query/index rewrites unrelated to measured N+1 paths.
