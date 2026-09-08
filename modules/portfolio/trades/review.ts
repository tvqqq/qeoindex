import { computePortfolioPositions, type RawTransaction } from "../pnl.ts"
import type { TradeStatus } from "./types.ts"

type ReviewFill = {
  id: string
  trade_id?: string | null
  ticker: string
  action: string
  quantity: number
  price: number
  fee: number
  transaction_date: string
}

export type TradeCloseReview = {
  status: "available" | "unavailable"
  reason: "trade_not_closed" | "no_fills" | "open_quantity_remaining" | "unsupported_fill_action" | null
  outcome: "winner" | "loser" | "breakeven" | null
  totalPaidVnd: number | null
  totalReceivedVnd: number | null
  totalFeesVnd: number | null
  netPnlVnd: number | null
  pnlPercent: number | null
  rMultiple: number | null
}

const SUPPORTED_ACTIONS = new Set<RawTransaction["action"]>([
  "buy",
  "sell",
  "rights",
  "dividend_stock",
])

function unavailable(reason: Exclude<TradeCloseReview["reason"], null>): TradeCloseReview {
  return {
    status: "unavailable",
    reason,
    outcome: null,
    totalPaidVnd: null,
    totalReceivedVnd: null,
    totalFeesVnd: null,
    netPnlVnd: null,
    pnlPercent: null,
    rMultiple: null,
  }
}

export function deriveTradeCloseReview(input: {
  status: TradeStatus
  ticker: string
  fills: ReviewFill[]
  initialRiskAmountVnd: number | null
}): TradeCloseReview {
  if (input.status !== "closed") return unavailable("trade_not_closed")
  if (input.fills.length === 0) return unavailable("no_fills")

  const normalized: RawTransaction[] = []
  let totalPaidKvnd = 0
  let totalReceivedKvnd = 0
  let totalFeesKvnd = 0

  for (const fill of input.fills) {
    if (!SUPPORTED_ACTIONS.has(fill.action as RawTransaction["action"])) {
      return unavailable("unsupported_fill_action")
    }

    const action = fill.action as RawTransaction["action"]
    normalized.push({
      id: fill.id,
      trade_id: fill.trade_id ?? null,
      ticker: fill.ticker,
      action,
      quantity: fill.quantity,
      price: fill.price,
      fee: fill.fee,
      transaction_date: fill.transaction_date,
      tags: [],
    })

    totalFeesKvnd += fill.fee
    if (action === "buy" || action === "rights") {
      totalPaidKvnd += fill.price * fill.quantity + fill.fee
    } else if (action === "sell") {
      totalReceivedKvnd += fill.price * fill.quantity - fill.fee
    }
  }

  const summary = computePortfolioPositions(normalized)
  if (summary.positions.some((position) => position.ticker === input.ticker && position.openQty > 0.0001)) {
    return unavailable("open_quantity_remaining")
  }

  const netPnlVnd = summary.totalRealizedPnl * 1000
  const totalPaidVnd = totalPaidKvnd * 1000
  const totalReceivedVnd = totalReceivedKvnd * 1000
  const totalFeesVnd = totalFeesKvnd * 1000
  const pnlPercent = totalPaidVnd > 0 ? (netPnlVnd / totalPaidVnd) * 100 : null
  const rMultiple = input.initialRiskAmountVnd != null && input.initialRiskAmountVnd > 0
    ? netPnlVnd / input.initialRiskAmountVnd
    : null
  const outcome = netPnlVnd > 0 ? "winner" : netPnlVnd < 0 ? "loser" : "breakeven"

  return {
    status: "available",
    reason: null,
    outcome,
    totalPaidVnd,
    totalReceivedVnd,
    totalFeesVnd,
    netPnlVnd,
    pnlPercent,
    rMultiple,
  }
}
