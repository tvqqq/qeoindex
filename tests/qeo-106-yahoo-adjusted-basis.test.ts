import assert from "node:assert/strict"
import test from "node:test"

import { fetchYahooDailyOhlcv } from "../modules/market/providers/yahoo/history.ts"

function approx(actual: number, expected: number, epsilon = 0.0051) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected}`)
}

test("QEO-106 Yahoo Daily applies adjusted-close ratio to OHLC while preserving volume", async () => {
  const originalFetch = globalThis.fetch
  const sourceTime = 1_740_355_200 // 2025-02-24 UTC
  globalThis.fetch = async () => new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [sourceTime],
        indicators: {
          quote: [{
            open: [93.3],
            high: [93.5],
            low: [92.7],
            close: [93.5],
            volume: [1_956_000],
          }],
          adjclose: [{ adjclose: [61.64] }],
        },
        meta: { previousClose: 93.1 },
      }],
      error: null,
    },
  }), { status: 200, headers: { "content-type": "application/json" } })

  try {
    const bars = await fetchYahooDailyOhlcv("VCB", new Date("2025-02-25T16:00:00+07:00"), 10)
    assert.equal(bars.length, 1)
    const bar = bars[0]
    const ratio = 61.64 / 93.5
    approx(bar.open, 93.3 * ratio)
    approx(bar.high, 93.5 * ratio)
    approx(bar.low, 92.7 * ratio)
    approx(bar.close, 61.64)
    assert.equal(bar.volume, 1_956_000)
  } finally {
    globalThis.fetch = originalFetch
  }
})
