import assert from "node:assert/strict"
import test from "node:test"

import {
  evaluateBuy,
  evaluateExit,
  marketSessionProgress,
  type LiveQuote,
  type SignalDailyScan,
} from "../lib/signal-engine.ts"

const scan: SignalDailyScan = {
  ticker: "HPG",
  date: "2026-08-13",
  price: 25,
  volume: 10_000_000,
  ma20: 24,
  ma50: 23,
  atr14: 1,
  relVolume: 1,
  taBias: "Bullish",
  bullProbability: 55,
  baseProbability: 30,
  bearProbability: 15,
  support: "24",
  resistance: "25.2",
  status: "Complete",
}

function atIct(clock: string, day = "2026-08-13") {
  return Date.parse(`${day}T${clock}:00+07:00`)
}

test("market session boundaries include ATO and fail closed outside HOSE windows", () => {
  assert.equal(marketSessionProgress(atIct("09:00")).active, true)
  assert.equal(marketSessionProgress(atIct("09:00")).label, "ATO")
  assert.equal(marketSessionProgress(atIct("09:15")).label, "ATO")
  assert.equal(marketSessionProgress(atIct("09:16")).label, "Morning")
  assert.equal(marketSessionProgress(atIct("11:30")).active, true)
  assert.equal(marketSessionProgress(atIct("11:31")).active, false)
  assert.equal(marketSessionProgress(atIct("12:59")).active, false)
  assert.equal(marketSessionProgress(atIct("13:00")).active, true)
  assert.equal(marketSessionProgress(atIct("14:31")).label, "ATC")
  assert.equal(marketSessionProgress(atIct("14:45")).active, true)
  assert.equal(marketSessionProgress(atIct("14:46")).active, false)
  assert.equal(marketSessionProgress(atIct("10:00", "2026-08-15")).active, false)
  assert.equal(marketSessionProgress(atIct("10:00", "2026-08-16")).active, false)
})

test("BUY requires complete bullish daily context and confirmation", () => {
  const quote: LiveQuote = { ticker: "HPG", price: 25.5, totalVolume: 8_000_000, timestamp: atIct("10:30") }
  assert.equal(evaluateBuy(scan, quote, quote.timestamp).signal, true)
  assert.equal(evaluateBuy({ ...scan, taBias: "Neutral" }, quote, quote.timestamp).signal, false)
  assert.equal(evaluateBuy({ ...scan, status: "Incomplete" }, quote, quote.timestamp).signal, false)
  assert.equal(evaluateBuy({ ...scan, bullProbability: 39 }, quote, quote.timestamp).signal, false)
})

test("BUY rejects each price, trend, volume, and extension boundary", () => {
  const timestamp = atIct("10:30")
  const decide = (overrides: Partial<SignalDailyScan>, price: number, volume = 8_000_000) =>
    evaluateBuy({ ...scan, ...overrides }, { ticker: "HPG", price, totalVolume: volume, timestamp }, timestamp)
  assert.match(decide({}, 25.19).reason, /momentum < \+0.8%/)
  assert.match(decide({}, 26.4).reason, /tăng > \+5.5%/)
  assert.match(decide({ ma20: 26 }, 25.5).reason, /dưới MA20/)
  assert.match(decide({ ma50: 26 }, 25.5).reason, /dưới MA50/)
  assert.match(decide({}, 25.5, 1_000_000).reason, /volume pace/)
  assert.match(decide({ atr14: 0.2 }, 25.5).reason, /ATR/)
  assert.match(decide({ resistance: "30" }, 25.3).reason, /chưa breakout/)
})

test("BUY diagnostics expose every gate and use avg20 fallback when prior volume is zero", () => {
  const timestamp = atIct("10:30")
  const zeroVolumeScan = { ...scan, volume: 0, relVolume: 0 }
  const quote: LiveQuote = { ticker: "HPG", price: 25.5, totalVolume: 8_000_000, timestamp }
  const withoutFallback = evaluateBuy(zeroVolumeScan, quote, timestamp)
  assert.equal(withoutFallback.signal, false)
  assert.match(withoutFallback.reason, /volume pace N\/A/)
  assert.match(withoutFallback.diagnostics ?? "", /unavailable/)

  const withFallback = evaluateBuy(zeroVolumeScan, quote, timestamp, 10_000_000)
  assert.equal(withFallback.signal, true)
  assert.ok((withFallback.volumePace ?? 0) >= 1.35)
  assert.match(withFallback.diagnostics ?? "", /avg20-fallback/)
  assert.match(withFallback.diagnostics ?? "", /change/)
  assert.match(withFallback.diagnostics ?? "", /MA20/)
  assert.match(withFallback.diagnostics ?? "", /breakout/)
  assert.match(withFallback.diagnostics ?? "", /trigger/)
})

test("EXIT evaluates the hard stop before structural rules", () => {
  const quote: LiveQuote = { ticker: "HPG", price: 23.9, totalVolume: 8_000_000, timestamp: atIct("10:30") }
  const result = evaluateExit({ id: "rec", ticker: "HPG", buyPrice: 25, stopPrice: 24, maxFavorablePct: 1, maxAdversePct: -2 }, scan, quote, quote.timestamp)
  assert.equal(result.signal, true)
  assert.equal(result.type, "EXIT_FAIL")
  assert.match(result.reason, /Hard stop/)
})

test("EXIT covers thesis, MA20, and structural support failures", () => {
  const timestamp = atIct("10:30")
  const open = { id: "rec", ticker: "HPG", buyPrice: 25, stopPrice: 22, maxFavorablePct: null, maxAdversePct: null }
  const quote = (price: number): LiveQuote => ({ ticker: "HPG", price, totalVolume: 8_000_000, timestamp })
  assert.match(evaluateExit(open, { ...scan, taBias: "Neutral" }, quote(25), timestamp).reason, /Daily thesis fail/)
  assert.match(evaluateExit(open, { ...scan, ma20: 25.5 }, quote(25), timestamp).reason, /Structural fail/)
  assert.match(evaluateExit(open, { ...scan, support: "24.8" }, quote(24.5), timestamp).reason, /support/)
})

test("EXIT protects profits after a meaningful give-back", () => {
  const timestamp = atIct("10:30")
  const quote: LiveQuote = { ticker: "HPG", price: 25.5, totalVolume: 2_000_000, timestamp }
  const result = evaluateExit({ id: "rec", ticker: "HPG", buyPrice: 25, stopPrice: 22, maxFavorablePct: 6, maxAdversePct: -0.5 }, scan, quote, timestamp, 1800)
  assert.equal(result.signal, true)
  assert.equal(result.type, "SELL")
  assert.match(result.reason, /Profit protection/)
})

test("EXIT rotates out of sustained VNINDEX underperformance", () => {
  const buySignal = new Date(atIct("09:15")).toISOString()
  const timestamp = atIct("10:30")
  const quote: LiveQuote = { ticker: "HPG", price: 24.9, totalVolume: 2_000_000, timestamp }
  const open = { id: "rec", ticker: "HPG", buyPrice: 25, stopPrice: 22, maxFavorablePct: 0.5, maxAdversePct: -0.4, buySignal, vnindexEntry: 1800 }
  const result = evaluateExit(open, scan, quote, timestamp, 1840)
  assert.equal(result.signal, true)
  assert.equal(result.type, "EXIT_FAIL")
  assert.ok((result.alphaPct ?? 0) <= -2.5)
  assert.match(result.reason, /Relative-strength fail/)
})
