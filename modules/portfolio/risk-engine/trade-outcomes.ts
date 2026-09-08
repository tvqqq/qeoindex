import type { RawTransaction } from "../pnl.ts"
import type { HolidayPeriodRules } from "../risk-plan/types.ts"
import { deriveTradeCloseReview } from "../trades/review.ts"

export type GuardrailTradeOutcome = {
  tradeId: string
  closedAt: string
  netPnlVnd: number
  outcome: "winner" | "loser" | "breakeven"
  explicitStopOut: boolean
}

export type GuardrailRuleEvaluation = {
  status: "triggered" | "clear" | "insufficient"
  triggeredFields: string[]
  insufficientFields: string[]
}

type ClosedTradeInput = {
  id: string
  ticker: string
  status: string
  closed_at: string | null
}

type StopEventInput = {
  id: string
  trade_id: string
}

type StopExitFillLinkInput = {
  stop_event_id: string
  transaction_id: string
  trade_id: string
}

export function deriveGuardrailTradeOutcomes({
  trades,
  fills,
  stopEvents,
  stopExitFillLinks,
}: {
  trades: ClosedTradeInput[]
  fills: RawTransaction[]
  stopEvents: StopEventInput[]
  stopExitFillLinks: StopExitFillLinkInput[]
}): GuardrailTradeOutcome[] {
  const outcomes: GuardrailTradeOutcome[] = []

  for (const trade of trades) {
    if (trade.status !== "closed" || !trade.closed_at) continue

    const linkedFills = fills.filter(
      (fill) => fill.trade_id === trade.id && fill.ticker === trade.ticker,
    )
    const review = deriveTradeCloseReview({
      status: "closed",
      ticker: trade.ticker,
      fills: linkedFills,
      initialRiskAmountVnd: null,
    })
    if (
      review.status !== "available"
      || review.netPnlVnd == null
      || review.outcome == null
    ) {
      continue
    }

    const stopIds = new Set(
      stopEvents.filter((event) => event.trade_id === trade.id).map((event) => event.id),
    )
    const sellFillIds = new Set(
      linkedFills.filter((fill) => fill.action === "sell").map((fill) => fill.id),
    )
    const explicitStopOut = stopExitFillLinks.some(
      (link) => link.trade_id === trade.id
        && stopIds.has(link.stop_event_id)
        && sellFillIds.has(link.transaction_id),
    )

    outcomes.push({
      tradeId: trade.id,
      closedAt: trade.closed_at,
      netPnlVnd: review.netPnlVnd,
      outcome: review.outcome,
      explicitStopOut,
    })
  }

  return outcomes.sort((a, b) => {
    const timeDiff = new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
    if (timeDiff !== 0) return timeDiff
    return a.tradeId.localeCompare(b.tradeId)
  })
}

export function evaluateRollingTradeLoss(
  outcomes: ReadonlyArray<{ netPnlVnd: number }>,
  tradeCount: number,
): { status: "triggered" | "clear" | "insufficient"; sampleSize: number; aggregateNetPnlVnd: number | null } {
  if (!Number.isInteger(tradeCount) || tradeCount <= 0 || outcomes.length < tradeCount) {
    return {
      status: "insufficient",
      sampleSize: outcomes.length,
      aggregateNetPnlVnd: null,
    }
  }

  const sample = outcomes.slice(-tradeCount)
  const aggregateNetPnlVnd = sample.reduce((sum, outcome) => sum + outcome.netPnlVnd, 0)
  return {
    status: aggregateNetPnlVnd < 0 ? "triggered" : "clear",
    sampleSize: sample.length,
    aggregateNetPnlVnd,
  }
}

export function countConsecutiveExplicitStopOuts(outcomes: GuardrailTradeOutcome[]): number {
  let count = 0
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (!outcomes[index]!.explicitStopOut) break
    count += 1
  }
  return count
}

function lastN<T>(values: T[], count: number): T[] | null {
  if (!Number.isInteger(count) || count <= 0 || values.length < count) return null
  return values.slice(-count)
}

export function evaluateHolidayPeriodRule({
  rule,
  outcomes,
  dailyNetPnlVnd,
  periodStartEquityVnd,
}: {
  period: "daily" | "weekly" | "monthly"
  rule: HolidayPeriodRules
  outcomes: GuardrailTradeOutcome[]
  dailyNetPnlVnd: Array<{ date: string; netPnlVnd: number }>
  periodStartEquityVnd: number | null
}): GuardrailRuleEvaluation {
  if (!rule.enabled) {
    return { status: "clear", triggeredFields: [], insufficientFields: [] }
  }

  const triggeredFields: string[] = []
  const insufficientFields: string[] = []
  let configuredFieldCount = 0
  const periodNetPnlVnd = outcomes.reduce((sum, outcome) => sum + outcome.netPnlVnd, 0)

  if (rule.consecutiveLosingTrades != null) {
    configuredFieldCount += 1
    const sample = lastN(outcomes, rule.consecutiveLosingTrades)
    if (!sample) insufficientFields.push("consecutiveLosingTrades")
    else if (sample.every((outcome) => outcome.outcome === "loser")) {
      triggeredFields.push("consecutiveLosingTrades")
    }
  }

  if (rule.consecutiveLosingDays != null) {
    configuredFieldCount += 1
    const sample = lastN(dailyNetPnlVnd, rule.consecutiveLosingDays)
    if (!sample) insufficientFields.push("consecutiveLosingDays")
    else if (sample.every((day) => day.netPnlVnd < 0)) {
      triggeredFields.push("consecutiveLosingDays")
    }
  }

  if (rule.lossAmount != null) {
    configuredFieldCount += 1
    if (periodNetPnlVnd <= -rule.lossAmount) triggeredFields.push("lossAmount")
  }

  if (rule.profitAmount != null) {
    configuredFieldCount += 1
    if (periodNetPnlVnd >= rule.profitAmount) triggeredFields.push("profitAmount")
  }

  if (rule.lossPercent != null) {
    configuredFieldCount += 1
    if (periodStartEquityVnd == null || !(periodStartEquityVnd > 0)) {
      insufficientFields.push("lossPercent")
    } else {
      const periodPercent = (periodNetPnlVnd / periodStartEquityVnd) * 100
      if (periodPercent <= -rule.lossPercent) triggeredFields.push("lossPercent")
    }
  }

  if (rule.profitPercent != null) {
    configuredFieldCount += 1
    if (periodStartEquityVnd == null || !(periodStartEquityVnd > 0)) {
      insufficientFields.push("profitPercent")
    } else {
      const periodPercent = (periodNetPnlVnd / periodStartEquityVnd) * 100
      if (periodPercent >= rule.profitPercent) triggeredFields.push("profitPercent")
    }
  }

  if (rule.losingTradeWindow != null) {
    configuredFieldCount += 1
    const sample = lastN(outcomes, rule.losingTradeWindow)
    if (!sample) insufficientFields.push("losingTradeWindow")
    else if (sample.reduce((sum, outcome) => sum + outcome.netPnlVnd, 0) < 0) {
      triggeredFields.push("losingTradeWindow")
    }
  }

  if (triggeredFields.length > 0) {
    return { status: "triggered", triggeredFields, insufficientFields }
  }
  if (configuredFieldCount === 0 || insufficientFields.length > 0) {
    return { status: "insufficient", triggeredFields, insufficientFields }
  }
  return { status: "clear", triggeredFields, insufficientFields }
}
