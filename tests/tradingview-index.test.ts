import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { parseTradingViewIndexes } from "../lib/tradingview-index.ts"
import {
  EMPTY_VNINDEX_ACCUMULATOR,
  accumulateVnindexFrame,
  mergeCandleSeries,
  mergePartialCandle,
  normalizeDnseOhlcFrame,
} from "../lib/index-candles.ts"

const modalSource = readFileSync(new URL("../components/index-chart/index-chart-modal.tsx", import.meta.url), "utf8")
const minuteChartSource = readFileSync(new URL("../components/index-chart/index-minute-chart.tsx", import.meta.url), "utf8")
const historySource = readFileSync(new URL("../lib/dnse-index-candles.ts", import.meta.url), "utf8")

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

test("DNSE 1m OHLC frame keeps exact OHLCV including string derivative volume", () => {
  const normalized = normalizeDnseOhlcFrame({
    T: "b",
    symbol: "VN30F1M",
    resolution: "1",
    time: 1787282400,
    open: 1881.2,
    high: 1882.4,
    low: 1880.9,
    close: 1882.1,
    volume: "120",
  })
  assert.deepEqual(normalized, {
    symbol: "VN30F1M",
    bar: { time: 1787282400, open: 1881.2, high: 1882.4, low: 1880.9, close: 1882.1, volume: 120 },
  })
})

test("DNSE derivative OHLC prefers VN30F1M symbolType over the resolved contract code", () => {
  const normalized = normalizeDnseOhlcFrame({
    T: "b",
    symbol: "41I1G4000",
    symbolType: "VN30F1M",
    resolution: "1",
    time: 1787282400,
    open: 1881.2,
    high: 1882.4,
    low: 1880.9,
    close: 1882.1,
    volume: 120,
  })
  assert.equal(normalized?.symbol, "VN30F1M")
  assert.equal(normalized?.bar.close, 1882.1)
})

test("DNSE candle validation refuses fabricated or inconsistent high/low", () => {
  assert.equal(normalizeDnseOhlcFrame({ symbol: "VN30F1M", time: 1, open: 10, close: 11, volume: 3 }), null)
  assert.equal(normalizeDnseOhlcFrame({ symbol: "VN30F1M", time: 1, open: 10, high: 10.5, low: 9, close: 11, volume: 3 }), null)
})

test("partial VNINDEX realtime candle enriches REST candle without destroying session open/high/low", () => {
  const rest = { time: 100, open: 1700, high: 1704, low: 1699, close: 1702, volume: 1_000_000 }
  const partial = { time: 100, open: 1702, high: 1706, low: 1701, close: 1705, volume: 50_000 }
  assert.deepEqual(mergePartialCandle(rest, partial), {
    time: 100,
    open: 1700,
    high: 1706,
    low: 1699,
    close: 1705,
    volume: 1_000_000,
  })
})

test("REST bootstrap merge preserves newer full live candle and partial VNINDEX semantics", () => {
  const rest = [{ time: 60, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }]
  const live = [{ time: 60, open: 10.5, high: 12, low: 10.2, close: 11.8, volume: 15 }]
  assert.deepEqual(mergeCandleSeries(rest, live, new Set([60])), [
    { time: 60, open: 10, high: 12, low: 9, close: 11.8, volume: 100 },
  ])
  assert.deepEqual(mergeCandleSeries(rest, live), live)
})

test("VNINDEX market-index ticks aggregate into one-minute candles and cumulative-volume delta", () => {
  const first = accumulateVnindexFrame(EMPTY_VNINDEX_ACCUMULATOR, {
    T: "mi",
    indexName: "VNINDEX",
    time: 1787282405,
    valueIndexes: 1740,
    totalVolumeTraded: 1_000_000,
  })
  assert.ok(first)
  const second = accumulateVnindexFrame(first.state, {
    T: "mi",
    indexName: "VNINDEX",
    time: 1787282440,
    valueIndexes: 1743,
    totalVolumeTraded: 1_040_000,
  })
  assert.ok(second)
  assert.equal(second.bar.time, Math.floor(1787282440 / 60) * 60)
  assert.equal(second.bar.open, 1740)
  assert.equal(second.bar.high, 1743)
  assert.equal(second.bar.low, 1740)
  assert.equal(second.bar.close, 1743)
  assert.equal(second.bar.volume, 40_000)
})

test("index chart modal keeps orderbook-style floating window controls", () => {
  assert.match(modalSource, /onPointerDown=\{startDrag\}/)
  assert.match(modalSource, /startResize\("se", event\)/)
  assert.match(modalSource, /setIsMaximized/)
  assert.match(modalSource, /setIsMinimized/)
  assert.match(modalSource, /<Maximize2/)
  assert.match(modalSource, /<Minimize2/)
  assert.match(modalSource, /<Minus/)
})

test("index charts preload multiple sessions while keeping latest bars readable", () => {
  assert.match(historySource, /HISTORY_LOOKBACK_DAYS = 14/)
  assert.match(historySource, /DEFAULT_MAX_POINTS = 2_600/)
  assert.match(historySource, /chart-api\/v2\/ohlcs/)
  assert.doesNotMatch(historySource, /sessionBars\.slice/)
  assert.match(minuteChartSource, /INITIAL_VISIBLE_BARS = 420/)
  assert.match(minuteChartSource, /setVisibleLogicalRange/)
})
