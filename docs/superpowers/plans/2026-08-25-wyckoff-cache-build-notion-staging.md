# Cached Wyckoff Build and Notion Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 100×5 Wyckoff contract snapshots exclusively from persistent Supabase OHLCV cache, support rank anomalies and genuine Incomplete records, and make QeoIndex server the Notion unified staging writer for `notion-unified-v2`.

**Architecture:** `HISTORY_REFRESH` is the only phase allowed to call external history providers. `WYCKOFF_BUILD` reads cached 1D/1H bars, derives 4H/1W/1M deterministically, and produces exactly five contract records per ticker. `NOTION_STAGING` then upserts those records and a deterministic Run manifest into Notion; no operational Wyckoff publish occurs until the later ingest phase.

**Tech Stack:** TypeScript, Supabase Postgres/PostgREST, Notion API, existing Wyckoff chart/engine code, Node test runner.

**Spec:** Approved `notion-unified-v2` Option A design plus `docs/superpowers/plans/2026-08-25-ohlcv-history-refresh.md`.

## Global Constraints

- Prompt Version = `notion-unified-v2`.
- Model Version = `qeo-wyckoff-rule-v1`.
- Aggregation Version = `vn-session-v1`.
- Exactly 100 unique Active HOSE tickers and 5 snapshot keys per ticker.
- Rank anomalies are warnings only; preserve source Rank when representable, never renumber.
- `History Status=Incomplete` only for genuine cached/provider history below 60 completed derived bars; runtime/cache/aggregation errors fail the phase.
- Complete threshold is 60 bars on every derived timeframe.
- Incomplete records contain real `completedBars` and non-empty `missingReason`, and contain no fabricated analysis/probabilities/levels/scenarios.
- `WYCKOFF_BUILD` must not import or call market-history/DNSE/Yahoo provider functions.
- 4H derives from completed 1H according to `vn-session-v1`; 1W/1M derive from completed Daily.
- Complete probabilities sum exactly 100; exactly 3 scenarios with mapped horizons.
- Notion staging upserts by Snapshot Key and Run Key; no duplicates.
- Notion is staging only. Supabase operational publish remains a later phase.

---

### Task 1: Relax operational schema for v2 rank anomalies and genuine Incomplete rows

**Files:**
- Create: `supabase/migrations/20260825170000_wyckoff_contract_v2.sql`
- Modify: `tests/wyckoff-unified-schema.test.ts`
- Modify: `tests/root-admin-schema.test.ts` if private contract assertions are needed.

**Interfaces:**
- `wyckoff_universe_memberships.rank` becomes nullable and non-unique; ticker/effective-date primary key remains authoritative.
- `wyckoff_analysis_snapshots` allows nullable analysis/probability fields for `history_status='incomplete'` while preserving strict Complete constraints.

- [ ] Write failing tests requiring the v2 migration to drop rank uniqueness/range blocker and conditional snapshot constraints.
- [ ] Run targeted schema test and verify RED.
- [ ] Add migration dropping rank unique/range/not-null constraints, dropping analysis NOT NULL constraints, and replacing probability/analysis checks with conditional Complete-vs-Incomplete checks.
- [ ] Re-run targeted schema test and verify GREEN.

### Task 2: Deterministic v2 universe selection

**Files:**
- Create: `modules/wyckoff/eod-universe.ts`
- Test: `tests/wyckoff-v2-staging.test.ts`

**Interfaces:**
- `selectWyckoffV2Universe(rows)` returns `{ stocks, warnings }` with exactly 100 selected rows or throws a hard-stop error.
- Valid Rank rows sort first ascending; rank anomalies sort last by original Rank then ticker.

- [ ] Write failing tests for duplicate Rank 21, missing/out-of-range Rank, duplicate ticker hard-stop, <100 hard-stop, and deterministic >100 selection.
- [ ] Run targeted test and verify RED.
- [ ] Implement pure selector preserving source Rank and emitting warnings.
- [ ] Re-run and verify GREEN.

