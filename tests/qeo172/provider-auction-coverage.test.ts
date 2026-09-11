import assert from "node:assert/strict"
import test from "node:test"

import { detectTradingSessionGaps } from "../../modules/market/chart-data/normalize.ts"
import { missingTradingProviderRanges } from "../../modules/market/chart-data/provider-coverage.ts"

function epoch(value: string) {
  return Math.floor(Date.parse(value) / 1000)
}

test("QEO-172 opening call auction is not treated as missing continuous 1m provider coverage", () => {
  assert.deepEqual(
    missingTradingProviderRanges({
      from: epoch("2026-09-11T09:00:00+07:00"),
      to: epoch("2026-09-11T09:14:59+07:00"),
    }, []),
    [],
  )
})

test("QEO-172 provider recovery begins at the 09:15 continuous session boundary", () => {
  assert.deepEqual(
    missingTradingProviderRanges({
      from: epoch("2026-09-11T09:00:00+07:00"),
      to: epoch("2026-09-11T09:20:00+07:00"),
    }, []),
    [{
      from: epoch("2026-09-11T09:15:00+07:00"),
      to: epoch("2026-09-11T09:20:00+07:00"),
    }],
  )
})

test("QEO-172 closing call auction is not treated as missing continuous 1m provider coverage", () => {
  assert.deepEqual(
    missingTradingProviderRanges({
      from: epoch("2026-09-11T14:31:00+07:00"),
      to: epoch("2026-09-11T14:44:00+07:00"),
    }, []),
    [],
  )
})

test("QEO-172 call-auction sparsity is not reported as an intraday sequence gap", () => {
  const bars = [
    { time: epoch("2026-09-11T14:29:00+07:00"), open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { time: epoch("2026-09-11T14:45:00+07:00"), open: 100, high: 101, low: 99, close: 100, volume: 1 },
  ]
  assert.deepEqual(detectTradingSessionGaps(bars), [])
})
