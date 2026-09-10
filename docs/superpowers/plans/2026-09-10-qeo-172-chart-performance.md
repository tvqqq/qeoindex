# QEO-172 Chart Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Stock Detail chart ticker/timeframe perceived latency by measuring the real pipeline, caching only validated stable history, independently refreshing the current trading-date tail, prefetching only adjacent watchlist intent, and atomically swapping complete prepared datasets without weakening canonical data correctness.

**Architecture:** Keep QEO-97's bounded per-tab cache and QEO-147/QEO-148/QEO-149/QEO-150 source-of-truth rules. Instrument first and freeze the production baseline. Then split intraday/hourly transport at the conservative current-trading-date boundary, allow private caching only for stable complete ranges, prepare closed + fresh current-date slices before committing a timeframe/ticker change, and prefetch only adjacent stable history.

**Tech Stack:** Next.js 16.3 route handlers, React 19, Lightweight Charts v5, Supabase/PostgreSQL + private COLD object storage, Vercel Runtime, Playwright 1.63, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-qeo-172-chart-performance-design.md`

## Global Constraints

- No synthetic OHLCV.
- Raw `1m` and canonical completed Daily remain source-of-truth inputs.
- Do not bypass QEO-147 derived-hourly readiness proof.
- Do not cache PARTIAL/gap/integrity/provider/storage-error responses.
- On any Vietnam trading date, intraday/hourly data from 09:00 ICT onward remains fresh/no-store for that whole date, including after EOD.
- Future-ending ranges are never cacheable.
- Do not prefetch more than previous + next visible watchlist ticker.
- Adjacent background prefetch warms stable closed history only; current-date tail is fetched fresh on actual navigation.
- Do not copy drawings, ticker-scoped objects or absolute price ranges across symbols.
- QEO-97 history horizons remain unchanged: `<1h <= 31d`, `1h/2h/4h <= 366d`, `>=1D` full canonical Daily.
- Client stable-range cache remains bounded to 24 entries and 10 minutes.
- No database migration is expected.

---

### Task 1: Instrument the pipeline and capture the production baseline

**Files:**
- Create: `modules/market/chart-data/performance.ts`
- Modify: `modules/market/chart-data/service.ts`
- Modify: `modules/market/chart-data/timeframe-service.ts`
- Modify: `app/api/market/ohlcv/route.ts`
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Create: `tests/qeo172/chart-performance-contract.test.ts`
- Create: `tests/browser/qeo172-chart-performance-production.spec.ts`
- Create: `.github/workflows/qeo-172.yml`

**Interfaces:**
- Produces `ChartPerfStage = "daily-db" | "hot-db" | "derived-cache" | "cold-object" | "provider-fetch" | "aggregation"`.
- Produces `createChartPerformanceRecorder(now?): ChartPerformanceRecorder` with `measure()`, `measureSync()` and `snapshot()`.
- Extends `ChartDataServiceDeps` with optional `performance?: ChartPerformanceRecorder`.
- `Server-Timing` preserves total `chart-data` and adds non-zero internal stages plus `serialization`.
- Chart host exposes `data-chart-rendered-key="<TICKER>:<TIMEFRAME>:<BAR_COUNT>:<LAST_BAR_TIME>"` only after Lightweight Charts has applied the dataset.
- Production benchmark writes `test-results/qeo172-performance.json`.

- [ ] **Step 1: Write the failing timing-recorder test**

Create `tests/qeo172/chart-performance-contract.test.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"

import {
  createChartPerformanceRecorder,
  type ChartPerfStage,
} from "../../modules/market/chart-data/performance.ts"

const STAGES: ChartPerfStage[] = [
  "daily-db",
  "hot-db",
  "derived-cache",
  "cold-object",
  "provider-fetch",
  "aggregation",
]

