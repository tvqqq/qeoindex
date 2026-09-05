import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
function source(relPath) {
  return readFileSync(path.join(root, relPath), "utf8")
}

const chartSource = source("components/stock-detail/stock-tradingview-chart.tsx")
const canvasSource = source("components/stock-detail/chart/stock-chart-drawing-canvas.tsx")
const objectManagerSource = source("components/stock-detail/chart/stock-chart-object-manager.tsx")
const syncSource = source("components/stock-detail/chart/use-user-chart-sync.ts")
const timeframeSource = source("components/stock-detail/chart/stock-chart-timeframes.ts")
const indicatorSource = source("components/stock-detail/chart/stock-chart-indicators.ts")
const typesSource = source("components/stock-detail/chart/stock-chart-types.ts")
const detailDataSource = source("modules/research/insights/stock-detail-data.ts")
const workstationSource = source("components/stock-detail/stock-detail-workstation.tsx")
const identitySource = source("components/stock-detail/stock-identity.tsx")

function mockBars(count = 120) {
  return Array.from({ length: count }, (_, i) => ({
    time: 1700000000 + i * 86400,
    open: 100 + i * 0.1,
    high: 101 + i * 0.1,
    low: 99 + i * 0.1,
    close: 100.5 + i * 0.1,
    volume: 1_000_000 + i * 1000,
  }))
}

test("StockTradingViewChart implements 100% TradingView scroll, zoom out, and coordinate pinning", () => {
  assert.match(chartSource, /visibleBarsCount/)
  assert.match(chartSource, /scrollOffset/)
  assert.match(chartSource, /onWheel=\{handleWheel\}/)
  assert.match(chartSource, /handleMouseDownCanvas/)
  assert.match(chartSource, /handleMouseMoveCanvas/)
  assert.match(chartSource, /timeToX/)
  assert.match(chartSource, /xToTime/)
  assert.match(chartSource, /priceToY/)
  assert.match(chartSource, /yToPrice/)
  assert.match(chartSource, /StockChartDrawingCanvas/)
  assert.match(chartSource, /StockChartDrawingTools/)
  assert.match(chartSource, /StockChartObjectManager/)
})

test("StockChartDrawingCanvas supports object selection, dragging, and anchor handles", () => {
  assert.match(canvasSource, /selectedId/)
  assert.match(canvasSource, /onSelect/)
  assert.match(canvasSource, /onMoveDrawing/)
  assert.match(canvasSource, /onMoveAnchor/)
  assert.match(canvasSource, /onPointerDown/)
  assert.match(canvasSource, /onPointerMove/)
  assert.match(canvasSource, /onPointerUp/)
})

test("StockChartObjectManager provides clear object tree management and text editing", () => {
  assert.match(objectManagerSource, /Object tree/i)
  assert.match(objectManagerSource, /onToggleHide/)
  assert.match(objectManagerSource, /onToggleLock/)
  assert.match(objectManagerSource, /onDelete/)
  assert.match(objectManagerSource, /onEditText/)
})

test("useUserChartSync manages database persistence and local cache fallback", () => {
  assert.match(syncSource, /\/api\/user\/chart-drawings/)
  assert.match(syncSource, /localStorage/)
  assert.match(syncSource, /setTimeout/)
  assert.match(syncSource, /saveStatus/)
})

test("StockTradingViewChart renders TradingView-style 4 horizontal columns timeframe panel with checkmark", () => {
  assert.match(chartSource, /grid-cols-4/)
  assert.match(chartSource, /divide-x divide-white/)
  assert.match(chartSource, /title: "Phút"/)
  assert.match(chartSource, /title: "Giờ"/)
  assert.match(chartSource, /title: "Ngày"/)
  assert.match(chartSource, /title: "Năm"/)
  assert.match(chartSource, /Check className/)
})

test("StockTradingViewChart renders dedicated X-axis (time) and Y-axis (price) rails with crosshairs", () => {
  assert.match(chartSource, /Right Y-Axis Price Rail Background/)
  assert.match(chartSource, /Bottom X-Axis Time Rail Background/)
  assert.match(chartSource, /Crosshair vertical/)
  assert.match(chartSource, /Crosshair horizontal/)
})

test("StockTradingViewChart implements TitanLabs-style bottom range presets and auto-fit reset", () => {
  assert.match(chartSource, /RANGE_PRESETS/)
  assert.match(chartSource, /handleRangePreset/)
  assert.match(chartSource, /Auto Fit/)
  assert.match(chartSource, /handleResetView/)
})

