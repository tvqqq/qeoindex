import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  deserializeUserChartSettings,
  isDrawingVisibleOnTimeframe,
  persistedV2ToRuntimeDrawing,
  projectAnchor,
  runtimeDrawingToPersistedV2,
  screenPointToAnchor,
  type CoordinateAdapter,
  type PersistedDrawingV2,
  type UserChartSettingsPayloadV2,
} from "../components/stock-detail/chart/drawings/index.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("Serialization roundtrip preserves canonical V2 values without loss", () => {
  const originalPayload: UserChartSettingsPayloadV2 = {
    ticker: "VNM",
    timeframe: "1D",
    chartStyle: "candles",
    indicators: {
      showMa: true,
      showRsi: false,
      showMacd: true,
      showIchimoku: false,
      showBollinger: false,
      showVolumeProfile: true,
    },
    drawingsSchemaVersion: 2,
    drawings: [
      {
        schemaVersion: 2,
        id: "draw-1",
        tool: "rectangle",
        anchors: [
          { time: 1700000000, price: 72.5 },
          { time: 1700500000, price: 78.0 },
        ],
        sourceTimeframe: "1D",
        visibility: "global",
        style: {
          color: "#00f0ff",
          lineWidth: 2,
        },
        locked: false,
        hidden: false,
      },
      {
        schemaVersion: 2,
        id: "draw-2",
        tool: "text",
        anchors: [{ time: 1700200000, price: 75.0 }],
        sourceTimeframe: "1D",
        visibility: "source-timeframe",
        style: {
          color: "#ffffff",
          lineWidth: 1,
          fontSize: 16,
        },
        text: "Accumulation box",
      },
    ],
    updatedAt: "2026-09-05T12:00:00.000Z",
  }

  const json = JSON.stringify(originalPayload)
  const { settings: restored } = deserializeUserChartSettings(json)

  assert.equal(restored.ticker, originalPayload.ticker)
  assert.equal(restored.timeframe, originalPayload.timeframe)
  assert.equal(restored.chartStyle, originalPayload.chartStyle)
  assert.deepEqual(restored.indicators, originalPayload.indicators)
  assert.equal(restored.drawingsSchemaVersion, 2)
  assert.equal(restored.drawings.length, 2)
  assert.deepEqual(restored.drawings, originalPayload.drawings)
})

test("Viewport independence: changing screen dimensions does not alter persisted anchors", () => {
  const persistedDrawing: PersistedDrawingV2 = {
    schemaVersion: 2,
    id: "draw-fixed",
    tool: "trendline",
    anchors: [
      { time: 1700000000, price: 50.0 },
      { time: 1700100000, price: 55.0 },
    ],
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#a855f7", lineWidth: 2 },
  }

  // Viewport A (Small mobile screen: 375x600)
  const adapterA: CoordinateAdapter = {
    timeToX: (t) => (t - 1700000000) / 1000, // 0 to 100
    priceToY: (p) => (60 - p) * 10,           // 100 to 50
  }
  const ptA0 = projectAnchor(persistedDrawing.anchors[0], adapterA)
  const ptA1 = projectAnchor(persistedDrawing.anchors[1], adapterA)
  assert.deepEqual(ptA0, { x: 0, y: 100 })
  assert.deepEqual(ptA1, { x: 100, y: 50 })

  // Viewport B (Large desktop screen: 1920x1080)
  const adapterB: CoordinateAdapter = {
    timeToX: (t) => ((t - 1700000000) / 1000) * 5, // 0 to 500
    priceToY: (p) => (60 - p) * 30,                 // 300 to 150
  }
  const ptB0 = projectAnchor(persistedDrawing.anchors[0], adapterB)
  const ptB1 = projectAnchor(persistedDrawing.anchors[1], adapterB)
  assert.deepEqual(ptB0, { x: 0, y: 300 })
  assert.deepEqual(ptB1, { x: 500, y: 150 })

  // The persisted anchors remain strictly untouched
  assert.deepEqual(persistedDrawing.anchors, [
    { time: 1700000000, price: 50.0 },
    { time: 1700100000, price: 55.0 },
  ])
  assert.equal("x" in persistedDrawing.anchors[0], false)
  assert.equal("y" in persistedDrawing.anchors[0], false)
})

test("CoordinateAdapter projections projectAnchor and screenPointToAnchor", () => {
  const adapter: CoordinateAdapter = {
    timeToX: (t) => (t - 1000) * 2,
    yToPrice: (y) => 100 - y / 10,
    xToTime: (x) => 1000 + x / 2,
    priceToY: (p) => (100 - p) * 10,
  }

  // Anchor -> Screen
  const anchor = { time: 1050, price: 85 }
  const screen = projectAnchor(anchor, adapter)
  assert.deepEqual(screen, { x: 100, y: 150 })

  // Screen -> Anchor
  const convertedBack = screenPointToAnchor(screen!, adapter)
  assert.deepEqual(convertedBack, anchor)

  // Incomplete adapter returns null safely
  const incompleteAdapter: CoordinateAdapter = {}
  assert.equal(projectAnchor(anchor, incompleteAdapter), null)
  assert.equal(screenPointToAnchor({ x: 100, y: 150 }, incompleteAdapter), null)
})