test("QEO-172 recorder accumulates duration and count per stage", async () => {
  let now = 0
  const recorder = createChartPerformanceRecorder(() => now)

  await recorder.measure("hot-db", async () => { now += 7 })
  await recorder.measure("hot-db", async () => { now += 5 })
  recorder.measureSync("aggregation", () => { now += 3 })

  const snapshot = recorder.snapshot()
  assert.deepEqual(snapshot["hot-db"], { durationMs: 12, count: 2 })
  assert.deepEqual(snapshot.aggregation, { durationMs: 3, count: 1 })
  for (const stage of STAGES) assert.ok(stage in snapshot)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
```

Expected: FAIL because `modules/market/chart-data/performance.ts` does not exist.

- [ ] **Step 3: Implement the pure timing recorder**

Create `modules/market/chart-data/performance.ts` without `server-only` so the pure utility can be directly tested:

```ts
export type ChartPerfStage =
  | "daily-db"
  | "hot-db"
  | "derived-cache"
  | "cold-object"
  | "provider-fetch"
  | "aggregation"

export interface ChartPerfMeasurement {
  durationMs: number
  count: number
}

export type ChartPerfSnapshot = Record<ChartPerfStage, ChartPerfMeasurement>

export interface ChartPerformanceRecorder {
  measure<T>(stage: ChartPerfStage, work: () => Promise<T>): Promise<T>
  measureSync<T>(stage: ChartPerfStage, work: () => T): T
  snapshot(): ChartPerfSnapshot
}

const STAGES: ChartPerfStage[] = [
  "daily-db", "hot-db", "derived-cache", "cold-object", "provider-fetch", "aggregation",
]

export function createChartPerformanceRecorder(
  now: () => number = () => performance.now(),
): ChartPerformanceRecorder {
  const values = new Map<ChartPerfStage, ChartPerfMeasurement>(
    STAGES.map((stage) => [stage, { durationMs: 0, count: 0 }]),
  )

  function add(stage: ChartPerfStage, durationMs: number) {
    const current = values.get(stage) ?? { durationMs: 0, count: 0 }
    values.set(stage, {
      durationMs: current.durationMs + Math.max(0, durationMs),
      count: current.count + 1,
    })
  }

  return {
    async measure(stage, work) {
      const startedAt = now()
      try { return await work() } finally { add(stage, now() - startedAt) }
    },
    measureSync(stage, work) {
      const startedAt = now()
      try { return work() } finally { add(stage, now() - startedAt) }
    },
    snapshot() {
      return Object.fromEntries(
        STAGES.map((stage) => [stage, { ...(values.get(stage) ?? { durationMs: 0, count: 0 }) }]),
      ) as ChartPerfSnapshot
    },
  }
}
```

- [ ] **Step 4: Wire server timing around existing work without reordering source logic**

In `modules/market/chart-data/service.ts`, add:

```ts
import type { ChartPerformanceRecorder, ChartPerfStage } from "./performance"

export interface ChartDataServiceDeps {
  supabase: SupabaseClient
  coldStorage?: ColdOhlcvStorage
  provider?: ChartOhlcvProvider
  now?: Date
  performance?: ChartPerformanceRecorder
}

async function measured<T>(deps: ChartDataServiceDeps, stage: ChartPerfStage, work: () => Promise<T>) {
  return deps.performance ? deps.performance.measure(stage, work) : work()
}
```

Wrap the existing operations in place:

```ts
const hotRows = await measured(deps, "daily-db", () => loadDailyRows(deps.supabase, request))
```

```ts
const [hotRead, coldRead, coverageRead] = await Promise.allSettled([
  measured(deps, "hot-db", () => readHotIntradayRange(deps.supabase, request.ticker, request.from, request.to)),
  measured(deps, "cold-object", () => coldStorage.readIntersectingRange({ ticker: request.ticker, from: request.from, to: request.to })),
  measured(deps, "hot-db", () => readProviderRequestCoverage(deps.supabase, request.ticker, request.from, request.to)),
])
```

Wrap external provider calls with `provider-fetch`. Do not change provider ranges, fallback order, persistence, QEO-148 coordination or error conversion.

In `modules/market/chart-data/timeframe-service.ts`, time existing derived-readiness/source-proof/derived-row operations as `derived-cache`, COLD reads as `cold-object`, and `aggregateChartTimeframe()` calls using `performance.measureSync("aggregation", ...)` when a recorder exists.

- [ ] **Step 5: Emit internal stage timings and serialization timing from the API**

In `app/api/market/ohlcv/route.ts`:

```ts
const recorder = createChartPerformanceRecorder()
const result = await getChartOhlcv(
  { supabase, performance: recorder },
  { ticker, resolution, from, to },
)
```

Time `JSON.stringify()` separately. Emit `Server-Timing` like:

```text
chart-data;dur=123.4, daily-db;dur=18.2, derived-cache;dur=9.1, aggregation;dur=2.8, serialization;dur=1.4
```

Omit zero-count stages. Preserve `X-Chart-Bar-Count` and `X-Chart-Payload-Bytes`.

- [ ] **Step 6: Add a deterministic browser render-ready marker**

After all series `setData()`/`update()` work in `StockTradingViewChart`, write:

```ts
const lastTime = displayBars.at(-1)?.time ?? 0
chartHostRef.current?.setAttribute(
  "data-chart-rendered-key",
  `${ticker.toUpperCase()}:${timeframe}:${displayBars.length}:${lastTime}`,
)
```

Do not set this during React render; it must mean the dataset was applied to Lightweight Charts.

- [ ] **Step 7: Build the authenticated production benchmark**

Create `tests/browser/qeo172-chart-performance-production.spec.ts`. Reuse the QEO-171 encrypted QA credentials and authenticated login/session-sync flow. Freeze:

```ts
const MATRIX = [
  ["VIC", "1D"], ["VIC", "4h"], ["VIC", "1h"], ["VIC", "15m"],
  ["VCB", "1D"], ["VCB", "4h"], ["VCB", "1h"], ["VCB", "15m"],
] as const
const SAMPLES = 10
```

For direct API requests, capture wall-clock latency, `Server-Timing`, bar count and payload bytes. For UI interactions, start at `performance.now()` immediately before interaction and stop when `data-chart-rendered-key` matches the target. Run one warm-up before collecting ten samples.

Use:

```ts
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}
```

Write raw samples and derived p50/p95 to `test-results/qeo172-performance.json`. Baseline mode records; it does not enforce the new optimization targets.

- [ ] **Step 8: Add `.github/workflows/qeo-172.yml`**

Use:

```yaml
name: QEO-172
on:
  pull_request:
    paths:
      - "modules/market/chart-data/**"
      - "app/api/market/ohlcv/**"
      - "components/stock-detail/**"
      - "tests/qeo172/**"
      - "tests/browser/qeo172-chart-performance-production.spec.ts"
      - ".github/workflows/qeo-172.yml"
  workflow_dispatch:
    inputs:
      benchmark_mode:
        description: baseline or acceptance
        required: true
        default: baseline

permissions:
  contents: read
```

`contract` runs the nested Node test. `production-browser` runs only on manual dispatch, checks `QEO171_TEST_EMAIL`/`QEO171_TEST_PASSWORD`, installs Chromium, sets `QEO172_BENCHMARK_MODE`, runs the Playwright spec, and uploads JSON + Playwright evidence for one day.

- [ ] **Step 9: Verify the instrumentation-only head**

Run:

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec eslint modules/market/chart-data/performance.ts modules/market/chart-data/service.ts modules/market/chart-data/timeframe-service.ts app/api/market/ohlcv/route.ts components/stock-detail/stock-tradingview-chart.tsx tests/browser/qeo172-chart-performance-production.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Expected: all exit 0.

- [ ] **Step 10: Commit, review, deploy, and freeze baseline before Task 2**

```bash
git add modules/market/chart-data/performance.ts modules/market/chart-data/service.ts modules/market/chart-data/timeframe-service.ts app/api/market/ohlcv/route.ts components/stock-detail/stock-tradingview-chart.tsx tests/qeo172/chart-performance-contract.test.ts tests/browser/qeo172-chart-performance-production.spec.ts .github/workflows/qeo-172.yml
git commit -m "perf(QEO-172): instrument chart latency pipeline"
```

Open a dedicated instrumentation PR. Require focused QEO-172 + repository Verify, review it, merge once, wait for the exact merge SHA on `qeoindex.qeoqeo.com`, dispatch QEO-172 in `baseline` mode, download the artifact, and record p50/p95 + stage breakdown in Linear QEO-172. Behavioral optimization does not begin before this evidence exists.

---

### Task 2: Split stable prior-session history from the current trading-date tail

**Files:**
- Create: `modules/market/chart-data/http-cache-policy.ts`
- Modify: `components/stock-detail/chart/chart-history.ts`
- Modify: `components/stock-detail/chart/use-chart-history.ts`
- Modify: `app/api/market/ohlcv/route.ts`
- Modify: `tests/qeo172/chart-performance-contract.test.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts` only if existing source contracts require alignment.

**Interfaces:**
- Produces `ChartHistorySlices { stableClosed: ChartRangeInput | null; currentDateTail: ChartRangeInput | null }`.
- Produces `planChartHistorySlices(input, now): ChartHistorySlices`.
- Produces `isStableClosedChartRange(input, now): boolean`.
- Produces `peekClosedChartRange(input, now?): ChartHistoryResponse | null`.
- Produces `prefetchStableChartRange(input, signal?, now?): Promise<ChartHistoryResponse | null>`.
- `requestChartRange()` uses browser default cache mode only for stable ranges; `requestFreshChartRange()` remains explicit no-store + L0 bypass.
- Route uses one pure fail-closed helper to choose `private, max-age=600` vs `no-store`.

- [ ] **Step 1: Write RED slice-boundary tests**

Add:

```ts
import {
  planChartHistorySlices,
  isStableClosedChartRange,
} from "../../components/stock-detail/chart/chart-history.ts"

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

test("trading date keeps 09:00 onward fresh even after EOD", () => {
  const now = new Date("2026-09-10T16:00:00+07:00")
  const input = {
    ticker: "VIC",
    timeframe: "1h" as const,
    from: epoch("2026-09-01T09:00:00+07:00"),
    to: epoch("2026-09-10T15:00:00+07:00"),
  }
  const slices = planChartHistorySlices(input, now)
  assert.equal(slices.stableClosed?.to, epoch("2026-09-10T08:59:59+07:00"))
  assert.equal(slices.currentDateTail?.from, epoch("2026-09-10T09:00:00+07:00"))
  assert.equal(slices.currentDateTail?.to, input.to)
})

test("non-trading date permits the bounded request to stay closed", () => {
  const now = new Date("2026-09-12T10:00:00+07:00")
  const input = {
    ticker: "VIC",
    timeframe: "1h" as const,
    from: epoch("2026-09-01T09:00:00+07:00"),
    to: epoch("2026-09-12T09:30:00+07:00"),
  }
  assert.deepEqual(planChartHistorySlices(input, now), {
    stableClosed: input,
    currentDateTail: null,
  })
})

test("future-ending ranges are never stable-cacheable", () => {
  const now = new Date("2026-09-12T10:00:00+07:00")
  const input = {
    ticker: "VIC",
    timeframe: "1h" as const,
    from: epoch("2026-09-01T09:00:00+07:00"),
    to: epoch("2026-09-12T11:00:00+07:00"),
  }
  assert.equal(isStableClosedChartRange(input, now), false)
})

test("completed Daily does not get an intraday current-date tail", () => {
  const now = new Date("2026-09-10T10:30:00+07:00")
  const input = { ticker: "VIC", timeframe: "1D" as const, from: 1, to: epoch("2026-09-10T10:30:00+07:00") }
  assert.deepEqual(planChartHistorySlices(input, now), { stableClosed: input, currentDateTail: null })
})
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
```

Expected: FAIL because the stable/current-date planner does not exist.

- [ ] **Step 3: Implement the pure stable/current-date planner**

Use the existing Vietnam calendar/date helpers. On a Vietnam trading date and lower/hourly timeframe, compute:

```text
stable boundary = current trading date 08:59:59+07:00
current-date start = current trading date 09:00:00+07:00
```

Intersect both slices with the already bounded input; return `null` for empty intersections. On non-trading dates, return the whole input as `stableClosed`. For `>=1D`, return the whole input as `stableClosed` because completed Daily is already the canonical completed-session path.

`isStableClosedChartRange()` must also reject `input.to > floor(now/1000)`.

- [ ] **Step 4: Write RED transport/cache-admission tests**

With fake responses/fetches prove:

```ts
stable complete request -> fetch init cache === "default"
current-date fresh request -> fetch init cache === "no-store"
PARTIAL result -> peekClosedChartRange(...) === null
result with gaps/errors/integrity -> peekClosedChartRange(...) === null
same-day EOD intraday result -> peekClosedChartRange(...) === null
```

- [ ] **Step 5: Implement L0 peek/prefetch + exact transport policy**

Refactor `requestChartRange()` so a normal stable request uses:

```ts
fetch(url, {
  cache: "default",
  headers: { Accept: "application/json" },
  signal,
})
```

Admission to `rememberClosedRange()` now additionally requires `isStableClosedChartRange(input, now)`. `peekClosedChartRange()` calls the same range-covering logic without mutating canonical state. `prefetchStableChartRange()` refuses non-stable input and otherwise calls the same normal request function, preserving in-flight coalescing.

`requestFreshChartRange()` continues to bypass response cache and uses `cache: "no-store"`.

- [ ] **Step 6: Write RED HTTP cache-policy tests**

Create `modules/market/chart-data/http-cache-policy.ts` with a pure exported contract to be implemented. Add tests:

```ts
safe stable CLOSED+COMPLETE -> { cacheControl: "private, max-age=600", vary: "Cookie" }
PARTIAL -> no-store
errors/gaps/integrity -> no-store
trading-date 09:00+ range after EOD -> no-store
prior-session-only range during MORNING -> private max-age=600
future-ending range -> no-store
```

- [ ] **Step 7: Implement the route policy fail-closed**

The route must decide cacheability from actual `ChartOhlcvResult`, requested range and `new Date()` using the same stable boundary semantics. Successful unsafe/current-date responses and all error responses remain no-store.

Do not introduce Vercel shared/Redis OHLCV caching in QEO-172.

- [ ] **Step 8: Update `useChartHistory()` to fetch stable + fresh slices independently**

Initial lower/hourly load:

```ts
const fullRange = initialChartHistoryRange(timeframe, to)
const slices = planChartHistorySlices({ ticker, timeframe, ...fullRange }, now)

const [stableResult, tailResult] = await Promise.all([
  slices.stableClosed ? requestChartRange(slices.stableClosed, controller.signal) : Promise.resolve(null),
  slices.currentDateTail ? requestFreshChartRange(slices.currentDateTail, controller.signal) : Promise.resolve(null),
])
```

Merge both by timestamp. Coverage is complete only when every requested slice is complete. Provider/stale state comes from the fresh tail when present.

Replace the existing 12-hour live-refresh lower bound with current trading-date `09:00 ICT`; do not request overnight/lunch as a wall-clock gap.

- [ ] **Step 9: Run focused correctness verification**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec tsx --test tests/stock-tradingview-chart-v2.test.ts
pnpm exec tsc --noEmit
pnpm build
```

Expected: all exit 0. If touched server logic causes a related chart-data regression suite to run, it must also pass before commit.

- [ ] **Step 10: Commit, review, deploy and remeasure**

```bash
git add modules/market/chart-data/http-cache-policy.ts components/stock-detail/chart/chart-history.ts components/stock-detail/chart/use-chart-history.ts app/api/market/ohlcv/route.ts tests/qeo172/chart-performance-contract.test.ts tests/stock-tradingview-chart-v2.test.ts
git commit -m "perf(QEO-172): split stable history from current-date tail"
```

After review/merge/deploy, rerun the exact benchmark matrix. Verify same-day tail remains fresh/no-store, stable repeat requests avoid provider work, and no canonical-bar or QEO-171 regression appears.

---

### Task 3: Prepare full initial datasets and make timeframe transitions atomic

**Files:**
- Modify: `components/stock-detail/chart/chart-history.ts`
- Modify: `components/stock-detail/chart/use-chart-history.ts`
- Modify: `components/stock-detail/stock-tradingview-chart-data.tsx`
- Modify: `tests/qeo172/chart-performance-contract.test.ts`
- Modify: `tests/browser/qeo172-chart-performance-production.spec.ts`

**Interfaces:**
- Produces `PreparedChartHistory { ticker; timeframe; range; result }`.
- Produces `prepareInitialChartHistory({ ticker, timeframe, now?, signal? }): Promise<PreparedChartHistory>`.
- `useChartHistory({ ..., preparedInitial? })` can consume a one-shot exact prepared dataset without repeating the initial request.
- `StockTradingViewChartData` separates `requestedTimeframe` from `committedTimeframe` and commits only a fully prepared target.

- [ ] **Step 1: Write RED preparation tests**

Use fake fetches to prove `prepareInitialChartHistory()`:

```text
live trading date -> one stable request with cache=default + one current-date request with cache=no-store
EOD same trading date -> same split; current-date tail remains no-store
non-trading date -> one stable request only
result bars -> merged and sorted by timestamp with current-date timestamp winning duplicates
```

Also prove an error in either required slice rejects preparation rather than returning a mislabeled partial target.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
```

Expected: FAIL because `prepareInitialChartHistory()` is missing.

- [ ] **Step 3: Implement `PreparedChartHistory` and preparation**

In `chart-history.ts`:

```ts
export interface PreparedChartHistory {
  ticker: string
  timeframe: ChartTimeframe
  range: { from: number; to: number }
  result: ChartHistoryResponse
}
```

`prepareInitialChartHistory()` computes `initialChartHistoryRange()`, calls `planChartHistorySlices()`, requests the stable slice normally and current-date tail fresh, then merges bars/coverage/gaps/integrity/errors/metadata without changing canonical values. It returns only when all required requests have completed.

For `1D`, if the caller already has usable seed Daily bars, the wrapper may skip network preparation and commit immediately.

- [ ] **Step 4: Teach `useChartHistory()` to consume an exact prepared handoff**

Add `preparedInitial?: PreparedChartHistory | null`. On reset:

- accept it only when ticker + timeframe + initial range match the hook's current intent;
- synchronously seed bars/coverage/live metadata from it;
- do not issue the duplicate initial fetch;
- continue normal older-history hydration and later fresh-tail refreshes.

The prepared object is not stored in a second module cache.

- [ ] **Step 5: Write RED staged-timeframe source/browser contracts**

Assert distinct requested/committed timeframe state. In Playwright, delay the target timeframe response and prove:

```text
old rendered key stays visible while target prepares
old key never becomes empty
target label does not appear over old data
after preparation: target label + target rendered key change together
```

- [ ] **Step 6: Implement staged timeframe commit**

In `StockTradingViewChartData`:

- keep `committedTimeframe` as the value passed to `HistoryBoundChart`;
- on target request, abort older preparation and increment a generation token;
- keep the committed chart rendered;
- `1D` with usable `seedDailyBars` commits immediately;
- other timeframes call `prepareInitialChartHistory()`;
- commit `committedTimeframe` + one-shot `preparedInitial` only if the preparation still matches the latest generation;
- if preparation fails, retain old chart/timeframe and expose the transition error/loading affordance.

- [ ] **Step 7: Verify and commit**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec tsx --test tests/stock-tradingview-chart-v2.test.ts
pnpm exec eslint components/stock-detail/chart/chart-history.ts components/stock-detail/chart/use-chart-history.ts components/stock-detail/stock-tradingview-chart-data.tsx tests/browser/qeo172-chart-performance-production.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Commit:

```bash
git add components/stock-detail/chart/chart-history.ts components/stock-detail/chart/use-chart-history.ts components/stock-detail/stock-tradingview-chart-data.tsx tests/qeo172/chart-performance-contract.test.ts tests/browser/qeo172-chart-performance-production.spec.ts
git commit -m "perf(QEO-172): stage complete timeframe datasets"
```

---

### Task 4: Prefetch adjacent stable data and atomically commit ticker navigation

**Files:**
- Modify: `components/stock-detail/stock-detail-workstation.tsx`
- Modify: `components/stock-detail/stock-tradingview-chart-data.tsx` only if a small prepared-handoff prop is needed.
- Modify: `components/stock-detail/chart/chart-history.ts`
- Modify: `tests/qeo172/chart-performance-contract.test.ts`
- Modify: `tests/browser/qeo172-chart-performance-production.spec.ts`

**Interfaces:**
- Produces `adjacentPrefetchTargets(order, active): string[]`, no wrap, max two.
- Produces workstation-local stock-detail request dedupe and `prefetchTickerTarget(ticker, timeframe, signal)`.
- Background prefetch warms stock-detail + stable closed chart only.
- Actual ticker navigation calls full `prepareInitialChartHistory()` so current-date tail is fresh before atomic commit.

- [ ] **Step 1: Write RED bounded-adjacent tests**

```ts
assert.deepEqual(adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "VIC"), ["VCB", "VHM"])
assert.deepEqual(adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "VCB"), ["VIC"])
assert.deepEqual(adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "VHM"), ["VIC"])
```

No wrap, no duplicates, maximum two.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
```

