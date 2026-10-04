import test from "node:test"
import assert from "node:assert/strict"

import {
  buildMarketDepthSnapshot,
  MARKET_DEPTH_BUCKETS,
  marketDepthBucketIndex,
} from "../modules/market/board/market-depth.ts"

const sessionDay = (timestamp: string) => {
  const value = Date.parse(timestamp)
  if (!Number.isFinite(value)) return null
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value))
}

test("HOSE depth bin boundaries follow FireAnt-style signed % ranges without overlap", () => {
  assert.equal(MARKET_DEPTH_BUCKETS.length, 11)
  const values = [-7, -6, -5, -4, -3, -2, -1, -0.01, 0, 0.01, 1, 2, 3, 4, 5, 6, 7]
  const expected = [0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 6, 7, 7, 8, 8, 9, 10]
  assert.deepEqual(values.map(marketDepthBucketIndex), expected)
  assert.equal(marketDepthBucketIndex(-9.4), 0)
  assert.equal(marketDepthBucketIndex(15), 10)
})

test("depth counts only dated valid HOSE prices actually available in canonical Top 200", () => {
  const stocks = [
    { ticker: "VIC", exchange: "HOSE" },
    { ticker: "VCB", exchange: "HOSE" },
    { ticker: "FPT", exchange: "HOSE" },
    { ticker: "HPG", exchange: "HOSE" },
    { ticker: "MBB", exchange: "HOSE" },
    { ticker: "VIC", exchange: "HOSE" }, // duplicate ticker should count once
    { ticker: "SHS", exchange: "HNX" },
    { ticker: "OIL", exchange: "UPCOM" },
  ]
  const fresh = "2026-10-02T14:57:00+07:00"
  const quotes = {
    VIC: { price: 105.5, changePercent: 6.5, updatedAt: fresh },
    VCB: { price: 59, changePercent: -1.7, updatedAt: fresh },
    FPT: { price: 97, changePercent: 0, updatedAt: fresh },
    HPG: { price: 0, changePercent: 2.2, updatedAt: fresh }, // invalid price
    MBB: { price: 26.5, changePercent: -2.1, updatedAt: "2026-10-01T14:59:00+07:00" },
    SHS: { price: 18, changePercent: 8.3, updatedAt: fresh },
    OIL: { price: 15, changePercent: -4.5, updatedAt: fresh },
  }
  const result = buildMarketDepthSnapshot(stocks, quotes, "2026-10-02", sessionDay)
  assert.equal(result.total, 5)
  assert.equal(result.covered, 3)
  assert.equal(result.missing, 2)
  assert.equal(result.advancers, 1)
  assert.equal(result.decliners, 1)
  assert.equal(result.unchanged, 1)
  assert.equal(result.bins.reduce((sum, count) => sum + count, 0), result.covered)
  assert.equal(result.bins[9], 1)
  assert.equal(result.bins[3], 1)
  assert.equal(result.bins[5], 1)
  assert.equal(result.asOf, fresh)
})

test("depth never pretends missing session or non-HOSE universe is full market", () => {
  const stocks = [{ ticker: "PVS", exchange: "HNX" }, { ticker: "VCB", exchange: "HOSE" }]
  const quotes = { VCB: { price: 62, changePercent: 0, updatedAt: "2026-10-02T14:57:00+07:00" } }
  const noSession = buildMarketDepthSnapshot(stocks, quotes, "", sessionDay)
  assert.deepEqual([noSession.total, noSession.covered, noSession.missing], [1, 0, 1])
  assert.equal(noSession.asOf, null)
  const followingSession = buildMarketDepthSnapshot(stocks, quotes, "2026-10-05", sessionDay)
  assert.equal(followingSession.covered, 0)
})
