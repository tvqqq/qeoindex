import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  ALL_TIMEFRAMES,
  QUICK_TIMEFRAMES,
  normalizePersistedChartTimeframe,
} from "../components/stock-detail/chart/stock-chart-types.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-241 active chart product exposes exactly 1D, 1W and 1M", () => {
  assert.deepEqual(QUICK_TIMEFRAMES, ["1D", "1W", "1M"])
  assert.deepEqual(ALL_TIMEFRAMES.map(({ id }) => id), ["1D", "1W", "1M"])
})

test("QEO-241 retired persisted timeframes normalize to 1D", () => {
  for (const retired of ["3D", "1Q", "1Y"]) {
    assert.equal(normalizePersistedChartTimeframe(retired), "1D")
  }
  assert.equal(normalizePersistedChartTimeframe("1W"), "1W")
  assert.equal(normalizePersistedChartTimeframe("1M"), "1M")
})

test("QEO-241 chart toolbar uses fixed direct timeframe controls with no dropdown", () => {
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")
  assert.match(chart, /QUICK_TIMEFRAMES\.map/)
  assert.doesNotMatch(chart, /showTfDropdown|setShowTfDropdown/)
  assert.doesNotMatch(chart, /Chọn khung thời gian/)
  assert.doesNotMatch(chart, /ALL_TIMEFRAMES\.map/)
})

test("QEO-241 ticker navigation has no 3D remote preparation special case", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")
  assert.doesNotMatch(workstation, /targetTimeframe\s*===\s*["']3D["']/)
})

test("QEO-241 public OHLCV route fails closed for retired Daily-derived resolutions", () => {
  const route = source("app/api/market/ohlcv/route.ts")
  assert.match(route, /new Set\(\["3D",\s*"1Q",\s*"1Y"\]\)/)
  assert.match(route, /TIMEFRAME_RETIRED/)
})
