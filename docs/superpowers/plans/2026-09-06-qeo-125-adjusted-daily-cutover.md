# QEO-125 Adjusted Daily Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a separate chart-facing adjusted Daily storage/read boundary, rebuild it deterministically from raw Daily + factors, and cut over consumers through a staged VHM→canonical-200 rollout without repurposing `market_ohlcv_history` in place.

**Architecture:** Preserve current raw/provider Daily evidence in `market_ohlcv_history`. Add a derived adjusted Daily table/read model keyed by ticker/session and lineage hash. Rebuild only affected ranges, validate VHM and representative tickers, then switch `/api/market/ohlcv` Daily/higher-timeframe source through an explicit feature/cutover gate.

**Tech Stack:** Supabase/PostgreSQL, TypeScript, existing `modules/market/history/*`, Next.js market OHLC API, QEO-93 aggregation engine.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on QEO-123/QEO-124 and the QEO-126 activation contract.
- `market_ohlcv_history` remains raw/provider evidence during rollout.
- `1W/1M/1Q/1Y` must derive from adjusted `1D`; never apply a second adjustment after aggregation.
- No mixed basis per rendered ticker/range.
- Exact one canonical session identity per ticker/date; no shifted/duplicate bars.
- Fail closed on missing factor/event lineage.
- PR #340/QEO-106 legacy Yahoo repair work must be reconciled before cutover: retain persisted-readback/semantic-invalid lessons, but do not make Yahoo-adjusted rows the long-term factor authority.

---

### Task 1: Add adjusted Daily storage + audit schema

**Files:**
- Create: `supabase/migrations/<timestamp>_qeo125_adjusted_daily_ohlcv.sql`
- Modify: `lib/supabase/database.types.ts`
- Test: `tests/market-data-contract.test.ts`

**Interfaces:**
- Produces `market_ohlcv_adjusted_daily` and service-role rebuild/readback RPCs.

Core shape:

```sql
create table public.market_ohlcv_adjusted_daily (
  ticker text not null,
  session_date date not null,
  bar_time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  raw_bar_time timestamptz not null,
  factor_version text not null,
  event_lineage_hash text not null,
  adjustment_engine_version text not null,
  rebuilt_at timestamptz not null default now(),
  primary key (ticker, session_date)
);
```

- [ ] **Step 1: RED schema assertions** — unique session identity, OHLC validity checks, service-role mutation only, indexes for ticker/date reads.
- [ ] **Step 2: Implement migration and readback RPC**
- [ ] **Step 3: Regenerate Database types + DB Drift**
- [ ] **Step 4: Commit**

### Task 2: Implement raw→adjusted transformation

**Files:**
- Create: `modules/market/history/adjusted-daily.ts`
- Test: `tests/qeo-125-adjusted-daily.test.ts`

**Interfaces:**

```ts
export type AdjustedDailyBar = {
  ticker: string
  sessionDate: string
  barTime: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  rawBarTime: string
  factorVersion: string
  eventLineageHash: string
  adjustmentEngineVersion: string
}

export function applyDailyAdjustment(
  raw: RawDailyBar,
  factor: FactorRow,
): AdjustedDailyBar
```

- [ ] **Step 1: RED OHLC factor application** — all OHLC multiply by `priceFactor`.
- [ ] **Step 2: RED volume semantics** — volume uses factor row's explicit `volumeFactor`, not price factor.
- [ ] **Step 3: RED invalid/missing-factor case** — no bar returned/throw typed unresolved error rather than raw fallback.
- [ ] **Step 4: Implement minimal transformation**
- [ ] **Step 5: GREEN tests and commit**

### Task 3: Implement bounded rebuild + exact DB readback

**Files:**
- Create: `modules/market/history/adjusted-daily-store.ts`
- Modify: `modules/market/history/adjusted-daily.ts`
- Test: `tests/qeo-125-adjusted-daily.test.ts`

**Interfaces:**

```ts
export async function rebuildAdjustedDailyRange(input: {
  supabase: SupabaseClient
  ticker: string
  fromDate: string
  toDate: string
  expectedLineageHash: string
}): Promise<{
  rebuiltSessions: number
  unresolvedSessions: string[]
  firstSession: string | null
  lastSession: string | null
}>
```

