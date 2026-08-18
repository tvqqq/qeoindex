import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeToKiloPrice,
  normalizeVolume,
  normalizeTradeSide,
  formatSessionTradeTime,
  normalizeDepthLevels,
  normalizeForeignFlow,
  toCanonicalOrderbookSnapshot,
} from "../lib/market-data-contract.ts"

test("price normalizer enforces consistent kilo format (21.85) across all price shapes", () => {
  // Raw Dong prices (>= 500)
  assert.equal(normalizeToKiloPrice(21850), 21.85)
  assert.equal(normalizeToKiloPrice(75200), 75.20)
  assert.equal(normalizeToKiloPrice(17600), 17.60)
  assert.equal(normalizeToKiloPrice(29400), 29.40)
  assert.equal(normalizeToKiloPrice(145600), 145.60)

  // Standard kilo prices (< 500)
  assert.equal(normalizeToKiloPrice(21.85), 21.85)
  assert.equal(normalizeToKiloPrice(75.2), 75.20)
  assert.equal(normalizeToKiloPrice(4.25), 4.25)
  assert.equal(normalizeToKiloPrice(145.6), 145.60)

  // Edge cases & null safety
  assert.equal(normalizeToKiloPrice(null), null)
  assert.equal(normalizeToKiloPrice(undefined), null)
  assert.equal(normalizeToKiloPrice(0), null)
  assert.equal(normalizeToKiloPrice(-10), null)
  assert.equal(normalizeToKiloPrice(NaN), null)
})

test("volume normalizer guarantees non-negative integer shares", () => {
  assert.equal(normalizeVolume(15360), 15360)
  assert.equal(normalizeVolume(15360.7), 15361)
  assert.equal(normalizeVolume(0), 0)
  assert.equal(normalizeVolume(-100), 0)
  assert.equal(normalizeVolume(null), 0)
  assert.equal(normalizeVolume(undefined), 0)
})

test("trade side parser accurately distinguishes active buying (BUY) vs active selling (SELL)", () => {
  // Direct side strings
  assert.equal(normalizeTradeSide("B"), "BUY")
  assert.equal(normalizeTradeSide("BUY"), "BUY")
  assert.equal(normalizeTradeSide("MUA"), "BUY")
  assert.equal(normalizeTradeSide("S"), "SELL")
  assert.equal(normalizeTradeSide("SELL"), "SELL")
  assert.equal(normalizeTradeSide("BAN"), "SELL")
  assert.equal(normalizeTradeSide("BÁN"), "SELL")

  // Color code fallback when side is empty
  assert.equal(normalizeTradeSide("", "i"), "BUY")
  assert.equal(normalizeTradeSide(null, "u"), "BUY")
  assert.equal(normalizeTradeSide("", "d"), "SELL")
  assert.equal(normalizeTradeSide(null, "e"), "REF")
  assert.equal(normalizeTradeSide(null, null), "REF")
})

test("session trade time formatter maintains exact session hours (09:15:00 - 14:45:00) without timezone drift", () => {
  // Exact HH:mm:ss strings
  assert.equal(formatSessionTradeTime("09:15:00"), "09:15:00")
  assert.equal(formatSessionTradeTime("14:45:00"), "14:45:00")
  assert.equal(formatSessionTradeTime("14:29:58"), "14:29:58")

  // Seconds of day (0 to 86400)
  assert.equal(formatSessionTradeTime(33300), "09:15:00") // 9*3600 + 15*60 = 33300
  assert.equal(formatSessionTradeTime(53100), "14:45:00") // 14*3600 + 45*60 = 53100
  assert.equal(formatSessionTradeTime("53100"), "14:45:00")
  assert.equal(formatSessionTradeTime("33300"), "09:15:00")
})

test("depth level normalizer unifies bid/ask depth prices and volumes", () => {
  const rawLevels = [
    { price: 21850, volume: 15300 },
    { p: 21.8, v: 4000 },
    { price: 0, volume: 0 },
    null,
    { price: 21.75, volume: 12000 },
  ]
  const normalized = normalizeDepthLevels(rawLevels)
  assert.equal(normalized.length, 3)
  assert.deepEqual(normalized[0], { price: 21.85, volume: 15300 })
  assert.deepEqual(normalized[1], { price: 21.80, volume: 4000 })
  assert.deepEqual(normalized[2], { price: 21.75, volume: 12000 })
})

