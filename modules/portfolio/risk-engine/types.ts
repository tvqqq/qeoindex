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
