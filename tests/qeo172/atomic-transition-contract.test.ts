import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import type { CanonicalOhlcvBar, SourceTaggedBar } from "../../modules/market/chart-data/contract.ts"
import * as normalizeModule from "../../modules/market/chart-data/normalize.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 timeframe transition separates requested and committed state", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")

  assert.match(wrapper, /committedTimeframe/)
  assert.match(wrapper, /prepareInitialChartHistory/)
  assert.match(wrapper, /preparedInitial/)
  assert.match(wrapper, /handleTimeframeClickCapture/)
  assert.match(wrapper, /replayTimeframeClickRef/)
  assert.match(wrapper, /flushSync/)
})

test("QEO-172 prepared ticker-timeframe handoff is synchronized before browser paint", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")
  const history = source("components/stock-detail/chart/use-chart-history.ts")
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  assert.match(wrapper, /renderPreparedInitial/)
  assert.match(wrapper, /renderTimeframe/)
  assert.match(wrapper, /timeframe=\{renderTimeframe\}/)
  assert.match(wrapper, /preparedInitial=\{renderPreparedInitial\}/)
  assert.match(history, /useLayoutEffect/)
  assert.match(workstation, /timeframe:\s*currentChartTimeframeRef\.current/)
})

test("QEO-172 external prepared/navigation handoff is one-shot and cannot pin a later direct timeframe change", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")

  assert.match(wrapper, /\[consumedExternalPrepared, setConsumedExternalPrepared\] = useState/)
  assert.match(wrapper, /pendingExternalPrepared/)
  assert.doesNotMatch(wrapper, /consumedExternalPreparedRef\.current/)
  assert.doesNotMatch(wrapper, /void prepareAndCommit\(requestedTimeframe\)/)
})

test("QEO-172 replayed timeframe event observes the committed ref and cannot prepare the same target twice", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")

  assert.match(wrapper, /committedTimeframeRef/)
  assert.match(wrapper, /committedTimeframeRef\.current = nextTimeframe/)
  assert.match(wrapper, /detail\.timeframe === committedTimeframeRef\.current/)
})

test("QEO-172 ticker navigation has bounded prefetch and full preparation before commit", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  assert.match(workstation, /adjacentPrefetchTargets/)
  assert.match(workstation, /prefetchInitialStableChartHistory/)
  assert.match(workstation, /prepareInitialChartHistory/)
  assert.match(workstation, /inFlightStockDetailRef/)
  assert.match(workstation, /pendingTicker/)
})

test("QEO-172 fresh live-tail correction replaces only same-timestamp HOT before integrity normalization", () => {
  type ReconcileLiveTail = (existing: SourceTaggedBar[], freshProviderBars: CanonicalOhlcvBar[]) => SourceTaggedBar[]
  const reconcileLiveTailProviderBars = Reflect.get(normalizeModule, "reconcileLiveTailProviderBars") as ReconcileLiveTail | undefined

  assert.equal(typeof reconcileLiveTailProviderBars, "function", "live-tail correction handoff must be explicit")
  if (!reconcileLiveTailProviderBars) return

  const staleHot: CanonicalOhlcvBar = { time: 100, open: 10, high: 11, low: 9, close: 10, volume: 100 }
  const unrelatedHot: CanonicalOhlcvBar = { time: 160, open: 12, high: 13, low: 11, close: 12, volume: 90 }
  const unrelatedCold: CanonicalOhlcvBar = { time: 40, open: 8, high: 9, low: 7, close: 8, volume: 80 }
  const freshProvider: CanonicalOhlcvBar = { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 120 }

  const reconciled = reconcileLiveTailProviderBars([
    { source: "cold", bar: unrelatedCold },
    { source: "hot", bar: staleHot },
    { source: "hot", bar: unrelatedHot },
  ], [freshProvider])
  const normalized = normalizeModule.normalizeCanonicalBars(reconciled)

  assert.deepEqual(normalized.integrityIssues, [])
  assert.deepEqual(normalized.bars, [unrelatedCold, freshProvider, unrelatedHot])
  assert.equal(reconciled.some((item) => item.source === "hot" && item.bar.time === staleHot.time), false)
  assert.equal(reconciled.some((item) => item.source === "hot" && item.bar.time === unrelatedHot.time), true)
})