### Task 3: Cached five-timeframe contract builder

**Files:**
- Create: `modules/wyckoff/eod-builder.ts`
- Modify: `modules/wyckoff/chart-model.ts` only if 4H aggregation must be corrected/exposed for `vn-session-v1`.
- Test: `tests/wyckoff-v2-staging.test.ts`

**Interfaces:**
- `buildWyckoffV2TickerSnapshots({ stock, daily, hourly, runKey, scanDate })` returns exactly five snapshot records.
- Complete records include Technical/Evidence/Markers/Scenarios; Incomplete records include only evidence/history metadata and null analysis/probabilities.
- Builder consumes `CachedOhlcvHistory`; no provider fetch functions.

- [ ] Write failing tests for exactly five keys, threshold 60, genuine monthly Incomplete, probability sum/scenario count/horizon, provenance evidence, and no future OHLCV fabrication.
- [ ] Run targeted test and verify RED.
- [ ] Implement builder using `buildWyckoffChartStudies`, adding contract evidence and normalization.
- [ ] Verify builder source does not import `market-history`, `dnse-history`, or `yahoo-history`.
- [ ] Re-run targeted test and verify GREEN.

### Task 4: Server-side Notion Run/Snapshot writer

**Files:**
- Create: `modules/wyckoff/eod-notion-staging.ts`
- Test: `tests/wyckoff-v2-staging.test.ts`

**Interfaces:**
- `buildNotionRunProperties(...)` and `buildNotionSnapshotProperties(...)` are pure mapping helpers.
- `upsertNotionWyckoffRun(...)` queries Run Key then create/update.
- `upsertNotionWyckoffSnapshot(...)` queries Snapshot Key then create/update.
- `writeNotionWyckoffBatch(...)` writes at most 10 tickers / 50 snapshots per caller batch.
- `validateV2SnapshotSet(...)` validates 500 unique keys and Complete/Incomplete contract before Ready.

- [ ] Write failing property-mapping tests covering null Incomplete fields and canonical JSON strings.
- [ ] Write failing final-validation tests for 500 keys, five frames/ticker, probabilities/scenarios, and rank-warning non-blocking behavior.
- [ ] Implement pure property mappers and validators first.
- [ ] Implement Notion query/create/update upsert wrappers with no duplicate keys.
- [ ] Re-run targeted tests and verify GREEN.

### Task 5: Cached batch build service and ingest compatibility

**Files:**
- Create: `lib/wyckoff-v2-build-service.ts`
- Modify: `modules/wyckoff/notion-ingest.ts`
- Test: `tests/wyckoff-v2-staging.test.ts`
- Modify: `tests/wyckoff-eod-refresh.test.ts` only where old assumptions conflict.

**Interfaces:**
- `buildWyckoffV2BatchFromCache(supabase,{stocks,runKey,scanDate})` loads cached pairs and returns snapshot records/errors without provider calls.
- Notion ingest removes unique-rank hard-stop and uses server-v2 diagnostics source.
- Operational membership upsert accepts rank anomalies after migration.

- [ ] Write failing source-boundary test proving build service uses `loadCachedOhlcvPair` and no provider fetch path.
- [ ] Write failing ingest test/source assertion that rank uniqueness no longer blocks.
- [ ] Implement cached batch service and ingest compatibility.
- [ ] Re-run targeted tests and verify GREEN.

### Task 6: Standard build gates and branch verification

**Files:**
- Modify: `package.json`
- Temporary: `.github/workflows/phase3-ci.yml` (delete after successful verification)

- [ ] Add Phase 3 tests to `test:core` and runtime files to `lint:touched`.
- [ ] Run full branch CI: `pnpm test:core`, `pnpm typecheck`, `pnpm lint:touched`, `pnpm scan:secrets`.
- [ ] Review final diff for: no direct provider call in `WYCKOFF_BUILD`; exactly 5 TF contract; rank anomalies warning-only; genuine Incomplete only.
- [ ] Delete temporary CI workflow after success.
