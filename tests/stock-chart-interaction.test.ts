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
import {
  chartHistoryIdentity,
  renderBarsForChartIdentity,
} from "../components/stock-detail/chart/chart-history-identity.ts"
import {
  canonicalPaneGeometry,
  drawablePaneBudget,
} from "../components/stock-detail/chart/chart-pane-geometry.ts"
import {
  chartTimeRangeForBars,
  shiftVisibleLogicalRange,
} from "../components/stock-detail/chart/chart-viewport.ts"
import {
  clampDrawingPoint,
  hasCanonicalDrawingAnchor,
  isInsideDrawingBounds,
} from "../components/stock-detail/chart/drawing-bounds.ts"

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

test("chart history identity never exposes the previous timeframe family during reset", () => {
  const daily = [{ timeframe: "1D", time: 1 }]
  const weekly = [{ timeframe: "1W", time: 7 }]
  const monthly = [{ timeframe: "1M", time: 30 }]

  let committedKey = chartHistoryIdentity("VIC", "1D")
  let committedBars = daily
  for (const [timeframe, targetBars] of [["1W", weekly], ["1M", monthly], ["1D", daily]] as const) {
    const requestedKey = chartHistoryIdentity("VIC", timeframe)
    const rendered = renderBarsForChartIdentity(committedKey, requestedKey, committedBars, targetBars)
    assert.deepEqual(rendered, targetBars, `${timeframe} must render its own family before layout reset commits`)
    assert.notEqual(rendered, committedBars)
    committedKey = requestedKey
    committedBars = targetBars
  }

  assert.deepEqual(
    renderBarsForChartIdentity(committedKey, chartHistoryIdentity("VIC", "1W"), committedBars, []),
    [],
    "an unprepared target must render an empty/loading state, never stale bars",
  )
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

test("timeframe reset uses canonical timestamps while history prepend preserves logical position", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const bars = Array.from({ length: 100 }, (_, index) => ({ time: index + 1 }))
  const futureTimes = Array.from({ length: 12 }, (_, index) => 101 + index)

  assert.match(chartCode, /projectFutureTimes/)
  assert.match(chartCode, /futureTimes\.map\(\(time\) => \(\{ time \}\)\)/)
  assert.match(chartCode, /Math\.ceil\(Math\.max\(1, displayBars\.length\) \* 0\.5\)/)
  assert.match(chartCode, /const rightOffset = DEFAULT_RIGHT_OFFSET_BARS/)
  assert.doesNotMatch(chartCode, /Math\.max\(DEFAULT_RIGHT_OFFSET_BARS, Math\.ceil\(visibleBars \* 0\.5\)\)/)
  assert.match(chartCode, /chartTimeRangeForBars/)
  assert.match(chartCode, /setVisibleRange/)
  assert.match(chartCode, /setVisibleLogicalRange/)
  assert.match(chartCode, /Prepending older history shifts logical indexes/)

  assert.deepEqual(chartTimeRangeForBars(bars, futureTimes, 30, 8), { from: 71, to: 108 })
  const tradingCalendarBars = [
    { time: Date.UTC(2026, 8, 11) / 1000 },
    { time: Date.UTC(2026, 8, 14) / 1000 },
    { time: Date.UTC(2026, 8, 18) / 1000 },
    { time: Date.UTC(2026, 8, 25) / 1000 },
  ]
  const projectedSessions = [
    Date.UTC(2026, 8, 28) / 1000,
    Date.UTC(2026, 9, 2) / 1000,
  ]
  assert.deepEqual(
    chartTimeRangeForBars(tradingCalendarBars, projectedSessions, 3, 1),
    { from: tradingCalendarBars[1].time, to: projectedSessions[0] },
  )
  assert.deepEqual(shiftVisibleLogicalRange({ from: 10.5, to: 20.5 }, 7), { from: 17.5, to: 27.5 })
})

test("native panes own volume, permanent maximized RSI/MACD and collapse heights", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(chartCode, /calculateRsiSeries/)
  assert.match(chartCode, /calculateMacdSeries/)
  assert.match(chartCode, /runtime\.HistogramSeries/)
  assert.match(chartCode, /chart\.panes\(\)/)
  assert.match(chartCode, /panes\[0\]\?\.setHeight\(paneHeights\.main\)/)
  assert.match(chartCode, /canonicalPaneGeometry/)
  assert.match(chartCode, /isRsiCollapsed/)
  assert.match(chartCode, /isMacdCollapsed/)
  assert.match(chartCode, /priceFormat: \{ type: "price", precision: 2, minMove: 0\.01 \}/)
  assert.match(chartCode, /priceFormat: \{ type: "price", precision: 4, minMove: 0\.0001 \}/)
  assert.match(chartCode, /indicatorVisibility/)

  const expanded = canonicalPaneGeometry({
    hostHeight: 1072,
    isMaximized: true,
    rsiCollapsed: false,
    macdCollapsed: false,
  })
  const collapsed = canonicalPaneGeometry({
    hostHeight: 1072,
    isMaximized: true,
    rsiCollapsed: true,
    macdCollapsed: true,
  })
  assert.equal(expanded.main + expanded.volume + expanded.rsi + expanded.macd, drawablePaneBudget(1072))
  assert.equal(collapsed.main + collapsed.volume + collapsed.rsi + collapsed.macd, drawablePaneBudget(1072))
  assert.equal(collapsed.rsi, 24)
  assert.equal(collapsed.macd, 24)
})

