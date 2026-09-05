import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("StockTradingViewChart implements 100% TradingView scroll, zoom out, and coordinate pinning", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  // 1. Viewport slice with visibleBarsCount and scrollOffset
  assert.match(chartCode, /visibleBarsCount/)
  assert.match(chartCode, /scrollOffset/)
  assert.match(chartCode, /displayBars\.slice\(startIdx, endIdx\)/)

  // 2. Mouse Wheel Zoom in and Zoom out
  assert.match(chartCode, /onWheel=\{handleWheel\}/)
  assert.match(chartCode, /deltaY > 0 \? 1 : -1/)

  // 3. Mouse Panning & Scrolling
  assert.match(chartCode, /onMouseDown=\{handleMouseDownCanvas\}/)
  assert.match(chartCode, /onMouseMove=\{handleMouseMoveCanvas\}/)
  assert.match(chartCode, /onMouseUp=\{handleMouseUpCanvas\}/)
  assert.match(chartCode, /isPanningRef\.current/)

  // 4. Coordinate transforms for pinning drawings to price and time
  assert.match(chartCode, /priceToY=\{priceToY\}/)
  assert.match(chartCode, /yToPrice=\{yToPrice\}/)
  assert.match(chartCode, /timeToX=\{timeToX\}/)
  assert.match(chartCode, /xToTime=\{xToTime\}/)

  // 5. Auto-scale reset action
  assert.match(chartCode, /handleResetView/)
})

test("StockTradingViewChart keeps TradingView-style future space and scalable price rail", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  // Latest candle can sit left of the price rail and pan to at least half the visible candle count.
  assert.match(chartCode, /DEFAULT_RIGHT_OFFSET_BARS = 8/)
  assert.match(chartCode, /MIN_MAX_RIGHT_OFFSET_BARS = 32/)
  assert.match(chartCode, /Math\.ceil\(visibleBars\.length \* 0\.5\)/)
  assert.match(chartCode, /maxRightOffsetBars/)
  assert.match(chartCode, /scrollOffset - rightOffsetBars/)
  assert.match(chartCode, /setRightOffsetBars\(Math\.max\(0, -nextPosition\)\)/)
  assert.match(chartCode, /visibleBars\.length \+ rightOffsetBars/)

  // Future blank space owns real projected timestamps so canonical drawings can be created there.
  assert.match(chartCode, /projectFutureTimes/)
  assert.match(chartCode, /futureTimes\[slotIndex - visibleBars\.length\]/)
  assert.match(chartCode, /futureTimes\.findIndex/)

  // Wheel on the Y rail changes only the manual price domain and supports auto-scale reset.
  assert.match(chartCode, /manualPriceDomain/)
  assert.match(chartCode, /isOverPriceAxis/)
  assert.match(chartCode, /setManualPriceDomain\(\{ min: nextMax - nextRange, max: nextMax \}\)/)
  assert.match(chartCode, /onDoubleClick=\{handleResetPriceScale\}/)
  assert.match(chartCode, /cursor-ns-resize/)
})

test("StockTradingViewChart exposes future Ichimoku, volume MA20 and collapsible lower panes", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const indicatorCode = source("components/stock-detail/chart/stock-chart-indicators.ts")

  assert.match(indicatorCode, /ICHIMOKU_DISPLACEMENT = 26/)
  assert.match(indicatorCode, /Array\(n \+ ICHIMOKU_DISPLACEMENT\)/)
  assert.match(indicatorCode, /calculateVolumeSma/)
  assert.match(chartCode, /calculateVolumeSma/)
  assert.match(chartCode, /volumeMa20Path/)
  assert.match(chartCode, /isRsiCollapsed/)
  assert.match(chartCode, /isMacdCollapsed/)
  assert.match(chartCode, /EXPANDED_SUBPANE_HEIGHT = 92/)
  assert.match(chartCode, /vectorEffect="non-scaling-stroke"/)
  assert.match(chartCode, /<CalendarDays/)
})

test("StockChartDrawingCanvas supports object selection, dragging, and anchor handles", () => {
  const canvasCode = source("components/stock-detail/chart/stock-chart-drawing-canvas.tsx")

  // Selected state and anchor handles
  assert.match(canvasCode, /selectedId/)
  assert.match(canvasCode, /onSelectDrawing/)
  assert.match(canvasCode, /dragState/)
  assert.match(canvasCode, /handleIndex/)

  // Floating action toolbar when selected
  assert.match(canvasCode, /selectedDrawing/)
  assert.match(canvasCode, /onUpdateDrawing/)

  // Keyboard shortcut delete listener
  assert.match(canvasCode, /e\.key === "Delete" \|\| e\.key === "Backspace"/)
})

