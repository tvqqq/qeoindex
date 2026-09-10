# QEO-172 Chart Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Stock Detail chart ticker/timeframe perceived latency by measuring the real pipeline, caching only validated closed history, independently refreshing the current-session tail, prefetching only adjacent watchlist intent, and atomically swapping ready datasets without weakening canonical data correctness.

**Architecture:** Keep QEO-97's bounded per-tab cache and QEO-147/QEO-148/QEO-149/QEO-150 source-of-truth rules. Add request-scoped server timing, split intraday/hourly initial loads into prior-session closed history plus current-session fresh tail, permit browser-private caching only for verified closed responses, then prewarm the exact current timeframe for adjacent tickers and commit ticker/timeframe changes only after the replacement closed dataset is ready.

**Tech Stack:** Next.js 16.3 route handlers, React 19, Lightweight Charts v5, Supabase/PostgreSQL + private COLD object storage, Vercel Runtime, Playwright 1.63, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-qeo-172-chart-performance-design.md`

## Global Constraints

- No synthetic OHLCV.
- Raw `1m` and canonical completed Daily remain the source-of-truth inputs.
- Do not bypass QEO-147 derived-hourly readiness proof.
- Do not cache PARTIAL/gap/integrity/provider/storage-error responses.
- Do not cache the mutable current trading-session tail as immutable history.
- Do not prefetch more than previous + next visible watchlist ticker.
- Do not copy drawings, ticker-scoped objects or absolute price ranges across symbols.
- QEO-97 history horizons remain unchanged: `<1h <= 31d`, `1h/2h/4h <= 366d`, `>=1D` full canonical Daily.
- Client closed-range cache remains bounded to 24 entries and 10 minutes.
- No database migration is expected.

---

### Task 1: Instrument the pipeline and capture an instrumentation-only production baseline

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
- Produces `createChartPerformanceRecorder(): ChartPerformanceRecorder` with `measure()`, `measureSync()` and `snapshot()`.
- Extends `ChartDataServiceDeps` with optional `performance?: ChartPerformanceRecorder`.
- `Server-Timing` keeps `chart-data` and adds non-zero stage values plus `serialization`.
- Chart runtime writes `data-chart-rendered-key="<TICKER>:<TIMEFRAME>:<BAR_COUNT>:<LAST_BAR_TIME>"` only after series data has been applied.
- Browser benchmark writes a machine-readable `test-results/qeo172-performance.json` artifact.

- [ ] **Step 1: Write the failing timing-recorder contract**

Add to `tests/qeo172/chart-performance-contract.test.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"

import {
  createChartPerformanceRecorder,
  type ChartPerfStage,
} from "../../modules/market/chart-data/performance.ts"

const REQUIRED_STAGES: ChartPerfStage[] = [
  "daily-db",
  "hot-db",
  "derived-cache",
  "cold-object",
  "provider-fetch",
  "aggregation",
]

test("QEO-172 performance recorder accumulates repeated stage duration and count", async () => {
  let now = 0
  const recorder = createChartPerformanceRecorder(() => now)

  await recorder.measure("hot-db", async () => {
    now += 7
  })
  await recorder.measure("hot-db", async () => {
    now += 5
  })
  recorder.measureSync("aggregation", () => {
    now += 3
  })

  const snapshot = recorder.snapshot()
  assert.deepEqual(snapshot["hot-db"], { durationMs: 12, count: 2 })
  assert.deepEqual(snapshot.aggregation, { durationMs: 3, count: 1 })
  for (const stage of REQUIRED_STAGES) assert.ok(stage in snapshot)
})
```

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
```

Expected: FAIL because `modules/market/chart-data/performance.ts` does not exist.

- [ ] **Step 3: Implement the minimal recorder**

Create `modules/market/chart-data/performance.ts`:

```ts
import "server-only"

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
  "daily-db",
  "hot-db",
  "derived-cache",
  "cold-object",
  "provider-fetch",
  "aggregation",
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
      try {
        return await work()
      } finally {
        add(stage, now() - startedAt)
      }
    },
    measureSync(stage, work) {
      const startedAt = now()
      try {
        return work()
      } finally {
        add(stage, now() - startedAt)
      }
    },
    snapshot() {
      return Object.fromEntries(
        STAGES.map((stage) => [stage, { ...(values.get(stage) ?? { durationMs: 0, count: 0 }) }]),
      ) as ChartPerfSnapshot
    },
  }
}
```

