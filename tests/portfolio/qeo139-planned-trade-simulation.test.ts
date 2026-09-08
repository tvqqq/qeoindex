import assert from "node:assert/strict"
import test from "node:test"

import {
  buildPortfolioAllocationSnapshot,
  removePlannedTrade,
  simulatePlannedTrades,
  summarizePortfolioRiskCoverage,
  upsertPlannedTrade,
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

test("planned ticker upsert replaces instead of duplicating and remove is ticker-scoped", () => {
  const first = upsertPlannedTrade([], planned("MSN", 100_000_000, 5_000_000))
  const second = upsertPlannedTrade(first, planned("MSN", 120_000_000, 6_000_000))
  const third = upsertPlannedTrade(second, planned("VIC", 150_000_000, 7_000_000))

  assert.equal(second.length, 1)
  assert.equal(second[0]?.positionValueVnd, 120_000_000)
  assert.deepEqual(third.map((row) => row.ticker).sort(), ["MSN", "VIC"])
  assert.deepEqual(removePlannedTrade(third, "MSN").map((row) => row.ticker), ["VIC"])
})

test("unlinked holdings and unknown normalized Trades remain fail-closed unknown", () => {
  const unlinked = summarizePortfolioRiskCoverage({
    positions: [{ ticker: "MSN" }, { ticker: "VIC" }],
    openTradeRisks: [
      { tradeId: "t1", ticker: "MSN", openQty: 100, avgCostKvnd: 70, latestStopKvnd: 65, activeRiskVnd: 500_000, riskStatus: "known" as const },
    ],
  })
  assert.equal(unlinked.holdingRisks.find((row) => row.ticker === "MSN")?.riskStatus, "known")
  assert.equal(unlinked.holdingRisks.find((row) => row.ticker === "VIC")?.riskStatus, "unknown")
  assert.equal(unlinked.unknownRiskItemCount, 1)

  const mixed = summarizePortfolioRiskCoverage({
    positions: [{ ticker: "MSN" }],
    openTradeRisks: [
      { tradeId: "t1", ticker: "MSN", openQty: 100, avgCostKvnd: 70, latestStopKvnd: 65, activeRiskVnd: 500_000, riskStatus: "known" as const },
      { tradeId: "t2", ticker: "MSN", openQty: 100, avgCostKvnd: 72, latestStopKvnd: null, activeRiskVnd: null, riskStatus: "unknown" as const },
    ],
  })
  assert.equal(mixed.holdingRisks[0]?.riskStatus, "unknown")
  assert.equal(mixed.holdingRisks[0]?.activeRiskVnd, null)
  assert.equal(mixed.holdingRisks[0]?.linkedTradeCount, 2)
  assert.equal(mixed.holdingRisks[0]?.unknownTradeCount, 1)
  assert.equal(mixed.unknownRiskItemCount, 1)
})

test("simulation sums multiple planned tickers and derives projected values", () => {
  const result = simulatePlannedTrades({
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 400_000_000,
    knownActiveRiskVnd: 20_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskItemCount: 0,
    riskContextAvailable: true,
    plannedTrades: [planned("MSN", 120_000_000, 8_000_000), planned("VIC", 150_000_000, 9_000_000)],
  })

  assert.equal(result.plannedPositionValueVnd, 270_000_000)
  assert.equal(result.plannedRiskAddedVnd, 17_000_000)
  assert.equal(result.projectedKnownActiveRiskVnd, 37_000_000)
  assert.ok(result.projectedRiskPercent != null && Math.abs(result.projectedRiskPercent - 3.7) < 1e-9)
  assert.equal(result.projectedEstimatedCashVnd, 130_000_000)
  assert.equal(result.fundingGapVnd, 0)
  assert.equal(result.unknownRiskItemCount, 0)
  assert.equal(result.verdict, "WITHIN PLAN")
})

test("verdict precedence fails closed before complete-evidence risk and funding conclusions", () => {
  const base = {
    accountEquityVnd: 1_000_000_000,
    accountEquityComplete: true,
    estimatedAvailableCashVnd: 500_000_000,
    knownActiveRiskVnd: 10_000_000,
    maxActiveRiskPercent: 5,
    unknownRiskItemCount: 0,
    riskContextAvailable: true,
    plannedTrades: [planned("MSN", 100_000_000, 10_000_000)],
  }

  assert.equal(simulatePlannedTrades({ ...base, riskContextAvailable: false }).verdict, "UNAVAILABLE")
  assert.equal(simulatePlannedTrades({ ...base, unknownRiskItemCount: 1 }).verdict, "RISK UNKNOWN")
  assert.equal(simulatePlannedTrades({ ...base, accountEquityComplete: false }).verdict, "REVIEW REQUIRED")
  assert.equal(simulatePlannedTrades({ ...base, maxActiveRiskPercent: null }).verdict, "REVIEW REQUIRED")
  assert.equal(
    simulatePlannedTrades({ ...base, knownActiveRiskVnd: 45_000_000, estimatedAvailableCashVnd: 50_000_000 }).verdict,
    "EXCEEDS PLAN",
  )
  assert.equal(simulatePlannedTrades({ ...base, estimatedAvailableCashVnd: 50_000_000 }).verdict, "REVIEW REQUIRED")
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
  assert.equal(snapshot.stockCostBasisVnd, 130_000_000)
  assert.equal(snapshot.stockMarketValueVnd, 135_000_000)
  assert.equal(snapshot.totalUnrealizedPnlVnd, 5_000_000)
  assert.equal(snapshot.estimatedAvailableCashVnd, 882_500_000)
  assert.deepEqual(snapshot.missingPriceTickers, ["VIC"])
})
