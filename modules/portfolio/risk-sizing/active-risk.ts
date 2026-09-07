import { computePortfolioPositions, type RawTransaction } from "../pnl.ts"
import { buildTradeReadModel } from "../trades/read-model.ts"

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
  let knownActiveRiskVnd = 0
  let unknownRiskTradeCount = 0

  for (const trade of trades) {
    const linkedFills = fills.filter((fill) => fill.trade_id === trade.id && fill.ticker === trade.ticker)
    const linkedStops = stopEvents.filter((event) => event.trade_id === trade.id)
    const summary = computePortfolioPositions(linkedFills)
    const position = summary.positions.find((candidate) => candidate.ticker === trade.ticker)
    const readModel = buildTradeReadModel({
      trade,
      fills: linkedFills,
      stopEvents: linkedStops,
      journalEntries: [],
    })

    if (!position || !(position.openQty > 0) || !readModel.latestStop) {
      unknownRiskTradeCount += 1
      continue
    }

    const downsidePerShareKvnd = Math.max(0, position.avgCost - readModel.latestStop.price)
    knownActiveRiskVnd += downsidePerShareKvnd * position.openQty * 1000
  }

  return { knownActiveRiskVnd, unknownRiskTradeCount }
}