- [ ] **Step 4: Wire stage timing without changing source-selection semantics**

In `modules/market/chart-data/service.ts`:

```ts
import type { ChartPerformanceRecorder } from "./performance"

export interface ChartDataServiceDeps {
  supabase: SupabaseClient
  coldStorage?: ColdOhlcvStorage
  provider?: ChartOhlcvProvider
  now?: Date
  performance?: ChartPerformanceRecorder
}

async function measured<T>(
  deps: ChartDataServiceDeps,
  stage: Parameters<ChartPerformanceRecorder["measure"]>[0],
  work: () => Promise<T>,
) {
  return deps.performance ? deps.performance.measure(stage, work) : work()
}
```

Wrap only existing operations; do not reorder them:

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

Wrap provider calls in `fetchClosedProviderValue()` and live-tail fetches with `provider-fetch`; wrap canonical normalization/aggregation only where actual timeframe aggregation occurs with `aggregation`. Keep all current exceptions and fallback branches unchanged.

In `modules/market/chart-data/timeframe-service.ts`, time `derivedCoverage`, `sourceCoverage`, `loadDerived`, COLD overlap reads and every `aggregateChartTimeframe()` call using the same recorder from `deps.performance`.

- [ ] **Step 5: Add route timing and serialization timing**

In `app/api/market/ohlcv/route.ts` create the recorder per request and pass it to `getChartOhlcv`:

```ts
const recorder = createChartPerformanceRecorder()
const result = await getChartOhlcv({ supabase, performance: recorder }, { ticker, resolution, from, to })
```

Replace the current `measuredJson()` implementation with one that times serialization and renders a `Server-Timing` header such as:

```text
chart-data;dur=123.4, daily-db;dur=18.2, derived-cache;dur=9.1, aggregation;dur=2.8, serialization;dur=1.4
```

Do not emit stages with `count=0`. Preserve `X-Chart-Bar-Count` and `X-Chart-Payload-Bytes`.

- [ ] **Step 6: Add deterministic render-ready semantics**

After `StockTradingViewChart` applies the latest series data, write directly to the chart host DOM node:

```ts
const lastTime = displayBars.at(-1)?.time ?? 0
chartHostRef.current?.setAttribute(
  "data-chart-rendered-key",
  `${ticker.toUpperCase()}:${timeframe}:${displayBars.length}:${lastTime}`,
)
```

Do this after `setData()`/`update()` work, not during React render.

- [ ] **Step 7: Write the authenticated production benchmark**

Create `tests/browser/qeo172-chart-performance-production.spec.ts` using the existing QEO-171 QA credentials and login flow. The test must:

```ts
const MATRIX = [
  ["VIC", "1D"], ["VIC", "4h"], ["VIC", "1h"], ["VIC", "15m"],
  ["VCB", "1D"], ["VCB", "4h"], ["VCB", "1h"], ["VCB", "15m"],
] as const
const SAMPLES = 10
```

For direct API samples, read `Server-Timing`, `X-Chart-Bar-Count`, `X-Chart-Payload-Bytes` and wall-clock duration. For browser samples, record `performance.now()` immediately before the user interaction and stop when `data-chart-rendered-key` changes to the target ticker/timeframe. Run one warm-up before collecting 10 warm samples.

Write JSON with exact raw samples plus calculated p50/p95. Use a deterministic percentile helper:

```ts
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}
```

The instrumentation-only benchmark must not assert the new QEO-172 optimization targets yet; it records the baseline.

- [ ] **Step 8: Add a focused QEO-172 workflow**

Create `.github/workflows/qeo-172.yml` with:

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

permissions:
  contents: read
