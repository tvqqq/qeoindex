import { computePortfolioPositions, type RawTransaction } from "../pnl.ts"

export type TradeFillHistoryEntry = {
  fillId: string
  runningOpenQty: number
  runningAverageCostKvnd: number | null
  runningRealizedPnlKvnd: number
}

type FillHistoryRow = {
  id: string
  trade_id?: string | null
  ticker: string
  action: string
  quantity: number
  price: number
  fee: number
  transaction_date: string
}

const PORTFOLIO_ACTIONS = new Set<RawTransaction["action"]>([
  "buy",
  "sell",
  "dividend_cash",
  "dividend_stock",
  "rights",
])

function stableNumber(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000
}

function asRawTransaction(fill: FillHistoryRow): RawTransaction | null {
  if (!PORTFOLIO_ACTIONS.has(fill.action as RawTransaction["action"])) return null
  return {
    id: fill.id,
    trade_id: fill.trade_id ?? null,
    ticker: fill.ticker,
    action: fill.action as RawTransaction["action"],
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
    transaction_date: fill.transaction_date,
    tags: [],
  }
}

export function deriveTradeFillHistory(fills: FillHistoryRow[], ticker: string): TradeFillHistoryEntry[] {
  const chronological = [...fills].sort((a, b) => {
    const dateDiff = a.transaction_date.localeCompare(b.transaction_date)
    if (dateDiff !== 0) return dateDiff
    return a.id.localeCompare(b.id)
  })
  const accepted: RawTransaction[] = []
  const history: TradeFillHistoryEntry[] = []

  for (const fill of chronological) {
    const raw = asRawTransaction(fill)
    if (raw) accepted.push(raw)

    const summary = computePortfolioPositions(accepted)
    const position = summary.positions.find((row) => row.ticker === ticker)
    history.push({
      fillId: fill.id,
      runningOpenQty: stableNumber(position?.openQty ?? 0),
      runningAverageCostKvnd: position ? stableNumber(position.avgCost) : null,
      runningRealizedPnlKvnd: stableNumber(summary.totalRealizedPnl),
    })
  }

  return history
}
