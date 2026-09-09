import type {
  ConcentrationCheck,
  ConcentrationCompleteness,
  ConcentrationStatus,
  CurrentConcentrationInput,
  PortfolioConcentrationReadModel,
} from "./types.ts"

function normalizedTicker(value: string): string {
  return value.trim().toUpperCase()
}

function finitePositive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

function percentOfEquity(amountVnd: number | null, accountEquityVnd: number | null): number | null {
  if (amountVnd == null || !finitePositive(accountEquityVnd)) return null
  return (amountVnd / accountEquityVnd) * 100
}

function ruleEnabled(input: CurrentConcentrationInput): boolean {
  return input.rules?.enabled === true
}

function checkStatusOrder(status: ConcentrationStatus): number {
  if (status === "BREACH") return 4
  if (status === "WARNING") return 3
  if (status === "UNKNOWN") return 2
  return 1
}

function overallStatus(checks: ConcentrationCheck[]): ConcentrationStatus {
  const relevant = checks.filter((check) => check.reason !== "rule_not_configured")
  if (relevant.length === 0) return "UNKNOWN"
  return relevant.reduce<ConcentrationStatus>((strongest, check) =>
    checkStatusOrder(check.status) > checkStatusOrder(strongest) ? check.status : strongest,
  "WITHIN_PLAN")
}

function metadataCompleteness(total: number, known: number): ConcentrationCompleteness {
  if (total === 0 || known === total) return "complete"
  if (known === 0) return "insufficient"
  return "partial"
}