```

`contract` runs the nested QEO-172 Node test. `production-browser` is manual or explicitly gated so PR instrumentation can be deployed before the baseline run; it uses `QEO171_TEST_EMAIL`/`QEO171_TEST_PASSWORD`, installs Chromium, runs the production spec, and uploads `test-results/qeo172-performance.json` plus Playwright report for one day.

- [ ] **Step 9: Run GREEN verification for the instrumentation-only change**

Run locally/CI:

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec eslint modules/market/chart-data/performance.ts modules/market/chart-data/service.ts modules/market/chart-data/timeframe-service.ts app/api/market/ohlcv/route.ts components/stock-detail/stock-tradingview-chart.tsx tests/browser/qeo172-chart-performance-production.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Expected: all exit 0.

- [ ] **Step 10: Commit, review, deploy, and capture baseline before behavior changes**

```bash
git add modules/market/chart-data/performance.ts modules/market/chart-data/service.ts modules/market/chart-data/timeframe-service.ts app/api/market/ohlcv/route.ts components/stock-detail/stock-tradingview-chart.tsx tests/qeo172/chart-performance-contract.test.ts tests/browser/qeo172-chart-performance-production.spec.ts .github/workflows/qeo-172.yml
git commit -m "perf(QEO-172): instrument chart latency pipeline"
```

Open/review/merge the instrumentation-only PR. Wait for the exact merge SHA on `qeoindex.qeoqeo.com`, manually dispatch QEO-172 production-browser, download the JSON artifact, and record the baseline p50/p95 + stage breakdown in QEO-172 before Task 2 starts.

---

### Task 2: Split stable closed history from the mutable current-session tail and enable safe browser-private reuse

**Files:**
- Modify: `components/stock-detail/chart/chart-history.ts`
- Modify: `components/stock-detail/chart/use-chart-history.ts`
- Modify: `app/api/market/ohlcv/route.ts`
- Modify: `tests/qeo172/chart-performance-contract.test.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts` only if an existing source contract requires alignment.

**Interfaces:**
- Produces `ChartHistorySlices { closed: ChartRangeInput | null; currentSession: ChartRangeInput | null }`.
- Produces `planChartHistorySlices(input, now): ChartHistorySlices`.
- Produces `peekClosedChartRange(input): ChartHistoryResponse | null`.
- Produces `prefetchClosedChartRange(input, signal?): Promise<ChartHistoryResponse | null>`.
- `requestChartRange()` uses browser default caching; `requestFreshChartRange()` remains `no-store` and bypasses L0 response cache.
- Route response cache policy is decided from actual result + requested time range; unsafe/partial/live remains no-store.

- [ ] **Step 1: Write RED range-slice tests**

Add deterministic cases to `tests/qeo172/chart-performance-contract.test.ts`:

```ts
import { planChartHistorySlices } from "../../components/stock-detail/chart/chart-history.ts"

test("live trading day splits prior sessions from current-session tail", () => {
  const now = new Date("2026-09-10T10:30:00+07:00")
  const from = Math.floor(Date.parse("2026-09-01T09:00:00+07:00") / 1000)
  const to = Math.floor(now.getTime() / 1000)
  const slices = planChartHistorySlices({ ticker: "VIC", timeframe: "1h", from, to }, now)
  assert.equal(slices.closed?.to, Math.floor(Date.parse("2026-09-10T08:59:59+07:00") / 1000))
  assert.equal(slices.currentSession?.from, Math.floor(Date.parse("2026-09-10T09:00:00+07:00") / 1000))
  assert.equal(slices.currentSession?.to, to)
})

test("EOD closed request remains one closed slice", () => {
  const now = new Date("2026-09-10T16:00:00+07:00")
  const input = { ticker: "VIC", timeframe: "1h" as const, from: 1_789_000_000, to: 1_789_100_000 }
  const slices = planChartHistorySlices(input, now)
  assert.deepEqual(slices, { closed: input, currentSession: null })
})

