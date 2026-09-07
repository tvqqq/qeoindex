import {
  computePortfolioPositions,
  type RawTransaction,
} from "../pnl.ts"
import type {
  ProfileMetricEvidence,
  RiskProfileMetricEvidenceMap,
} from "./types.ts"

type EvidenceTrade = {
  id: string
  ticker: string
  status: string
  closed_at: string | null
}

type ClosedTradeOutcome = {
  tradeId: string
  closedAt: string
  pnl: number
}

function parseRequiredDate(value: string, label: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid timestamp.`)
  }
  return date
}

function oneYearBefore(value: Date): string {
  const start = new Date(value.getTime())
  start.setUTCFullYear(start.getUTCFullYear() - 1)
  return start.toISOString()
}

function arithmeticMean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function closedTradeOutcome(
  trade: EvidenceTrade,
  fills: readonly RawTransaction[],
): ClosedTradeOutcome | null {
  if (trade.status !== "closed" || !trade.closed_at) return null

  const linked = fills.filter(
    (fill) => fill.trade_id === trade.id && fill.ticker === trade.ticker,
  )
  if (linked.length === 0) return null

  const hasEntry = linked.some(
    (fill) => fill.action === "buy" || fill.action === "rights",
  )
  const hasExit = linked.some((fill) => fill.action === "sell")
  if (!hasEntry || !hasExit) return null

  const result = computePortfolioPositions([...linked])
  if (result.positions.length > 0) return null
  if (!Number.isFinite(result.totalRealizedPnl)) return null

  return {
    tradeId: trade.id,
    closedAt: trade.closed_at,
    pnl: result.totalRealizedPnl,
  }
}

function metricEvidence({
  value,
  periodStart,
  periodEnd,
  sampleSize,
  excludedCount,
  completeness,
  computedAt,
  note,
}: {
  value: number | null
  periodStart: string | null
  periodEnd: string
  sampleSize: number
  excludedCount: number
  completeness: ProfileMetricEvidence["completeness"]
  computedAt: string
  note?: string
}): ProfileMetricEvidence {
  return {
    source: "canonical_closed_trades",
    value,
    periodStart,
    periodEnd,
    sampleSize,
    excludedCount,
    completeness,
    computedAt,
    ...(note ? { note } : {}),
  }
}

export function buildRiskProfileEvidence({
  trades,
  fills,
  periodEnd,
  computedAt = new Date().toISOString(),
}: {
  trades: readonly EvidenceTrade[]
  fills: readonly RawTransaction[]
  periodEnd: string
  computedAt?: string
}): RiskProfileMetricEvidenceMap {
  const end = parseRequiredDate(periodEnd, "periodEnd")

  const closedCandidates = trades.filter((trade) => {
    if (trade.status !== "closed" || !trade.closed_at) return false
    const closedAt = new Date(trade.closed_at)
    return !Number.isNaN(closedAt.getTime()) && closedAt.getTime() <= end.getTime()
  })

  const outcomes: ClosedTradeOutcome[] = []
  let excludedCount = 0
  for (const trade of closedCandidates) {
    const outcome = closedTradeOutcome(trade, fills)
    if (outcome) outcomes.push(outcome)
    else excludedCount += 1
  }

  outcomes.sort((a, b) => {
    const timeDiff = new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
    if (timeDiff !== 0) return timeDiff
    return a.tradeId.localeCompare(b.tradeId)
  })

  const sampleSize = outcomes.length
  const periodStart = outcomes[0]?.closedAt ?? null
  const sampleCompleteness: ProfileMetricEvidence["completeness"] =
    sampleSize === 0
      ? "insufficient"
      : excludedCount > 0
        ? "partial"
        : "complete"

  const winners = outcomes.filter((outcome) => outcome.pnl > 0)
  const losers = outcomes.filter((outcome) => outcome.pnl < 0)

  const winRatio = metricEvidence({
    value: sampleSize > 0 ? (winners.length / sampleSize) * 100 : null,
    periodStart,
    periodEnd,
    sampleSize,
    excludedCount,
    completeness: sampleCompleteness,
    computedAt,
    note: excludedCount > 0
      ? `${excludedCount} closed Trade(s) were excluded because linked Fill history was incomplete.`
      : undefined,
  })

  let payoffValue: number | null = null
  let payoffCompleteness = sampleCompleteness
  let payoffNote = excludedCount > 0
    ? `${excludedCount} closed Trade(s) were excluded because linked Fill history was incomplete.`
    : undefined

  if (sampleSize === 0) {
    payoffCompleteness = "insufficient"
    payoffNote = "No eligible closed Trade history is available for Payoff Ratio."
  } else if (winners.length === 0) {
    payoffCompleteness = "insufficient"
    payoffNote = "Payoff Ratio requires at least one winning Trade and one losing Trade."
  } else if (losers.length === 0) {
    payoffCompleteness = "insufficient"
    payoffNote = "Payoff Ratio requires at least one losing Trade; it is not represented as Infinity."
  } else {
    payoffValue = arithmeticMean(winners.map((outcome) => outcome.pnl))
      / Math.abs(arithmeticMean(losers.map((outcome) => outcome.pnl)))
  }

  const payoffRatio = metricEvidence({
    value: payoffValue,
    periodStart,
    periodEnd,
    sampleSize,
    excludedCount,
    completeness: payoffCompleteness,
    computedAt,
    note: payoffNote,
  })

  const activeReturn12m: ProfileMetricEvidence = {
    source: "unavailable",
    value: null,
    periodStart: oneYearBefore(end),
    periodEnd,
    sampleSize: null,
    excludedCount: null,
    completeness: "insufficient",
    computedAt,
    note: "12-month active trading return requires deterministic starting and ending Account Equity history; QEO-138 does not fabricate it from incomplete transactions or current NAV.",
  }

  return {
    activeReturn12m,
    winRatio,
    payoffRatio,
  }
}
