import assert from "node:assert/strict"
import test from "node:test"

import {
  buildPortfolioAllocationSnapshot,
  simulatePlannedTrades,
} from "../../modules/portfolio/risk-sizing/planning.ts"

const planned = (ticker: string, positionValueVnd: number, riskAddedVnd: number) => ({
  id: ticker,
  ticker,
  plannedEntryKvnd: 100,
  initialStopKvnd: 95,
  riskPercent: 1,
  estimatedCommissionVnd: 0,
  slippageAllowanceVnd: 0,
  riskAmountVnd: riskAddedVnd,
  riskPerShareVnd: 5_000,
  tradeSizeShares: 100,
  positionValueVnd,
  riskAddedVnd,
})

test("simulation sums multiple planned tickers and derives projected values", () => {
  const result = simulatePlannedTrades({
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 400_000_000,
    stockMarketValueVnd: 600_000_000,
    knownActiveRiskVnd: 20_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskTradeCount: 0,
    riskContextAvailable: true,
    plannedTrades: [planned("MSN", 120_000_000, 8_000_000), planned("VIC", 150_000_000, 9_000_000)],
  })

  assert.equal(result.plannedPositionValueVnd, 270_000_000)
  assert.equal(result.plannedRiskAddedVnd, 17_000_000)
  assert.equal(result.projectedKnownActiveRiskVnd, 37_000_000)
  assert.ok(result.projectedRiskPercent != null && Math.abs(result.projectedRiskPercent - 3.7) < 1e-9)
  assert.equal(result.projectedEstimatedCashVnd, 130_000_000)
  assert.equal(result.fundingGapVnd, 0)
  assert.equal(result.verdict, "WITHIN PLAN")
})

test("verdict precedence fails closed before risk and funding conclusions", () => {
  const base = {
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 500_000_000,
    stockMarketValueVnd: 500_000_000,
    knownActiveRiskVnd: 10_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskTradeCount: 0,
    riskContextAvailable: true,
    plannedTrades: [planned("MSN", 100_000_000, 10_000_000)],
  }

  assert.equal(simulatePlannedTrades({ ...base, riskContextAvailable: false }).verdict, "UNAVAILABLE")
  assert.equal(simulatePlannedTrades({ ...base, unknownRiskTradeCount: 1 }).verdict, "RISK UNKNOWN")
  assert.equal(simulatePlannedTrades({ ...base, accountEquityComplete: false }).verdict, "REVIEW REQUIRED")
  assert.equal(simulatePlannedTrades({ ...base, maxActiveRiskPercent: null }).verdict, "REVIEW REQUIRED")
})

test("complete-evidence risk breach outranks a separate funding warning", () => {
  const result = simulatePlannedTrades({
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 50_000_000,
    stockMarketValueVnd: 950_000_000,
    knownActiveRiskVnd: 45_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskTradeCount: 0,
    riskContextAvailable: true,
    plannedTrades: [planned("MSN", 100_000_000, 10_000_000)],
  })

  assert.equal(result.fundingGapVnd, 50_000_000)
  assert.equal(result.verdict, "EXCEEDS PLAN")
})

test("funding gap requires review when risk stays within a complete configured cap", () => {
  const result = simulatePlannedTrades({
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 50_000_000,
    stockMarketValueVnd: 950_000_000,
    knownActiveRiskVnd: 10_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskTradeCount: 0,
    riskContextAvailable: true,
    plannedTrades: [planned("MSN", 100_000_000, 10_000_000)],
  })

  assert.equal(result.projectedEstimatedCashVnd, -50_000_000)
  assert.equal(result.fundingGapVnd, 50_000_000)
  assert.equal(result.verdict, "REVIEW REQUIRED")
})

test("portfolio snapshot keeps realized P&L, AVCO cost basis, market value, and missing-price provenance separate", () => {
  const snapshot = buildPortfolioAllocationSnapshot({
    initialCapitalVnd: 1_000_000_000,
    totalRealizedPnlKvnd: 12_500,
    positions: [
      { ticker: "MSN", openQty: 1_000, avgCost: 70, totalInvested: 70_000 },
      { ticker: "VIC", openQty: 500, avgCost: 120, totalInvested: 60_000 },
    ],
    currentPricesKvnd: { MSN: 75 },
  })

  assert.equal(snapshot.totalRealizedPnlVnd, 12_500_000)
  assert.equal(snapshot.openPositionCostBasisVnd, 130_000_000)
  assert.equal(snapshot.stockMarketValueVnd, 135_000_000)
  assert.equal(snapshot.totalUnrealizedPnlVnd, 5_000_000)
  assert.equal(snapshot.estimatedAvailableCashVnd, 882_500_000)
  assert.deepEqual(snapshot.missingPriceTickers, ["VIC"])
  assert.equal(snapshot.marketPriceCoverageComplete, false)
})
