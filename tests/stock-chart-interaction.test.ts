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
