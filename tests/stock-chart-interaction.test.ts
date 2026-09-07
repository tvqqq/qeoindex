import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  boundChartTimeToTimeline,
  bridgeCoordinateToTime,
  bridgeTimeToCoordinate,
} from "../components/stock-detail/chart/chart-coordinate-bridge.ts"
import {
  canIncrementallyUpdateLatest,
  fingerprintOhlcvPrefix,
} from "../components/stock-detail/chart/chart-render-diff.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("stock detail chart uses native Lightweight Charts for the market plot", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const runtimeCode = source("modules/shared/charts/lightweight-charts-runtime.ts")

  assert.match(chartCode, /loadLightweightCharts/)
  assert.match(chartCode, /runtime\.createChart/)
  assert.match(chartCode, /runtime\.CandlestickSeries/)
  assert.match(chartCode, /runtime\.HistogramSeries/)
  assert.match(chartCode, /runtime\.LineSeries/)
  assert.match(chartCode, /candles\.setData|series\.candles\.setData/)
  assert.match(chartCode, /candles\.update|series\.candles\.update/)
  assert.match(chartCode, /futureAxisData/)
  assert.match(chartCode, /series\.futureAxis\.setData/)
  assert.doesNotMatch(chartCode, /candleData\(displayBars, futureTimes\)/)
  assert.doesNotMatch(chartCode, /<svg|<path|<line|<rect/)
  assert.doesNotMatch(chartCode, /transition-all|backdrop-blur|filter=\{/)
  assert.match(runtimeCode, /timeToCoordinate/)
  assert.match(runtimeCode, /coordinateToTime/)
  assert.match(runtimeCode, /priceToCoordinate/)
  assert.match(runtimeCode, /coordinateToPrice/)
})

test("chart drawing anchors use live LWC coordinates and cursor mode leaves native navigation available", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const canvasCode = source("components/stock-detail/chart/stock-chart-drawing-canvas.tsx")

  assert.match(chartCode, /priceToY = useCallback/)
  assert.match(chartCode, /candles\.priceToCoordinate/)
  assert.match(chartCode, /candles\.coordinateToPrice/)
  assert.match(chartCode, /timeScale\(\)\.timeToCoordinate/)
  assert.match(chartCode, /timeScale\(\)\.coordinateToTime/)
  assert.match(chartCode, /priceToY=\{priceToY\}/)
  assert.match(chartCode, /yToPrice=\{yToPrice\}/)
  assert.match(chartCode, /timeToX=\{timeToX\}/)
  assert.match(chartCode, /xToTime=\{xToTime\}/)
  assert.match(canvasCode, /pointerEvents: !drawingReady \|\| activeTool === "cursor" \? "none" : "auto"/)
  assert.match(canvasCode, /Canonical market coordinates always win over stale runtime x\/y values/)
})

test("corrected prior candle forces a full render instead of latest-only update", () => {
  const bars = [
    { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 1000 },
    { time: 200, open: 11, high: 13, low: 10, close: 12, volume: 1100 },
    { time: 300, open: 12, high: 14, low: 11, close: 13, volume: 1200 },
  ]
  const previous = {
    actualLength: bars.length,
    firstTime: bars[0].time,
    latestTime: bars.at(-1)!.time,
    fingerprint: fingerprintOhlcvPrefix(bars),
  }
  assert.equal(canIncrementallyUpdateLatest(previous, bars), true)
  assert.equal(canIncrementallyUpdateLatest(previous, [
    bars[0],
    bars[1],
    { ...bars[2], close: 13.5, volume: 1250 },
  ]), true)
  assert.equal(canIncrementallyUpdateLatest(previous, [
    bars[0],
    { ...bars[1], high: 15, volume: 1300 },
    bars[2],
  ]), false)

  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  assert.match(chartCode, /canIncrementallyUpdateLatest\(previous, displayBars\)/)
  assert.match(chartCode, /barFingerprint/)
})

test("coordinate bridge interpolates missing anchors and keeps pointer work logarithmic", () => {
  const timeline = [100, 200, 300, 400, 500]
  const coordinateForTime = (time: number) => time / 10

  assert.equal(bridgeTimeToCoordinate(250, timeline, coordinateForTime), 25)
  assert.equal(bridgeCoordinateToTime(25, timeline, coordinateForTime), 250)
  assert.equal(bridgeTimeToCoordinate(50, timeline, coordinateForTime), null)
  assert.equal(bridgeCoordinateToTime(-1, timeline, coordinateForTime), null)
  assert.equal(boundChartTimeToTimeline(500, timeline), 500)
  assert.equal(boundChartTimeToTimeline(501, timeline), null)

  let calls = 0
  const denseTimeline = Array.from({ length: 100_001 }, (_, index) => index)
  const denseCoordinate = (time: number) => {
    calls += 1
    return time * 2
  }
  assert.equal(bridgeCoordinateToTime(100_000, denseTimeline, denseCoordinate), 50_000)
  assert.ok(calls < 40, `binary search should not scan ${denseTimeline.length} timestamps (calls=${calls})`)
})

