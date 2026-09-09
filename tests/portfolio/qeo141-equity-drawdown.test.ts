import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCurrentAccountEquity,
  buildEquityCurve,
  deriveCurrentDrawdown,
} from "../../modules/portfolio/risk-engine/equity-curve.ts"

const buy120m = [{
  id: "b",
  ticker: "FPT",
  action: "buy" as const,
  quantity: 2_000,
  price: 60,
  fee: 0,
  transaction_date: "2026-09-01",
  tags: [],
}]

test("current equity preserves negative estimated cash", () => {
  const result = buildCurrentAccountEquity({
    initialCapitalVnd: 100_000_000,
    transactions: buy120m,
    currentPricesKvnd: { FPT: 65 },
  })
  assert.equal(result.estimatedCashVnd, -20_000_000)
  assert.equal(result.marketValueVnd, 130_000_000)
  assert.equal(result.equityVnd, 110_000_000)
  assert.equal(result.fundingWarning, true)
})

test("baseline captures loss immediately after first deployment", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [{
      id: "b",
      ticker: "FPT",
      action: "buy" as const,
      quantity: 1_000,
      price: 100,
      fee: 0,
      transaction_date: "2026-09-01",
      tags: [],
    }],
    sessions: ["2026-09-01"],
    rawDailyCloseKvnd: { "2026-09-01": { FPT: 90 } },
  })
  assert.equal(curve.points[0]?.equityVnd, 100_000_000)
  assert.equal(curve.points[1]?.equityVnd, 90_000_000)
  assert.equal(curve.currentDrawdown.drawdownPercent, 10)
})

test("missing RAW Daily close makes drawdown insufficient", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [{
      id: "b",
      ticker: "FPT",
      action: "buy" as const,
      quantity: 1_000,
      price: 100,
      fee: 0,
      transaction_date: "2026-09-01",
      tags: [],
    }],
    sessions: ["2026-09-01"],
    rawDailyCloseKvnd: { "2026-09-01": {} },
  })
  assert.equal(curve.points[1]?.status, "incomplete")
  assert.equal(curve.currentDrawdown.completeness, "insufficient")
})

test("new current peak recovers drawdown to zero", () => {
  const result = deriveCurrentDrawdown([
    { key: "baseline", kind: "baseline", equityVnd: 100, externalFlowVnd: 0, status: "complete", missingTickers: [] },
    { key: "d1", kind: "daily", equityVnd: 80, externalFlowVnd: 0, status: "complete", missingTickers: [] },
    { key: "current", kind: "current", equityVnd: 120, externalFlowVnd: 0, status: "complete", missingTickers: [] },
  ])
  assert.deepEqual(
    { peak: result.peakEquityVnd, drawdown: result.drawdownVnd, percent: result.drawdownPercent },
    { peak: 120, drawdown: 0, percent: 0 },
  )
})
