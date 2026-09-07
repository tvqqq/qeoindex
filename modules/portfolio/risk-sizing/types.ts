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
