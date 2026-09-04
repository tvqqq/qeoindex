# Persistent OHLCV History Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent Supabase raw OHLCV store and a deterministic `HISTORY_REFRESH` service that backfills only when coverage is insufficient, then refreshes only overlapping deltas for the 100-ticker EOD pipeline.

**Architecture:** Store only canonical raw `1D` and `1H` completed bars in the existing `qeoindex` Supabase project. A coverage RPC decides whether each ticker/timeframe needs a full backfill or a small overlap refresh; provider retrieval remains DNSE-primary with Yahoo fallback. Derived `4H/1W/1M` are not persisted and will be produced downstream from cached `1H/1D` data.

**Tech Stack:** Next.js/TypeScript, Supabase Postgres/PostgREST, DNSE OpenAPI, Yahoo fallback, Node test runner.

**Spec:** Approved `notion-unified-v2` Option A design in project conversation; Admin phase contract implemented by `modules/admin/job-phases.ts`.

## Global Constraints

- Existing Supabase project only; no new project or Edge Function.
- Persist raw `1D` and `1H` only; never persist derived `4H/1W/1M` in the raw history table.
- Finite, positive OHLC and non-negative Volume only.
- Completed bars only; provider filtering remains authoritative.
- Daily coverage must preserve at least 60 distinct completed calendar months when provider history exists.
- Hourly backfill window remains 180 calendar days and must support later 4H derivation.
- Runtime/provider fetch failure is an error; it must not be reclassified as genuine history insufficiency.
- Genuine short provider history is allowed and must be reported as limited coverage, not fabricated.
- Refresh is idempotent by `(ticker,timeframe,bar_time)`.
- Provider provenance (`provider`, `provider_detail`, `source_url`, `fetched_at`) is persisted per raw bar.
- Batch size is at most 10 tickers; provider concurrency is bounded to 4 tickers.

---

### Task 1: Private raw OHLCV storage and coverage RPC

**Files:**
- Create: `supabase/migrations/20260825163000_market_ohlcv_history.sql`
- Modify: `tests/root-admin-schema.test.ts`

**Interfaces:**
- Produces table `public.market_ohlcv_history` keyed by `(ticker,timeframe,bar_time)`.
- Produces RPC `public.qeo_market_ohlcv_coverage(text[])` returning ticker/timeframe row count, first/last bar, and distinct Daily months.

- [ ] **Step 1: Write failing schema assertions** for table privacy, uniqueness, timeframe check, coverage RPC, and service-role-only access.
- [ ] **Step 2: Run `node --test tests/root-admin-schema.test.ts`** and verify failure because the migration does not exist.
- [ ] **Step 3: Add migration** with RLS, service-role grants, descending lookup index, and coverage RPC.
- [ ] **Step 4: Re-run schema test** and verify pass.

### Task 2: Provider window metadata

**Files:**
- Modify: `modules/market/providers/dnse/history.ts`
- Modify: `modules/market/providers/yahoo/history.ts`
- Modify: `modules/market/history/index.ts`
- Test: `tests/ohlcv-history-store.test.ts`

**Interfaces:**
- Produces `fetchDailyMarketHistoryWindow(symbol, lookbackDays, now)` and `fetchHourlyMarketHistoryWindow(symbol, lookbackDays, now)` returning `HistoricalBarsResult` with `sourceUrl` and `fetchedAt`.
- Existing `fetchDailyMarketHistory`, `fetchLongDailyMarketHistory`, and `fetchHourlyMarketHistory` remain backward compatible wrappers.

- [ ] **Step 1: Write failing tests** for safe provenance URL formatting and refresh-window constants/selection.
- [ ] **Step 2: Run targeted test** and verify failure due missing APIs.
- [ ] **Step 3: Add optional hourly lookback parameter to DNSE/Yahoo fetchers**, then implement market-history window wrappers and provenance metadata.
- [ ] **Step 4: Re-run targeted test** and verify pass.

### Task 3: Persistent history store and refresh planner

**Files:**
- Create: `modules/market/history/ohlcv-store.ts`
- Test: `tests/ohlcv-history-store.test.ts`

**Interfaces:**
- Produces `buildOhlcvRefreshPlan(coverage, now)`.
- Produces `refreshOhlcvHistoryBatch(supabase, tickers, now)` for <=10 tickers.
- Produces `refreshOhlcvHistoryUniverse(supabase, tickers, now)` for exactly/bounded universe processing.
- Produces `loadCachedOhlcvHistory(supabase, ticker, timeframe)` and `loadCachedOhlcvPair(...)` with pagination.

- [ ] **Step 1: Write failing planner tests**: empty/short coverage => backfill; >=60 Daily months and sufficient Hourly rows => delta; invalid/duplicate ticker normalization is deterministic.
- [ ] **Step 2: Run targeted test** and verify failures are feature-missing failures.
- [ ] **Step 3: Implement pure planner and normalization**, using 8×366 Daily backfill, 180-day Hourly backfill, 14-day Daily overlap and 7-day Hourly overlap.
- [ ] **Step 4: Implement Supabase coverage lookup, chunked upserts (500 rows), bounded concurrency=4, post-refresh coverage, and paginated reads.** Provider errors populate `errors`; provider-returned short histories populate `limitedCoverage`.
- [ ] **Step 5: Re-run targeted tests** and verify pass.

### Task 4: HISTORY_REFRESH phase-facing service and verification

**Files:**
- Create: `modules/eod/history-refresh.ts`
- Modify: `package.json`
- Modify: `tests/root-admin-ui.test.ts` only if needed for touched-file performance inventory.
- Test: `tests/ohlcv-history-store.test.ts`

**Interfaces:**
- Produces `runEodHistoryRefresh(supabase, { tickers, now })` returning a compact Admin phase summary with `requestedTickers`, `completedTickers`, `failedTickers`, fetched-bar counts, backfill/delta counts, limited-coverage warnings, and errors.
- Does not yet write `system_job_phases`; the later orchestration task owns lifecycle/telemetry writes.

- [ ] **Step 1: Write failing summary-contract test** for deterministic aggregate output and hard failure when any provider/runtime error occurs.
- [ ] **Step 2: Run targeted test** and verify failure.
- [ ] **Step 3: Implement phase-facing wrapper** over `refreshOhlcvHistoryUniverse` with fail-closed error type `EOD_HISTORY_REFRESH_FAILED`.
- [ ] **Step 4: Add new test to `test:core` and new runtime files to `lint:touched`.**
- [ ] **Step 5: Run `pnpm test:core`, `pnpm typecheck`, targeted ESLint, and `pnpm scan:secrets`.**
- [ ] **Step 6: Review diff for no persistence of derived 4H/1W/1M and no credentials in source URLs.**
