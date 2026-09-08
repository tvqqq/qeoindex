import type {
  ClosedTradeOutcome,
  MetricValue,
  PerformancePopulation,
  TradingScorecard,
} from "./types.ts"

function available(value: number): MetricValue {
  return { value, status: "available", reason: null }
}

function insufficient(reason: string): MetricValue {
  return { value: null, status: "insufficient", reason }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sortedOutcomes(
  outcomes: readonly ClosedTradeOutcome[],
  population: PerformancePopulation,
): ClosedTradeOutcome[] {
  const selected = population === "combined"
    ? [...outcomes]
    : outcomes.filter((row) => row.mode === population)

  return selected.sort((a, b) => {
    const timeDiff = new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
    return timeDiff !== 0 ? timeDiff : a.tradeId.localeCompare(b.tradeId)
  })
}

function lossRuns(outcomes: readonly ClosedTradeOutcome[]): number[] {
  const runs: number[] = []
  let current = 0

  for (const row of outcomes) {
    if (row.netPnlVnd < 0) {
      current += 1
      continue
    }
    if (current > 0) runs.push(current)
    current = 0
  }
  if (current > 0) runs.push(current)
  return runs
}

export function buildTradingScorecard({
  outcomes,
  population,
  initialCapitalVnd,
}: {
  outcomes: readonly ClosedTradeOutcome[]
  population: PerformancePopulation
  initialCapitalVnd: number | null
}): TradingScorecard {
  const selected = sortedOutcomes(outcomes, population)
  const winners = selected.filter((row) => row.netPnlVnd > 0)
  const losers = selected.filter((row) => row.netPnlVnd < 0)
  const breakevens = selected.filter((row) => row.netPnlVnd === 0)

  const grossProfitVnd = selected
    .filter((row) => row.grossPnlVnd > 0)
    .reduce((sum, row) => sum + row.grossPnlVnd, 0)
  const grossLossVnd = selected
    .filter((row) => row.grossPnlVnd < 0)
    .reduce((sum, row) => sum + row.grossPnlVnd, 0)
  const commissionVnd = selected.reduce((sum, row) => sum + row.totalFeesVnd, 0)
  const netPnlVnd = selected.reduce((sum, row) => sum + row.netPnlVnd, 0)

  const winRatioPercent = selected.length > 0
    ? available((winners.length / selected.length) * 100)
    : insufficient("No eligible closed Trades are available for Win Ratio.")

  const averageWin = winners.length > 0
    ? mean(winners.map((row) => row.netPnlVnd))
    : null
  const averageLoss = losers.length > 0
    ? mean(losers.map((row) => row.netPnlVnd))
    : null

  const payoffRatio = averageWin != null && averageLoss != null
    ? available(averageWin / Math.abs(averageLoss))
    : insufficient("Payoff Ratio requires at least one winning Trade and one losing Trade.")

  const commissionRatio = grossProfitVnd > 0
    ? available(commissionVnd / grossProfitVnd)
    : insufficient("Commission Ratio is not applicable when Gross Profit is not positive.")

  const documentedPnlPercent = initialCapitalVnd != null
    && Number.isFinite(initialCapitalVnd)
    && initialCapitalVnd > 0
    ? available((netPnlVnd / initialCapitalVnd) * 100)
    : insufficient("Portfolio Initial Capital is required for documented closed-Trade P/L percent.")

  const runs = lossRuns(selected)
  const largestConsecutiveLosses = runs.length > 0
    ? available(Math.max(...runs))
    : insufficient("No consecutive losing run is available to measure.")
  const averageConsecutiveLosses = runs.length > 0
    ? available(mean(runs))
    : insufficient("No consecutive losing run is available to average.")

  const rollingRows = selected.slice(-25)
  const rollingNetPnlVnd = rollingRows.length > 0
    ? rollingRows.reduce((sum, row) => sum + row.netPnlVnd, 0)
    : null
  const rollingStatus = rollingNetPnlVnd == null
    ? "insufficient" as const
    : rollingNetPnlVnd > 0
      ? "positive" as const
      : rollingNetPnlVnd < 0
        ? "negative" as const
        : "breakeven" as const

  const optimalF = winRatioPercent.value != null
    && payoffRatio.value != null
    && payoffRatio.value > 0
    ? available(
      (((payoffRatio.value + 1) * (winRatioPercent.value / 100)) - 1)
        / payoffRatio.value,
    )
    : insufficient("Optimal f requires valid Win Ratio and Payoff Ratio inputs.")

  return {
    population,
    eligibleTradeCount: selected.length,
    winnerCount: winners.length,
    loserCount: losers.length,
    breakevenCount: breakevens.length,
    grossProfitVnd,
    grossLossVnd,
    commissionVnd,
    netPnlVnd,
    documentedPnlPercent,
    winRatioPercent,
    payoffRatio,
    commissionRatio,
    averageWinVnd: averageWin != null
      ? available(averageWin)
      : insufficient("No winning Trade is available to average."),
    averageLossVnd: averageLoss != null
      ? available(averageLoss)
      : insufficient("No losing Trade is available to average."),
    largestWinVnd: winners.length > 0
      ? available(Math.max(...winners.map((row) => row.netPnlVnd)))
      : insufficient("No winning Trade is available."),
    largestLossVnd: losers.length > 0
      ? available(Math.min(...losers.map((row) => row.netPnlVnd)))
      : insufficient("No losing Trade is available."),
    largestConsecutiveLosses,
    averageConsecutiveLosses,
    rolling25: {
      sampleSize: rollingRows.length,
      netPnlVnd: rollingNetPnlVnd,
      status: rollingStatus,
      isFullWindow: selected.length >= 25,
    },
    optimalF,
  }
}
