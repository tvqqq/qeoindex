export type AccountEquitySource = "portfolio_mark_to_market" | "portfolio_partial" | "manual"

export type AccountEquityContext = {
  valueVnd: number
  source: AccountEquitySource
  missingPriceTickers: string[]
}

export type AccountEquityPosition = {
  ticker: string
  openQty: number
  avgCost: number
}

export type AccountEquityInput = {
  initialCapitalVnd: number
  totalRealizedPnlKvnd: number
  positions: AccountEquityPosition[]
  currentPricesKvnd: Record<string, number>
}

export type TradeSizeInput = {
  side: "long"
  accountEquityVnd: number
  riskPercent: number
  plannedEntryKvnd: number | null
  initialStopKvnd: number | null
  estimatedCommissionVnd: number
  slippageAllowanceVnd: number
  lotSizeShares: number
  advancedRiskOverrideAcknowledged: boolean
}

export type TradeSizeStatus =
  | "ready"
  | "incomplete"
  | "invalid_account_equity"
  | "invalid_risk_percent"
  | "advanced_override_required"
  | "invalid_entry"
  | "invalid_stop_direction"
  | "zero_stop_distance"
  | "invalid_cost"
  | "costs_consume_risk_budget"
  | "below_regular_lot"

export type TradeSizeResult = {
  status: TradeSizeStatus
  riskAmountVnd: number | null
  riskPerShareVnd: number | null
  stopDistanceKvnd: number | null
  stopDistancePercent: number | null
  availableRiskBudgetVnd: number | null
  rawTradeSizeShares: number | null
  tradeSizeShares: number
  positionValueVnd: number | null
  totalRiskConsumptionVnd: number | null
}

export type RiskState = "normal" | "reduce_risk" | "pause_and_review" | "unknown"

export type CurrentActiveRiskContext = {
  knownActiveRiskVnd: number
  accountEquityVnd: number
  maxActiveRiskPercent: number | null
  unknownRiskTradeCount: number
  riskState?: RiskState
}

export type ProjectedRiskStatus =
  | "within_plan"
  | "exceeds_plan"
  | "risk_unknown"
  | "no_cap"
  | "review_required"

export type ProjectedRiskResult = {
  status: ProjectedRiskStatus
  knownActiveRiskVnd: number
  plannedTradeRiskVnd: number
  projectedKnownActiveRiskVnd: number
  maxActiveRiskVnd: number | null
  remainingRiskBudgetVnd: number | null
  unknownRiskTradeCount: number
}

export type PlannedTrade = {
  id: string
  ticker: string
  plannedEntryKvnd: number
  initialStopKvnd: number
  riskPercent: number
  estimatedCommissionVnd: number
  slippageAllowanceVnd: number
  riskAmountVnd: number
  riskPerShareVnd: number
  tradeSizeShares: number
  positionValueVnd: number
  riskAddedVnd: number
}

export type PortfolioAllocationSnapshot = {
  initialCapitalVnd: number
  totalRealizedPnlVnd: number
  openPositionCostBasisVnd: number
  stockMarketValueVnd: number
  totalUnrealizedPnlVnd: number
  estimatedAvailableCashVnd: number
  missingPriceTickers: string[]
  marketPriceCoverageComplete: boolean
}

export type CombinedVerdict =
  | "UNAVAILABLE"
  | "RISK UNKNOWN"
  | "REVIEW REQUIRED"
  | "EXCEEDS PLAN"
  | "WITHIN PLAN"

export type PortfolioPlanSimulation = {
  plannedPositionValueVnd: number
  plannedRiskAddedVnd: number
  projectedKnownActiveRiskVnd: number
  projectedRiskPercent: number | null
  maxActiveRiskVnd: number | null
  remainingRiskBudgetVnd: number | null
  projectedEstimatedCashVnd: number
  fundingGapVnd: number
  verdict: CombinedVerdict
}

export type RiskTermSourceKind = "book" | "product" | "extension"

export type RiskSizingTerm = {
  label: string
  help: string
  sourceKind: RiskTermSourceKind
  formula?: string
}