test("completed Daily never creates a live tail", () => {
  const now = new Date("2026-09-10T10:30:00+07:00")
  const input = { ticker: "VIC", timeframe: "1D" as const, from: 1, to: Math.floor(now.getTime() / 1000) }
  const slices = planChartHistorySlices(input, now)
  assert.deepEqual(slices, { closed: input, currentSession: null })
})
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
```

Expected: FAIL because `planChartHistorySlices()` is missing.

- [ ] **Step 3: Implement pure slice planning**

In `chart-history.ts`, use `getMarketSessionStatus(now)` and a deterministic Vietnam date key. For phases other than `EOD_CLOSED`, compute `09:00:00+07:00` as the mutable-session start. Only `1m/15m/30m/1h/2h/4h` can produce `currentSession`.

Return `null` for empty slices; never extend beyond the already bounded input range.

- [ ] **Step 4: Write RED cache-transport tests**

Use a fake fetch implementation to prove:

```ts
await requestChartRange(input, undefined, fakeFetch)
assert.equal(lastFetchInit.cache, "default")

await requestFreshChartRange(input, undefined, fakeFetch)
assert.equal(lastFetchInit.cache, "no-store")
```

Also prove `peekClosedChartRange()` returns only an admitted CLOSED/COMPLETE response and returns `null` for PARTIAL/error responses.

- [ ] **Step 5: Implement L0 peek/prefetch and transport policy**

Refactor `requestChartRange()` so the normal closed path sends:

```ts
fetch(url, {
  cache: "default",
  headers: { Accept: "application/json" },
  signal,
})
```

Keep `requestFreshChartRange()` as an explicit `bypassCache: true` + `cache: "no-store"` path. `prefetchClosedChartRange()` must call the same normal request function so prefetch and later navigation share both in-flight promises and admitted cache entries.

- [ ] **Step 6: Write RED route cache-policy tests**

Extract a pure helper from the route or a small server-only sibling such as `modules/market/chart-data/http-cache-policy.ts` if that makes the test cleaner. Prove:

```ts
safe complete closed result -> "private, max-age=600"
PARTIAL -> "no-store"
errors/gaps/integrity -> "no-store"
request overlaps current trading date before EOD -> "no-store"
EOD completed range -> cacheable
prior-session-only range during MORNING -> cacheable
```

- [ ] **Step 7: Implement fail-closed private cache headers**

Use actual response/result state plus `request.to` and current Vietnam session phase. Add `Vary: Cookie` only to cacheable private responses. Keep all errors as no-store.

Do not use Vercel shared/Redis cache for OHLCV in this task.

- [ ] **Step 8: Update `useChartHistory()` to load slices**

Initial load algorithm:

```ts
const fullRange = initialChartHistoryRange(timeframe, to)
const slices = planChartHistorySlices({ ticker, timeframe, ...fullRange }, now)

const closedPromise = slices.closed
  ? requestChartRange(slices.closed, controller.signal)
  : Promise.resolve(null)
const currentPromise = slices.currentSession
  ? requestFreshChartRange(slices.currentSession, controller.signal)
  : Promise.resolve(null)

const [closedResult, currentResult] = await Promise.all([closedPromise, currentPromise])
```

Merge bars by timestamp. Coverage is complete only when every requested slice is complete. Provider/stale state comes from the mutable slice when present. Keep existing 5-second refresh but constrain its fresh range to the current trading session start instead of the previous 12 wall-clock hours.

- [ ] **Step 9: Verify regression and cache semantics**

Run:

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec tsx --test tests/stock-tradingview-chart-v2.test.ts
pnpm exec tsc --noEmit
pnpm build
```

Expected: all pass. Add focused existing chart-data tests if route/service semantics require them.

- [ ] **Step 10: Commit and review**

```bash
git add components/stock-detail/chart/chart-history.ts components/stock-detail/chart/use-chart-history.ts app/api/market/ohlcv/route.ts tests/qeo172/chart-performance-contract.test.ts tests/stock-tradingview-chart-v2.test.ts
git commit -m "perf(QEO-172): split closed history from live tail"
```

After merge/deploy, rerun the same QEO-172 production benchmark and confirm repeat closed scenarios no longer generate provider work and browser cache/network counts improve without changing canonical bars.

---

### Task 3: Make timeframe changes atomic and non-blank

