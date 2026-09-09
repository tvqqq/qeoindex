import type { DiversificationRules } from "../risk-plan/types.ts"
import type {
  ConcentrationCheck,
  ConcentrationCompleteness,
  ConcentrationStatus,
  PortfolioConcentrationReadModel,
} from "./types.ts"

export type PlannedConcentrationTradeInput = {
  ticker: string
  plannedQty: number
  plannedEntryKvnd: number
  plannedRiskVnd: number
  sector: string | null
}

export type ProjectTradeConcentrationInput = {
  current: PortfolioConcentrationReadModel
  accountEquityVnd: number | null
  rules: DiversificationRules | null
  trade: PlannedConcentrationTradeInput
}

export type ProjectedTradeConcentrationResult = {
  projectedTrade: PlannedConcentrationTradeInput
  tickerMarketValue: ConcentrationCheck
  tickerActiveRisk: ConcentrationCheck
  sectorActiveRisk: ConcentrationCheck
  openPositions: ConcentrationCheck
  overallStatus: ConcentrationStatus
  basis: {
    accountEquityVnd: number | null
    equityBasis: "current_account_equity"
  }
}

function ticker(value: string): string {
  return value.trim().toUpperCase()
}

function finitePositive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

function normalizePercent(value: number): number {
  return Number(value.toFixed(12))
}

function percent(amountVnd: number | null, equityVnd: number | null): number | null {
  if (amountVnd == null || !finitePositive(equityVnd)) return null
  return normalizePercent((amountVnd / equityVnd) * 100)
}

function statusRank(status: ConcentrationStatus): number {
  if (status === "BREACH") return 4
  if (status === "WARNING") return 3
  if (status === "UNKNOWN") return 2
  return 1
}

function overall(checks: ConcentrationCheck[]): ConcentrationStatus {
  const relevant = checks.filter((check) => check.reason !== "rule_not_configured")
  if (relevant.length === 0) return "UNKNOWN"
  return relevant.reduce<ConcentrationStatus>((best, check) =>
    statusRank(check.status) > statusRank(best) ? check.status : best,
  "WITHIN_PLAN")
}

function hardRuleStatus({
  metricValue,
  threshold,
  incomplete,
  missingReason,
}: {
  metricValue: number | null
  threshold: number | null
  incomplete: boolean
  missingReason: string
}): { status: ConcentrationStatus; reason: string } {
  if (threshold == null) return { status: "UNKNOWN", reason: "rule_not_configured" }
  if (metricValue == null) return { status: "UNKNOWN", reason: missingReason }
  if (metricValue > threshold) return { status: "BREACH", reason: "hard_limit_exceeded" }
  if (incomplete) return { status: "UNKNOWN", reason: "incomplete_current_evidence" }
  return { status: "WITHIN_PLAN", reason: "within_configured_limit" }
}