test("StockChartObjectManager provides clear object tree management and text editing", () => {
  const managerCode = source("components/stock-detail/chart/stock-chart-object-manager.tsx")
  const editorCode = source("components/stock-detail/chart/stock-chart-text-editor.tsx")
  const toolsCode = source("components/stock-detail/chart/stock-chart-drawing-tools.tsx")

  // Object manager features
  assert.match(managerCode, /Quản lý đối tượng/)
  assert.match(managerCode, /onToggleHide/)
  assert.match(managerCode, /onToggleLock/)
  assert.match(managerCode, /onEditText/)
  assert.match(managerCode, /onDelete/)
  assert.match(managerCode, /onClearAll/)

  // Text editor features
  assert.match(editorCode, /StockChartTextEditor/)
  assert.match(editorCode, /initialFontSize/)
  assert.match(editorCode, /FONT_SIZES/)
  assert.match(editorCode, /onSave/)

  // Drawing tools button for Object Tree
  assert.match(toolsCode, /onToggleObjectManager/)
  assert.match(toolsCode, /drawingsCount/)
  assert.match(toolsCode, /saveStatus/)

  // Ray and arrow must remain visually distinct tools.
  assert.match(toolsCode, /function RayToolIcon/)
  assert.match(toolsCode, /id: "ray"[^\n]+RayToolIcon/)
  assert.match(toolsCode, /id: "arrow"[^\n]+ArrowUpRight/)
})

test("useUserChartSync manages database persistence and local cache fallback", () => {
  const syncCode = source("components/stock-detail/chart/use-user-chart-sync.ts")

  // Local storage immediate load and save
  assert.match(syncCode, /localStorage\.getItem/)
  assert.match(syncCode, /localStorage\.setItem/)

  // Remote Supabase API sync with debounced POST
  assert.match(syncCode, /fetch\(`\/api\/user\/chart-drawings/)
  assert.match(syncCode, /method: "POST"/)
  assert.match(syncCode, /saveStatus/)
})

test("StockTradingViewChart renders TradingView-style 4 horizontal columns timeframe panel with checkmark", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  // 4 horizontal columns with divider
  assert.match(chartCode, /grid grid-cols-4 divide-x divide-white\/\[0\.08\]/)
  assert.match(chartCode, /title: "Phút"/)
  assert.match(chartCode, /title: "Giờ"/)
  assert.match(chartCode, /title: "Ngày"/)
  assert.match(chartCode, /title: "Năm"/)

  // Row item with fixed-width timeframe ID, label, and active checkmark
  assert.match(chartCode, /font-mono text-\[11px\] font-bold w-8 text-left shrink-0/)
  assert.match(chartCode, /Check className="size-3\.5 text-cyan-400 shrink-0/)

  // Backdrop overlay to close when clicking outside
  assert.match(chartCode, /fixed inset-0 z-40/)
})

test("StockTradingViewChart renders dedicated X-axis (time) and Y-axis (price) rails with crosshairs", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  // Dedicated geometry with right rail (padRight: 68) and bottom rail (padBottom: 26)
  assert.match(chartCode, /padRight = 68/)
  assert.match(chartCode, /padBottom = 26/)

  // Y-axis Price Levels and Grid Lines
  assert.match(chartCode, /priceLevels/)
  assert.match(chartCode, /p\.toFixed\(1\)/)

  // X-axis Time Ticks and Grid Lines
  assert.match(chartCode, /timeTicks/)
  assert.match(chartCode, /height - padBottom \+ 16/)

  // Crosshair hover tracking on both axes
  assert.match(chartCode, /hoverY/)
  assert.match(chartCode, /yToPrice\(hoverY\)\.toFixed\(1\)/)
})

test("StockTradingViewChart implements TitanLabs-style bottom range presets and auto-fit reset", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")

  // Presets and TradingView-style status controls
  assert.match(chartCode, /label: "5N"/)
  assert.match(chartCode, /label: "3N"/)
  assert.match(chartCode, /label: "1N"/)
  assert.match(chartCode, /label: "6T"/)
  assert.match(chartCode, /label: "3T"/)
  assert.match(chartCode, /label: "1T"/)
  assert.match(chartCode, /label: "Tất cả"/)
  assert.match(chartCode, /UTC\+7/)
  assert.match(chartCode, /tự động/)

  // Cursor-anchored wheel zoom calculations
  assert.match(chartCode, /cursorRatio = Math\.max\(0, Math\.min\(1, mouseX \/ Math\.max\(1, plotPx\)\)\)/)
  assert.match(chartCode, /offsetDelta = Math\.round\(diff \* \(1 - cursorRatio\)\)/)
})