Expected: FAIL until bounded prefetch intent exists.

- [ ] **Step 3: Refactor stock-detail loading into one deduped helper**

In `StockDetailWorkstation`, keep `cacheRef` and add an exact-ticker `Map<string, Promise<StockDetailData>>` for in-flight requests. `loadStockDetailIntoCache(sym, signal?)` must:

- return cached data immediately when present;
- reuse the same pending promise for the same ticker;
- call `/api/insights/stock-detail?ticker=...` only once;
- remove the promise from the map in `finally`;
- never mutate active ticker/current data on prefetch.

- [ ] **Step 4: Schedule previous/next prefetch at low priority**

After active ticker + active timeframe + visible watchlist order settle, schedule only `adjacentPrefetchTargets()`:

```ts
if ("requestIdleCallback" in window) {
  const id = window.requestIdleCallback(runPrefetch, { timeout: 600 })
  return () => window.cancelIdleCallback(id)
}
const id = window.setTimeout(runPrefetch, 250)
return () => window.clearTimeout(id)
```

Abort obsolete in-flight prefetch if ticker/timeframe/watchlist intent changes.

- [ ] **Step 5: Warm stock-detail plus stable chart slice only**

For each target:

```ts
await Promise.allSettled([
  loadStockDetailIntoCache(target, signal),
  prefetchInitialStableChartHistory({
    ticker: target,
    timeframe: currentChartTimeframeRef.current,
    signal,
  }),
])
```

