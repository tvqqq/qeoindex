import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  calculateBollingerBands,
  calculateIchimokuSeries,
  calculateMacdSeries,
  calculateRsiSeries,
  calculateSma,
  calculateVolumeProfile,
} from "../components/stock-detail/chart/stock-chart-indicators.ts"
import { aggregateBarsByTimeframe } from "../components/stock-detail/chart/stock-chart-timeframes.ts"
import {
  ALL_TIMEFRAMES,
  DEFAULT_INDICATOR_CONFIG,
  QUICK_TIMEFRAMES,
} from "../components/stock-detail/chart/stock-chart-types.ts"
import type { OhlcvBar } from "../modules/shared/technical/indicators.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const mockBars: OhlcvBar[] = Array.from({ length: 60 }, (_, i) => {
  const base = 50 + Math.sin(i / 5) * 5
  return {
    time: 1700000000 + i * 86400,
    open: base,
    high: base + 2,
    low: base - 2,
    close: base + (i % 2 === 0 ? 1 : -1),
    volume: 1_000_000 + i * 10_000,
  }
})

test("Timeframe definitions contain all requested intervals", () => {
  assert.deepEqual(QUICK_TIMEFRAMES, ["15m", "1h", "1D", "1W"])

  const ids = ALL_TIMEFRAMES.map((t) => t.id)
  assert.ok(ids.includes("1m"))
  assert.ok(ids.includes("15m"))
  assert.ok(ids.includes("30m"))
  assert.ok(ids.includes("1h"))
  assert.ok(ids.includes("2h"))
  assert.ok(ids.includes("4h"))
  assert.ok(ids.includes("1D"))
  assert.ok(ids.includes("3D"))
  assert.ok(ids.includes("1W"))
  assert.ok(ids.includes("1M"))
  assert.ok(ids.includes("1Q"))
  assert.ok(ids.includes("1Y"))
})

test("Technical indicators calculate valid series", () => {
  // SMA
  const sma20 = calculateSma(mockBars, 20)
  assert.equal(sma20.length, mockBars.length)
  assert.equal(sma20[0], null)
  assert.ok(typeof sma20[30] === "number")

  // RSI
  const rsi = calculateRsiSeries(mockBars, 14)
  assert.equal(rsi.length, mockBars.length)
  assert.equal(rsi[0], null)
  const lastRsi = rsi.at(-1)
  assert.ok(typeof lastRsi === "number" && lastRsi >= 0 && lastRsi <= 100)

  // MACD
  const macd = calculateMacdSeries(mockBars)
  assert.equal(macd.macd.length, mockBars.length)
  assert.equal(macd.signal.length, mockBars.length)
  assert.equal(macd.histogram.length, mockBars.length)

  // Ichimoku
  const ichi = calculateIchimokuSeries(mockBars)
  assert.equal(ichi.tenkan.length, mockBars.length)
  assert.equal(ichi.kijun.length, mockBars.length)
  assert.equal(ichi.spanA.length, mockBars.length)
  assert.equal(ichi.spanB.length, mockBars.length)

  // Bollinger Bands
  const bb = calculateBollingerBands(mockBars, 20, 2)
  assert.equal(bb.upper.length, mockBars.length)
  assert.equal(bb.lower.length, mockBars.length)
  const lastIdx = mockBars.length - 1
  assert.ok((bb.upper[lastIdx] as number) >= (bb.lower[lastIdx] as number))

  // Volume Profile & POC
  const vp = calculateVolumeProfile(mockBars, 10)
  assert.equal(vp.buckets.length, 10)
  assert.ok(vp.pocPrice > 0)
  assert.ok(vp.buckets.some((b) => b.isPoc))
})

test("Timeframe aggregation creates valid candle datasets", () => {
  const daily = aggregateBarsByTimeframe(mockBars, undefined, "1D")
  assert.ok(daily.length > 0)

  const weekly = aggregateBarsByTimeframe(mockBars, undefined, "1W")
  assert.ok(weekly.length > 0 && weekly.length <= daily.length)

  const subHourly = aggregateBarsByTimeframe(mockBars, undefined, "15m")
  assert.ok(subHourly.length > 0)
})

test("StockTradingViewChart implements standard compact mode and full maximized mode", () => {
  const code = source("components/stock-detail/stock-tradingview-chart.tsx")

  // Standard mode: candle + volume
  assert.match(code, /isMaximized \?/)
  assert.match(code, /Maximize2/)
  assert.match(code, /Minimize2/)

  // Full indicators suite
  assert.match(code, /indicators\.showRsi/)
  assert.match(code, /indicators\.showMacd/)
  assert.match(code, /indicators\.showIchimoku/)
  assert.match(code, /indicators\.showBollinger/)
  assert.match(code, /indicators\.showVolumeProfile/)

  // Drawing tools integration
  assert.match(code, /<StockChartDrawingTools/)
  assert.match(code, /<StockChartDrawingCanvas/)
})

test("StockDetailWorkstation handles isChartMaximized and hides sidebar/tabs", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  // Maximized state management
  assert.match(workstation, /isChartMaximized/)
  assert.match(workstation, /setIsChartMaximized/)

  // Hides left sidebar and tabs when maximized
  assert.match(workstation, /!isChartMaximized && \(\s*<aside/)
  assert.match(workstation, /!isChartMaximized && <StockCompanyHeader/)
  assert.match(workstation, /!isChartMaximized && <StockTabsPanel/)

  // Keeps watchlist active and passes maximize handler
  assert.match(workstation, /StockWatchlistSidebar/)
  assert.match(workstation, /onToggleMaximize=\{\(\) => setIsChartMaximized\(\(prev\) => !prev\)\}/)
})
