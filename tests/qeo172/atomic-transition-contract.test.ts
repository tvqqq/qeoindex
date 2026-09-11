import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 timeframe transition separates requested and committed state", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(wrapper, /committedTimeframe/)
  assert.match(wrapper, /prepareInitialChartHistory/)
  assert.match(wrapper, /preparedInitial/)
  assert.match(chart, /onTimeframeRequest/)
  assert.match(chart, /controlledTimeframe/)
})

test("QEO-172 ticker navigation has bounded prefetch and full preparation before commit", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  assert.match(workstation, /adjacentPrefetchTargets/)
  assert.match(workstation, /prefetchInitialStableChartHistory/)
  assert.match(workstation, /prepareInitialChartHistory/)
  assert.match(workstation, /inFlightStockDetailRef/)
  assert.match(workstation, /pendingTicker/)
})
