import type {
  CombinedVerdict,
  PlannedTrade,
  PortfolioAllocationSnapshot,
  PortfolioPlanSimulation,
} from "./types.ts"

export function buildPortfolioAllocationSnapshot(input: {
  initialCapitalVnd: number
  totalRealizedPnlKvnd: number
  positions: Array<{
    ticker: string
    openQty: number
    avgCost: number
    totalInvested: number
  }>
  currentPricesKvnd: Record<string, number>
}): PortfolioAllocationSnapshot {
  const totalRealizedPnlVnd = input.totalRealizedPnlKvnd * 1000
  let openPositionCostBasisVnd = 0
  let stockMarketValueVnd = 0
  let totalUnrealizedPnlVnd = 0
  const missingPriceTickers: string[] = []

  for (const position of input.positions) {
    openPositionCostBasisVnd += position.totalInvested * 1000

    const currentPriceKvnd = input.currentPricesKvnd[position.ticker]
    const hasCurrentPrice = Number.isFinite(currentPriceKvnd)
    const markKvnd = hasCurrentPrice ? currentPriceKvnd : position.avgCost

    if (!hasCurrentPrice) missingPriceTickers.push(position.ticker)

    stockMarketValueVnd += markKvnd * position.openQty * 1000
    totalUnrealizedPnlVnd += (markKvnd - position.avgCost) * position.openQty * 1000
  }

  return {
    initialCapitalVnd: input.initialCapitalVnd,
    totalRealizedPnlVnd,
    openPositionCostBasisVnd,
    stockMarketValueVnd,
    totalUnrealizedPnlVnd,
    estimatedAvailableCashVnd: Math.max(
      0,
      input.initialCapitalVnd + totalRealizedPnlVnd - openPositionCostBasisVnd,
    ),
    missingPriceTickers,
    marketPriceCoverageComplete: missingPriceTickers.length === 0,
  }
}

function deriveCombinedVerdict(input: {
  riskContextAvailable: boolean
  unknownRiskTradeCount: number
  accountEquityComplete: boolean
  maxActiveRiskPercent: number | null
  fundingGapVnd: number
  projectedKnownActiveRiskVnd: number
  maxActiveRiskVnd: number | null
}): CombinedVerdict {
  if (!input.riskContextAvailable) return "UNAVAILABLE"
  if (input.unknownRiskTradeCount > 0) return "RISK UNKNOWN"
  if (!input.accountEquityComplete || input.maxActiveRiskPercent == null) {
    return "REVIEW REQUIRED"
  }
  if (
    input.maxActiveRiskVnd != null
    && input.projectedKnownActiveRiskVnd > input.maxActiveRiskVnd
  ) {
    return "EXCEEDS PLAN"
  }
  if (input.fundingGapVnd > 0) return "REVIEW REQUIRED"
  return "WITHIN PLAN"
}

export function simulatePlannedTrades(input: {
  accountEquityVnd: number
  accountEquityComplete: boolean
  estimatedAvailableCashVnd: number
  stockMarketValueVnd: number
  knownActiveRiskVnd: number
  maxActiveRiskPercent: number | null
  unknownRiskTradeCount: number
  riskContextAvailable: boolean
  plannedTrades: PlannedTrade[]
}): PortfolioPlanSimulation {
  const plannedPositionValueVnd = input.plannedTrades.reduce(
    (sum, trade) => sum + trade.positionValueVnd,
    0,
  )
  const plannedRiskAddedVnd = input.plannedTrades.reduce(
    (sum, trade) => sum + trade.riskAddedVnd,
    0,
  )
  const projectedKnownActiveRiskVnd = input.knownActiveRiskVnd + plannedRiskAddedVnd
  const maxActiveRiskVnd = input.maxActiveRiskPercent == null
    ? null
    : input.accountEquityVnd * (input.maxActiveRiskPercent / 100)
  const remainingRiskBudgetVnd = maxActiveRiskVnd == null
    ? null
    : maxActiveRiskVnd - projectedKnownActiveRiskVnd
  const projectedEstimatedCashVnd = input.estimatedAvailableCashVnd - plannedPositionValueVnd
  const fundingGapVnd = Math.max(0, -projectedEstimatedCashVnd)
  const projectedRiskPercent = input.accountEquityVnd > 0
    ? (projectedKnownActiveRiskVnd / input.accountEquityVnd) * 100
    : null

  return {
    plannedPositionValueVnd,
    plannedRiskAddedVnd,
    projectedKnownActiveRiskVnd,
    projectedRiskPercent,
    maxActiveRiskVnd,
    remainingRiskBudgetVnd,
    projectedEstimatedCashVnd,
    fundingGapVnd,
    verdict: deriveCombinedVerdict({
      riskContextAvailable: input.riskContextAvailable,
      unknownRiskTradeCount: input.unknownRiskTradeCount,
      accountEquityComplete: input.accountEquityComplete,
      maxActiveRiskPercent: input.maxActiveRiskPercent,
      fundingGapVnd,
      projectedKnownActiveRiskVnd,
      maxActiveRiskVnd,
    }),
  }
}
