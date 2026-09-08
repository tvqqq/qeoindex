import type {
  CombinedVerdict,
  OpenTradeRiskBreakdown,
  PlannedTrade,
  PortfolioAllocationSnapshot,
  PortfolioPlanSimulation,
  PortfolioRiskCoverage,
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
  let stockCostBasisVnd = 0
  let stockMarketValueVnd = 0
  let totalUnrealizedPnlVnd = 0
  const missingPriceTickers: string[] = []

  for (const position of input.positions) {
    stockCostBasisVnd += position.totalInvested * 1000

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
    totalUnrealizedPnlVnd,
    stockCostBasisVnd,
    stockMarketValueVnd,
    estimatedAvailableCashVnd: Math.max(
      0,
      input.initialCapitalVnd + totalRealizedPnlVnd - stockCostBasisVnd,
    ),
    missingPriceTickers,
  }
}

export function upsertPlannedTrade(current: PlannedTrade[], next: PlannedTrade): PlannedTrade[] {
  const existingIndex = current.findIndex((trade) => trade.ticker === next.ticker)
  if (existingIndex < 0) return [...current, next]
  return current.map((trade, index) => (index === existingIndex ? next : trade))
}

export function removePlannedTrade(current: PlannedTrade[], ticker: string): PlannedTrade[] {
  return current.filter((trade) => trade.ticker !== ticker)
}

export function summarizePortfolioRiskCoverage(input: {
  positions: Array<{ ticker: string }>
  openTradeRisks: OpenTradeRiskBreakdown[]
}): PortfolioRiskCoverage {
  const unknownNormalizedTradeCount = input.openTradeRisks.filter(
    (row) => row.riskStatus === "unknown",
  ).length
  let unlinkedHoldingCount = 0

  const holdingRisks = input.positions.map((position) => {
    const linked = input.openTradeRisks.filter((row) => row.ticker === position.ticker)
    const unknownTradeCount = linked.filter((row) => row.riskStatus === "unknown").length

    if (linked.length === 0) {
      unlinkedHoldingCount += 1
      return {
        ticker: position.ticker,
        activeRiskVnd: null,
        riskStatus: "unknown" as const,
        linkedTradeCount: 0,
        unknownTradeCount: 0,
      }
    }

    if (unknownTradeCount > 0) {
      return {
        ticker: position.ticker,
        activeRiskVnd: null,
        riskStatus: "unknown" as const,
        linkedTradeCount: linked.length,
        unknownTradeCount,
      }
    }

    return {
      ticker: position.ticker,
      activeRiskVnd: linked.reduce((sum, row) => sum + (row.activeRiskVnd ?? 0), 0),
      riskStatus: "known" as const,
      linkedTradeCount: linked.length,
      unknownTradeCount: 0,
    }
  })

  return {
    holdingRisks,
    unknownRiskItemCount: unknownNormalizedTradeCount + unlinkedHoldingCount,
  }
}

function deriveCombinedVerdict(input: {
  riskContextAvailable: boolean
  unknownRiskItemCount: number
  accountEquityComplete: boolean
  maxActiveRiskPercent: number | null
  fundingGapVnd: number
  projectedKnownActiveRiskVnd: number
  maxActiveRiskVnd: number | null
}): CombinedVerdict {
  if (!input.riskContextAvailable) return "UNAVAILABLE"
  if (input.unknownRiskItemCount > 0) return "RISK UNKNOWN"
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
  knownActiveRiskVnd: number
  maxActiveRiskPercent: number | null
  unknownRiskItemCount: number
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
    unknownRiskItemCount: input.unknownRiskItemCount,
    verdict: deriveCombinedVerdict({
      riskContextAvailable: input.riskContextAvailable,
      unknownRiskItemCount: input.unknownRiskItemCount,
      accountEquityComplete: input.accountEquityComplete,
      maxActiveRiskPercent: input.maxActiveRiskPercent,
      fundingGapVnd,
      projectedKnownActiveRiskVnd,
      maxActiveRiskVnd,
    }),
  }
}