`prefetchInitialStableChartHistory()` computes the target initial range and calls `prefetchStableChartRange()` only for `stableClosed`; it must not call `requestFreshChartRange()`.

- [ ] **Step 6: Make actual ticker navigation prepare the full target before commit**

On select/Arrow navigation:

1. record target intent and show transition affordance;
2. resolve target stock-detail data;
3. for lower/hourly timeframe call `prepareInitialChartHistory()`; the prefetched stable slice should hit L0/browser cache while current-date tail is fetched fresh;
4. only after both succeed, atomically set `currentData`, committed target ticker and prepared chart handoff;
5. then update target URL/title if not already updated, or restore them on failure if intent was optimistically reflected;
6. on failure, keep previous committed chart/ticker visible and surface an explicit transition failure rather than mismatching label/data.

For `1D`, usable target `data.bars` can satisfy chart preparation immediately.

- [ ] **Step 7: Prove no drawing leakage and no duplicate warmed request**

Extend Playwright:

1. create/persist a VIC drawing;
2. allow adjacent VCB stable prefetch to finish;
3. navigate to VCB;
4. assert VCB drawings remain empty;
5. assert navigation did not issue a duplicate stable closed OHLCV request for the exact prefetched range; a fresh current-date request is allowed;
6. navigate back to VIC and verify the VIC drawing persists.

