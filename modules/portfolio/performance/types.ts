import type { EquityPoint } from "../risk-engine/types.ts"

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

export type DrawdownEpisode = {
  peakKey: string
  startKey: string
  troughKey: string
  recoveryKey: string | null
  peakEquityVnd: number
  troughEquityVnd: number
  depthPercent: number
  recovered: boolean
}

export type DrawdownAnalytics = {
  maxDrawdownPercent: number | null
  averageDrawdownPercent: number | null
  episodes: DrawdownEpisode[]
  completeness: "complete" | "insufficient"
}

export type TradingLedgerPeriod = {
  key: string
  tradeCount: number
  winnerCount: number
  loserCount: number
  breakevenCount: number
  grossProfitVnd: number
  grossLossVnd: number
  commissionVnd: number
  netPnlVnd: number
  runningNetPnlVnd: number
  averageWinVnd: number | null
  averageLossVnd: number | null
  largestWinVnd: number | null
  largestLossVnd: number | null
}

export type AccountLedgerPeriod = {
  key: string
  startEquityVnd: number | null
  endEquityVnd: number | null
  returnPercent: number | null
  worstDrawdownPercent: number | null
  completeness: "complete" | "insufficient"
}

export type PeriodLedgerSet = {
  daily: TradingLedgerPeriod[]
  weekly: TradingLedgerPeriod[]
  monthly: TradingLedgerPeriod[]
  annual: TradingLedgerPeriod[]
}

export type PerformanceSegment = {
  dimension: "system" | "setup" | "timeframe" | "mode" | "behavior" | "mistake"
  key: string
  sampleSize: number
  winRatioPercent: number | null
  payoffRatio: number | null
  netPnlVnd: number
  smallSample: boolean
}

export type BenchmarkIndexPoint = {
  date: string
  close: number
}

export type BenchmarkPoint = {
  date: string
  portfolioReturnPercent: number
  vnindexReturnPercent: number
  alphaPercent: number
}

export type BenchmarkComparison = {
  points: BenchmarkPoint[]
  portfolioReturnPercent: number | null
  vnindexReturnPercent: number | null
  alphaPercent: number | null
  completeness: "complete" | "insufficient"
  reason: string | null
}

export type AccountLedgerSet = {
  daily: AccountLedgerPeriod[]
  weekly: AccountLedgerPeriod[]
  monthly: AccountLedgerPeriod[]
  annual: AccountLedgerPeriod[]
}

export type PerformanceReadModel = {
  scorecards: {
    live: TradingScorecard
    paper: TradingScorecard
    combined: TradingScorecard
  }
  tradingLedgers: {
    live: PeriodLedgerSet
    paper: PeriodLedgerSet
    combined: PeriodLedgerSet
  }
  accountLedgers: AccountLedgerSet
  equity: {
    points: EquityPoint[]
    accountTotalReturnPercent: number | null
    maxDrawdownPercent: number | null
    averageDrawdownPercent: number | null
    episodes: DrawdownEpisode[]
    completeness: "complete" | "insufficient"
  }
  benchmark: BenchmarkComparison
  segments: {
    live: PerformanceSegment[]
    paper: PerformanceSegment[]
    combined: PerformanceSegment[]
  }
  evidence: {
    eligibleTradeCount: number
    excludedClosedTradeCount: number
    legacyUngroupedTransactionCount: number
    tradeGroupingCompleteness: "complete" | "partial" | "insufficient"
    equityCompleteness: "complete" | "insufficient"
  }
}
