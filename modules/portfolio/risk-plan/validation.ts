import type {
  HolidayPeriodRules,
  MoneyManagementPlanInput,
  RiskCapitalPolicy,
  ScaleRules,
} from "./types.ts"

export type RiskPlanDomainErrorCode =
  | "INVALID_PLAN"
  | "ADVANCED_RISK_ACK_REQUIRED"
  | "NOT_FOUND"

export class RiskPlanDomainError extends Error {
  readonly code: RiskPlanDomainErrorCode

  constructor(code: RiskPlanDomainErrorCode, message: string) {
    super(message)
    this.name = "RiskPlanDomainError"
    this.code = code
  }
}

function invalid(message: string): never {
  throw new RiskPlanDomainError("INVALID_PLAN", message)
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) invalid(`${label} must be a finite number.`)
}

function assertPercent(value: number, label: string): void {
  assertFinite(value, label)
  if (value <= 0 || value > 100) invalid(`${label} must be greater than 0 and at most 100%.`)
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) invalid(`${label} must be a positive integer.`)
}

function validateHolidayPeriod(rule: HolidayPeriodRules | undefined, label: string): void {
  if (!rule) return

  const positiveIntegers: Array<[number | undefined, string]> = [
    [rule.consecutiveLosingTrades, `${label} consecutive losing trades`],
    [rule.consecutiveLosingDays, `${label} consecutive losing days`],
    [rule.losingTradeWindow, `${label} losing Trade window`],
  ]
  for (const [value, field] of positiveIntegers) {
    if (value != null) assertPositiveInteger(value, field)
  }

  const positiveAmounts: Array<[number | undefined, string]> = [
    [rule.lossAmount, `${label} loss amount`],
    [rule.profitAmount, `${label} profit amount`],
  ]
  for (const [value, field] of positiveAmounts) {
    if (value == null) continue
    assertFinite(value, field)
    if (value <= 0) invalid(`${field} must be greater than 0.`)
  }

  const percentages: Array<[number | undefined, string]> = [
    [rule.lossPercent, `${label} loss percent`],
    [rule.profitPercent, `${label} profit percent`],
  ]
  for (const [value, field] of percentages) {
    if (value != null) assertPercent(value, field)
  }
}

function validateScaleRules(scaleRules: ScaleRules): void {
  if (scaleRules.scaleOutMode !== "custom") {
    if (scaleRules.customScaleOutPercentages?.length) {
      invalid("Custom scale-out percentages are only valid when scale-out mode is custom.")
    }
    return
  }

  const percentages = scaleRules.customScaleOutPercentages
  if (!percentages || percentages.length === 0) {
    invalid("Custom scale-out percentages are required and must total 100%.")
  }

  let total = 0
  for (const percentage of percentages) {
    assertFinite(percentage, "Custom scale-out percentage")
    if (percentage <= 0 || percentage > 100) {
      invalid("Each custom scale-out percentage must be greater than 0 and at most 100%.")
    }
    total += percentage
  }

  if (Math.abs(total - 100) > 1e-6) {
    invalid("Custom scale-out percentages must total 100%.")
  }
}

function validateRiskCapitalPolicy(policy: RiskCapitalPolicy): void {
  if (policy.mode === "disabled") return
  if (policy.mode === "risk_capital_amount") {
    assertFinite(policy.amount, "Risk capital amount")
    if (policy.amount <= 0) invalid("Risk capital amount must be greater than 0.")
    return
  }
  assertPercent(policy.percent, "Net-worth percent")
}

