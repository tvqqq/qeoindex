import { computePortfolioPositions, type RawTransaction } from "../pnl.ts"
import { buildTradeReadModel } from "../trades/read-model.ts"
import type { OpenTradeRiskBreakdown } from "./types.ts"

export type OpenTradeRiskRow = {
  id: string
  portfolio_id: string
  user_id: string
  ticker: string
  mode: "live" | "paper"
  status: "open" | "partially_closed"
  initial_stop_loss_exit?: number | null
  opened_at?: string | null
  created_at: string
  updated_at: string
}

export type StopRiskRow = {
  id: string
  trade_id: string
  stop_type: string
  price: number
  effective_at: string
  created_at: string
}

export function computeOpenTradeRiskContext({
  trades,
  fills,
  stopEvents,
}: {
  trades: OpenTradeRiskRow[]
  fills: RawTransaction[]
  stopEvents: StopRiskRow[]
}) {
  const breakdown: OpenTradeRiskBreakdown[] = []

  for (const trade of trades) {
    const linkedFills = fills.filter((fill) => fill.trade_id === trade.id && fill.ticker === trade.ticker)
    const linkedStops = stopEvents.filter((event) => event.trade_id === trade.id)
    const summary = computePortfolioPositions(linkedFills)
    const position = summary.positions.find((candidate) => candidate.ticker === trade.ticker)
    const readModel = buildTradeReadModel({
      trade,
      // RawTransaction is an interface and intentionally has no catch-all index signature.
      // Spread into a fresh structural object so it satisfies the Trade read-model row shape
      // without weakening either domain's public type contract or using an unsafe cast.
      fills: linkedFills.map((fill) => ({ ...fill })),
      stopEvents: linkedStops,
      journalEntries: [],
    })

    if (!position || !(position.openQty > 0) || !readModel.latestStop) {
      breakdown.push({
        tradeId: trade.id,
        ticker: trade.ticker,
        openQty: position?.openQty ?? null,
        avgCostKvnd: position?.avgCost ?? null,
        latestStopKvnd: readModel.latestStop?.price ?? null,
        activeRiskVnd: null,
        riskStatus: "unknown",
      })
      continue
    }

    const activeRiskVnd = Math.max(0, position.avgCost - readModel.latestStop.price) * position.openQty * 1000
    breakdown.push({
      tradeId: trade.id,
      ticker: trade.ticker,
      openQty: position.openQty,
      avgCostKvnd: position.avgCost,
      latestStopKvnd: readModel.latestStop.price,
      activeRiskVnd,
      riskStatus: "known",
    })
  }

  const knownActiveRiskVnd = breakdown.reduce(
    (sum, row) => sum + (row.activeRiskVnd ?? 0),
    0,
  )
  const unknownRiskTradeCount = breakdown.filter((row) => row.riskStatus === "unknown").length

  return { knownActiveRiskVnd, unknownRiskTradeCount, breakdown }
}