- [ ] **Step 8: Verify and commit**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec tsx --test tests/stock-tradingview-chart-v2.test.ts
pnpm exec eslint components/stock-detail/stock-detail-workstation.tsx components/stock-detail/stock-tradingview-chart-data.tsx components/stock-detail/chart/chart-history.ts tests/browser/qeo172-chart-performance-production.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Commit:

```bash
git add components/stock-detail/stock-detail-workstation.tsx components/stock-detail/stock-tradingview-chart-data.tsx components/stock-detail/chart/chart-history.ts tests/qeo172/chart-performance-contract.test.ts tests/browser/qeo172-chart-performance-production.spec.ts
git commit -m "perf(QEO-172): prefetch adjacent stable chart targets"
```

---

### Task 5: Production before/after acceptance and closeout

**Files:**
- Modify: `tests/browser/qeo172-chart-performance-production.spec.ts`
- Modify: `docs/chart-performance-budget.md`
- Modify: `docs/chart-data.md` only if transport documentation still describes one unsplit initial request.
- No runtime code unless the benchmark reproduces a defect.

**Interfaces:**
- `QEO172_BENCHMARK_MODE=baseline|acceptance` uses the exact same matrix and sample logic.
- Acceptance mode enforces the frozen targets only after the before artifact exists.

