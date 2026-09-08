export type OpenTradeActiveRiskRow = {
  tradeId: string
  ticker: string
  openQty: number | null
  avgCostKvnd: number | null
  initialStopKvnd: number | null
  currentStopKvnd: number | null
  latestStopEffectiveAt: string | null
  initialRiskAmountVnd: number | null
  initialRiskPercent: number | null
  activeRiskVnd: number | null
  riskStatus: "known" | "unknown"
  reason: "missing_open_position" | "missing_stop" | null
}

export type PortfolioActiveRiskResult = {
  rows: OpenTradeActiveRiskRow[]
  knownActiveRiskVnd: number
  unknownRiskItemCount: number
  totalInitialOpenRiskVnd: number
  initialRiskUnknownCount: number
}

export type AccountEquitySnapshot = {
  equityVnd: number | null
  estimatedCashVnd: number
  marketValueVnd: number | null
  realizedPnlVnd: number
  unrealizedPnlVnd: number | null
  missingPriceTickers: string[]
  completeness: "complete" | "insufficient"
  fundingWarning: boolean
}

export type EquityPoint = {
  key: string
  kind: "baseline" | "daily" | "current"
  equityVnd: number | null
  status: "complete" | "incomplete"
  missingTickers: string[]
}

export type DrawdownSnapshot = {
  peakEquityVnd: number | null
  peakAt: string | null
  drawdownVnd: number | null
  drawdownPercent: number | null
  completeness: "complete" | "insufficient"
}

export type RiskRuleEvidence = {
  ruleId: string
  severity: "reduce" | "pause"
  configuredThreshold: number | string | null
  observedValue: number | string | null
  status: "triggered" | "clear" | "insufficient"
  reason: string
  source: "money_management_plan" | "canonical_closed_trades" | "account_equity" | "active_risk"
}

export type PortfolioRiskStateResult = {
  state: "NORMAL" | "REDUCE_RISK" | "PAUSE_AND_REVIEW" | "UNKNOWN"
  triggers: RiskRuleEvidence[]
  insufficientRules: RiskRuleEvidence[]
  configuredDefaultTradeRiskPercent: number
  effectiveDefaultTradeRiskPercent: number
}
