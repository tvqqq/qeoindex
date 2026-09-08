import { computePortfolioPositions, type RawTransaction } from "../pnl.ts"
import { buildTradeReadModel } from "../trades/read-model.ts"
import type { PortfolioActiveRiskResult } from "./types.ts"

export type OpenTradeRiskInput = {
  id: string
  portfolio_id: string
  user_id: string
  ticker: string
  mode: "live" | "paper"
  status: "open" | "partially_closed"
  initial_stop_loss_exit?: number | null
  initial_risk_amount?: number | null
  initial_risk_percent?: number | null
  opened_at?: string | null
  created_at: string
  updated_at: string
}

export type StopRiskInput = {
  id: string
  trade_id: string
  stop_type: string
  price: number
  effective_at: string
  created_at: string
}

export function computeOpenTradeActiveRisk({
  trades,
  fills,
  stopEvents,
}: {
  trades: OpenTradeRiskInput[]
  fills: RawTransaction[]
  stopEvents: StopRiskInput[]
}): PortfolioActiveRiskResult {
  const rows: PortfolioActiveRiskResult["rows"] = []

  for (const trade of trades) {
    const linkedFills = fills.filter(
      (fill) => fill.trade_id === trade.id && fill.ticker === trade.ticker,
    )
    const linkedStops = stopEvents.filter((event) => event.trade_id === trade.id)
    const summary = computePortfolioPositions(linkedFills)
    const position = summary.positions.find((candidate) => candidate.ticker === trade.ticker)
    const readModel = buildTradeReadModel({
      trade,
      fills: linkedFills.map((fill) => ({ ...fill })),
      stopEvents: linkedStops,
      journalEntries: [],
    })

    const common = {
      tradeId: trade.id,
      ticker: trade.ticker,
      openQty: position?.openQty ?? null,
      avgCostKvnd: position?.avgCost ?? null,
      initialStopKvnd: trade.initial_stop_loss_exit ?? null,
      currentStopKvnd: readModel.latestStop?.price ?? null,
      latestStopEffectiveAt: readModel.latestStop?.effectiveAt ?? null,
      initialRiskAmountVnd: trade.initial_risk_amount ?? null,
      initialRiskPercent: trade.initial_risk_percent ?? null,
    }

    if (!position || !(position.openQty > 0)) {
      rows.push({
        ...common,
        activeRiskVnd: null,
        riskStatus: "unknown",
        reason: "missing_open_position",
      })
      continue
    }

    if (!readModel.latestStop) {
      rows.push({
        ...common,
        activeRiskVnd: null,
        riskStatus: "unknown",
        reason: "missing_stop",
      })
      continue
    }

    rows.push({
      ...common,
      activeRiskVnd: Math.round(
        Math.max(0, position.avgCost - readModel.latestStop.price) * position.openQty * 1000,
      ),
      riskStatus: "known",
      reason: null,
    })
  }

  return {
    rows,
    knownActiveRiskVnd: rows.reduce((sum, row) => sum + (row.activeRiskVnd ?? 0), 0),
    unknownRiskItemCount: rows.filter((row) => row.riskStatus === "unknown").length,
    totalInitialOpenRiskVnd: rows.reduce((sum, row) => sum + (row.initialRiskAmountVnd ?? 0), 0),
    initialRiskUnknownCount: rows.filter((row) => row.initialRiskAmountVnd == null).length,
  }
}