- [ ] **Step 1: Freeze acceptance assertions before the optimized run**

Acceptance mode enforces:

```text
uncached initial usable chart p95 <= 2500 ms
warm stable-closed timeframe switch p50 <= 150 ms, p95 <= 500 ms
prefetched adjacent ticker switch including fresh current-date tail p50 <= 300 ms, p95 <= 800 ms
render-after-full-prepared-data p95 <= 200 ms
current-date tail refresh p95 <= 2000 ms
repeat L0-covered stable range => zero duplicate network request, <= 50 ms local resolution
lower/mid-term initial payload <= 2 MiB
```

Targets may only be revised from instrumentation-only baseline evidence **before Tasks 2-4 begin**. Do not loosen them after observing the optimized result.

- [ ] **Step 2: Run the full QEO-171 interaction regression on the candidate**

Rerun the authenticated QEO-171 matrix. Require 1/1 PASS on drawings, keyboard guards, global-vs-ticker settings, MACD/POC/crosshair semantics, canonical candle parity, hydration retry and viewport/timeframe drawing stability.

- [ ] **Step 3: Merge/deploy the exact reviewed QEO-172 candidate once**

Use Git merge + Vercel Git Integration only. Wait until `qeoindex.qeoqeo.com` serves the exact merge SHA and deployment state is READY.

