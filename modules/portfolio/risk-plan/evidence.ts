import type { RawTransaction } from "../pnl.ts"
import { deriveClosedTradeOutcomes } from "../performance/closed-trades.ts"
import { buildTradingScorecard } from "../performance/scorecard.ts"
import type { PerformanceTradeInput } from "../performance/types.ts"
import type {
  ProfileMetricEvidence,
  RiskProfileMetricEvidenceMap,
} from "./types.ts"

type EvidenceTrade = Pick<PerformanceTradeInput, "id" | "ticker" | "status" | "closed_at">
  & Partial<Pick<
    PerformanceTradeInput,
    "mode" | "timeframe" | "system_tags" | "setup_tags" | "initial_risk_amount"
  >>

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

function toPerformanceTrade(trade: EvidenceTrade): PerformanceTradeInput {
  // Compatibility defaults keep the historical pure helper callable by QEO-138 tests.
  // Production callers supply these canonical fields from portfolio_trades in server.ts.
  return {
    id: trade.id,
    ticker: trade.ticker,
    mode: trade.mode ?? "live",
    status: trade.status,
    timeframe: trade.timeframe ?? null,
    system_tags: trade.system_tags ?? [],
    setup_tags: trade.setup_tags ?? [],
    initial_risk_amount: trade.initial_risk_amount ?? null,
    closed_at: trade.closed_at,
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

  const normalized = deriveClosedTradeOutcomes({
    trades: closedCandidates.map(toPerformanceTrade),
    fills,
  })
  const outcomes = normalized.outcomes
  const scorecard = buildTradingScorecard({
    outcomes,
    population: "combined",
    initialCapitalVnd: null,
  })

  const sampleSize = scorecard.eligibleTradeCount
  const excludedCount = normalized.excludedClosedTradeCount
  const periodStart = outcomes[0]?.closedAt ?? null
  const sampleCompleteness: ProfileMetricEvidence["completeness"] = sampleSize === 0
    ? "insufficient"
    : excludedCount > 0
      ? "partial"
      : "complete"
  const exclusionNote = excludedCount > 0
    ? `${excludedCount} closed Trade(s) were excluded because linked Fill history was incomplete.`
    : undefined

  const winRatio = metricEvidence({
    value: scorecard.winRatioPercent.value,
    periodStart,
    periodEnd,
    sampleSize,
    excludedCount,
    completeness: sampleCompleteness,
    computedAt,
    note: exclusionNote,
  })

  const payoffAvailable = scorecard.payoffRatio.status === "available"
  const payoffRatio = metricEvidence({
    value: scorecard.payoffRatio.value,
    periodStart,
    periodEnd,
    sampleSize,
    excludedCount,
    completeness: payoffAvailable ? sampleCompleteness : "insufficient",
    computedAt,
    note: payoffAvailable
      ? exclusionNote
      : scorecard.payoffRatio.reason ?? "Payoff Ratio evidence is unavailable.",
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