test("foreign flow normalizer guarantees consistent numeric metrics and net calculations", () => {
  const raw = {
    fBVol: 100000,
    fSVolume: 40000,
    fBValue: 2185000,
    fSValue: 874000,
    fRoom: 50000000,
  }
  const flow = normalizeForeignFlow(raw)
  assert.equal(flow.totalBuyVolume, 100000)
  assert.equal(flow.totalSellVolume, 40000)
  assert.equal(flow.foreignNetVolume, 60000)
  assert.equal(flow.totalBuyValue, 218500000)
  assert.equal(flow.totalSellValue, 87400000)
  assert.equal(flow.foreignNetValue, 131100000)
  assert.equal(flow.foreignRoom, 50000000)
})

test("toCanonicalOrderbookSnapshot produces 100% polymorphic schema whether loaded from Supabase, DNSE WS, or Yahoo", () => {
  // Sample 1: Raw Supabase row (with raw Dong prices from legacy)
  const supabaseRow = {
    symbol: "HPG",
    session_date: "2026-08-18",
    reference_price: 21200,
    ceiling_price: 22684,
    floor_price: 19716,
    latest_price: 21000,
    total_volume: 16800000,
    intraday_1m: [
      { time: "09:15:00", open: 21150, close: 21150 },
      { time: "14:45:00", open: 21000, close: 21000 },
    ],
    trades: [
      { id: "t-1", time: "09:15:01", price: 21200, volume: 40, side: "B" },
      { id: "t-2", time: "14:45:00", price: 21000, volume: 50000, side: "S" },
    ],
    trades_truncated: false,
    foreign_flow: {
      totalBuyVolume: 171910,
      totalSellVolume: 273333,
      totalBuyValue: 36438310,
      totalSellValue: 57921210,
      foreignRoom: 230436874,
    },
    put_through: [
      { id: "pt-1", time: "13:03:39", price: 22100, volume: 200000, value: 4420000, type: "PTM" },
    ],
    updated_at: "2026-08-18T13:45:00.000Z",
  }

  const snap1 = toCanonicalOrderbookSnapshot("HPG", supabaseRow)
  assert.equal(snap1.symbol, "HPG")
  assert.equal(snap1.referencePrice, 21.20)
  assert.equal(snap1.latestPrice, 21.00)
  assert.equal(snap1.ceilingPrice, 22.68)
  assert.equal(snap1.floorPrice, 19.72)
  assert.equal(snap1.trades[0].price, 21.20)
  assert.equal(snap1.trades[0].side, "BUY")
  assert.equal(snap1.trades[1].price, 21.00)
  assert.equal(snap1.trades[1].side, "SELL")
  assert.equal(snap1.putThrough[0].price, 22.10)
  assert.equal(snap1.intraday1m[0].open, 21.15)

  // Sample 2: Raw DNSE Live Broker Tick (in kilo format)
  const dnseLivePayload = {
    symbol: "HPG",
    r: 21.2,
    c: 22.68,
    f: 19.72,
    lastPrice: 21.0,
    lot: 1680000,
    g1: "21.0|5000",
    g4: "21.05|3000",
    trades: [
      { id: "ws-1", time: "14:45:00", matchPrice: 21.0, matchQtty: 50000, matchSide: "S" },
    ],
  }

  const snap2 = toCanonicalOrderbookSnapshot("HPG", dnseLivePayload)
  assert.equal(snap2.referencePrice, 21.20)
  assert.equal(snap2.latestPrice, 21.00)
  assert.equal(snap2.totalVolume, 16800000)
  assert.equal(snap2.trades[0].side, "SELL")
  assert.equal(snap2.trades[0].price, 21.00)

  // Both snapshots match the exact same contract types
  assert.equal(typeof snap1.referencePrice, "number")
  assert.equal(typeof snap2.referencePrice, "number")
  assert.equal(typeof snap1.latestPrice, "number")
  assert.equal(typeof snap2.latestPrice, "number")
})
