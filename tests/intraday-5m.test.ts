import assert from "node:assert/strict"
import test from "node:test"

import { fiveMinuteBucket, intradaySnapshot, mergeFiveMinuteClose, normalizeEpochSeconds, normalizeFiveMinuteBars, normalizeMarketPrice, previousSessionClose, selectLatestSession } from "../lib/intraday-5m.ts"

test("five-minute buckets keep minute bars in the same candle", () => {
  const start = Date.UTC(2026, 7, 17, 2, 0, 0) / 1000
  assert.equal(fiveMinuteBucket(start), fiveMinuteBucket(start + 299))
  assert.notEqual(fiveMinuteBucket(start), fiveMinuteBucket(start + 300))
})

test("epoch timestamps accept seconds, milliseconds, and a fallback", () => {
  assert.equal(normalizeEpochSeconds(1_776_561_000, 1), 1_776_561_000)
  assert.equal(normalizeEpochSeconds(1_776_561_000_000, 1), 1_776_561_000)
  assert.equal(normalizeEpochSeconds("invalid", 123), 123)
})

test("intraday snapshot uses prior-session reference, not session open", () => {
  const snapshot = intradaySnapshot([{ open: 24_900, close: 25_200 }, { open: 25_200, close: 24_750 }], 25_100)
  assert.equal(snapshot.reference, 25_100)
  assert.equal(snapshot.price, 24_750)
  assert.equal(snapshot.change, -350)
  assert.ok(snapshot.changePercent !== null)
  assert.ok(Math.abs(snapshot.changePercent - (-350 / 25_100) * 100) < 1e-9)
  assert.deepEqual(intradaySnapshot([], null), { reference: null, price: null, change: null, changePercent: null })
})

test("previous session close is the daily reference for the selected session", () => {
  const friday = Date.UTC(2026, 7, 14, 7, 0, 0) / 1000
  const monday = Date.UTC(2026, 7, 17, 2, 15, 0) / 1000
  const bars = [
    { time: friday, close: 25_100 },
    { time: monday, close: 25_200 },
    { time: monday + 300, close: 24_750 },
  ]
  const dateOf = (bar: { time: number }) => new Date(bar.time * 1000).toISOString().slice(0, 10)
  assert.equal(previousSessionClose(bars, "2026-08-17", dateOf, (bar) => bar.close), 25_100)
  assert.equal(previousSessionClose(bars, "2026-08-14", dateOf, (bar) => bar.close), null)
})

test("five-minute normalization collapses partial updates and fills quiet intervals", () => {
  const start = Date.UTC(2026, 7, 17, 2, 15, 0) / 1000
  const bars = normalizeFiveMinuteBars([
    { time: start, open: 10, high: 10, low: 10, close: 10, volume: 100 },
    { time: start + 24, open: 10, high: 10.2, low: 10, close: 10.2, volume: 120 },
    { time: start + 600, open: 10.2, high: 10.4, low: 10.2, close: 10.4, volume: 80 },
  ], start + 600)
  assert.deepEqual(bars.map((bar) => ({ time: bar.time, open: bar.open, close: bar.close, volume: bar.volume })), [
    { time: start, open: 10, close: 10.2, volume: 120 },
    { time: start + 300, open: 10.2, close: 10.2, volume: 0 },
    { time: start + 600, open: 10.2, close: 10.4, volume: 80 },
  ])
})

test("five-minute normalization extends an inactive stock to the requested session time", () => {
  const start = Date.UTC(2026, 7, 17, 2, 15, 0) / 1000
  const bars = normalizeFiveMinuteBars([
    { time: start, open: 20, high: 20, low: 20, close: 20, volume: 10 },
  ], start + 900)
  assert.equal(bars.length, 4)
  assert.deepEqual(bars.map((bar) => bar.close), [20, 20, 20, 20])
})

test("five-minute normalization drops Yahoo zero-price candles after the close", () => {
  const start = Date.UTC(2026, 7, 17, 2, 15, 0) / 1000
  const bars = normalizeFiveMinuteBars([
    { time: start, open: 58_000, high: 58_500, low: 58_000, close: 58_500, volume: 100 },
    { time: start + 300, open: 0, high: 0, low: 0, close: 0, volume: 0 },
  ], start + 300)
  assert.deepEqual(bars.map((bar) => bar.close), [58_500, 58_500])
})

test("live closes update the matching bucket without resetting history", () => {
  const start = Date.UTC(2026, 7, 17, 2, 15, 0) / 1000
  const history = Array.from({ length: 54 }, (_, index) => ({ time: start + index * 300, close: 50_000 + index * 10 }))
  const updated = mergeFiveMinuteClose(history, 51_000, history.at(-1)!.time + 120)
  assert.equal(updated.length, 54)
  assert.equal(updated.at(-1)?.close, 51_000)

  const appended = mergeFiveMinuteClose(updated, 51_100, history.at(-1)!.time + 300)
  assert.equal(appended.length, 55)
  assert.equal(appended.at(-1)?.close, 51_100)
})

test("replayed and out-of-order closes replace their bucket and remain sorted", () => {
  const start = Date.UTC(2026, 7, 17, 2, 15, 0) / 1000
  const history = [
    { time: start, close: 10_000 },
    { time: start + 600, close: 10_200 },
  ]
  const merged = mergeFiveMinuteClose(history, 10_100, start + 320)
  assert.deepEqual(merged, [
    { time: start, close: 10_000 },
    { time: start + 300, close: 10_100 },
    { time: start + 600, close: 10_200 },
  ])
  assert.deepEqual(mergeFiveMinuteClose(merged, 10_150, start + 340), [
    { time: start, close: 10_000 },
    { time: start + 300, close: 10_150 },
    { time: start + 600, close: 10_200 },
  ])
})

test("DNSE prices are normalized to the Yahoo VND scale", () => {
  assert.equal(normalizeMarketPrice(58.5, 58_400), 58_500)
  assert.equal(normalizeMarketPrice(58_500, 58_400), 58_500)
  assert.equal(normalizeMarketPrice(72.5, 74_200), 72_500)
  assert.equal(normalizeMarketPrice(0.0585, 58_400), null)
})

test("EOD history falls back to the latest available trading session", () => {
  const friday = Date.UTC(2026, 7, 14, 3, 0, 0) / 1000
  const monday = Date.UTC(2026, 7, 17, 3, 0, 0) / 1000
  const bars = [
    { time: friday, open: 10, high: 11, low: 10, close: 11, volume: 100 },
    { time: monday, open: 12, high: 13, low: 12, close: 13, volume: 200 },
  ]
  const dateOf = (bar: { time: number }) => new Date(bar.time * 1000).toISOString().slice(0, 10)
  assert.equal(selectLatestSession(bars, "2026-08-16", dateOf)?.date, "2026-08-14")
  assert.equal(selectLatestSession(bars, "2026-08-17", dateOf)?.date, "2026-08-17")
})