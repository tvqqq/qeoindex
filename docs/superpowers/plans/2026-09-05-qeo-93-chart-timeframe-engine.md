# QEO-93 Chart Timeframe Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic VN-session/calendar-aware chart aggregation for all 12 chart resolutions and progressive pan-left history hydration without synthetic OHLCV or viewport resets.

**Architecture:** Keep QEO-92 canonical raw `1m` and `1D` as the only persistence/provider inputs. Add a pure timeframe engine plus a server wrapper that maps public resolutions to canonical sources, then let one client history hook fetch/merge paged ranges for every chart pane.

**Tech Stack:** Next.js 16.3 App Router, React, TypeScript 5.7, Node test runner, Supabase-backed QEO-92 chart-data service.

**Spec:** `docs/superpowers/specs/2026-09-05-qeo-93-chart-timeframe-engine-design.md`

## Global Constraints

- Supported public resolutions are exactly `1m, 15m, 30m, 1h, 2h, 4h, 1D, 3D, 1W, 1M, 1Q, 1Y`.
- Canonical persistence/provider resolutions remain exactly `1m` and `1D`.
- Derived intraday bars aggregate only from real canonical `1m`.
- `1D` stays canonical Daily.
- `3D` groups actual Daily sessions, not calendar-day triples.
- `1W/1M/1Q/1Y` use Vietnam-local calendar boundaries, never fixed bar counts.
- No aggregation bucket crosses a local trading date or morning/afternoon session boundary.
- Never fabricate/interpolate missing OHLCV.
- Older-history hydration must not reset zoom, scroll offset, crosshair model, or drawing `time + price` anchors.

---

### Task 1: Public resolution contract and pure timeframe engine

**Files:**
- Modify: `modules/market/chart-data/contract.ts`
- Create: `modules/market/chart-data/timeframes.ts`
- Create: `tests/chart-timeframe-engine.test.ts`
- Modify: `tests/test-contracts.json` if this repository manifest requires explicit registration.

**Interfaces:**
- Produces `ChartResolution` with all 12 selectable values.
- Keeps `CanonicalChartResolution = "1m" | "1D"`.
- Produces `canonicalSourceResolution(resolution): CanonicalChartResolution`.
- Produces `aggregateChartTimeframe(bars, resolution, options?): CanonicalOhlcvBar[]`.

- [ ] **Step 1: Write failing engine tests**

Create tests with real bars. Minimum cases:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { aggregateChartTimeframe, canonicalSourceResolution } from "../modules/market/chart-data/timeframes.ts"

test("15m aggregation uses first/max/min/last/sum and does not cross lunch", () => {
  const bars = [
    bar("2026-09-04T04:15:00Z", 10, 11, 9.5, 10.5, 100), // 11:15 VN
    bar("2026-09-04T04:29:00Z", 10.5, 12, 10, 11, 200),
    bar("2026-09-04T06:00:00Z", 11, 11.5, 10.8, 11.2, 300), // 13:00 VN
  ]
  const out = aggregateChartTimeframe(bars, "15m")
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { time: epoch("2026-09-04T04:15:00Z"), open: 10, high: 12, low: 9.5, close: 11, volume: 300 })
  assert.equal(out[1].open, 11)
})

test("3D groups three actual Daily sessions across a weekend", () => {
  const out = aggregateChartTimeframe([
    daily("2026-09-03", 10),
    daily("2026-09-04", 11),
    daily("2026-09-07", 12),
    daily("2026-09-08", 13),
  ], "3D")
  assert.equal(out.length, 2)
  assert.equal(out[0].close, 12)
})

test("week/month/quarter/year use calendar keys rather than fixed counts", () => {
  // Include a shortened week and month/quarter boundary and assert separate buckets.
})

test("source resolution mapping never derives intraday from Daily", () => {
  for (const resolution of ["1m", "15m", "30m", "1h", "2h", "4h"] as const) {
    assert.equal(canonicalSourceResolution(resolution), "1m")
  }
  for (const resolution of ["1D", "3D", "1W", "1M", "1Q", "1Y"] as const) {
    assert.equal(canonicalSourceResolution(resolution), "1D")
  }
})
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/chart-timeframe-engine.test.ts
```

Expected: FAIL because `timeframes.ts` and/or `ChartResolution` do not exist.

- [ ] **Step 3: Implement the pure engine**

Implement:

```ts
export type ChartResolution = "1m" | "15m" | "30m" | "1h" | "2h" | "4h" | "1D" | "3D" | "1W" | "1M" | "1Q" | "1Y"

