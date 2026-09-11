import assert from "node:assert/strict"
import test from "node:test"

import { closedProviderBarsAreComplete } from "../../modules/market/chart-data/provider-response-coverage.ts"

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)
const bar = (iso: string) => ({
  time: epoch(iso),
  open: 58.1,
  high: 58.1,
  low: 58.0,
  close: 58.1,
  volume: 1_000,
})

test("QEO-172 closed provider response rejects an internal continuous-session 1m gap", () => {
  const bars = [
    bar("2026-09-08T11:10:00+07:00"),
    bar("2026-09-08T11:13:00+07:00"),
  ]

  assert.equal(closedProviderBarsAreComplete(bars), false)
})

test("QEO-172 closed provider response accepts contiguous continuous-session 1m bars", () => {
  const bars = [
    bar("2026-09-08T11:10:00+07:00"),
    bar("2026-09-08T11:11:00+07:00"),
    bar("2026-09-08T11:12:00+07:00"),
    bar("2026-09-08T11:13:00+07:00"),
  ]

  assert.equal(closedProviderBarsAreComplete(bars), true)
})
