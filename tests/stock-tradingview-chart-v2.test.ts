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
  historyWindowSeconds,
  mergeChartBars,
  requestChartRange,
} from "../components/stock-detail/chart/chart-history.ts"
import {
  aggregateChartTimeframe,
  canonicalSourceResolution,
  sourceRangeForResolution,
  splitCanonicalSourceRange,
} from "../modules/market/chart-data/timeframes.ts"
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

function epoch(iso: string) {
  return Math.floor(new Date(iso).getTime() / 1000)
}

function bar(iso: string, open: number, high = open + 1, low = open - 1, close = open, volume = 100): OhlcvBar {
  return { time: epoch(iso), open, high, low, close, volume }
}

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

test("QEO-93 aggregates intraday OHLCV without crossing the VN lunch break", () => {
  const out = aggregateChartTimeframe([
    bar("2026-09-04T04:15:00Z", 10, 11, 9.5, 10.5, 100),
    bar("2026-09-04T04:29:00Z", 10.5, 12, 10, 11, 200),
    bar("2026-09-04T06:00:00Z", 11, 11.5, 10.8, 11.2, 300),
  ], "15m")

  assert.equal(out.length, 2)
  assert.deepEqual(out[0], {
    time: epoch("2026-09-04T04:15:00Z"),
    open: 10,
    high: 12,
    low: 9.5,
    close: 11,
    volume: 300,
  })
  assert.equal(out[1].time, epoch("2026-09-04T06:00:00Z"))
})

test("QEO-93 3D aggregation follows actual Daily sessions across weekends", () => {
  const out = aggregateChartTimeframe([
    bar("2026-09-03T00:00:00Z", 10, 11, 9, 10.5),
    bar("2026-09-04T00:00:00Z", 11, 12, 10, 11.5),
    bar("2026-09-07T00:00:00Z", 12, 13, 11, 12.5),
    bar("2026-09-08T00:00:00Z", 13, 14, 12, 13.5),
  ], "3D")

  assert.equal(out.length, 2)
  assert.equal(out[0].open, 10)
  assert.equal(out[0].close, 12.5)
  assert.equal(out[1].open, 13)
})

test("QEO-93 source routing and chunking never derive intraday from Daily", () => {
  for (const resolution of ["1m", "15m", "30m", "1h", "2h", "4h"] as const) {
    assert.equal(canonicalSourceResolution(resolution), "1m")
  }
  for (const resolution of ["1D", "3D", "1W", "1M", "1Q", "1Y"] as const) {
    assert.equal(canonicalSourceResolution(resolution), "1D")
  }

  const from = epoch("2026-09-02T03:00:00Z")
  const weekly = sourceRangeForResolution("1W", from, epoch("2026-09-05T03:00:00Z"))
  assert.ok(weekly.from < from)

  const chunks = splitCanonicalSourceRange("1m", epoch("2026-01-01T00:00:00Z"), epoch("2026-03-15T00:00:00Z"))
  assert.ok(chunks.length >= 3)
  assert.ok(chunks.every((chunk) => chunk.to - chunk.from <= 31 * 86400))
})

test("QEO-93 chart history merge is prepend-safe and timestamp-deduped", () => {
  const merged = mergeChartBars(
    [bar("2026-09-04T03:00:00Z", 20)],
    [bar("2026-09-04T02:00:00Z", 10), bar("2026-09-04T03:00:00Z", 21)],
  )
  assert.deepEqual(merged.map((item) => item.time), [epoch("2026-09-04T02:00:00Z"), epoch("2026-09-04T03:00:00Z")])
  assert.equal(merged[1].open, 21)
})

test("QEO-93 identical history requests coalesce while in flight", async () => {
  let fetches = 0
  const fakeFetch = async () => {
    fetches += 1
    await Promise.resolve()
    return new Response(JSON.stringify({
      ok: true,
      ticker: "VIC",
      resolution: "15m",
      from: 100,
      to: 200,
      bars: [{ time: 120, open: 1, high: 2, low: 1, close: 2, volume: 10 }],
      gaps: [],
      integrityIssues: [],
      coverage: { complete: true, state: "COMPLETE" },
      errors: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  }

  await Promise.all([
    requestChartRange({ ticker: "VIC", timeframe: "15m", from: 100, to: 200 }, undefined, fakeFetch),
    requestChartRange({ ticker: "VIC", timeframe: "15m", from: 100, to: 200 }, undefined, fakeFetch),
  ])
  assert.equal(fetches, 1)
  assert.ok(historyWindowSeconds("15m") >= 21 * 86400)
  assert.ok(historyWindowSeconds("4h") >= 180 * 86400)
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

test("QEO-93 workstation uses unified history wrapper and lazy-load intent", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")
  const timeframeSource = source("components/stock-detail/chart/stock-chart-timeframes.ts")

  assert.match(wrapper, /useChartHistory/)
  assert.match(wrapper, /loadOlder/)
  assert.match(wrapper, /onMouseMoveCapture/)
  assert.match(wrapper, /loadingOlder/)
  assert.match(workstation, /StockTradingViewChartData/)
  assert.doesNotMatch(timeframeSource, /groupBars|aggregateWeekly|aggregateMonthly|aggregateQuarterly|aggregateYearly/)
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

test("StockTradingViewChart cannot trap an empty persisted timeframe behind the loading return", () => {
  const code = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.doesNotMatch(code, /if \(!displayBars\.length \|\| !chartMetrics \|\| visibleBars\.length === 0\)/)
  assert.match(code, /Dữ liệu timeframe này chưa sẵn sàng/)
})

test("StockTradingViewChart consumes canonical raw 1m from the chart-data API", () => {
  const code = source("components/stock-detail/stock-tradingview-chart.tsx")
  const hook = source("components/stock-detail/chart/use-canonical-minute-bars.ts")

  assert.match(code, /useCanonicalMinuteBars/)
  assert.match(code, /timeframe === "1m"/)
  assert.match(hook, /\/api\/market\/ohlcv/)
  assert.match(hook, /resolution:\s*"1m"/)
})

import "./qeo-100-market-data.cases.ts"