**Files:**
- Modify: `components/stock-detail/stock-tradingview-chart-data.tsx`
- Modify: `components/stock-detail/chart/chart-history.ts`
- Modify: `tests/qeo172/chart-performance-contract.test.ts`
- Modify: `tests/browser/qeo172-chart-performance-production.spec.ts`

**Interfaces:**
- Produces `prefetchInitialChartHistory({ ticker, timeframe, now?, signal? })` which prefetches only the stable closed slice and returns the admitted response or `null`.
- `StockTradingViewChartData` separates `requestedTimeframe` and `committedTimeframe`.
- The rendered chart keeps the committed timeframe until the requested timeframe's closed dataset is ready.

- [ ] **Step 1: Write RED source/behavior contracts**

Assert that the wrapper contains distinct requested/committed states and that timeframe events call `prefetchInitialChartHistory()` before committing the new timeframe. Add a browser assertion that, during an intentionally delayed timeframe request, the old `data-chart-rendered-key` remains present until the new key appears; it must never become empty.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
```

Expected: FAIL because atomic timeframe staging does not exist.

- [ ] **Step 3: Implement `prefetchInitialChartHistory()`**

In `chart-history.ts`:

```ts
export async function prefetchInitialChartHistory(input: {
  ticker: string
  timeframe: ChartTimeframe
  now?: Date
  signal?: AbortSignal
}) {
  const now = input.now ?? new Date()
  const to = Math.floor(now.getTime() / 1000)
  const range = initialChartHistoryRange(input.timeframe, to)
  const slices = planChartHistorySlices({
    ticker: input.ticker,
    timeframe: input.timeframe,
    ...range,
  }, now)
  return slices.closed
    ? prefetchClosedChartRange(slices.closed, input.signal)
    : null
}
```

- [ ] **Step 4: Implement staged timeframe commit**

In `StockTradingViewChartData`:

- keep `committedTimeframe` as the prop passed to `HistoryBoundChart`;
- on timeframe request, increment a generation token and create an AbortController;
- prefetch the target closed slice;
- if still current, set `committedTimeframe(target)` and notify `onTimeframeChange(target)`;
- if prefetch fails, keep the previous committed chart and surface a small transition error/loading affordance; do not relabel old bars;
- abort obsolete timeframe prefetch on ticker change/new request.

For `1D`, existing `seedDailyBars` is already a usable dataset, so commit may happen immediately.

- [ ] **Step 5: Make `useChartHistory()` synchronously seed from L0**

On hook initialization/reset, call `peekClosedChartRange()` for the planned closed slice. If a prefetch result exists, use its bars immediately before the effect runs. Merge the mutable tail after commit. Do not use a cached response that fails the existing admission rules.

- [ ] **Step 6: Verify atomic transition behavior**

Run focused unit/source contracts and Playwright against a preview/local deterministic delayed route fixture if one already exists. The invariant is:

```text
old rendered key -> loading overlay while old chart remains -> new rendered key
```

Never:

```text
old rendered key -> empty chart -> new rendered key
```

- [ ] **Step 7: Run full verification and commit**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec tsx --test tests/stock-tradingview-chart-v2.test.ts
pnpm exec eslint components/stock-detail/stock-tradingview-chart-data.tsx components/stock-detail/chart/chart-history.ts tests/browser/qeo172-chart-performance-production.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Commit:

```bash
git add components/stock-detail/stock-tradingview-chart-data.tsx components/stock-detail/chart/chart-history.ts tests/qeo172/chart-performance-contract.test.ts tests/browser/qeo172-chart-performance-production.spec.ts
git commit -m "perf(QEO-172): stage timeframe chart swaps"
```

---

### Task 4: Prefetch previous/next watchlist ticker and atomically commit ticker navigation

**Files:**
- Modify: `components/stock-detail/stock-detail-workstation.tsx`
- Modify: `components/stock-detail/stock-tradingview-chart-data.tsx` only if a small readiness callback is required.
- Modify: `tests/qeo172/chart-performance-contract.test.ts`
- Modify: `tests/browser/qeo172-chart-performance-production.spec.ts`

**Interfaces:**
- Produces a workstation-local `prefetchTickerTarget(ticker, timeframe, signal)` that warms stock-detail data and the chart's closed slice.
- Prefetch set is exactly the previous and next ticker returned from the current `visibleWatchlistTickersRef` order.
- Ticker commit occurs after target detail + target closed chart prefetch are ready; obsolete requests are aborted/generation-guarded.

- [ ] **Step 1: Write RED bounded-prefetch tests**

Add a pure helper or source contract proving:

```ts
adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "VIC")
// => ["VCB", "VHM"]

