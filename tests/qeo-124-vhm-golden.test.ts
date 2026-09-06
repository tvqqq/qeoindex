import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildFactorRunCandidate } from "../modules/market/corporate-actions/adjustment/engine.ts"
import type { CanonicalFactorAction } from "../modules/market/corporate-actions/adjustment/types.ts"
import { aggregateChartTimeframe } from "../modules/market/chart-data/timeframes.ts"

interface GoldenFixture {
  ticker: string
  asOfDate: string
  engineVersion: string
  sessions: string[]
  rawReferences: Array<{ sessionDate: string; close: number }>
  actions: CanonicalFactorAction[]
  rawDailyWeek: Array<{
    sessionDate: string
    time: number
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
  expected: {
    cashStepPriceFactor: number
    stockStepPriceFactor: number
    historicalCumulativePriceFactor: number
    weeklyHigh: number
    weeklyLow: number
    priceTolerance: number
  }
}

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/corporate-actions/vhm-qeo124-golden.json", import.meta.url),
  "utf8",
)) as GoldenFixture

function approx(actual: number, expected: number, epsilon: number) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected} ± ${epsilon}`)
}

function roundPrice(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

test("QEO-124 VHM golden lineage reproduces the 13-17/10/2025 adjusted weekly H/L through QEO-93 aggregation", () => {
  const rawDailyByDate = new Map(fixture.rawReferences.map((row) => [row.sessionDate, row]))
  const run = buildFactorRunCandidate({
    ticker: fixture.ticker,
    sessions: fixture.sessions,
    rawDailyByDate,
    actions: fixture.actions,
    asOfDate: fixture.asOfDate,
    engineVersion: fixture.engineVersion,
  })

  assert.equal(run.status, "candidate")
  assert.equal(run.blockedReason, null)
  assert.equal(run.transitions.length, 2)

  const cash = run.transitions.find((transition) => transition.effectiveSession === "2026-06-29")
  const stock = run.transitions.find((transition) => transition.effectiveSession === "2026-08-06")
  assert.ok(cash)
  assert.ok(stock)

  approx(cash.stepPriceFactor, fixture.expected.cashStepPriceFactor, 1e-12)
  approx(stock.stepPriceFactor, fixture.expected.stockStepPriceFactor, 1e-12)
  approx(cash.cumulativePriceFactor, fixture.expected.historicalCumulativePriceFactor, 1e-12)
  approx(stock.cumulativePriceFactor, fixture.expected.stockStepPriceFactor, 1e-12)

  const historicalFactor = cash.cumulativePriceFactor
  const adjustedDaily = fixture.rawDailyWeek.map((bar) => ({
    time: bar.time,
    open: bar.open * historicalFactor,
    high: bar.high * historicalFactor,
    low: bar.low * historicalFactor,
    close: bar.close * historicalFactor,
    volume: bar.volume,
  }))

  assert.deepEqual(
    adjustedDaily.map((bar) => bar.time),
    fixture.rawDailyWeek.map((bar) => bar.time),
    "price-basis normalization must not move session identities",
  )

  const weekly = aggregateChartTimeframe(adjustedDaily, "1W")
  assert.equal(weekly.length, 1)
  assert.equal(weekly[0].time, fixture.rawDailyWeek[0].time)

  approx(weekly[0].high, fixture.expected.weeklyHigh, fixture.expected.priceTolerance)
  approx(weekly[0].low, fixture.expected.weeklyLow, fixture.expected.priceTolerance)
  assert.equal(roundPrice(weekly[0].high), fixture.expected.weeklyHigh)
  assert.equal(roundPrice(weekly[0].low), fixture.expected.weeklyLow)
})