export function validateMoneyManagementPlan(input: MoneyManagementPlanInput): MoneyManagementPlanInput {
  assertPercent(input.defaultTradeRiskPercent, "Risk per Trade")
  assertPercent(input.maxActiveRiskPercent, "Max Active Risk")

  if (input.defaultTradeRiskPercent > 2 && !input.advancedRiskOverrideAcknowledged) {
    throw new RiskPlanDomainError(
      "ADVANCED_RISK_ACK_REQUIRED",
      "Risk per Trade above 2% requires explicit advanced-risk acknowledgement.",
    )
  }

  if (input.maxActiveRiskPercent < input.defaultTradeRiskPercent) {
    invalid("Max Active Risk must be at least the configured Risk per Trade.")
  }

  if (input.drawdownReduce.enabled) {
    const threshold = input.drawdownReduce.thresholdPercent
    const factor = input.drawdownReduce.riskReductionFactor
    if (threshold == null) invalid("Enabled drawdown reduction requires a threshold percent.")
    assertPercent(threshold, "Drawdown reduce threshold")
    if (factor == null || !Number.isFinite(factor) || factor <= 0 || factor >= 1) {
      invalid("Drawdown risk reduction factor must be greater than 0 and less than 1.")
    }
  } else if (
    input.drawdownReduce.thresholdPercent != null
    || input.drawdownReduce.riskReductionFactor != null
  ) {
    invalid("Disabled drawdown reduction must not persist hidden threshold values.")
  }

  if (input.drawdownPause.enabled) {
    const threshold = input.drawdownPause.thresholdPercent
    if (threshold == null) invalid("Enabled drawdown pause requires a threshold percent.")
    assertPercent(threshold, "Drawdown pause threshold")
    if (
      input.drawdownReduce.enabled
      && input.drawdownReduce.thresholdPercent != null
      && threshold < input.drawdownReduce.thresholdPercent
    ) {
      invalid("Drawdown pause threshold must be greater than or equal to the reduce-risk threshold.")
    }
  } else if (input.drawdownPause.thresholdPercent != null) {
    invalid("Disabled drawdown pause must not persist a hidden threshold.")
  }

  if (input.consecutiveStopOuts.enabled) {
    if (input.consecutiveStopOuts.threshold == null) {
      invalid("Enabled consecutive stop-out rule requires a threshold.")
    }
    assertPositiveInteger(input.consecutiveStopOuts.threshold, "Consecutive stop-out threshold")
  } else if (input.consecutiveStopOuts.threshold != null) {
    invalid("Disabled consecutive stop-out rule must not persist a hidden threshold.")
  }

  if (input.rollingTradeLoss.enabled) {
    if (input.rollingTradeLoss.tradeCount == null) {
      invalid("Enabled rolling Trade loss rule requires a Trade count.")
    }
    assertPositiveInteger(input.rollingTradeLoss.tradeCount, "Rolling losing Trade count")
  } else if (input.rollingTradeLoss.tradeCount != null) {
    invalid("Disabled rolling Trade loss rule must not persist a hidden Trade count.")
  }

  validateHolidayPeriod(input.holidayRules.daily, "Daily holiday rule")
  validateHolidayPeriod(input.holidayRules.weekly, "Weekly holiday rule")
  validateHolidayPeriod(input.holidayRules.monthly, "Monthly holiday rule")
  validateScaleRules(input.scaleRules)

  if (input.diversificationRules.maxSectorRiskPercent != null) {
    assertPercent(input.diversificationRules.maxSectorRiskPercent, "Maximum sector risk")
  }
  if (input.diversificationRules.concentrationWarningPercent != null) {
    assertPercent(input.diversificationRules.concentrationWarningPercent, "Concentration warning")
  }
  if (input.diversificationRules.maxTickerConcentrationPercent != null) {
    assertPercent(input.diversificationRules.maxTickerConcentrationPercent, "Maximum ticker concentration")
  }
  if (input.diversificationRules.maxConcurrentOpenPositions != null) {
    assertPositiveInteger(input.diversificationRules.maxConcurrentOpenPositions, "Maximum concurrent open positions")
  }

  validateRiskCapitalPolicy(input.riskCapitalPolicy)

  return {
    ...input,
    notes: input.notes?.trim() || null,
  }
}
