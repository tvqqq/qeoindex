import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

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
  assert.match(wrapper, /renderNavigationTimeframe\s*=\s*pendingExternalPrepared\s*\?\s*navigationTimeframe\s*:\s*null/)
  assert.match(wrapper, /navigationTimeframe=\{renderNavigationTimeframe\}/)
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
