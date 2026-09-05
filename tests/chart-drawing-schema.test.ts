import assert from "node:assert/strict"
import test from "node:test"
import {
  MAX_ANCHORS_PER_DRAWING,
  MAX_DRAWINGS_PER_TICKER,
  MAX_DRAWING_TEXT_LENGTH,
  validateDrawingV2,
  validateDrawingsCollectionV2,
  type PersistedDrawingV2,
} from "../components/stock-detail/chart/drawings/index.ts"

test("validateDrawingV2 accepts a well-formed V2 drawing", () => {
  const validDrawing: PersistedDrawingV2 = {
    schemaVersion: 2,
    id: "draw-trend-1",
    tool: "trendline",
    anchors: [
      { time: 1700000000, price: 54.5 },
      { time: 1700100000, price: 58.2 },
    ],
    sourceTimeframe: "1D",
    visibility: "global",
    style: {
      color: "#00f0ff",
      lineWidth: 2,
    },
  }

  const result = validateDrawingV2(validDrawing)
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test("validateDrawingV2 accepts valid text and icon drawings", () => {
  const textDrawing: PersistedDrawingV2 = {
    schemaVersion: 2,
    id: "draw-text-1",
    tool: "text",
    anchors: [{ time: 1700000000, price: 100 }],
    sourceTimeframe: "15m",
    visibility: "source-timeframe",
    style: {
      color: "#ffffff",
      lineWidth: 1,
      fontSize: 14,
    },
    text: "Key resistance level",
  }

  const resultText = validateDrawingV2(textDrawing)
  assert.equal(resultText.valid, true)

  const iconDrawing: PersistedDrawingV2 = {
    schemaVersion: 2,
    id: "draw-icon-1",
    tool: "icon",
    anchors: [{ time: 1700000000, price: 95 }],
    sourceTimeframe: "1D",
    visibility: "global",
    style: {
      color: "#f59e0b",
      lineWidth: 2,
    },
    iconType: "star",
    locked: true,
    hidden: false,
  }

  const resultIcon = validateDrawingV2(iconDrawing)
  assert.equal(resultIcon.valid, true)
})

test("validateDrawingV2 rejects non-finite coordinates (NaN, Infinity)", () => {
  const nanTime = {
    schemaVersion: 2,
    id: "draw-nan-time",
    tool: "trendline",
    anchors: [
      { time: Number.NaN, price: 50 },
      { time: 1700100000, price: 55 },
    ],
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#00f0ff", lineWidth: 2 },
  }
  const resNanTime = validateDrawingV2(nanTime)
  assert.equal(resNanTime.valid, false)
  assert.ok(resNanTime.errors.some((e) => e.includes("finite numeric time and price")))

  const infPrice = {
    schemaVersion: 2,
    id: "draw-inf-price",
    tool: "horizontal",
    anchors: [{ time: 1700000000, price: Number.POSITIVE_INFINITY }],
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#00f0ff", lineWidth: 2 },
  }
  const resInfPrice = validateDrawingV2(infPrice)
  assert.equal(resInfPrice.valid, false)
  assert.ok(resInfPrice.errors.some((e) => e.includes("finite numeric time and price")))
})

test("validateDrawingV2 rejects incorrect schema version", () => {
  const wrongVersion = {
    schemaVersion: 1,
    id: "draw-v1",
    tool: "trendline",
    anchors: [{ time: 1700000000, price: 50 }],
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#00f0ff", lineWidth: 2 },
  }
  const result = validateDrawingV2(wrongVersion)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("Expected schemaVersion 2")))
})

test("validateDrawingV2 rejects unknown drawing tools", () => {
  const unknownTool = {
    schemaVersion: 2,
    id: "draw-unknown",
    tool: "fibonacci_spiral",
    anchors: [{ time: 1700000000, price: 50 }],
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#00f0ff", lineWidth: 2 },
  }
  const result = validateDrawingV2(unknownTool)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("Invalid drawing tool")))
})

test("validateDrawingV2 enforces anchor count constraints", () => {
  const emptyAnchors = {
    schemaVersion: 2,
    id: "draw-no-anchors",
    tool: "rectangle",
    anchors: [],
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#00f0ff", lineWidth: 2 },
  }
  assert.equal(validateDrawingV2(emptyAnchors).valid, false)

  const excessAnchors = {
    schemaVersion: 2,
    id: "draw-too-many-anchors",
    tool: "rectangle",
    anchors: Array.from({ length: MAX_ANCHORS_PER_DRAWING + 1 }, (_, i) => ({
      time: 1700000000 + i * 1000,
      price: 50 + i,
    })),
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#00f0ff", lineWidth: 2 },
  }
  const excessResult = validateDrawingV2(excessAnchors)
  assert.equal(excessResult.valid, false)
  assert.ok(excessResult.errors.some((e) => e.includes("cannot exceed")))
})

test("validateDrawingV2 enforces text length constraint", () => {
  const longText = {
    schemaVersion: 2,
    id: "draw-long-text",
    tool: "text",
    anchors: [{ time: 1700000000, price: 50 }],
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#ffffff", lineWidth: 1 },
    text: "A".repeat(MAX_DRAWING_TEXT_LENGTH + 1),
  }
  const result = validateDrawingV2(longText)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("exceeds maximum length")))
})

test("validateDrawingsCollectionV2 enforces maximum drawings per ticker", () => {
  const baseDrawing: PersistedDrawingV2 = {
    schemaVersion: 2,
    id: "draw-base",
    tool: "trendline",
    anchors: [{ time: 1700000000, price: 50 }],
    sourceTimeframe: "1D",
    visibility: "global",
    style: { color: "#00f0ff", lineWidth: 2 },
  }

  const withinLimit = Array.from({ length: MAX_DRAWINGS_PER_TICKER }, (_, i) => ({
    ...baseDrawing,
    id: `draw-${i}`,
  }))
  assert.equal(validateDrawingsCollectionV2(withinLimit).valid, true)

  const overLimit = Array.from({ length: MAX_DRAWINGS_PER_TICKER + 1 }, (_, i) => ({
    ...baseDrawing,
    id: `draw-${i}`,
  }))
  const overResult = validateDrawingsCollectionV2(overLimit)
  assert.equal(overResult.valid, false)
  assert.ok(overResult.errors[0].includes("exceeds maximum limit"))
})
