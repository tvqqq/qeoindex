export type PerformancePopulation = "live" | "paper" | "combined"

export type PerformanceTradeInput = {
  id: string
  ticker: string
  mode: "live" | "paper"
  status: string
  timeframe: string | null
  system_tags: string[]
  setup_tags: string[]
  initial_risk_amount: number | null
  closed_at: string | null
}

export type PerformanceJournalInput = {
  trade_id: string
  behavior_tags: string[]
}

export type PerformanceStopInput = {
  id: string
  trade_id: string
}

export type PerformanceStopExitLinkInput = {
  stop_event_id: string
  transaction_id: string
  trade_id: string
}

export type ClosedTradeOutcome = {
  tradeId: string
  ticker: string
  mode: "live" | "paper"
  timeframe: string | null
  systemTags: string[]
  setupTags: string[]
  behaviorTags: string[]
  mistakeTags: string[]
  closedAt: string
  grossPnlVnd: number
  totalFeesVnd: number
  netPnlVnd: number
  pnlPercent: number | null
  outcome: "winner" | "loser" | "breakeven"
  rMultiple: number | null
  explicitStopOut: boolean
}

export type ClosedTradeNormalization = {
  outcomes: ClosedTradeOutcome[]
  closedCandidateCount: number
  excludedClosedTradeCount: number
  legacyUngroupedTransactionCount: number
  completeness: "complete" | "partial" | "insufficient"
}

export type MetricValue = {
  value: number | null
  status: "available" | "insufficient"
  reason: string | null
}

export type TradingScorecard = {
  population: PerformancePopulation
  eligibleTradeCount: number
  winnerCount: number
  loserCount: number
  breakevenCount: number
  grossProfitVnd: number
  grossLossVnd: number
  commissionVnd: number
  netPnlVnd: number
  documentedPnlPercent: MetricValue
  winRatioPercent: MetricValue
  payoffRatio: MetricValue
  commissionRatio: MetricValue
  averageWinVnd: MetricValue
  averageLossVnd: MetricValue
  largestWinVnd: MetricValue
  largestLossVnd: MetricValue
  largestConsecutiveLosses: MetricValue
  averageConsecutiveLosses: MetricValue
  rolling25: {
    sampleSize: number
    netPnlVnd: number | null
    status: "positive" | "breakeven" | "negative" | "insufficient"
    isFullWindow: boolean
  }
  optimalF: MetricValue
}