- [ ] **Step 1: RED persistence false-positive regression** — mocked silent-preserve/write mismatch must remain unresolved.
- [ ] **Step 2: Load raw Daily from existing `market_ohlcv_history`/history store and active factors**
- [ ] **Step 3: Upsert adjusted rows in bounded batches**
- [ ] **Step 4: Read back exact sessions + lineage; compute success from readback only**
- [ ] **Step 5: Commit**

### Task 4: Add adjusted Daily read abstraction without cutover

**Files:**
- Modify: `modules/market/history/contract.ts`
- Create: `modules/market/history/adjusted-daily-read.ts`
- Modify: `modules/market/history/index.ts`
- Test: `tests/ohlcv-history-store.test.ts`

**Interfaces:**

```ts
export async function loadAdjustedDailyRange(
  ticker: string,
  fromMs: number,
  toMs: number,
): Promise<MarketHistoryBar[]>
```

- [ ] **Step 1: RED read contract** — complete adjusted range returns bars ordered by canonical session; missing lineage is explicit, not raw fallback.
- [ ] **Step 2: Implement provider-agnostic adjusted read path**
- [ ] **Step 3: Keep existing raw read path unchanged and separately callable**
- [ ] **Step 4: Commit**

### Task 5: Add explicit chart-data cutover gate

**Files:**
- Modify: `app/api/market/ohlcv/route.ts`
- Modify: chart-data server module used by the route if split from route implementation
- Modify: `tests/qeo-93-chart-timeframes.test.ts` or existing chart API contract test

**Interfaces:**
- Daily/higher-timeframe chart queries select adjusted Daily only for tickers marked cutover-ready.

Recommended gate source: DB rollout state table/RPC rather than environment variable per ticker.

- [ ] **Step 1: RED VHM cutover test** — VHM 1D reads adjusted store when rollout state is `active`.
- [ ] **Step 2: RED non-migrated ticker test** — remains on existing raw path until explicitly activated; response metadata must expose basis so mixed ranges cannot be merged invisibly.
- [ ] **Step 3: Implement atomic per-ticker basis selection**
- [ ] **Step 4: Ensure derived `3D/1W/1M/1Q/1Y` receives only the selected Daily series via QEO-93 aggregation**
- [ ] **Step 5: Commit**

### Task 6: VHM golden production migration

**Files:**
- Create: `docs/db/evidence/qeo125-vhm-adjusted-daily-cutover.md`

- [ ] Rebuild VHM full retained adjusted Daily range.
- [ ] Verify factor/session coverage = complete for target range.
- [ ] Verify no duplicate/shifted sessions around 13–21/10/2025.
- [ ] Aggregate 13–17/10/2025 weekly from adjusted Daily and require H≈63.31 / L≈55.18 within documented tolerance.
- [ ] Compare raw and adjusted series explicitly; never overwrite raw evidence.
- [ ] Activate VHM cutover only after checks pass.
- [ ] Verify `/api/market/ohlcv` and production chart show adjusted VHM 1D/1W.
- [ ] Commit evidence.

### Task 7: Regression set + multi-exchange rollout

- [ ] Rebuild HCM/VCB/VIC; verify persistence/readback and no session shift.
- [ ] Pick HOSE/HNX/UPCOM sample with cash/stock/rights cases.
- [ ] Require 0 unresolved effective events, 0 mixed-basis reads, 0 duplicate sessions before activation.
- [ ] Measure DB growth/capacity after each stage.
- [ ] Update rollout state only for passing tickers.

### Task 8: Canonical-200 staged rollout

- [ ] Process 10–20 tickers per batch.
- [ ] Before each batch: capacity + event/factor coverage preflight.
- [ ] After each batch: exact adjusted-session readback, unresolved count, price-basis marker, derived-timeframe smoke.
- [ ] Stop on any ambiguous effective event or unresolved persistence.
- [ ] Final canonical-200 report: migrated, blocked, unresolved, event coverage, factor coverage, DB size.
- [ ] QEO-98 must consume this report as a release gate.
- [ ] Only after canonical acceptance consider retiring transitional Yahoo-adjusted repair logic; never delete raw evidence as part of this issue.