adjacentPrefetchTargets(["VCB", "VIC", "VHM"], "VCB")
// => ["VIC"]
```

No wrap and no more than two results.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
```

Expected: FAIL until adjacent prefetch intent exists.

- [ ] **Step 3: Implement low-priority prefetch scheduling**

After `currentData.ticker`, current timeframe and visible watchlist order settle:

```ts
const schedule = window.requestIdleCallback
  ? window.requestIdleCallback(callback, { timeout: 600 })
  : window.setTimeout(callback, 250)
```

Prefetch only previous/next. Abort scheduled/in-flight prefetch when active ticker, timeframe or visible watchlist intent changes.

- [ ] **Step 4: Warm both stock-detail and chart caches**

For each target, start in parallel:

```ts
const detailPromise = loadStockDetailIntoCache(target, signal)
const chartPromise = prefetchInitialChartHistory({
  ticker: target,
  timeframe: currentChartTimeframeRef.current,
  signal,
})
await Promise.allSettled([detailPromise, chartPromise])
```

`loadStockDetailIntoCache()` must reuse `cacheRef` and dedupe concurrent same-ticker requests; do not create a second permanent cache object.

- [ ] **Step 5: Make target selection atomic**

Refactor `handleSelectTicker()` so it does not immediately replace `currentData`. It may update URL intent and show the transition affordance, but commits `setCurrentData(targetData)` only after:

- target stock-detail data exists; and
- target closed chart prefetch has either completed successfully or target timeframe is `1D` with usable `targetData.bars`.

If the closed chart prefetch fails for a lower timeframe, keep the previous committed ticker/chart and expose the existing error path. Do not show target ticker labels over previous ticker bars.

- [ ] **Step 6: Prove no drawing leakage**

Extend the browser benchmark/regression flow:

1. create a VIC drawing;
2. allow VCB adjacent prefetch to complete;
3. navigate to VCB;
4. assert VCB drawing list remains empty;
5. navigate back to VIC;
6. assert VIC drawing is still present.

This guards against accidentally prefetching or copying ticker-scoped settings.

- [ ] **Step 7: Prove prefetch actually reduces navigation network work**

In Playwright, count `/api/market/ohlcv` and `/api/insights/stock-detail` requests around a warmed previous/next navigation. After the prefetch has completed, the actual navigation interaction must not start a duplicate closed-history request for the same target/range; mutable tail requests are allowed.

- [ ] **Step 8: Verify and commit**

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec tsx --test tests/stock-tradingview-chart-v2.test.ts
pnpm exec eslint components/stock-detail/stock-detail-workstation.tsx components/stock-detail/stock-tradingview-chart-data.tsx tests/browser/qeo172-chart-performance-production.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Commit:

```bash
git add components/stock-detail/stock-detail-workstation.tsx components/stock-detail/stock-tradingview-chart-data.tsx tests/qeo172/chart-performance-contract.test.ts tests/browser/qeo172-chart-performance-production.spec.ts
git commit -m "perf(QEO-172): prefetch adjacent chart targets"
```

---

### Task 5: Production before/after benchmark, correctness regression and acceptance closeout

**Files:**
- Modify: `tests/browser/qeo172-chart-performance-production.spec.ts`
- Modify: `docs/chart-performance-budget.md`
- Modify: `docs/chart-data.md` only if the closed/live transport split needs canonical documentation.
- No runtime code unless the benchmark reproduces a defect.

**Interfaces:**
- Benchmark enforces the final QEO-172 targets only in post-optimization mode.
- Produces before/after JSON artifacts with identical ticker/timeframe/sample matrices.

- [ ] **Step 1: Freeze final benchmark mode**

Support an environment variable such as:

