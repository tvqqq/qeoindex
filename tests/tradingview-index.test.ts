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
  resampleCandleSeries,
  timeframeBucketKey,
} from "../lib/index-candles.ts"

const modalSource = readFileSync(new URL("../components/index-chart/index-chart-modal.tsx", import.meta.url), "utf8")
const minuteChartSource = readFileSync(new URL("../components/index-chart/index-minute-chart.tsx", import.meta.url), "utf8")
const historySource = readFileSync(new URL("../lib/dnse-index-candles.ts", import.meta.url), "utf8")
const routeSource = readFileSync(new URL("../app/api/market/index-candles/route.ts", import.meta.url), "utf8")

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

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

test("5m resampling preserves OHLCV and starts a new bucket at 09:05", () => {
  const bars = [
    { time: epoch("2026-08-21T02:00:00Z"), open: 10, high: 11, low: 9, close: 10.5, volume: 10 },
    { time: epoch("2026-08-21T02:01:00Z"), open: 10.5, high: 12, low: 10, close: 11.5, volume: 20 },
    { time: epoch("2026-08-21T02:05:00Z"), open: 11.5, high: 13, low: 11, close: 12.5, volume: 30 },
  ]
  const result = resampleCandleSeries(bars, "5", "VNINDEX")
  assert.equal(result.length, 2)
  assert.deepEqual(result[0], { ...bars[0], high: 12, close: 11.5, volume: 30 })
  assert.deepEqual(result[1], bars[2])
})

test("4H buckets are session-anchored and never merge the 13:00 bar into the morning VNINDEX candle", () => {
  const bars = [
    { time: epoch("2026-08-21T02:00:00Z"), open: 10, high: 11, low: 9, close: 10, volume: 10 },
    { time: epoch("2026-08-21T04:00:00Z"), open: 10, high: 12, low: 9.5, close: 11, volume: 20 },
    { time: epoch("2026-08-21T06:00:00Z"), open: 11, high: 13, low: 10.5, close: 12, volume: 30 },
    { time: epoch("2026-08-21T07:00:00Z"), open: 12, high: 14, low: 11.5, close: 13, volume: 40 },
  ]
  const result = resampleCandleSeries(bars, "4H", "VNINDEX")
  assert.equal(result.length, 2)
  assert.equal(result[0].time, bars[0].time)
  assert.equal(result[0].close, 11)
  assert.equal(result[1].time, bars[2].time)
  assert.equal(result[1].close, 13)
})

test("timeframe bucket keys reset on the next Vietnam trading day", () => {
  const firstDay = timeframeBucketKey(epoch("2026-08-21T02:00:00Z"), "VNINDEX", "1H")
  const nextDay = timeframeBucketKey(epoch("2026-08-24T02:00:00Z"), "VNINDEX", "1H")
  assert.notEqual(firstDay, nextDay)
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

test("index chart exposes 1m 5m 30m 1H 4H 1D selectors and timeframe-aware history", () => {
  assert.match(modalSource, /INDEX_CHART_RESOLUTIONS\.map/)
  assert.match(modalSource, /useIndexCandles\(open, resolution\)/)
  assert.match(historySource, /"5": \{ sourceResolution: "5"/)
  assert.match(historySource, /"30": \{ sourceResolution: "30"/)
  assert.match(historySource, /"1H": \{ sourceResolution: "1H"/)
  assert.match(historySource, /"4H": \{ sourceResolution: "1H"/)
  assert.match(historySource, /"1D": \{ sourceResolution: "1D"/)
  assert.match(routeSource, /searchParams\.get\("resolution"\)/)
  assert.match(routeSource, /new Map<IndexChartResolution, CachedPayload>/)
})

test("intraday x-axis uses time-only ticks with day labels and separators through 1H", () => {
  assert.match(minuteChartSource, /TIME_ONLY_FORMATTER/)
  assert.match(minuteChartSource, /dayStartTimes/)
  assert.match(minuteChartSource, /timeToCoordinate/)
  assert.match(minuteChartSource, /isSessionSeparatorResolution\(resolution\)/)
  assert.match(minuteChartSource, /bottom-\[3px\]/)
  assert.match(minuteChartSource, /resolution === "1D" \? DATE_ONLY_FORMATTER/)
})

test("index charts retain readable initial windows while loading deeper timeframe history", () => {
  assert.match(historySource, /lookbackDays: 14, maxPoints: 2_600/)
  assert.match(historySource, /lookbackDays: 1_825, maxPoints: 1_800/)
  assert.match(historySource, /chart-api\/v2\/ohlcs/)
  assert.match(minuteChartSource, /INITIAL_VISIBLE_BARS/)
  assert.match(minuteChartSource, /setVisibleLogicalRange/)
})