test("chart wheel history and drawing bounds have one explicit owner", () => {
  const wrapperCode = source("components/stock-detail/stock-tradingview-chart-data.tsx")
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const canvasCode = source("components/stock-detail/chart/stock-chart-drawing-canvas.tsx")

  assert.doesNotMatch(wrapperCode, /onWheelCapture/)
  assert.match(chartCode, /handleScroll:[\s\S]*mouseWheel: true/)
  assert.match(chartCode, /handleScale:[\s\S]*mouseWheel: true/)
  assert.match(chartCode, /width=\{drawingWidth\}/)
  assert.match(chartCode, /height=\{mainPaneHeight\}/)
  assert.match(chartCode, /getHeight/)
  assert.match(chartCode, /data-chart-pane-geometry/)
  assert.match(chartCode, /onDrawingComplete=\{\(\) => setActiveTool\("cursor"\)\}/)
  assert.match(canvasCode, /clipPathId/)
  assert.match(canvasCode, /data-drawing-width/)
  assert.match(canvasCode, /hasCanonicalDrawingAnchor/)

  const bounds = { width: 900, height: 500 }
  assert.deepEqual(clampDrawingPoint({ x: -10, y: 530 }, bounds), { x: 0, y: 500 })
  assert.equal(isInsideDrawingBounds({ x: 450, y: 250 }, bounds), true)
  assert.equal(isInsideDrawingBounds({ x: 450, y: 501 }, bounds), false)
  assert.equal(hasCanonicalDrawingAnchor({ time: 100, price: 25.5 }), true)
  assert.equal(hasCanonicalDrawingAnchor({ time: 100 }), false)
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

test("QEO-241 chart product exposes only fixed 1D, 1W and 1M controls", () => {
  const typesCode = source("components/stock-detail/chart/stock-chart-types.ts")
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(typesCode, /export type ChartTimeframe = "1D" \| "1W" \| "1M"/)
  assert.match(typesCode, /QUICK_TIMEFRAMES[^\n]*\["1D", "1W", "1M"\]/)
  assert.doesNotMatch(typesCode, /"3D"|"1Q"|"1Y"/)
  assert.match(chartCode, /QUICK_TIMEFRAMES\.map/)
  assert.doesNotMatch(chartCode, /showTfDropdown|setShowTfDropdown|Chọn khung thời gian|ALL_TIMEFRAMES\.map/)
})

test("QEO-241 ticker navigation no longer has a 3D remote preparation special case", () => {
  const workstationCode = source("components/stock-detail/stock-detail-workstation.tsx")
  assert.doesNotMatch(workstationCode, /targetTimeframe\s*===\s*["']3D["']/)
})

test("QEO-241 OHLCV route fails closed for retired 3D, 1Q and 1Y resolutions", () => {
  const routeCode = source("app/api/market/ohlcv/route.ts")
  assert.match(routeCode, /new Set\(\["3D",\s*"1Q",\s*"1Y"\]\)/)
  assert.match(routeCode, /TIMEFRAME_RETIRED/)
})