test("future timestamps are real LWC whitespace and reserve at least half a viewport", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(chartCode, /projectFutureTimes/)
  assert.match(chartCode, /futureTimes\.map\(\(time\) => \(\{ time \}\)\)/)
  assert.match(chartCode, /Math\.ceil\(Math\.max\(1, displayBars\.length\) \* 0\.5\)/)
  assert.match(chartCode, /const rightOffset = DEFAULT_RIGHT_OFFSET_BARS/)
  assert.doesNotMatch(chartCode, /Math\.max\(DEFAULT_RIGHT_OFFSET_BARS, Math\.ceil\(visibleBars \* 0\.5\)\)/)
  assert.match(chartCode, /setVisibleLogicalRange/)
  assert.match(chartCode, /Prepending older history shifts logical indexes/)
})

test("native panes own volume, permanent maximized RSI/MACD and collapse heights", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(chartCode, /calculateRsiSeries/)
  assert.match(chartCode, /calculateMacdSeries/)
  assert.match(chartCode, /runtime\.HistogramSeries/)
  assert.match(chartCode, /chart\.panes\(\)/)
  assert.match(chartCode, /setHeight\(isMaximized/)
  assert.match(chartCode, /isRsiCollapsed/)
  assert.match(chartCode, /isMacdCollapsed/)
  assert.match(chartCode, /priceFormat: \{ type: "price", precision: 2, minMove: 0\.01 \}/)
  assert.match(chartCode, /priceFormat: \{ type: "price", precision: 4, minMove: 0\.0001 \}/)
  assert.doesNotMatch(chartCode, /showRsi|showMacd/)
})

test("indicator controls cover all persisted overlays with aligned cloud and volume profile", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const modalCode = source("components/stock-detail/chart/stock-chart-indicator-modal.tsx")

  for (const token of ["showMa", "showIchimoku", "showQeoBase129", "showBollinger", "showVolumeProfile"]) {
    assert.match(chartCode, new RegExp(token))
    assert.match(modalCode, new RegExp(token))
  }
  assert.match(chartCode, /calculateVolumeProfile/)
  assert.match(chartCode, /data-chart-indicator-overlay="aligned"/)
  assert.match(chartCode, /Ichimoku Cloud/)
  assert.match(chartCode, /ichimokuSpanA/)
  assert.match(chartCode, /ichimokuSpanB/)
})

test("runtime and resize cleanup invalidate stale async chart initialization", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const wrapperCode = source("components/stock-detail/stock-tradingview-chart-data.tsx")

  assert.match(chartCode, /chartGenerationRef/)
  assert.match(chartCode, /if \(disposed \|\| chartGenerationRef\.current !== generation/)
  assert.match(chartCode, /ResizeObserver/)
  assert.match(chartCode, /resizeObserver\?\.disconnect\(\)/)
  assert.match(chartCode, /chart\?\.remove\(\)/)
  assert.match(chartCode, /unsubscribeVisibleLogicalRangeChange/)
  assert.doesNotMatch(wrapperCode, /HistoryBoundChart key=\{`\$\{props\.ticker\}:\$\{timeframe\}`\}/)
})

test("chart keeps real export and truthful loading/empty states", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(chartCode, /toPng\(/)
  assert.doesNotMatch(chartCode, /window\.alert/)
  assert.match(chartCode, /Đang tải dữ liệu nến/)
  assert.match(chartCode, /Khung \$\{timeframe\} hiện chưa có dữ liệu nến hoàn tất/)
  assert.match(chartCode, /Nến Nhật/)
  assert.match(chartCode, /data-chart-ohlcv-overlay/)
})

test("drawing tools retain object management, text editing, and persistence", () => {
  const toolsCode = source("components/stock-detail/chart/stock-chart-drawing-tools.tsx")
  const managerCode = source("components/stock-detail/chart/stock-chart-object-manager.tsx")
  const editorCode = source("components/stock-detail/chart/stock-chart-text-editor.tsx")
  const syncCode = source("components/stock-detail/chart/use-user-chart-sync.ts")
  const canvasCode = source("components/stock-detail/chart/stock-chart-drawing-canvas.tsx")
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(toolsCode, /id: "ray"/)
  assert.match(toolsCode, /onToggleObjectManager/)
  assert.match(managerCode, /onToggleHide/)
  assert.match(managerCode, /onToggleLock/)
  assert.match(managerCode, /onEditText/)
  assert.match(editorCode, /initialFontSize/)
  assert.match(syncCode, /runtimeDrawingToPersistedV2/)
  assert.match(syncCode, /isDrawingVisibleOnTimeframe/)
  assert.match(syncCode, /drawingSyncStatus/)
  assert.match(syncCode, /retryChartHydration/)
  assert.match(chartCode, /drawingReady=\{drawingSyncStatus === "ready"\}/)
  assert.match(toolsCode, /Đang đồng bộ nét vẽ/)
  assert.match(toolsCode, /disabled=\{!drawingReady\}/)
  assert.match(canvasCode, /pointerEvents: !drawingReady/)
})
