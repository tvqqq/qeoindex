import assert from "node:assert/strict"
import test from "node:test"

import { computePortfolioPositions, type RawTransaction } from "../../modules/portfolio/pnl.ts"
import {
  buildAccountEquityContext,
  calculateBookTradeSize,
  calculateRiskAmountVnd,
  calculateTradeSize,
  DEFAULT_REGULAR_LOT_SHARES,
} from "../../modules/portfolio/risk-sizing/calculator.ts"

const baseInput = {
  side: "long" as const,
  accountEquityVnd: 500_000_000,
  riskPercent: 2,
  plannedEntryKvnd: 100,
  initialStopKvnd: 95,
  estimatedCommissionVnd: 500_000,
  slippageAllowanceVnd: 500_000,
  lotSizeShares: 100,
  advancedRiskOverrideAcknowledged: false,
}

test("source-exact Risk Amount and printed Trade Size formula remain available", () => {
  const riskAmount = calculateRiskAmountVnd(500_000_000, 2)
  assert.equal(riskAmount, 10_000_000)

  const tradeSize = calculateBookTradeSize({
    riskAmountVnd: riskAmount,
    commissionVnd: 500_000,
    riskPerShareVnd: 5_000,
  })
  assert.equal(tradeSize, 1900)
})

test("extended calculator subtracts commission and explicit slippage allowance", () => {
  const result = calculateTradeSize(baseInput)
  assert.equal(result.status, "ready")
  assert.equal(result.tradeSizeShares, 1800)
  assert.equal(result.riskAmountVnd, 10_000_000)
  assert.equal(result.riskPerShareVnd, 5_000)
  assert.equal(result.availableRiskBudgetVnd, 9_000_000)
  assert.equal(result.totalRiskConsumptionVnd, 10_000_000)
})

test("wider stop reduces Trade Size and narrower stop increases it", () => {
  const wider = calculateTradeSize({ ...baseInput, initialStopKvnd: 90 })
  const narrower = calculateTradeSize({ ...baseInput, initialStopKvnd: 97 })
  assert.equal(wider.status, "ready")
  assert.equal(narrower.status, "ready")
  assert.ok((wider.tradeSizeShares ?? 0) < (narrower.tradeSizeShares ?? 0))
})

test("missing or invalid stop evidence never produces a ready size", () => {
  assert.equal(calculateTradeSize({ ...baseInput, initialStopKvnd: null }).status, "incomplete")
  assert.equal(calculateTradeSize({ ...baseInput, initialStopKvnd: 0 }).status, "invalid_stop_direction")
  assert.equal(calculateTradeSize({ ...baseInput, initialStopKvnd: 100 }).status, "zero_stop_distance")
  assert.equal(calculateTradeSize({ ...baseInput, initialStopKvnd: 101 }).status, "invalid_stop_direction")
})

test("invalid equity, risk, costs and advanced override fail closed", () => {
  assert.equal(calculateTradeSize({ ...baseInput, accountEquityVnd: 0 }).status, "invalid_account_equity")
  assert.equal(calculateTradeSize({ ...baseInput, riskPercent: 0 }).status, "invalid_risk_percent")
  assert.equal(calculateTradeSize({ ...baseInput, riskPercent: 2.5 }).status, "advanced_override_required")
  assert.equal(
    calculateTradeSize({ ...baseInput, riskPercent: 2.5, advancedRiskOverrideAcknowledged: true }).status,
    "ready",
  )
  assert.equal(calculateTradeSize({ ...baseInput, estimatedCommissionVnd: -1 }).status, "invalid_cost")
  assert.equal(
    calculateTradeSize({ ...baseInput, estimatedCommissionVnd: 9_500_000, slippageAllowanceVnd: 500_000 }).status,
    "costs_consume_risk_budget",
  )
})

test("regular-lot rounding is injectable and never exceeds the risk budget", () => {
  assert.equal(DEFAULT_REGULAR_LOT_SHARES, 100)
  const hundred = calculateTradeSize({
    ...baseInput,
    estimatedCommissionVnd: 0,
    slippageAllowanceVnd: 0,
    riskPercent: 1.03,
  })
  const ten = calculateTradeSize({
    ...baseInput,
    estimatedCommissionVnd: 0,
    slippageAllowanceVnd: 0,
    riskPercent: 1.03,
    lotSizeShares: 10,
  })
  assert.equal(hundred.status, "ready")
  assert.equal(ten.status, "ready")
  assert.equal((hundred.tradeSizeShares ?? 0) % 100, 0)
  assert.equal((ten.tradeSizeShares ?? 0) % 10, 0)
  assert.ok((hundred.totalRiskConsumptionVnd ?? Infinity) <= (hundred.riskAmountVnd ?? 0))
  assert.ok((ten.totalRiskConsumptionVnd ?? Infinity) <= (ten.riskAmountVnd ?? 0))
})

test("below one regular lot returns zero rather than using odd-lot capacity", () => {
  const result = calculateTradeSize({
    ...baseInput,
    accountEquityVnd: 10_000_000,
    riskPercent: 1,
    plannedEntryKvnd: 100,
    initialStopKvnd: 90,
    estimatedCommissionVnd: 0,
    slippageAllowanceVnd: 0,
  })
  assert.equal(result.status, "below_regular_lot")
  assert.equal(result.tradeSizeShares, 0)
})

test("Account Equity includes portfolio-level realized P&L and current unrealized P&L in full VND", () => {
  const context = buildAccountEquityContext({
    initialCapitalVnd: 500_000_000,
    totalRealizedPnlKvnd: 10_000,
    positions: [{ ticker: "FPT", openQty: 1000, avgCost: 100 }],
    currentPricesKvnd: { FPT: 110 },
  })
  assert.equal(context.valueVnd, 520_000_000)
  assert.equal(context.source, "portfolio_mark_to_market")
  assert.deepEqual(context.missingPriceTickers, [])
})

test("missing market prices keep Account Equity explicitly partial", () => {
  const context = buildAccountEquityContext({
    initialCapitalVnd: 500_000_000,
    totalRealizedPnlKvnd: 10_000,
    positions: [
      { ticker: "FPT", openQty: 1000, avgCost: 100 },
      { ticker: "VIC", openQty: 100, avgCost: 80 },
    ],
    currentPricesKvnd: { FPT: 110 },
  })
  assert.equal(context.source, "portfolio_partial")
  assert.deepEqual(context.missingPriceTickers, ["VIC"])
  assert.equal(context.valueVnd, 520_000_000)
})


test("Account Equity preserves realized P&L from a fully closed ticker", () => {
  const transactions: RawTransaction[] = [
    { id: "fpt-buy", ticker: "FPT", action: "buy", quantity: 1000, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] },
    { id: "fpt-sell", ticker: "FPT", action: "sell", quantity: 1000, price: 110, fee: 0, transaction_date: "2026-09-02", tags: [] },
    { id: "vic-buy", ticker: "VIC", action: "buy", quantity: 100, price: 80, fee: 0, transaction_date: "2026-09-03", tags: [] },
  ]
  const summary = computePortfolioPositions(transactions)
  assert.equal(summary.positions.length, 1)
  assert.equal(summary.positions[0].ticker, "VIC")
  assert.equal(summary.totalRealizedPnl, 10_000)

  const context = buildAccountEquityContext({
    initialCapitalVnd: 500_000_000,
    totalRealizedPnlKvnd: summary.totalRealizedPnl,
    positions: summary.positions,
    currentPricesKvnd: { VIC: 85 },
  })
  assert.equal(context.valueVnd, 510_500_000)
})