```text
QEO172_BENCHMARK_MODE=baseline|acceptance
```

`baseline` records only. `acceptance` asserts:

```text
uncached initial usable chart p95 <= 2500 ms
warm closed timeframe switch p50 <= 150 ms, p95 <= 500 ms
prefetched adjacent ticker switch p50 <= 300 ms, p95 <= 800 ms
render-after-data p50/p95 with p95 <= 200 ms
current-session tail refresh p95 <= 2000 ms
repeat L0-covered closed range => zero duplicate network request, <= 50 ms resolution
payload <= 2 MiB for lower/mid-term initial requests
```

- [ ] **Step 2: Run QEO-171 interaction regression on the candidate**

Before performance signoff, rerun the authenticated QEO-171 matrix to protect drawings, keyboard guards, global/ticker settings, MACD/POC/crosshair semantics and canonical candle parity.

Expected: 1/1 PASS on the exact production candidate.

- [ ] **Step 3: Deploy the exact reviewed QEO-172 candidate once**

Use normal Git merge + Vercel Git Integration. Do not manually duplicate the deployment. Wait until `qeoindex.qeoqeo.com` serves the exact merge SHA and deployment state is READY.

- [ ] **Step 4: Run the acceptance benchmark on production**

Dispatch `.github/workflows/qeo-172.yml` in `acceptance` mode. Download and inspect `qeo172-performance.json`.

For each VIC/VCB × `1D/4h/1h/15m` case, verify:

- raw sample count >= 10 after warm-up;
- p50/p95 calculations match the raw samples;
- no repeat closed-range provider fetch after a validated cache/preload hit;
- current-session tail remains no-store/fresh;
- no target ticker is displayed with previous ticker bars;
- no duplicate closed-history request starts on warmed adjacent navigation.

- [ ] **Step 5: Inspect production errors and provider activity**

Use Vercel runtime logs for the benchmark window. Fail acceptance if a new 5xx/error/fatal cluster or repeated provider recovery appears for a closed range that the benchmark marked complete/cacheable.

- [ ] **Step 6: Update performance documentation with measured evidence**

Append a `QEO-172 production acceptance — 2026-09-10` section to `docs/chart-performance-budget.md` containing:

- baseline deployment SHA + artifact/run ID;
- accepted deployment SHA + artifact/run ID;
- before/after table for API total and browser p50/p95;
- representative stage breakdown (`daily-db`, `hot-db`, `derived-cache`, `cold-object`, `provider-fetch`, `aggregation`, `serialization`);
- observed closed-cache hit/network behavior;
- explicit note that live/current-session tail remains no-store;
- any accepted remaining bottleneck delegated to QEO-173 or another named issue.

If `docs/chart-data.md` currently describes the client history flow as one request, update it to show `closed slice + mutable current-session tail` without changing source-of-truth claims.

- [ ] **Step 7: Run final code/build verification**

Fresh final commands on the exact head:

```bash
pnpm exec tsx --test tests/qeo172/chart-performance-contract.test.ts
pnpm exec tsx --test tests/stock-tradingview-chart-v2.test.ts
pnpm exec eslint modules/market/chart-data components/stock-detail app/api/market/ohlcv tests/browser/qeo172-chart-performance-production.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Also require the repository's normal full Verify workflow and QEO-171/QEO-172 focused workflows to pass.

- [ ] **Step 8: Reconcile Linear only after production evidence is complete**

Update QEO-172 acceptance checkboxes with exact production run/deployment evidence. Update QEO-168:

```text
[X] Chart ticker/timeframe navigation meets agreed p50/p95 latency targets and avoids unnecessary provider fetches for closed history.
```

Keep QEO-173 blocked until this is true. If any target misses, leave QEO-172 In Progress and open/reopen the specific owner issue with the measured failing stage instead of weakening the target after the fact.

- [ ] **Step 9: Final commit for documentation only if needed**

```bash
git add docs/chart-performance-budget.md docs/chart-data.md
git commit -m "docs(QEO-172): record production performance acceptance"
```

No completion claim until the post-deploy production benchmark, QEO-171 regression, final verification workflows and Linear readback all confirm the evidence.