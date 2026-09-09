import type { PlannedTrade } from "@/modules/portfolio/risk-sizing/types"
import type { RiskSizingClientContext } from "./use-risk-sizing-context"

export type PersistPlannedTradeInput = {
  portfolioId: string
  trade: PlannedTrade
  mode: "live" | "paper"
  riskContext: RiskSizingClientContext
  requiresConcentrationOverride: boolean
  overrideReason: string | null
}

export async function persistPlannedTradeRecord(input: PersistPlannedTradeInput): Promise<{ tradeId: string }> {
  const overrideReason = input.overrideReason?.trim() || ""
  if (input.requiresConcentrationOverride && overrideReason.length === 0) {
    throw new Error("Cần lý do override trước khi lưu Trade có cảnh báo/vượt giới hạn concentration.")
  }

  const response = await fetch(`/api/portfolio/${input.portfolioId}/trades`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticker: input.trade.ticker,
      mode: input.mode,
      status: "planned",
      trade_type: null,
      timeframe: null,
      system_tags: [],
      setup_tags: [],
      money_management_plan_id: input.riskContext.moneyManagementPlanId ?? null,
      planned_entry: input.trade.plannedEntryKvnd,
      initial_stop_loss_exit: input.trade.initialStopKvnd,
      initial_account_equity: input.riskContext.accountEquityVnd,
      initial_risk_percent: input.trade.riskPercent,
      initial_risk_amount: input.trade.riskAmountVnd,
      initial_risk_amount_per_share: input.trade.riskPerShareVnd,
      planned_trade_size: input.trade.tradeSizeShares,
      planned_position_value: input.trade.positionValueVnd,
      estimated_commission: input.trade.estimatedCommissionVnd,
      slippage_allowance: input.trade.slippageAllowanceVnd,
      pre_trade_plan: "QEO-159 deterministic concentration/diversification review",
      thesis_summary: null,
    }),
  })
  const payload = await response.json().catch(() => null) as { trade?: { id?: string }; error?: string } | null
  if (!response.ok || !payload?.trade?.id) {
    throw new Error(payload?.error || "Không thể lưu Trade dự kiến.")
  }

  if (input.requiresConcentrationOverride) {
    const journalResponse = await fetch(`/api/portfolio/${input.portfolioId}/trades/${payload.trade.id}/journal`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phase: "before",
        note: "Concentration/diversification override",
        emotion_tags: [],
        behavior_tags: ["concentration_override"],
        adherence_status: "deviated",
        override_reason: overrideReason,
        occurred_at: new Date().toISOString(),
      }),
    })
    const journalPayload = await journalResponse.json().catch(() => null) as { error?: string } | null
    if (!journalResponse.ok) {
      throw new Error(`Không thể lưu bằng chứng override: ${journalPayload?.error || "journal request failed"}`)
    }
  }

  return { tradeId: payload.trade.id }
}
