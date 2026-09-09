import type { RawTransaction } from "../pnl.ts"
import { deriveTradeCloseReview } from "../trades/review.ts"
import type {
  ClosedTradeNormalization,
  ClosedTradeOutcome,
  PerformanceJournalInput,
  PerformanceStopExitLinkInput,
  PerformanceStopInput,
  PerformanceTradeInput,
} from "./types.ts"

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function isExplicitStopOut(input: {
  tradeId: string
  linkedFills: readonly RawTransaction[]
  stopEvents: readonly PerformanceStopInput[]
  stopExitFillLinks: readonly PerformanceStopExitLinkInput[]
}): boolean {
  const sellFillIds = new Set(
    input.linkedFills
      .filter((fill) => fill.action === "sell")
      .map((fill) => fill.id),
  )
  if (sellFillIds.size === 0) return false

  const stopIds = new Set(
    input.stopEvents
      .filter((stop) => stop.trade_id === input.tradeId)
      .map((stop) => stop.id),
  )
  if (stopIds.size === 0) return false

  return input.stopExitFillLinks.some((link) => (
    link.trade_id === input.tradeId
    && stopIds.has(link.stop_event_id)
    && sellFillIds.has(link.transaction_id)
  ))
}

export function deriveClosedTradeOutcomes({
  trades,
  fills,
  journalEntries = [],
  stopEvents = [],
  stopExitFillLinks = [],
}: {
  trades: readonly PerformanceTradeInput[]
  fills: readonly RawTransaction[]
  journalEntries?: readonly PerformanceJournalInput[]
  stopEvents?: readonly PerformanceStopInput[]
  stopExitFillLinks?: readonly PerformanceStopExitLinkInput[]
}): ClosedTradeNormalization {
  const closedCandidates = trades.filter((trade) => trade.status === "closed")
  const legacyUngroupedTransactionCount = fills.filter((fill) => fill.trade_id == null).length
  const outcomes: ClosedTradeOutcome[] = []
  let excludedClosedTradeCount = 0

  for (const trade of closedCandidates) {
    // Native rows created before QEO-143 do not carry this optional field in older
    // fixtures, so only an explicit false is ineligible. Migration rows also use
    // mode=unknown, which is independently excluded. The server read model always
    // supplies the persisted scorecard_eligible boolean after QEO-143.
    if (trade.scorecard_eligible === false || trade.mode === "unknown") {
      excludedClosedTradeCount += 1
      continue
    }

    if (!trade.closed_at) {
      excludedClosedTradeCount += 1
      continue
    }

    const linkedFills = fills.filter(
      (fill) => fill.trade_id === trade.id && fill.ticker === trade.ticker,
    )

    const review = deriveTradeCloseReview({
      status: "closed",
      ticker: trade.ticker,
      fills: linkedFills,
      initialRiskAmountVnd: trade.initial_risk_amount,
    })

    if (
      review.status !== "available"
      || review.netPnlVnd == null
      || review.totalFeesVnd == null
      || review.outcome == null
    ) {
      excludedClosedTradeCount += 1
      continue
    }

    const behaviorTags = uniqueSorted(
      journalEntries
        .filter((entry) => entry.trade_id === trade.id)
        .flatMap((entry) => entry.behavior_tags ?? []),
    )
    const mistakeTags = uniqueSorted(
      linkedFills.flatMap((fill) => fill.mistake_tags ?? []),
    )

    outcomes.push({
      tradeId: trade.id,
      ticker: trade.ticker,
      mode: trade.mode,
      timeframe: trade.timeframe,
      systemTags: uniqueSorted(trade.system_tags ?? []),
      setupTags: uniqueSorted(trade.setup_tags ?? []),
      behaviorTags,
      mistakeTags,
      closedAt: trade.closed_at,
      grossPnlVnd: review.netPnlVnd + review.totalFeesVnd,
      totalFeesVnd: review.totalFeesVnd,
      netPnlVnd: review.netPnlVnd,
      pnlPercent: review.pnlPercent,
      outcome: review.outcome,
      rMultiple: review.rMultiple,
      explicitStopOut: isExplicitStopOut({
        tradeId: trade.id,
        linkedFills,
        stopEvents,
        stopExitFillLinks,
      }),
    })
  }

  outcomes.sort((a, b) => {
    const closedAtDiff = new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
    if (closedAtDiff !== 0) return closedAtDiff
    return a.tradeId.localeCompare(b.tradeId)
  })

  const completeness: ClosedTradeNormalization["completeness"] = outcomes.length === 0
    ? "insufficient"
    : excludedClosedTradeCount > 0 || legacyUngroupedTransactionCount > 0
      ? "partial"
      : "complete"

  return {
    outcomes,
    closedCandidateCount: closedCandidates.length,
    excludedClosedTradeCount,
    legacyUngroupedTransactionCount,
    completeness,
  }
}