export function evaluateCurrentConcentration(input: CurrentConcentrationInput): PortfolioConcentrationReadModel {
  const accountEquityVnd = finitePositive(input.accountEquityVnd) ? input.accountEquityVnd : null
  const enabled = ruleEnabled(input)
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

  const positionsByTicker = new Map<string, { openQty: number; currentPriceKvnd: number | null }>()
  for (const position of input.positions) {
    const ticker = normalizedTicker(position.ticker)
    if (!ticker || !Number.isFinite(position.openQty) || position.openQty <= 0) continue
    const current = positionsByTicker.get(ticker)
    const price = finitePositive(position.currentPriceKvnd) ? position.currentPriceKvnd : null
    if (!current) {
      positionsByTicker.set(ticker, { openQty: position.openQty, currentPriceKvnd: price })
      continue
    }
    positionsByTicker.set(ticker, {
      openQty: current.openQty + position.openQty,
      currentPriceKvnd: current.currentPriceKvnd ?? price,
    })
  }
  const openTickers = [...positionsByTicker.keys()].sort()

  const sectorByTicker = new Map<string, string | null>()
  const sourceDates = new Set<string>()
  for (const item of input.sectors) {
    const ticker = normalizedTicker(item.ticker)
    if (!ticker) continue
    const sector = item.sector?.trim() || null
    sectorByTicker.set(ticker, sector)
    if (item.sourceAsOfDate) sourceDates.add(item.sourceAsOfDate)
  }

  const knownRiskByTicker = new Map<string, number>()
  const unknownRiskCountByTicker = new Map<string, number>()
  for (const row of input.activeRiskRows) {
    const ticker = normalizedTicker(row.ticker)
    if (!ticker) continue
    if (row.riskStatus === "known" && row.activeRiskVnd != null && Number.isFinite(row.activeRiskVnd) && row.activeRiskVnd >= 0) {
      knownRiskByTicker.set(ticker, (knownRiskByTicker.get(ticker) ?? 0) + row.activeRiskVnd)
    } else {
      unknownRiskCountByTicker.set(ticker, (unknownRiskCountByTicker.get(ticker) ?? 0) + 1)
    }
  }

  const relevantTickerSet = new Set<string>([
    ...openTickers,
    ...knownRiskByTicker.keys(),
    ...unknownRiskCountByTicker.keys(),
  ])
  const relevantTickers = [...relevantTickerSet].sort()
  const unknownClassificationTickers = relevantTickers.filter((ticker) => !sectorByTicker.get(ticker))
  const sectorMetadataKnownCount = relevantTickers.length - unknownClassificationTickers.length

  const tickerMarketValueVnd: Record<string, number> = {}
  const tickerMarketValue: ConcentrationCheck[] = openTickers.map((ticker) => {
    const position = positionsByTicker.get(ticker)!
    const amountVnd = finitePositive(position.currentPriceKvnd)
      ? position.openQty * position.currentPriceKvnd * 1_000
      : null
    if (amountVnd != null && Number.isFinite(amountVnd)) tickerMarketValueVnd[ticker] = amountVnd
    const metricValue = percentOfEquity(amountVnd, accountEquityVnd)
    const hasRule = tickerHardLimit != null || warningThreshold != null
    let status: ConcentrationStatus = "UNKNOWN"
    let reason = "rule_not_configured"
    if (hasRule) {
      if (amountVnd == null) {
        reason = "missing_market_price"
      } else if (metricValue == null) {
        reason = "account_equity_unavailable"
      } else if (tickerHardLimit != null && metricValue > tickerHardLimit) {
        status = "BREACH"
        reason = "hard_limit_exceeded"
      } else if (warningThreshold != null && metricValue >= warningThreshold) {
        status = "WARNING"
        reason = "warning_threshold_reached"
      } else {
        status = "WITHIN_PLAN"
        reason = "within_configured_limit"
      }
    }
    return {
      id: `ticker_market_value:${ticker}`,
      kind: "ticker_market_value",
      status,
      metricValue,
      metricUnit: "percent",
      amountVnd,
      warningThreshold,
      breachThreshold: tickerHardLimit,
      ticker,
      sector: sectorByTicker.get(ticker) ?? null,
      basis: "ticker market value / current Account Equity",
      completeness: amountVnd != null && metricValue != null ? "complete" : "insufficient",
      provenance: ["canonical_holdings", "current_market_price", "account_equity"],
      reason,
    }
  })

  const tickerKnownActiveRiskVnd: Record<string, number> = {}
  const riskTickers = [...new Set([...knownRiskByTicker.keys(), ...unknownRiskCountByTicker.keys()])].sort()
  const tickerActiveRisk: ConcentrationCheck[] = riskTickers.map((ticker) => {
    const amountVnd = knownRiskByTicker.get(ticker) ?? 0
    tickerKnownActiveRiskVnd[ticker] = amountVnd
    const metricValue = percentOfEquity(amountVnd, accountEquityVnd)
    const completeness: ConcentrationCompleteness = (unknownRiskCountByTicker.get(ticker) ?? 0) > 0 ? "partial" : "complete"
    return {
      id: `ticker_active_risk:${ticker}`,
      kind: "ticker_active_risk",
      status: "UNKNOWN",
      metricValue,
      metricUnit: "percent",
      amountVnd,
      warningThreshold: null,
      breachThreshold: null,
      ticker,
      sector: sectorByTicker.get(ticker) ?? null,
      basis: "known QEO-141 Active Risk / current Account Equity",
      completeness: metricValue == null ? "insufficient" : completeness,
      provenance: ["qeo141_active_risk", "account_equity"],
      reason: "rule_not_configured",
    }
  })

  const sectorKnownActiveRisk = new Map<string, number>()
  const sectorUnknownRiskCount = new Map<string, number>()
  let unclassifiedKnownRiskVnd = 0
  let unclassifiedRiskRowCount = 0
  for (const row of input.activeRiskRows) {
    const ticker = normalizedTicker(row.ticker)
    if (!ticker) continue
    const sector = sectorByTicker.get(ticker) ?? null
    if (!sector) {
      unclassifiedRiskRowCount += 1
      if (row.riskStatus === "known" && row.activeRiskVnd != null && Number.isFinite(row.activeRiskVnd) && row.activeRiskVnd >= 0) {
        unclassifiedKnownRiskVnd += row.activeRiskVnd
      }
      continue
    }
    if (row.riskStatus === "known" && row.activeRiskVnd != null && Number.isFinite(row.activeRiskVnd) && row.activeRiskVnd >= 0) {
      sectorKnownActiveRisk.set(sector, (sectorKnownActiveRisk.get(sector) ?? 0) + row.activeRiskVnd)
    } else {
      sectorUnknownRiskCount.set(sector, (sectorUnknownRiskCount.get(sector) ?? 0) + 1)
    }
  }

  const sectorKnownActiveRiskVnd: Record<string, number> = {}
  const knownSectorNames = [...new Set([...sectorKnownActiveRisk.keys(), ...sectorUnknownRiskCount.keys()])].sort((a, b) => a.localeCompare(b, "vi"))
  const sectorActiveRisk: ConcentrationCheck[] = knownSectorNames.map((sector) => {
    const amountVnd = sectorKnownActiveRisk.get(sector) ?? 0
    sectorKnownActiveRiskVnd[sector] = amountVnd
    const metricValue = percentOfEquity(amountVnd, accountEquityVnd)
    const localUnknown = (sectorUnknownRiskCount.get(sector) ?? 0) > 0
    const crossSectorUnknown = unclassifiedRiskRowCount > 0
    const riskIncomplete = localUnknown || crossSectorUnknown
    const completeness: ConcentrationCompleteness = metricValue == null
      ? "insufficient"
      : riskIncomplete
        ? "partial"
        : "complete"
    let status: ConcentrationStatus = "UNKNOWN"
    let reason = "rule_not_configured"
    if (sectorHardLimit != null) {
      if (metricValue == null) {
        reason = "account_equity_unavailable"
      } else if (metricValue > sectorHardLimit) {
        status = "BREACH"
        reason = "hard_limit_exceeded"
      } else if (riskIncomplete) {
        reason = "incomplete_risk_evidence"
      } else {
        status = "WITHIN_PLAN"
        reason = "within_configured_limit"
      }
    }
    return {
      id: `sector_active_risk:${sector}`,
      kind: "sector_active_risk",
      status,
      metricValue,
      metricUnit: "percent",
      amountVnd,
      warningThreshold: null,
      breachThreshold: sectorHardLimit,
      ticker: null,
      sector,
      basis: "known QEO-141 Active Risk in structured sector / current Account Equity",
      completeness,
      provenance: ["qeo141_active_risk", "canonical_market_universe", "account_equity"],
      reason,
    }
  })

  if (unclassifiedRiskRowCount > 0) {
    sectorActiveRisk.push({
      id: "sector_active_risk:UNKNOWN",
      kind: "sector_active_risk",
      status: "UNKNOWN",
      metricValue: null,
      metricUnit: "percent",
      amountVnd: unclassifiedKnownRiskVnd,
      warningThreshold: null,
      breachThreshold: sectorHardLimit,
      ticker: null,
      sector: null,
      basis: "sector classification unavailable from structured canonical metadata",
      completeness: "insufficient",
      provenance: ["qeo141_active_risk", "canonical_market_universe"],
      reason: sectorHardLimit == null ? "rule_not_configured" : "unknown_sector_classification",
    })
  }

  const openPositionCount = openTickers.length
  let openPositionStatus: ConcentrationStatus = "UNKNOWN"
  let openPositionReason = "rule_not_configured"
  if (openPositionLimit != null) {
    if (openPositionCount > openPositionLimit) {
      openPositionStatus = "BREACH"
      openPositionReason = "hard_limit_exceeded"
    } else {
      openPositionStatus = "WITHIN_PLAN"
      openPositionReason = "within_configured_limit"
    }
  }
  const openPositions: ConcentrationCheck = {
    id: "open_position_count",
    kind: "open_position_count",
    status: openPositionStatus,
    metricValue: openPositionCount,
    metricUnit: "count",
    amountVnd: null,
    warningThreshold: null,
    breachThreshold: openPositionLimit,
    ticker: null,
    sector: null,
    basis: "distinct canonical tickers with positive open quantity",
    completeness: "complete",
    provenance: ["canonical_holdings"],
    reason: openPositionReason,
  }

  const checks = [...tickerMarketValue, ...sectorActiveRisk, openPositions]
  const missingPriceCount = tickerMarketValue.filter((check) => check.amountVnd == null).length
  const holdingsCompleteness = metadataCompleteness(openTickers.length, openTickers.length - missingPriceCount)
  const activeRiskCoverage = [...unknownRiskCountByTicker.values()].some((count) => count > 0) ? "partial" : "complete"

  return {
    summary: {
      overallStatus: overallStatus(checks),
      openPositionCount,
      accountEquityVnd,
    },
    tickerMarketValue,
    tickerActiveRisk,
    sectorActiveRisk,
    openPositions,
    unknownClassificationTickers,
    snapshot: {
      tickerMarketValueVnd,
      tickerKnownActiveRiskVnd,
      sectorKnownActiveRiskVnd,
      openTickers,
    },
    evidence: {
      holdingsCompleteness,
      activeRiskCoverage,
      sectorMetadataCoverage: metadataCompleteness(relevantTickers.length, sectorMetadataKnownCount),
      sectorSourceAsOfDate: [...sourceDates].sort().at(-1) ?? null,
      moneyManagementPlanVersion: input.planVersion,
    },
  }
}