- [ ] **Step 4: Run QEO-172 production benchmark in acceptance mode**

Dispatch `.github/workflows/qeo-172.yml` with `benchmark_mode=acceptance`. Download `qeo172-performance.json` and verify for VIC/VCB × `1D/4h/1h/15m`:

- raw sample count >= 10 after warm-up;
- p50/p95 calculation matches raw samples;
- repeat stable closed ranges do not trigger provider recovery;
- current-date tail requests remain no-store;
- warmed adjacent navigation does not start a duplicate stable request;
- ticker/timeframe label never gets ahead of the full prepared dataset;
- payload budgets hold.

- [ ] **Step 5: Inspect Vercel errors and provider activity for the exact benchmark window**

Fail acceptance on any new 5xx/error/fatal cluster attributable to the chart change, or repeated provider recovery for a stable range already proven complete/cacheable.

- [ ] **Step 6: Document the before/after measurements**

Append `QEO-172 production acceptance — 2026-09-10` to `docs/chart-performance-budget.md` with:

- baseline deployment SHA + workflow/artifact ID;
- accepted deployment SHA + workflow/artifact ID;
- before/after API total and browser p50/p95 table;
- representative stage breakdown for `daily-db`, `hot-db`, `derived-cache`, `cold-object`, `provider-fetch`, `aggregation`, `serialization`;
- stable cache hit/network behavior;
- explicit note that same-day current-date tail remains no-store even after EOD;
- any residual bottleneck delegated to a named issue rather than hidden.

