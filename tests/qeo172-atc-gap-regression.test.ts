import assert from "node:assert/strict"
import test from "node:test"

import { detectTradingSessionGaps } from "../modules/market/chart-data/normalize.ts"
import type { CanonicalOhlcvBar } from "../modules/market/chart-data/contract.ts"

function bar(iso: string): CanonicalOhlcvBar {
  return {
    time: Math.floor(Date.parse(iso) / 1000),
    open: 10,
    high: 10,
    low: 10,
    close: 10,
    volume: 1,
  }
}

test("QEO-172 ignores the HOSE ATC auction boundary when detecting 1m session gaps", () => {
  const gaps = detectTradingSessionGaps([
    bar("2026-09-10T07:29:00Z"), // 14:29 Asia/Ho_Chi_Minh
    bar("2026-09-10T07:45:00Z"), // 14:45 closing auction print
  ])

  assert.deepEqual(gaps, [])
})

test("QEO-172 still reports missing bars inside the continuous PM session", () => {
  const gaps = detectTradingSessionGaps([
    bar("2026-09-10T07:00:00Z"), // 14:00 Asia/Ho_Chi_Minh
    bar("2026-09-10T07:02:00Z"), // 14:02 Asia/Ho_Chi_Minh
  ])

  assert.deepEqual(gaps, [{
    fromTime: Math.floor(Date.parse("2026-09-10T07:00:00Z") / 1000),
    toTime: Math.floor(Date.parse("2026-09-10T07:02:00Z") / 1000),
    missingBars: 1,
  }])
})