test("Runtime roundtrip preserves persisted source timeframe and visibility metadata", () => {
  const persistedDrawing: PersistedDrawingV2 = {
    schemaVersion: 2,
    id: "scoped-drawing",
    tool: "trendline",
    anchors: [
      { time: 1700000000, price: 50 },
      { time: 1700100000, price: 55 },
    ],
    sourceTimeframe: "1h",
    visibility: "source-timeframe",
    style: { color: "#00f0ff", lineWidth: 2 },
  }

  const runtime = persistedV2ToRuntimeDrawing(persistedDrawing)
  const restored = runtimeDrawingToPersistedV2(runtime, "1D")

  assert.ok(restored)
  assert.equal(restored.sourceTimeframe, "1h")
  assert.equal(restored.visibility, "source-timeframe")
})

test("source-timeframe visibility is runtime-only and legacy-safe", () => {
  assert.equal(isDrawingVisibleOnTimeframe({ visibility: "global", sourceTimeframe: "1D" }, "1h"), true)
  assert.equal(isDrawingVisibleOnTimeframe({ visibility: "source-timeframe", sourceTimeframe: "1D" }, "1D"), true)
  assert.equal(isDrawingVisibleOnTimeframe({ visibility: "source-timeframe", sourceTimeframe: "1D" }, "1h"), false)

  // Malformed legacy scope remains visible instead of silently hiding user content.
  assert.equal(isDrawingVisibleOnTimeframe({ visibility: "source-timeframe" }, "1h"), true)
})

test("useUserChartSync carries unresolved legacy drawings into every V2 save payload", () => {
  const code = source("components/stock-detail/chart/use-user-chart-sync.ts")

  assert.match(code, /unresolvedLegacyDrawingsRef/)
  assert.match(code, /unresolvedLegacyDrawings:\s*unresolvedLegacyDrawingsRef\.current/)
})

test("new runtime drawings retain their creation timeframe across later timeframe saves", () => {
  const code = source("components/stock-detail/chart/use-user-chart-sync.ts")

  assert.match(code, /sourceTimeframe:\s*runtimeDrawing\.sourceTimeframe\s*\?\?\s*timeframe/)
  assert.match(code, /visibility:\s*runtimeDrawing\.visibility\s*\?\?\s*"global"/)
})

test("useUserChartSync keeps full persistence set while exposing current-timeframe drawings", () => {
  const code = source("components/stock-detail/chart/use-user-chart-sync.ts")

  assert.match(code, /const \[allDrawings, setAllDrawings\]/)
  assert.match(code, /allDrawings\.filter/)
  assert.match(code, /isDrawingVisibleOnTimeframe/)
  assert.match(code, /scheduleSave\(tf, chartStyle, indicators, allDrawings\)/)
  assert.match(code, /scheduleSave\(timeframe, st, indicators, allDrawings\)/)
})

test("Phase B chart path projects market coordinates and supports ray rendering", () => {
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

test("horizontal drawings use one canonical anchor and render across viewport", () => {
  const canvasCode = source("components/stock-detail/chart/stock-chart-drawing-canvas.tsx")

  assert.match(canvasCode, /tool: "horizontal",[\s\S]*?points: \[point\]/)
  assert.match(canvasCode, /lineStart = draw\.tool === "horizontal" \? \{ x: 0, y: p1\.y \} : p1/)
  assert.match(canvasCode, /draw\.tool === "horizontal"[\s\S]*?\{ x: width, y: p1\.y \}/)
})

test("Rapid save queue simulation ensures latest revision wins without overlapping requests", async () => {
  // Simulates the coalesced queue behavior in useUserChartSync
  let inFlight = false
  let inFlightCount = 0
  let maxConcurrent = 0
  const savedRevisions: number[] = []

  let pendingItem: { revision: number; data: string } | null = null

  async function mockRemoteSave(data: string, rev: number): Promise<void> {
    inFlight = true
    inFlightCount++
    maxConcurrent = Math.max(maxConcurrent, inFlightCount)
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 20))
    savedRevisions.push(rev)
    inFlightCount--
    inFlight = false
  }

  async function processQueue(): Promise<void> {
    if (inFlight || !pendingItem) return
    const current = pendingItem
    pendingItem = null
    await mockRemoteSave(current.data, current.revision)
    if (pendingItem) {
      await processQueue()
    }
  }

  function enqueue(rev: number, data: string) {
    // New changes replace pending payload
    pendingItem = { revision: rev, data }
    void processQueue()
  }

  // Rapid edits 1, 2, 3
  enqueue(1, "edit-A")
  enqueue(2, "edit-B")
  enqueue(3, "edit-C")

  // Wait for queue to drain
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Concurrency must never exceed 1
  assert.equal(maxConcurrent, 1, "At most one remote write should be in-flight")

  // The final saved revision must be the latest (3)
  assert.ok(savedRevisions.length >= 1)
  assert.equal(savedRevisions.at(-1), 3, "Latest revision must be persisted")
  assert.ok(!savedRevisions.includes(2), "Revision 2 was superseded before send")
})