Update `docs/chart-data.md` only if needed to show `stable prior-session slice + fresh current trading-date tail` while keeping canonical source claims unchanged.

- [ ] **Step 7: Run fresh final verification on the exact head**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec tsx --test tests/stock-tradingview-chart-v2.test.ts
pnpm exec eslint modules/market/chart-data components/stock-detail app/api/market/ohlcv tests/browser/qeo172-chart-performance-production.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Also require repository full Verify, focused QEO-172 and authenticated QEO-171 workflows to pass.

- [ ] **Step 8: Reconcile Linear only after production evidence is complete**

Tick QEO-172 acceptance criteria with exact deployment/workflow evidence. Then update QEO-168:

```text
[X] Chart ticker/timeframe navigation meets agreed p50/p95 latency targets and avoids unnecessary provider fetches for closed history.
```

If any target misses, keep QEO-172 `In Progress` and open/reopen the measured owner issue; do not weaken the target after the fact. QEO-173 remains blocked until this gate is genuinely complete.

- [ ] **Step 9: Commit documentation closeout if required**

```bash
git add docs/chart-performance-budget.md docs/chart-data.md
git commit -m "docs(QEO-172): record production performance acceptance"
```

No completion claim until post-deploy production benchmark, QEO-171 regression, final Verify workflows and Linear readback all confirm the same accepted state.