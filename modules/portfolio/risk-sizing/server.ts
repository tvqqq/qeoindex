import "server-only"

import type { ServerAuthContext } from "@/modules/auth/server"
import type { RawTransaction, TransactionAction } from "../pnl.ts"
import { getRiskPlanOverview } from "../risk-plan/server.ts"
import {
  computeOpenTradeRiskContext,
  type OpenTradeRiskBreakdown,
  type OpenTradeRiskRow,
  type StopRiskRow,
} from "./active-risk.ts"

export type RiskSizingServerContext = {
  defaultTradeRiskPercent: number
  riskSource: "money_management_plan" | "onboarding_default"
  maxActiveRiskPercent: number | null
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  openTradeRisks: OpenTradeRiskBreakdown[]
  winRatioPercent: number | null
  payoffRatio: number | null
  evidenceCompleteness: "complete" | "partial" | "insufficient"
}

function dbFailure(operation: string, error: unknown): never {
  const detail = String((error as { message?: unknown } | null)?.message ?? "unknown database error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
  console.error(`[QeoIndex Risk Sizing] ${operation} failed: ${detail}`)
  throw new Error(`Risk sizing read failed during ${operation}`)
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

export async function getRiskSizingContext(
  context: ServerAuthContext,
  portfolioId: string,
): Promise<RiskSizingServerContext> {
  const overview = await getRiskPlanOverview(context, portfolioId)
  const [tradesResult, fillsResult, stopsResult] = await Promise.all([
    context.supabase
      .from("portfolio_trades")
      .select("id,portfolio_id,user_id,ticker,mode,status,initial_stop_loss_exit,opened_at,created_at,updated_at")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id)
      .in("status", ["open", "partially_closed"]),
    context.supabase
      .from("portfolio_transactions")
      .select("id,trade_id,ticker,action,quantity,price,fee,fee_rate,transaction_date,tags")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id)
      .not("trade_id", "is", null),
    context.supabase
      .from("portfolio_trade_stop_events")
      .select("id,trade_id,stop_type,price,effective_at,created_at")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id),
  ])
  if (tradesResult.error) dbFailure("load-open-trades", tradesResult.error)
  if (fillsResult.error) dbFailure("load-linked-fills", fillsResult.error)
  if (stopsResult.error) dbFailure("load-stop-events", stopsResult.error)

  const trades = (tradesResult.data ?? []) as OpenTradeRiskRow[]
  const fills = (fillsResult.data ?? []).map((row) => ({
    ...row,
    action: row.action as TransactionAction,
    tags: row.tags ?? [],
  })) as RawTransaction[]
  const stops = (stopsResult.data ?? []) as StopRiskRow[]
  const active = computeOpenTradeRiskContext({ trades, fills, stopEvents: stops })
  const plan = overview.currentMoneyManagementPlan
  const win = overview.evidence.winRatio
  const payoff = overview.evidence.payoffRatio

  return {
    defaultTradeRiskPercent: finiteOrNull(plan?.default_trade_risk_percent) ?? 2,
    riskSource: plan ? "money_management_plan" : "onboarding_default",
    maxActiveRiskPercent: finiteOrNull(plan?.max_active_risk_percent),
    knownActiveRiskVnd: active.knownActiveRiskVnd,
    unknownRiskTradeCount: active.unknownRiskTradeCount,
    openTradeRisks: active.breakdown,
    winRatioPercent: finiteOrNull(win.value),
    payoffRatio: finiteOrNull(payoff.value),
    evidenceCompleteness: combinedEvidenceCompleteness(win.completeness, payoff.completeness),
  }
}
