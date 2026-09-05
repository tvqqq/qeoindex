# QEO-106 Daily Hot/Cold Full-History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend canonical Daily history beyond the current 8-year PostgreSQL seed using verified Storage cold partitions while preserving one storage-agnostic chart-data API.

**Architecture:** Keep recent canonical Daily in `market_ohlcv_history`; use the existing private `chart-ohlcv` bucket for immutable `1D` cold partitions and verified manifests. The chart service merges Hot PostgreSQL + Cold Storage deterministically, while a resumable deep-backfill worker and fail-closed archival/prune lifecycle maintain the physical tiers.

**Tech Stack:** Next.js 16, TypeScript, Supabase Postgres, Supabase Storage, Node gzip/SHA-256, Node test contracts.

**Spec:** `docs/superpowers/specs/2026-09-05-qeo-106-daily-hot-cold-full-history-design.md`

## Global Constraints

- `1D/3D/1W/1M/1Q/1Y` render full recoverable canonical Daily history.
- `DAILY_BACKFILL_DAYS = 8 * 366` is a physical hot/bootstrap horizon only.
- Existing `1m` archive behavior must remain backward compatible.
- Never synthesize Daily or intraday OHLCV.
- No PostgreSQL prune before immutable object write + checksum + readback + exact row-count verification.
- Frontend and QEO-93 aggregation stay provider/storage agnostic.

---

### Task 1: Add schema support for Daily cold manifests and resumable state

**Files:**
- Create: `supabase/migrations/20260905153500_qeo106_daily_hot_cold_history.sql`
- Test: `tests/qeo-106-daily-hot-cold-history.test.ts`

**Interfaces:**
- Produces `chart_ohlcv_cold_manifests.base_resolution IN ('1m','1D')`.
- Produces `chart_ohlcv_cold_manifests.provenance jsonb`.
- Produces `chart_daily_history_state`.
- Produces service-role RPC `qeo_prune_verified_chart_daily_partition(uuid,text,integer)`.

- [ ] **Step 1: Write a failing contract test** asserting the migration widens the manifest resolution, creates Daily state, and defines a verified Daily prune RPC.
- [ ] **Step 2: Run `node --test tests/qeo-106-daily-hot-cold-history.test.ts` and confirm RED.**
- [ ] **Step 3: Add the migration** with fail-closed exact-row pruning from `market_ohlcv_history` only for `timeframe='1D'` and only for verified `1D` manifests.
- [ ] **Step 4: Re-run the contract test and confirm GREEN.**

### Task 2: Generalize verified cold storage without changing `1m` callers

**Files:**
- Modify: `modules/market/chart-data/cold-store.ts`
- Test: `tests/qeo-106-daily-hot-cold-history.test.ts`

**Interfaces:**
- Keep `createSupabaseColdOhlcvStorage(supabase)` as the existing `1m` factory.
- Add `createSupabaseDailyColdOhlcvStorage(supabase)` for `1D`.
- Both factories use the same serializer, checksum/readback verification and manifest table.
- Daily paths are `1D/ticker=.../year=.../...ndjson.gz`; minute paths stay unchanged.

- [ ] **Step 1: Extend the failing test** to require the Daily factory and resolution-specific manifest/path behavior.
- [ ] **Step 2: Confirm RED.**
- [ ] **Step 3: Refactor internal helpers to accept `baseResolution: '1m'|'1D'` while preserving the public `1m` API.**
- [ ] **Step 4: Confirm GREEN.**

### Task 3: Merge Hot PostgreSQL + Cold Daily in the canonical chart service

**Files:**
- Modify: `modules/market/chart-data/service.ts`
- Modify: `modules/market/chart-data/normalize.ts`
- Test: `tests/qeo-106-daily-hot-cold-history.test.ts`

**Interfaces:**
- `loadDaily()` concurrently reads paginated Hot rows and intersecting verified Daily cold manifests.
- Hot Daily has deterministic precedence over Cold on overlap.
- Session-validity filtering applies to both tiers before gap detection.

- [ ] **Step 1: Add regression assertions** for Daily cold factory usage, concurrent merge and Hot-over-Cold precedence.
- [ ] **Step 2: Confirm RED.**
- [ ] **Step 3: Implement the minimal service/precedence change.**
- [ ] **Step 4: Run targeted test, current contracts, lint and TypeScript.**

### Task 4: Add resumable deep left-edge backfill and Daily hot archival

**Files:**
- Create: `modules/market/history/daily-cold-history.ts`
- Create: `app/api/admin/market/daily-history/backfill/route.ts`
- Test: `tests/qeo-106-daily-hot-cold-history.test.ts`

**Interfaces:**
- `backfillDailyColdHistory(supabase,{tickers,maxChunksPerTicker,now})` processes bounded chunks.
- Each ticker starts before the earliest verified Hot/Cold bar.
- It calls `fetchDailyMarketHistoryWindow(ticker, lookbackDays, cursorNow)` through the approved provider waterfall.
- Recovered old bars archive directly through `createSupabaseDailyColdOhlcvStorage` with provenance.
- `archiveExpiredDailyHotHistory(...)` archives Hot rows older than `DAILY_BACKFILL_DAYS` and invokes the verified prune RPC only after cold verification.
- The admin route is machine-authenticated and bounded to at most 10 tickers per request.

- [ ] **Step 1: Add RED contracts** for bounded chunking, provider waterfall reuse, state persistence, no synthetic fill, and archive-before-prune order.
- [ ] **Step 2: Implement the worker and route.**
- [ ] **Step 3: Run targeted test and `pnpm verify:pr`.**

### Task 5: Reconcile QEO-106 integrity work and release evidence

**Files:**
- Reconcile from PR #329: Daily session calendar filtering, integrity report/repair route, migrations that do not conflict with latest `main`.
- Update: `docs/chart-data.md`
- Update: PR body + Linear QEO-106.

**Interfaces:**
- QEO-106 final branch contains both session integrity and full-history Hot/Cold behavior.
- PR #329 is superseded only after its non-conflicting integrity changes are preserved.

- [ ] **Step 1: Port QEO-106 integrity files from PR #329 onto latest-main-based branch, preserving QEO-93 pagination.**
- [ ] **Step 2: Run `pnpm verify:pr`; if DB schema changed, run full DB drift/replay/type gates.**
- [ ] **Step 3: Open replacement PR, mark old PR #329 superseded, and update Linear with exact remaining production rollout steps.**
