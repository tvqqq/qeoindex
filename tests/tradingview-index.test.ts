import assert from "node:assert/strict"
import test from "node:test"

import { parseTradingViewIndexes } from "../lib/tradingview-index.ts"

test("TradingView scan maps VNINDEX and VN30 snapshots", () => {
  const quotes = parseTradingViewIndexes({ data: [
    { s: "HOSE:VNINDEX", d: [1727.46, -0.09369, -1.62] },
    { s: "HOSE:VN30", d: [1877.68, 0.04635, 0.87] },
  ] }, "2026-08-17T08:00:00.000Z")
  assert.deepEqual(quotes.VNINDEX, { symbol: "VNINDEX", value: 1727.46, change: -1.62, changePercent: -0.09369, updatedAt: "2026-08-17T08:00:00.000Z" })
  assert.equal(quotes.VN30.value, 1877.68)
})

test("TradingView scan ignores zero and malformed rows", () => {
  const quotes = parseTradingViewIndexes({ data: [
    { s: "HOSE:VNINDEX", d: [0, 1, 1] },
    { s: "UNKNOWN", d: [100, 1, 1] },
  ] })
  assert.deepEqual(quotes, {})
})
