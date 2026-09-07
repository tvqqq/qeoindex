export type ProfilePoint = 5 | 10 | 15
export type ProfileBand = "low" | "middle" | "high"

export type ProfileMetricEvidence = {
  source: "manual" | "canonical_closed_trades" | "account_equity_history" | "unavailable"
  value: number | null
  periodStart: string | null
  periodEnd: string | null
  sampleSize: number | null
  excludedCount: number | null
  completeness: "complete" | "partial" | "insufficient"
  computedAt: string | null
  note?: string
}

export type RiskProfileMetricEvidenceMap = {
  activeReturn12m: ProfileMetricEvidence
  winRatio: ProfileMetricEvidence
  payoffRatio: ProfileMetricEvidence
}

export type RiskProfilePoints = {
  marketRiskPoints: ProfilePoint
  activeReturn12mPoints: ProfilePoint
  winRatioPoints: ProfilePoint
  personalRiskTolerancePoints: ProfilePoint
  experiencePoints: ProfilePoint
  payoffRatioPoints: ProfilePoint
}

export type DisciplineProfilePoints = {
  punctualityPoints: ProfilePoint
  dietSelfControlPoints: ProfilePoint
  recordKeepingPoints: ProfilePoint
  officeClutterPoints: ProfilePoint
  billsExpensesPoints: ProfilePoint
  exerciseRoutinePoints: ProfilePoint
}

export type HolidayPeriodRules = {
  enabled: boolean
  consecutiveLosingTrades?: number
  consecutiveLosingDays?: number
  lossAmount?: number
  lossPercent?: number
  profitAmount?: number
  profitPercent?: number
  losingTradeWindow?: number
}

export type HolidayRules = {
  daily?: HolidayPeriodRules
  weekly?: HolidayPeriodRules
  monthly?: HolidayPeriodRules
}

export type ExecutionRules = {
  defineInitialStopBeforeEntry: boolean
  honorStopWhenHit: boolean
  stopUsesMarketOrSystemRules: boolean
  trailingStopsWhenAppropriate: boolean
  doNotMoveStopEmotionally: boolean
  recalculateRiskWhenScalingIn: boolean
  dailyRecordKeeping: boolean
}

export type ScaleOutMode = "none" | "thirds" | "30_30_40" | "signal_driven" | "custom"

export type ScaleRules = {
  scaleInOnlyToWinningPosition: boolean
  prohibitDoublingDown: boolean
  scaleOutMode: ScaleOutMode
  customScaleOutPercentages?: number[]
}

export type DiversificationRules = {
  enabled: boolean
  maxSectorRiskPercent?: number
  concentrationWarningPercent?: number
}

export type RiskCapitalPolicy =
  | { mode: "disabled" }
  | { mode: "risk_capital_amount"; amount: number }
  | { mode: "net_worth_percent"; percent: number }

export type DrawdownReduceRule = {
  enabled: boolean
  thresholdPercent?: number | null
  riskReductionFactor?: number | null
}

export type DrawdownPauseRule = {
  enabled: boolean
  thresholdPercent?: number | null
}

export type ConsecutiveStopOutRule = {
  enabled: boolean
  threshold?: number | null
}

export type RollingTradeLossRule = {
  enabled: boolean
  tradeCount?: number | null
}

export type MoneyManagementPlanInput = {
  riskProfileAttemptId: string | null
  disciplineProfileAttemptId: string | null
  defaultTradeRiskPercent: number
  advancedRiskOverrideAcknowledged: boolean
  maxActiveRiskPercent: number
  drawdownReduce: DrawdownReduceRule
  drawdownPause: DrawdownPauseRule
  consecutiveStopOuts: ConsecutiveStopOutRule
  rollingTradeLoss: RollingTradeLossRule
  holidayRules: HolidayRules
  executionRules: ExecutionRules
  scaleRules: ScaleRules
  diversificationRules: DiversificationRules
  riskCapitalPolicy: RiskCapitalPolicy
  notes: string | null
}

export type MoneyManagementPlan = MoneyManagementPlanInput & {
  id: string
  portfolioId: string
  userId: string
  version: number
  schemaVersion: number
  createdAt: string
}
