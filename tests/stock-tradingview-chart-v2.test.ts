import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
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
  const sma20 = calculateSma(mockBars, 20)
  assert.equal(sma20.length, mockBars.length)
  assert.equal(sma20[0], null)
  assert.ok(typeof sma20[30] === "number")

  const rsi = calculateRsiSeries(mockBars, 14)
  assert.equal(rsi.length, mockBars.length)
  assert.equal(rsi[0], null)
  const lastRsi = rsi.at(-1)
  assert.ok(typeof lastRsi === "number" && lastRsi >= 0 && lastRsi <= 100)

  const macd = calculateMacdSeries(mockBars)
  assert.equal(macd.macd.length, mockBars.length)
  assert.equal(macd.signal.length, mockBars.length)
  assert.equal(macd.histogram.length, mockBars.length)

  const ichi = calculateIchimokuSeries(mockBars)
  assert.equal(ichi.tenkan.length, mockBars.length)
  assert.equal(ichi.kijun.length, mockBars.length)
  assert.equal(ichi.spanA.length, mockBars.length)
  assert.equal(ichi.spanB.length, mockBars.length)

  const bb = calculateBollingerBands(mockBars, 20, 2)
  assert.equal(bb.upper.length, mockBars.length)
  assert.equal(bb.lower.length, mockBars.length)
  const lastIdx = mockBars.length - 1
  assert.ok((bb.upper[lastIdx] as number) >= (bb.lower[lastIdx] as number))

  const vp = calculateVolumeProfile(mockBars, 10)
  assert.equal(vp.buckets.length, 10)
  assert.ok(vp.pocPrice > 0)
  assert.ok(vp.buckets.some((b) => b.isPoc))
})

test("Timeframe aggregation never fabricates intraday candles from Daily bars", () => {
  const daily = aggregateBarsByTimeframe(mockBars, undefined, "1D")
  assert.ok(daily.length > 0)

  const weekly = aggregateBarsByTimeframe(mockBars, undefined, "1W")
  assert.ok(weekly.length > 0 && weekly.length <= daily.length)

  assert.deepEqual(aggregateBarsByTimeframe(mockBars, undefined, "1m"), [])
  assert.deepEqual(aggregateBarsByTimeframe(mockBars, undefined, "15m"), [])
  assert.deepEqual(aggregateBarsByTimeframe(mockBars, undefined, "30m"), [])
  assert.deepEqual(aggregateBarsByTimeframe(mockBars, undefined, "1h"), [])
  assert.deepEqual(aggregateBarsByTimeframe(mockBars, undefined, "2h"), [])
  assert.deepEqual(aggregateBarsByTimeframe(mockBars, undefined, "4h"), [])
})

test("QEO-92 removes synthetic micro-volatility and adds canonical chart-data boundaries", () => {
  const timeframeSource = source("components/stock-detail/chart/stock-chart-timeframes.ts")
  const dnseSource = source("modules/market/providers/dnse/history.ts")

  assert.doesNotMatch(timeframeSource, /deriveSubHourlyBars|micro-volatility|Math\.sin/i)
  assert.doesNotMatch(timeframeSource, /hourly\s*=\s*.*daily\.slice/i)
  assert.match(dnseSource, /fetchMinuteOhlcvRange/)

  for (const path of [
    "modules/market/chart-data/contract.ts",
    "modules/market/chart-data/normalize.ts",
    "modules/market/chart-data/provider.ts",
    "modules/market/chart-data/hot-store.ts",
    "modules/market/chart-data/cold-store.ts",
    "modules/market/chart-data/service.ts",
    "app/api/market/ohlcv/route.ts",
  ]) {
    assert.equal(existsSync(path), true, `${path} must exist`)
  }
})

test("QEO-92 chart OHLC API requires the research feature gate", () => {
  const route = source("app/api/market/ohlcv/route.ts")

  assert.match(route, /requireApiFeature/)
  assert.match(route, /requireApiFeature\(["']research["']\)/)
  assert.doesNotMatch(route, /requireApiUser/)
})

test("QEO-92 canonical merge is sorted, deduped, hot-preferred and mismatch-aware", async () => {
  const { normalizeCanonicalBars, detectSequenceGaps } = await import("../modules/market/chart-data/normalize.ts")

  const result = normalizeCanonicalBars([
    { source: "cold", bar: { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 100 } },
    { source: "hot", bar: { time: 100, open: 10, high: 13, low: 9, close: 12, volume: 120 } },
    { source: "hot", bar: { time: 160, open: 12, high: 13, low: 11, close: 12.5, volume: 90 } },
    { source: "provider", bar: { time: 220, open: 0, high: 1, low: 1, close: 1, volume: 10 } },
  ])

  assert.deepEqual(result.bars.map((bar: { time: number }) => bar.time), [100, 160])
  assert.equal(result.bars[0].close, 12)
  assert.ok(result.integrityIssues.some((issue: { kind: string }) => issue.kind === "SOURCE_MISMATCH"))
  assert.ok(result.integrityIssues.some((issue: { kind: string }) => issue.kind === "INVALID_BAR"))

  assert.deepEqual(detectSequenceGaps([
    { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { time: 220, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  ], "1m"), [{ fromTime: 100, toTime: 220, missingBars: 1 }])
})

test("StockTradingViewChart implements standard compact mode and full maximized mode", () => {
  const code = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(code, /isMaximized \?/)
  assert.match(code, /Maximize2/)
  assert.match(code, /Minimize2/)

  assert.match(code, /indicators\.showRsi/)
  assert.match(code, /indicators\.showMacd/)
  assert.match(code, /indicators\.showIchimoku/)
  assert.match(code, /indicators\.showBollinger/)
  assert.match(code, /indicators\.showVolumeProfile/)

  assert.match(code, /<StockChartDrawingTools/)
  assert.match(code, /<StockChartDrawingCanvas/)
})

test("StockTradingViewChart renders explicit unavailable state for unsupported intraday timeframes", () => {
  const code = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(code, /displayBars\.length\s*===\s*0/)
  assert.match(code, /Dữ liệu timeframe này chưa sẵn sàng/)
  assert.match(code, /QEO-93/)
})

test("StockDetailWorkstation handles isChartMaximized and hides sidebar/tabs", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  assert.match(workstation, /isChartMaximized/)
  assert.match(workstation, /setIsChartMaximized/)

  assert.match(workstation, /!isChartMaximized && \(\s*<aside/)
  assert.match(workstation, /!isChartMaximized && <StockCompanyHeader/)
  assert.match(workstation, /!isChartMaximized && <StockTabsPanel/)

  assert.match(workstation, /StockWatchlistSidebar/)
  assert.match(workstation, /onToggleMaximize=\{\(\) => setIsChartMaximized\(\(prev\) => !prev\)\}/)
})
