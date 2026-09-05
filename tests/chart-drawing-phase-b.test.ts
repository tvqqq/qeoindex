import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { isDrawingVisibleOnTimeframe } from "../components/stock-detail/chart/drawings/index.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("source-timeframe visibility is runtime-only and legacy-safe", () => {
  assert.equal(isDrawingVisibleOnTimeframe({ visibility: "global", sourceTimeframe: "1D" }, "1h"), true)
  assert.equal(isDrawingVisibleOnTimeframe({ visibility: "source-timeframe", sourceTimeframe: "1D" }, "1D"), true)
  assert.equal(isDrawingVisibleOnTimeframe({ visibility: "source-timeframe", sourceTimeframe: "1D" }, "1h"), false)

  // A malformed legacy scope must not make user content disappear silently.
  assert.equal(isDrawingVisibleOnTimeframe({ visibility: "source-timeframe" }, "1h"), true)
})

test("useUserChartSync keeps the full persistence set while exposing only current-timeframe drawings", () => {
  const code = source("components/stock-detail/chart/use-user-chart-sync.ts")

  assert.match(code, /const \[allDrawings, setAllDrawings\]/)
  assert.match(code, /allDrawings\.filter/)
  assert.match(code, /isDrawingVisibleOnTimeframe/)
  assert.match(code, /scheduleSave\(tf, chartStyle, indicators, allDrawings\)/)
  assert.match(code, /scheduleSave\(timeframe, st, indicators, allDrawings\)/)
})

test("Phase B chart path projects canonical market coordinates and supports ray rendering", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const canvasCode = source("components/stock-detail/chart/stock-chart-drawing-canvas.tsx")
  const toolsCode = source("components/stock-detail/chart/stock-chart-drawing-tools.tsx")

  assert.match(chartCode, /priceToY=\{priceToY\}/)
  assert.match(chartCode, /yToPrice=\{yToPrice\}/)
  assert.match(chartCode, /timeToX=\{timeToX\}/)
  assert.match(chartCode, /xToTime=\{xToTime\}/)

  assert.match(canvasCode, /Canonical market coordinates always win over stale runtime x\/y values/)
  assert.match(canvasCode, /draw\.tool === "ray"/)
  assert.match(canvasCode, /resolveRayEnd/)
  assert.match(toolsCode, /id: "ray"/)
})

test("horizontal drawings use one canonical anchor and render across the viewport", () => {
  const canvasCode = source("components/stock-detail/chart/stock-chart-drawing-canvas.tsx")

  assert.match(canvasCode, /tool: "horizontal",[\s\S]*?points: \[point\]/)
  assert.match(canvasCode, /lineStart = draw\.tool === "horizontal" \? \{ x: 0, y: p1\.y \} : p1/)
  assert.match(canvasCode, /draw\.tool === "horizontal"[\s\S]*?\{ x: width, y: p1\.y \}/)
})
