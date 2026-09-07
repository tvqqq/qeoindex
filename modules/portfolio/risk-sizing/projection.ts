import type { CurrentActiveRiskContext, ProjectedRiskResult } from "./types.ts"

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function projectActiveRisk(
  context: CurrentActiveRiskContext,
  plannedTradeRiskVnd: number,
): ProjectedRiskResult {
  const knownActiveRiskVnd = finiteNonNegative(context.knownActiveRiskVnd)
  const normalizedPlannedRiskVnd = finiteNonNegative(plannedTradeRiskVnd)
  const projectedKnownActiveRiskVnd = knownActiveRiskVnd + normalizedPlannedRiskVnd
  const maxActiveRiskVnd = context.maxActiveRiskPercent != null
    && Number.isFinite(context.maxActiveRiskPercent)
    && context.maxActiveRiskPercent > 0
    && Number.isFinite(context.accountEquityVnd)
    && context.accountEquityVnd > 0
    ? context.accountEquityVnd * (context.maxActiveRiskPercent / 100)
    : null
  const remainingRiskBudgetVnd = maxActiveRiskVnd == null
    ? null
    : Math.max(0, maxActiveRiskVnd - projectedKnownActiveRiskVnd)

  let status: ProjectedRiskResult["status"]
  if (context.riskState === "reduce_risk" || context.riskState === "pause_and_review") {
    status = "review_required"
  } else if (context.unknownRiskTradeCount > 0 || context.riskState === "unknown") {
    status = "risk_unknown"
  } else if (maxActiveRiskVnd == null) {
    status = "no_cap"
  } else if (projectedKnownActiveRiskVnd > maxActiveRiskVnd) {
    status = "exceeds_plan"
  } else {
    status = "within_plan"
  }

  return {
    status,
    knownActiveRiskVnd,
    plannedTradeRiskVnd: normalizedPlannedRiskVnd,
    projectedKnownActiveRiskVnd,
    maxActiveRiskVnd,
    remainingRiskBudgetVnd,
    unknownRiskTradeCount: Math.max(0, Math.floor(context.unknownRiskTradeCount)),
  }
}
