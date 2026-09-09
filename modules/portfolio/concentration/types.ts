import type { DiversificationRules } from "../risk-plan/types.ts"

export type ConcentrationStatus = "WITHIN_PLAN" | "WARNING" | "BREACH" | "UNKNOWN"
export type ConcentrationCompleteness = "complete" | "partial" | "insufficient"

export type ConcentrationPositionInput = {
  ticker: string
  openQty: number
  currentPriceKvnd: number | null
}

export type ConcentrationRiskInput = {
  tradeId: string
  ticker: string
  activeRiskVnd: number | null
  riskStatus: "known" | "unknown"
}

export type StructuredSectorEvidence = {
  ticker: string
  sector: string | null
  source: "canonical_market_universe"
  sourceAsOfDate: string | null
}

export type CurrentConcentrationInput = {
  accountEquityVnd: number | null
  positions: ConcentrationPositionInput[]
  activeRiskRows: ConcentrationRiskInput[]
  sectors: StructuredSectorEvidence[]
  rules: DiversificationRules | null
  planVersion: number | null
}

export type ConcentrationCheck = {
  id: string
  kind: "ticker_market_value" | "ticker_active_risk" | "sector_active_risk" | "open_position_count"
  status: ConcentrationStatus
  metricValue: number | null
  metricUnit: "percent" | "count" | "vnd"
  amountVnd: number | null
  warningThreshold: number | null
  breachThreshold: number | null
  ticker: string | null
  sector: string | null
  basis: string
  completeness: ConcentrationCompleteness
  provenance: string[]
  reason: string
}

export type ConcentrationExposureSnapshot = {
  tickerMarketValueVnd: Record<string, number>
  tickerKnownActiveRiskVnd: Record<string, number>
  sectorKnownActiveRiskVnd: Record<string, number>
  openTickers: string[]
}

export type PortfolioConcentrationReadModel = {
  summary: {
    overallStatus: ConcentrationStatus
    openPositionCount: number
    accountEquityVnd: number | null
  }
  tickerMarketValue: ConcentrationCheck[]
  tickerActiveRisk: ConcentrationCheck[]
  sectorActiveRisk: ConcentrationCheck[]
  openPositions: ConcentrationCheck
  unknownClassificationTickers: string[]
  snapshot: ConcentrationExposureSnapshot
  evidence: {
    holdingsCompleteness: ConcentrationCompleteness
    activeRiskCoverage: "complete" | "partial"
    sectorMetadataCoverage: ConcentrationCompleteness
    sectorSourceAsOfDate: string | null
    moneyManagementPlanVersion: number | null
  }
}
