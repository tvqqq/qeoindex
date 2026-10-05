import test from "node:test"
import assert from "node:assert/strict"

import {
  isProviderTimestampNotOlder,
  parseDnseForeignFrame,
  parseDnseMarketIndexFrame,
  providerTimestamp,
} from "../modules/market/board/dnse-market-frame.ts"

test("DNSE market-index frames honor provider reference and exact signed fields, including zero", () => {
  const parsed = parseDnseMarketIndexFrame({
    T: "mi",
    indexName: "VNINDEX",
    valueIndexes: 1739.09,
    priorValueIndexes: 1737.71,
    changedValue: 1.38,
    changedRatio: 0.08,
    totalVolumeTraded: 8_861_632,
    grossTradeAmount: 178.0548371,
    transactTime: { Seconds: 1_791_166_520, Nanos: 82_000_000 },
  })

  assert.ok(parsed)
  assert.equal(parsed.value, 1739.09)
  assert.equal(parsed.reference, 1737.71)
  assert.equal(parsed.change, 1.38)
  assert.equal(parsed.changePercent, 0.08)
  assert.equal(parsed.volume, 8_861_632)
  assert.equal(parsed.valueTraded, 178_054_837_100)
  assert.equal(parsed.asOf, "2026-10-05T02:15:20.082Z")

  const zero = parseDnseMarketIndexFrame({
    indexName: "VNINDEX",
    valueIndexes: 1737.71,
    priorValueIndexes: 1737.71,
    changedValue: 0,
    changedRatio: 0,
    totalVolumeTraded: 0,
    grossTradeAmount: 0,
    transactTime: { Seconds: 1_791_166_520, Nanos: 82_000_000 },
  })
  assert.equal(zero?.change, 0)
  assert.equal(zero?.changePercent, 0)
  assert.equal(zero?.volume, 0)
  assert.equal(zero?.valueTraded, 0)
})

test("DNSE index changes derive only from a verified same-session reference", () => {
  const frame = {
    indexName: "VN30",
    valueIndexes: 1_900,
    transactTime: { Seconds: 1_791_166_520, Nanos: 0 },
  }
  const sameSession = parseDnseMarketIndexFrame(frame, { value: 1_890, sessionDate: "2026-10-05" })
  assert.equal(sameSession?.change, 10)
  assert.ok(Math.abs((sameSession?.changePercent ?? 0) - (10 / 1890) * 100) < 1e-12)

  const staleReference = parseDnseMarketIndexFrame(frame, { value: 1_890, sessionDate: "2026-10-02" })
  assert.equal(staleReference?.reference, undefined)
  assert.equal(staleReference?.change, undefined)
  assert.equal(staleReference?.changePercent, undefined)
  assert.equal(parseDnseMarketIndexFrame({ ...frame, transactTime: "022300018" }), null)
})

test("DNSE foreign snapshots preserve cumulative zero and provider time without price-derived net", () => {
  const fixture = {
    T: "f",
    symbol: "HPG",
    tradingSessionId: 40,
    totalBuyTradedAmount: 42_667_830_000,
    totalBuyVolume: 2_075_600,
    totalSellTradedAmount: 14_527_550_000,
    totalSellVolume: 710_800,
    buyTradedAmount: 42_667_830_000,
    buyVolume: 2_075_600,
    sellTradedAmount: 14_527_550_000,
    sellVolume: 710_800,
    multicastReceiveTime: { Seconds: 1_791_166_985, Nanos: 664_143_789 },
    _qeoWorkerReceivedAt: 1_791_167_000_370,
  }
  const parsed = parseDnseForeignFrame(fixture)
  assert.ok(parsed)
  assert.equal(parsed.buyValue, 42_667_830_000)
  assert.equal(parsed.sellValue, 14_527_550_000)
  assert.equal(parsed.netValue, 28_140_280_000)
  assert.equal(parsed.sessionDate, "2026-10-05")
  assert.equal(parsed.asOf, "2026-10-05T02:23:05.664Z")

  const replay = parseDnseForeignFrame({
    ...fixture,
    totalBuyTradedAmount: 0,
    totalSellTradedAmount: 0,
    buyTradedAmount: 0,
    sellTradedAmount: 0,
  })
  assert.equal(replay?.buyValue, 0)
  assert.equal(replay?.sellValue, 0)
  assert.equal(replay?.netValue, 0)
  assert.equal(parseDnseForeignFrame({ ...fixture, multicastReceiveTime: undefined }), null)
  assert.equal(providerTimestamp({ Seconds: 1_791_166_985, Nanos: -1 }), null)
})

test("provider source timestamps reject older frames and allow equal-time corrections", () => {
  const sourceAsOf = "2026-10-05T02:23:05.664Z"
  assert.equal(isProviderTimestampNotOlder("2026-10-05T02:23:04.999Z", sourceAsOf), false)
  assert.equal(isProviderTimestampNotOlder(sourceAsOf, sourceAsOf), true)
  assert.equal(isProviderTimestampNotOlder("2026-10-05T02:23:06.000Z", sourceAsOf), true)
})
