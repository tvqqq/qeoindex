import "server-only"

import type { ServerAuthContext } from "@/modules/auth/server"
import { getPortfolioRiskContext } from "../risk-engine/server.ts"
import { getRiskPlanOverview } from "../risk-plan/server.ts"
import type { OpenTradeRiskBreakdown, RiskState } from "./types.ts"

export type RiskSizingServerContext = {
  configuredDefaultTradeRiskPercent: number
  effectiveDefaultTradeRiskPercent: number
  defaultTradeRiskPercent: number
  riskSource: "money_management_plan" | "onboarding_default"
  riskState: RiskState
  riskStateReasons: string[]
  accountEquityVnd: number | null
  accountEquityCompleteness: "complete" | "insufficient"
  accountEquityMissingPriceTickers: string[]
  maxActiveRiskPercent: number | null
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  openTradeRisks: OpenTradeRiskBreakdown[]
  winRatioPercent: number | null
  payoffRatio: number | null
  evidenceCompleteness: "complete" | "partial" | "insufficient"
}

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function combinedEvidenceCompleteness(
  win: string,
  payoff: string,
): RiskSizingServerContext["evidenceCompleteness"] {
  if (win === "complete" && payoff === "complete") return "complete"
  if (win === "insufficient" && payoff === "insufficient") return "insufficient"
  return "partial"
}

function mapRiskState(value: "NORMAL" | "REDUCE_RISK" | "PAUSE_AND_REVIEW" | "UNKNOWN"): RiskState {
  if (value === "REDUCE_RISK") return "reduce_risk"
  if (value === "PAUSE_AND_REVIEW") return "pause_and_review"
  if (value === "UNKNOWN") return "unknown"
  return "normal"
}

export async function getRiskSizingContext(
  context: ServerAuthContext,
  portfolioId: string,
): Promise<RiskSizingServerContext> {
  const [risk, overview] = await Promise.all([
    getPortfolioRiskContext(context, portfolioId),
    getRiskPlanOverview(context, portfolioId),
  ])
  const plan = overview.currentMoneyManagementPlan
  const win = overview.evidence.winRatio
  const payoff = overview.evidence.payoffRatio
  const state = risk.riskState

  return {
    configuredDefaultTradeRiskPercent: state.configuredDefaultTradeRiskPercent,
    effectiveDefaultTradeRiskPercent: state.effectiveDefaultTradeRiskPercent,
    defaultTradeRiskPercent: state.effectiveDefaultTradeRiskPercent,
    riskSource: plan ? "money_management_plan" : "onboarding_default",
    riskState: mapRiskState(state.state),
    riskStateReasons: (state.state === "UNKNOWN" ? state.insufficientRules : state.triggers).map((item) => item.reason),
    accountEquityVnd: risk.account.equityVnd,
    accountEquityCompleteness: risk.account.completeness,
    accountEquityMissingPriceTickers: risk.account.missingPriceTickers,
    maxActiveRiskPercent: finiteOrNull(plan?.max_active_risk_percent),
    knownActiveRiskVnd: risk.activeRisk.knownActiveRiskVnd,
    unknownRiskTradeCount: risk.activeRisk.unknownRiskItemCount,
    openTradeRisks: risk.activeRisk.rows.map((row) => ({
      tradeId: row.tradeId,
      ticker: row.ticker,
      openQty: row.openQty,
      avgCostKvnd: row.avgCostKvnd,
      latestStopKvnd: row.currentStopKvnd,
      activeRiskVnd: row.activeRiskVnd,
      riskStatus: row.riskStatus,
    })),
    winRatioPercent: finiteOrNull(win.value),
    payoffRatio: finiteOrNull(payoff.value),
    evidenceCompleteness: combinedEvidenceCompleteness(win.completeness, payoff.completeness),
  }
}
