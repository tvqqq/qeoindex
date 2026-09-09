import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCurrentAccountEquity,
  buildEquityCurve,
} from "../../modules/portfolio/risk-engine/equity-curve.ts"

const deposit20m = [{
  id: "flow-deposit",
  flowType: "deposit" as const,
  signedAmountVnd: 20_000_000,
  effectiveAt: "2026-09-02T02:00:00.000Z",
  effectiveDate: "2026-09-02",
  provenance: "manual" as const,
}]

const withdrawal20m = [{
  id: "flow-withdrawal",
  flowType: "withdrawal" as const,
  signedAmountVnd: -20_000_000,
  effectiveAt: "2026-09-02T02:00:00.000Z",
  effectiveDate: "2026-09-02",
  provenance: "manual" as const,
}]

test("deposit increases Account Equity without creating flow-adjusted performance", () => {
  const account = buildCurrentAccountEquity({
    initialCapitalVnd: 100_000_000,
    transactions: [],
    currentPricesKvnd: {},
    externalCashFlows: deposit20m,
    fundingHistoryStatus: "known",
  })

  assert.equal(account.equityVnd, 120_000_000)
  assert.equal(account.cumulativeExternalFlowVnd, 20_000_000)
  assert.equal(account.flowAdjustedEquityVnd, 100_000_000)
})

test("withdrawal reduces Account Equity without creating flow-adjusted drawdown", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [],
    sessions: ["2026-09-02"],
    rawDailyCloseKvnd: { "2026-09-02": {} },
    externalCashFlows: withdrawal20m,
    fundingHistoryStatus: "known",
  })

  assert.equal(curve.points[1]?.equityVnd, 80_000_000)
  assert.equal(curve.points[1]?.flowAdjustedEquityVnd, 100_000_000)
  assert.equal(curve.currentDrawdown.drawdownPercent, 0)
})

test("gain after a deposit remains visible in flow-adjusted equity", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [{
      id: "buy",
      ticker: "FPT",
      action: "buy" as const,
      quantity: 1_000,
      price: 100,
      fee: 0,
      transaction_date: "2026-09-02",
      tags: [],
    }],
    sessions: ["2026-09-02"],
    rawDailyCloseKvnd: { "2026-09-02": { FPT: 110 } },
    externalCashFlows: deposit20m,
    fundingHistoryStatus: "known",
  })

  assert.equal(curve.points[1]?.equityVnd, 130_000_000)
  assert.equal(curve.points[1]?.flowAdjustedEquityVnd, 110_000_000)
})

test("external flows apply only on and after their effective Vietnam date", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [],
    sessions: ["2026-09-01", "2026-09-02"],
    rawDailyCloseKvnd: {
      "2026-09-01": {},
      "2026-09-02": {},
    },
    externalCashFlows: deposit20m,
    fundingHistoryStatus: "known",
  })

  assert.equal(curve.points[1]?.equityVnd, 100_000_000)
  assert.equal(curve.points[1]?.cumulativeExternalFlowVnd, 0)
  assert.equal(curve.points[2]?.equityVnd, 120_000_000)
  assert.equal(curve.points[2]?.cumulativeExternalFlowVnd, 20_000_000)
})

test("legacy-unrecorded funding makes performance drawdown insufficient", () => {
  const curve = buildEquityCurve({
    initialCapitalVnd: 100_000_000,
    transactions: [],
    sessions: ["2026-09-02"],
    rawDailyCloseKvnd: { "2026-09-02": {} },
    externalCashFlows: [],
    fundingHistoryStatus: "legacy_unrecorded",
  })

  assert.equal(curve.points[1]?.fundingHistoryStatus, "legacy_unrecorded")
  assert.equal(curve.currentDrawdown.completeness, "insufficient")
  assert.equal(curve.currentDrawdown.drawdownPercent, null)
})