export function canonicalSourceResolution(resolution: ChartResolution): CanonicalChartResolution {
  return ["1m", "15m", "30m", "1h", "2h", "4h"].includes(resolution) ? "1m" : "1D"
}
```

In `timeframes.ts`, use Vietnam-local date/time parts, explicit morning/afternoon segment starts, deterministic bucket keys, and a shared reducer for OHLCV. Ignore out-of-session raw intraday bars rather than merging them into valid buckets.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/chart-timeframe-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run affected chart-data tests**

```bash
node --test tests/stock-tradingview-chart-v2.test.ts tests/root-admin-schema.test.ts
```

Expected: PASS after updating obsolete fixed-count expectations in later tasks only if needed.

---

### Task 2: Server timeframe service and public API contract

**Files:**
- Modify: `modules/market/chart-data/contract.ts`
- Modify: `modules/market/chart-data/provider.ts`
- Modify: `modules/market/chart-data/service.ts` only where canonical request typing must remain narrow.
- Create: `modules/market/chart-data/timeframe-service.ts`
- Modify: `app/api/market/ohlcv/route.ts`
- Create: `tests/chart-timeframe-service.test.ts`

**Interfaces:**
- Produces `getChartOhlcv(deps, request: ChartOhlcvRequest): Promise<ChartOhlcvResult>` for all public resolutions.
- Continues to expose `getCanonicalChartOhlcv(... CanonicalChartOhlcvRequest ...)` for `1m | 1D` internals.
- Route calls only `getChartOhlcv`.

- [ ] **Step 1: Write failing service tests**

Use injected canonical loader rather than a real network/database:

```ts
test("15m request reads canonical 1m and aggregates before returning", async () => {
  const requested: string[] = []
  const result = await getChartOhlcv({
    canonicalLoader: async (request) => {
      requested.push(request.resolution)
      return canonicalResult(request, minuteBars)
    },
  }, { ticker: "VIC", resolution: "15m", from, to })

  assert.deepEqual(requested, ["1m"])
  assert.equal(result.resolution, "15m")
  assert.ok(result.bars.length > 0)
})

test("1W source range expands to the containing Monday before aggregation", async () => {
  // Request from mid-week, capture canonical loader from, assert it starts no later than local Monday.
})