export function projectTradeConcentration(input: ProjectTradeConcentrationInput): ProjectedTradeConcentrationResult {
  const normalizedTicker = ticker(input.trade.ticker)
  const normalizedSector = input.trade.sector?.trim() || null
  const accountEquityVnd = finitePositive(input.accountEquityVnd) ? input.accountEquityVnd : null
  const enabled = input.rules?.enabled === true
  const warningThreshold = enabled && finitePositive(input.rules?.concentrationWarningPercent)
    ? input.rules!.concentrationWarningPercent!
    : null
  const tickerHardLimit = enabled && finitePositive(input.rules?.maxTickerConcentrationPercent)
    ? input.rules!.maxTickerConcentrationPercent!
    : null
  const sectorHardLimit = enabled && finitePositive(input.rules?.maxSectorRiskPercent)
    ? input.rules!.maxSectorRiskPercent!
    : null
  const openPositionLimit = enabled
    && Number.isInteger(input.rules?.maxConcurrentOpenPositions)
    && Number(input.rules?.maxConcurrentOpenPositions) > 0
    ? Number(input.rules!.maxConcurrentOpenPositions)
    : null

  const plannedQty = Number.isFinite(input.trade.plannedQty) && input.trade.plannedQty > 0 ? input.trade.plannedQty : 0
  const plannedEntryKvnd = finitePositive(input.trade.plannedEntryKvnd) ? input.trade.plannedEntryKvnd : 0
  const plannedRiskVnd = Number.isFinite(input.trade.plannedRiskVnd) && input.trade.plannedRiskVnd > 0 ? input.trade.plannedRiskVnd : 0
  const plannedMarketValueVnd = plannedQty * plannedEntryKvnd * 1_000
  const existingTicker = input.current.snapshot.openTickers.includes(normalizedTicker)
  const currentTickerMarketValue = input.current.snapshot.tickerMarketValueVnd[normalizedTicker]
  const tickerMarketValueIncomplete = existingTicker && currentTickerMarketValue == null
  const projectedTickerMarketValueVnd = (currentTickerMarketValue ?? 0) + plannedMarketValueVnd
  const tickerMarketMetric = percent(projectedTickerMarketValueVnd, accountEquityVnd)

  let tickerMarketStatus: ConcentrationStatus = "UNKNOWN"
  let tickerMarketReason = "rule_not_configured"
  if (tickerHardLimit != null || warningThreshold != null) {
    if (tickerMarketMetric == null) {
      tickerMarketReason = "account_equity_unavailable"
    } else if (tickerHardLimit != null && tickerMarketMetric > tickerHardLimit) {
      tickerMarketStatus = "BREACH"
      tickerMarketReason = "hard_limit_exceeded"
    } else if (tickerMarketValueIncomplete) {
      tickerMarketReason = "incomplete_current_market_value"
    } else if (warningThreshold != null && tickerMarketMetric >= warningThreshold) {
      tickerMarketStatus = "WARNING"
      tickerMarketReason = "warning_threshold_reached"
    } else {
      tickerMarketStatus = "WITHIN_PLAN"
      tickerMarketReason = "within_configured_limit"
    }
  }
  const tickerMarketValue: ConcentrationCheck = {
    id: `projected_ticker_market_value:${normalizedTicker}`,
    kind: "ticker_market_value",
    status: tickerMarketStatus,
    metricValue: tickerMarketMetric,
    metricUnit: "percent",
    amountVnd: projectedTickerMarketValueVnd,
    warningThreshold,
    breachThreshold: tickerHardLimit,
    ticker: normalizedTicker,
    sector: normalizedSector,
    basis: "current ticker market value + planned position value / current Account Equity",
    completeness: tickerMarketMetric == null ? "insufficient" : tickerMarketValueIncomplete ? "partial" : "complete",
    provenance: ["current_concentration_snapshot", "qeo139_planned_trade", "account_equity"],
    reason: tickerMarketReason,
  }

  const currentTickerRisk = input.current.snapshot.tickerKnownActiveRiskVnd[normalizedTicker] ?? 0
  const projectedTickerRiskVnd = currentTickerRisk + plannedRiskVnd
  const tickerRiskMetric = percent(projectedTickerRiskVnd, accountEquityVnd)
  const currentTickerRiskCheck = input.current.tickerActiveRisk.find((check) => check.ticker === normalizedTicker)
  const tickerRiskCompleteness: ConcentrationCompleteness = tickerRiskMetric == null
    ? "insufficient"
    : currentTickerRiskCheck?.completeness === "partial"
      ? "partial"
      : "complete"
  const tickerActiveRisk: ConcentrationCheck = {
    id: `projected_ticker_active_risk:${normalizedTicker}`,
    kind: "ticker_active_risk",
    status: "UNKNOWN",
    metricValue: tickerRiskMetric,
    metricUnit: "percent",
    amountVnd: projectedTickerRiskVnd,
    warningThreshold: null,
    breachThreshold: null,
    ticker: normalizedTicker,
    sector: normalizedSector,
    basis: "current known QEO-141 ticker Active Risk + planned QEO-139 risk / current Account Equity",
    completeness: tickerRiskCompleteness,
    provenance: ["qeo141_active_risk", "qeo139_planned_trade", "account_equity"],
    reason: "rule_not_configured",
  }

  let sectorActiveRisk: ConcentrationCheck
  if (!normalizedSector) {
    sectorActiveRisk = {
      id: "projected_sector_active_risk:UNKNOWN",
      kind: "sector_active_risk",
      status: "UNKNOWN",
      metricValue: null,
      metricUnit: "percent",
      amountVnd: plannedRiskVnd,
      warningThreshold: null,
      breachThreshold: sectorHardLimit,
      ticker: null,
      sector: null,
      basis: "planned ticker has no structured canonical sector classification",
      completeness: "insufficient",
      provenance: ["qeo139_planned_trade", "canonical_market_universe"],
      reason: sectorHardLimit == null ? "rule_not_configured" : "unknown_sector_classification",
    }
  } else {
    const currentSectorRiskVnd = input.current.snapshot.sectorKnownActiveRiskVnd[normalizedSector] ?? 0
    const projectedSectorRiskVnd = currentSectorRiskVnd + plannedRiskVnd
    const sectorMetric = percent(projectedSectorRiskVnd, accountEquityVnd)
    const currentSectorCheck = input.current.sectorActiveRisk.find((check) => check.sector === normalizedSector)
    const incomplete = input.current.evidence.activeRiskCoverage !== "complete"
      || input.current.evidence.sectorMetadataCoverage !== "complete"
      || currentSectorCheck?.completeness === "partial"
    const evaluated = hardRuleStatus({
      metricValue: sectorMetric,
      threshold: sectorHardLimit,
      incomplete,
      missingReason: "account_equity_unavailable",
    })
    sectorActiveRisk = {
      id: `projected_sector_active_risk:${normalizedSector}`,
      kind: "sector_active_risk",
      status: evaluated.status,
      metricValue: sectorMetric,
      metricUnit: "percent",
      amountVnd: projectedSectorRiskVnd,
      warningThreshold: null,
      breachThreshold: sectorHardLimit,
      ticker: null,
      sector: normalizedSector,
      basis: "current known sector Active Risk + planned QEO-139 risk / current Account Equity",
      completeness: sectorMetric == null ? "insufficient" : incomplete ? "partial" : "complete",
      provenance: ["qeo141_active_risk", "qeo139_planned_trade", "canonical_market_universe", "account_equity"],
      reason: evaluated.reason,
    }
  }

  const projectedOpenPositionCount = input.current.summary.openPositionCount
    + (!existingTicker && plannedQty > 0 ? 1 : 0)
  const openEvaluation = hardRuleStatus({
    metricValue: projectedOpenPositionCount,
    threshold: openPositionLimit,
    incomplete: false,
    missingReason: "open_position_count_unavailable",
  })
  const openPositions: ConcentrationCheck = {
    id: "projected_open_position_count",
    kind: "open_position_count",
    status: openEvaluation.status,
    metricValue: projectedOpenPositionCount,
    metricUnit: "count",
    amountVnd: null,
    warningThreshold: null,
    breachThreshold: openPositionLimit,
    ticker: null,
    sector: null,
    basis: "current distinct open tickers plus planned ticker when new",
    completeness: "complete",
    provenance: ["canonical_holdings", "qeo139_planned_trade"],
    reason: openEvaluation.reason,
  }

  const projectedTrade: PlannedConcentrationTradeInput = {
    ticker: normalizedTicker,
    plannedQty: input.trade.plannedQty,
    plannedEntryKvnd: input.trade.plannedEntryKvnd,
    plannedRiskVnd: input.trade.plannedRiskVnd,
    sector: normalizedSector,
  }

  return {
    projectedTrade,
    tickerMarketValue,
    tickerActiveRisk,
    sectorActiveRisk,
    openPositions,
    overallStatus: overall([tickerMarketValue, sectorActiveRisk, openPositions]),
    basis: {
      accountEquityVnd,
      equityBasis: "current_account_equity",
    },
  }
}