test("Timeframe definitions contain all requested intervals", () => {
  const expected = ["1m", "15m", "30m", "1h", "2h", "4h", "1D", "3D", "1W", "1M", "3M", "1Y"]
  for (const tf of expected) assert.match(typesSource, new RegExp(`id: "${tf}"`))
})

test("Technical indicators calculate valid series", async () => {
  const { calculateSma, calculateRsiSeries, calculateMacdSeries, calculateBollingerBands } = await import(
    path.join(root, "components/stock-detail/chart/stock-chart-indicators.ts")
  )
  const bars = mockBars(250)
  const sma = calculateSma(bars, 20)
  const rsi = calculateRsiSeries(bars, 14)
  const macd = calculateMacdSeries(bars)
  const boll = calculateBollingerBands(bars, 20)
  assert.equal(sma.length, bars.length)
  assert.equal(rsi.length, bars.length)
  assert.equal(macd.macd.length, bars.length)
  assert.equal(boll.upper.length, bars.length)
  assert.ok(sma.at(-1) !== null)
  assert.ok(rsi.at(-1) !== null)
})

test("Timeframe aggregation never fabricates intraday candles from Daily bars", async () => {
  const { aggregateBarsByTimeframe } = await import(
    path.join(root, "components/stock-detail/chart/stock-chart-timeframes.ts")
  )
  const bars = mockBars(10)
  assert.deepEqual(aggregateBarsByTimeframe(bars, undefined, "1m"), [])
  assert.deepEqual(aggregateBarsByTimeframe(bars, undefined, "15m"), [])
  assert.deepEqual(aggregateBarsByTimeframe(bars, undefined, "30m"), [])
  assert.deepEqual(aggregateBarsByTimeframe(bars, undefined, "1h"), [])
})

test("QEO-92 removes synthetic micro-volatility and adds canonical chart-data boundaries", () => {
  const route = source("app/api/market/ohlcv/route.ts")
  const normalize = source("modules/market/chart-data/normalize.ts")
  const service = source("modules/market/chart-data/service.ts")
  const hot = source("modules/market/chart-data/hot-store.ts")
  const cold = source("modules/market/chart-data/cold-store.ts")
  const provider = source("modules/market/chart-data/providers/dnse.ts")

  assert.doesNotMatch(timeframeSource, /deriveSubHourlyBars|Math\.sin/)
  assert.match(route, /getCanonicalChartOhlcv/)
  assert.match(normalize, /normalizeCanonicalBars/)
  assert.match(service, /mergeCanonicalBars/)
  assert.match(hot, /chart_ohlcv_intraday/)
  assert.match(cold, /chart_ohlcv_cold_manifests/)
  assert.match(provider, /fetchMinuteOhlcvExact/)
})

test("QEO-92 canonical merge is sorted, deduped, hot-preferred and mismatch-aware", async () => {
  const { mergeCanonicalBars } = await import(path.join(root, "modules/market/chart-data/normalize.ts"))
  const cold = [{ time: 100, open: 10, high: 12, low: 9, close: 11, volume: 100 }]
  const hot = [
    { time: 100, open: 10, high: 13, low: 9, close: 12, volume: 110 },
    { time: 160, open: 12, high: 14, low: 11, close: 13, volume: 120 },
  ]
  const result = mergeCanonicalBars([
    { source: "cold", bars: cold },
    { source: "hot", bars: hot },
  ])
  assert.deepEqual(result.bars.map((bar) => bar.time), [100, 160])
  assert.equal(result.bars[0].high, 13)
  assert.equal(result.integrityIssues.length, 1)
})

test("StockTradingViewChart implements standard compact mode and full maximized mode", () => {
  assert.match(chartSource, /isMaximized/)
  assert.match(chartSource, /StockChartIndicatorModal/)
  assert.match(chartSource, /StockChartDrawingTools/)
  assert.match(chartSource, /onToggleMaximize/)
})

test("StockTradingViewChart renders explicit unavailable state for unsupported intraday timeframes", () => {
  const code = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(code, /displayBars\.length\s*===\s*0/)
  assert.match(code, /Dữ liệu timeframe này chưa sẵn sàng/)
  assert.match(code, /QEO-93/)
})

test("StockDetailWorkstation handles isChartMaximized and hides sidebar/tabs", () => {
  assert.match(workstationSource, /isChartMaximized/)
  assert.match(workstationSource, /StockWatchlistSidebar/)
  assert.match(workstationSource, /onToggleMaximize=\{\(\) => setIsChartMaximized\(\(prev\) => !prev\)\}/)
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