test("canonical loader calls are chunked within QEO-92 max source spans", async () => {
  // Request a derived intraday range >31 days and assert every canonical 1m call spans <=31 days.
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/chart-timeframe-service.test.ts
```

Expected: FAIL because `timeframe-service.ts` does not exist and the route accepts only canonical resolutions.

- [ ] **Step 3: Implement public/canonical request separation**

Use types equivalent to:

```ts
export interface ChartOhlcvRequest {
  ticker: string
  resolution: ChartResolution
  from: number
  to: number
}

export interface CanonicalChartOhlcvRequest extends Omit<ChartOhlcvRequest, "resolution"> {
  resolution: CanonicalChartResolution
}
```

Provider interfaces use `CanonicalChartOhlcvRequest` so no provider can accidentally be asked for `15m`, `1W`, etc.

- [ ] **Step 4: Implement source-range expansion and chunked canonical loading**

Rules:

```text
1m -> canonical 1m unchanged
15m/30m/1h/2h/4h -> canonical 1m, source start expanded to containing VN session bucket
1D -> canonical 1D unchanged
3D -> canonical 1D from deterministic sequence anchor, aggregate, filter requested range
1W -> canonical 1D from local Monday containing request.from
1M -> canonical 1D from local month start
1Q -> canonical 1D from local quarter start
1Y -> canonical 1D from local year start
```

Split canonical source reads so each `1m` call spans at most 31 days and each `1D` call spans at most ten years. Merge source results by timestamp before aggregation.

- [ ] **Step 5: Update the API route**

Parse `resolution` as `ChartResolution`, call `getChartOhlcv`, preserve the sanitized response fields from QEO-92, and never expose source storage/provider internals.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/chart-timeframe-service.test.ts tests/chart-timeframe-engine.test.ts
```

Expected: PASS.

---

### Task 3: Client history loader with range merge and request dedupe

**Files:**
- Create: `components/stock-detail/chart/chart-history.ts`
- Create: `components/stock-detail/chart/use-chart-history.ts`
- Create: `tests/chart-history.test.ts`

**Interfaces:**
- Produces `mergeChartBars(existing, incoming): OhlcvBar[]`.
- Produces `requestChartRange(input, signal?): Promise<ChartHistoryResponse>` with module-level in-flight dedupe.
- Produces `useChartHistory({ ticker, timeframe, seedDailyBars })` returning `{ bars, loading, loadingOlder, error, coverage, hasMore, loadOlder }`.

- [ ] **Step 1: Write failing pure history tests**

```ts
test("mergeChartBars prepends older bars, sorts and dedupes by timestamp", () => {
  const merged = mergeChartBars([{ time: 200, ...p }], [{ time: 100, ...p }, { time: 200, ...p }])
  assert.deepEqual(merged.map((bar) => bar.time), [100, 200])
})

test("identical in-flight range requests share one fetch promise", async () => {
  let fetches = 0
  const fakeFetch = async () => { fetches += 1; return response }
  await Promise.all([requestChartRange(input, undefined, fakeFetch), requestChartRange(input, undefined, fakeFetch)])
  assert.equal(fetches, 1)
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/chart-history.test.ts
```

Expected: FAIL because history helpers do not exist.

- [ ] **Step 3: Implement deterministic client range helpers**

Use a stable key:

```ts
const key = `${ticker}:${timeframe}:${from}:${to}`
```

Delete the key from the in-flight map in `finally` so retries are possible after completion/failure.

- [ ] **Step 4: Implement the React hook**

On ticker/timeframe change:

- abort obsolete request;
- reset to optional Daily seed only when timeframe is `1D`;
- reset viewport-facing history state;
- load recent range ending at `Date.now()`.

`loadOlder()` requests the adjacent range ending immediately before the earliest loaded bar. Do not mutate chart viewport state inside the hook.

- [ ] **Step 5: Run GREEN**

```bash
node --test tests/chart-history.test.ts
```

Expected: PASS.

---

### Task 4: Stock chart integration and lazy pan-left trigger

**Files:**
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Modify: `components/stock-detail/chart/stock-chart-timeframes.ts`
- Modify: `components/stock-detail/stock-detail-workstation.tsx` if `hourlyBars` is no longer needed by chart props.
- Modify: `tests/stock-tradingview-chart-v2.test.ts`
- Modify: `tests/stock-chart-interaction.test.ts`

**Interfaces:**
- `StockTradingViewChart` consumes ready timeframe bars from `useChartHistory`.
- Legacy `aggregateBarsByTimeframe(dailyBars, hourlyBars, timeframe)` is removed from the production chart path.

- [ ] **Step 1: Write failing integration/source tests**

Add assertions:

```ts
assert.match(chartSource, /useChartHistory/)
assert.doesNotMatch(chartSource, /aggregateBarsByTimeframe/)
assert.match(chartSource, /loadOlder/)
assert.match(chartSource, /loadingOlder/)
```

Add an interaction contract that pan/scroll logic triggers `loadOlder()` near the oldest loaded window without calling `setScrollOffset(0)`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/stock-tradingview-chart-v2.test.ts tests/stock-chart-interaction.test.ts
```

Expected: FAIL on the new QEO-93 assertions.

- [ ] **Step 3: Integrate the history hook**

Replace:

```ts
const displayBars = useMemo(() => aggregateBarsByTimeframe(bars, hourlyBars, timeframe), [bars, hourlyBars, timeframe])
```

with the hook-provided bars for the selected timeframe.

Use the existing `bars` prop only as optional canonical Daily seed. Remove synthetic/unavailable QEO-92 messaging that says QEO-93 is future work.

- [ ] **Step 4: Trigger progressive older loading**

When the visible start approaches the first loaded bars or panning reaches the left boundary, call `loadOlder()` once. The hook prevents duplicate requests; the chart keeps its current `scrollOffset` and `visibleBarsCount`.

- [ ] **Step 5: Add non-blocking states**

Initial empty + loading may show the existing loading shell. Older-range loading must render a small non-blocking status indicator. Partial canonical coverage may render a warning without replacing existing candles.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/stock-tradingview-chart-v2.test.ts tests/stock-chart-interaction.test.ts tests/chart-history.test.ts tests/chart-timeframe-engine.test.ts tests/chart-timeframe-service.test.ts
```

Expected: PASS.

---

### Task 5: Documentation, full verification and review-ready PR

**Files:**
- Modify: `docs/chart-data.md`
- Modify: `docs/HANDOVER.md`
- Modify: `docs/README.md` only if navigation wording needs QEO-93 ownership clarification.
- Update: this plan checkboxes only if the repository convention tracks completion in-plan.

- [ ] **Step 1: Update canonical docs**

Document:

- all 12 public chart resolutions;
- `1m`/`1D` canonical source mapping;
- VN session bucket rule;
- calendar higher-timeframe rule;
- client progressive history loading and in-flight dedupe;
- QEO-96 realtime boundary.

- [ ] **Step 2: Run targeted tests**

```bash
node --test tests/chart-timeframe-engine.test.ts tests/chart-timeframe-service.test.ts tests/chart-history.test.ts tests/stock-tradingview-chart-v2.test.ts tests/stock-chart-interaction.test.ts tests/root-admin-schema.test.ts
```

Expected: all pass, zero failures.

- [ ] **Step 3: Run repository verification gates**

Use the same commands enforced by the repository Verify workflow. At minimum:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

If the repository uses a combined verify script, run that canonical script as well.

- [ ] **Step 4: Inspect the final diff against QEO-93 acceptance**

Confirm line-by-line:

- standard OHLC aggregation;
- calendar-aligned W/M/Q/Y;
- 3D actual-session grouping;
- no lunch/date-crossing intraday buckets;
- stable historical timestamps;
- progressive older history;
- no viewport reset;
- no coarser-source intraday derivation;
- no synthetic OHLCV.

- [ ] **Step 5: Open stacked PR and update Linear**

Open QEO-93 PR with base `tvq9612/qeo-92-chart-data-real-1m-1d-canonical-ohlcv-with-hotcold-storage` while QEO-92 is unmerged. After QEO-92 merges, retarget QEO-93 to `main` and re-run verification.

Move QEO-93 to `In Review` only after fresh CI evidence is green.
