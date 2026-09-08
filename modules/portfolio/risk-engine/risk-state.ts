import type {
  PortfolioRiskStateResult,
  RiskRuleEvidence,
} from "./types.ts"

export function derivePortfolioRiskState({
  configuredDefaultTradeRiskPercent,
  reductionFactor,
  rules,
}: {
  configuredDefaultTradeRiskPercent: number
  reductionFactor: number | null
  rules: RiskRuleEvidence[]
}): PortfolioRiskStateResult {
  const pause = rules.filter(
    (rule) => rule.severity === "pause" && rule.status === "triggered",
  )
  const reduce = rules.filter(
    (rule) => rule.severity === "reduce" && rule.status === "triggered",
  )
  const insufficientRules = rules.filter((rule) => rule.status === "insufficient")
  const triggers = rules.filter((rule) => rule.status === "triggered")

  const state: PortfolioRiskStateResult["state"] = pause.length > 0
    ? "PAUSE_AND_REVIEW"
    : reduce.length > 0
      ? "REDUCE_RISK"
      : insufficientRules.length > 0
        ? "UNKNOWN"
        : "NORMAL"

  const validReductionFactor = reductionFactor != null
    && Number.isFinite(reductionFactor)
    && reductionFactor > 0
    && reductionFactor < 1
  const effectiveDefaultTradeRiskPercent = state === "REDUCE_RISK" && validReductionFactor
    ? configuredDefaultTradeRiskPercent * reductionFactor
    : configuredDefaultTradeRiskPercent

  return {
    state,
    triggers,
    insufficientRules,
    configuredDefaultTradeRiskPercent,
    effectiveDefaultTradeRiskPercent,
  }
}
