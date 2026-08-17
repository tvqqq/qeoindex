import assert from "node:assert/strict"
import test from "node:test"

import { fiveMinuteBucket, intradaySnapshot, normalizeEpochSeconds } from "../lib/intraday-5m.ts"

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

test("intraday snapshot uses session open and latest five-minute close", () => {
  assert.deepEqual(intradaySnapshot([{ open: 10, close: 10.2 }, { open: 10.2, close: 11 }]), {
    reference: 10,
    price: 11,
    change: 1,
    changePercent: 10,
  })
  assert.deepEqual(intradaySnapshot([]), { reference: null, price: null, change: null, changePercent: null })
})
