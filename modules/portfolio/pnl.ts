/**
 * Portfolio P&L Engine — AVCO (Average Cost) method
 *
 * Tính giá vốn bình quân và lãi/lỗ thực theo chuẩn thị trường chứng khoán VN.
 * Giá được tính bằng nghìn VNĐ (k₫) để nhất quán với data sources.
 */

export type TransactionAction =
  | "buy"
  | "sell"
  | "dividend_cash"
  | "dividend_stock"
  | "rights"

export interface RawTransaction {
  id: string
  ticker: string
  action: TransactionAction
  quantity: number
  price: number
  fee: number
  fee_rate?: number
  transaction_date: string
  note?: string | null
  tags: string[]
  setup_tags?: string[]
  mistake_tags?: string[]
  target_price_1?: number | null
  target_price_2?: number | null
  target_price_3?: number | null
  stop_loss_1?: number | null
  stop_loss_2?: number | null
  stop_loss_3?: number | null
}

export interface PortfolioPosition {
  ticker: string
  openQty: number
  avgCost: number
  totalInvested: number
  realizedPnl: number
  /** Compatibility read model derived from canonical level 1. */
  targetPrice: number | null
  /** Compatibility read model derived from canonical level 1. */
  stopLoss: number | null
  targetPrice1: number | null
  targetPrice2: number | null
  targetPrice3: number | null
  stopLoss1: number | null
  stopLoss2: number | null
  stopLoss3: number | null
  setupTags: string[]
  mistakeTags: string[]
  lastTransactionDate: string
}

export interface PortfolioSummary {
  positions: PortfolioPosition[]
  totalRealizedPnl: number
  calcUnrealizedPnl: (currentPrices: Record<string, number>) => {
    totalUnrealizedPnl: number
    totalMarketValue: number
    positionDetails: Array<PortfolioPosition & {
      currentPrice: number
      marketValue: number
      unrealizedPnl: number
      unrealizedPnlPct: number
    }>
  }
}

/**
 * Tính portfolio positions từ danh sách giao dịch.
 * Transactions phải được sort theo transaction_date ASC, created_at ASC.
 */
export function computePortfolioPositions(
  transactions: RawTransaction[],
): PortfolioSummary {
  const state = new Map<
    string,
    {
      openQty: number
      totalCost: number
      realizedPnl: number
      targetPrice1: number | null
      targetPrice2: number | null
      targetPrice3: number | null
      stopLoss1: number | null
      stopLoss2: number | null
      stopLoss3: number | null
      setupTags: string[]
      mistakeTags: string[]
      lastDate: string
    }
  >()

  const sorted = [...transactions].sort((a, b) => {
    if (a.transaction_date < b.transaction_date) return -1
    if (a.transaction_date > b.transaction_date) return 1
    return 0
  })

  for (const tx of sorted) {
    const ticker = tx.ticker
    if (!state.has(ticker)) {
      state.set(ticker, {
        openQty: 0,
        totalCost: 0,
        realizedPnl: 0,
        targetPrice1: null,
        targetPrice2: null,
        targetPrice3: null,
        stopLoss1: null,
        stopLoss2: null,
        stopLoss3: null,
        setupTags: [],
        mistakeTags: [],
        lastDate: tx.transaction_date,
      })
    }

    const pos = state.get(ticker)!
    pos.lastDate = tx.transaction_date

    if (tx.target_price_1 != null) pos.targetPrice1 = tx.target_price_1
    if (tx.target_price_2 != null) pos.targetPrice2 = tx.target_price_2
    if (tx.target_price_3 != null) pos.targetPrice3 = tx.target_price_3
    if (tx.stop_loss_1 != null) pos.stopLoss1 = tx.stop_loss_1
    if (tx.stop_loss_2 != null) pos.stopLoss2 = tx.stop_loss_2
    if (tx.stop_loss_3 != null) pos.stopLoss3 = tx.stop_loss_3

    if (tx.setup_tags && tx.setup_tags.length > 0) {
      pos.setupTags = Array.from(new Set([...pos.setupTags, ...tx.setup_tags]))
    }
    if (tx.mistake_tags && tx.mistake_tags.length > 0) {
      pos.mistakeTags = Array.from(new Set([...pos.mistakeTags, ...tx.mistake_tags]))
    }

    switch (tx.action) {
      case "buy": {
        const addCost = tx.price * tx.quantity + tx.fee
        pos.totalCost += addCost
        pos.openQty += tx.quantity
        break
      }

      case "sell": {
        if (pos.openQty <= 0) break
        const sellQty = Math.min(tx.quantity, pos.openQty)
        const avgCost = pos.openQty > 0 ? pos.totalCost / pos.openQty : 0
        const realized = (tx.price - avgCost) * sellQty - tx.fee
        pos.realizedPnl += realized
        pos.totalCost = avgCost * (pos.openQty - sellQty)
        pos.openQty -= sellQty
        break
      }

      case "dividend_cash": {
        if (pos.openQty <= 0) break
        const dividendAmount = tx.price * pos.openQty - tx.fee
        pos.totalCost = Math.max(0, pos.totalCost - dividendAmount)
        break
      }

      case "dividend_stock": {
        pos.openQty += tx.quantity
        break
      }

      case "rights": {
        const addCost = tx.price * tx.quantity + tx.fee
        pos.totalCost += addCost
        pos.openQty += tx.quantity
        break
      }
    }
  }

  const openPositions: PortfolioPosition[] = []
  let totalRealizedFromClosed = 0

  for (const [ticker, pos] of state.entries()) {
    totalRealizedFromClosed += pos.realizedPnl

    if (pos.openQty > 0.0001) {
      const avgCost = pos.totalCost / pos.openQty
      openPositions.push({
        ticker,
        openQty: pos.openQty,
        avgCost,
        totalInvested: pos.totalCost,
        realizedPnl: pos.realizedPnl,
        targetPrice: pos.targetPrice1,
        stopLoss: pos.stopLoss1,
        targetPrice1: pos.targetPrice1,
        targetPrice2: pos.targetPrice2,
        targetPrice3: pos.targetPrice3,
        stopLoss1: pos.stopLoss1,
        stopLoss2: pos.stopLoss2,
        stopLoss3: pos.stopLoss3,
        setupTags: pos.setupTags,
        mistakeTags: pos.mistakeTags,
        lastTransactionDate: pos.lastDate,
      })
    }
  }

  return {
    positions: openPositions,
    totalRealizedPnl: totalRealizedFromClosed,
    calcUnrealizedPnl: (currentPrices: Record<string, number>) => {
      let totalUnrealizedPnl = 0
      let totalMarketValue = 0

      const positionDetails = openPositions.map((pos) => {
        const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
        const marketValue = currentPrice * pos.openQty
        const unrealizedPnl = (currentPrice - pos.avgCost) * pos.openQty
        const unrealizedPnlPct =
          pos.avgCost > 0 ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100 : 0

        totalMarketValue += marketValue
        totalUnrealizedPnl += unrealizedPnl

        return {
          ...pos,
          currentPrice,
          marketValue,
          unrealizedPnl,
          unrealizedPnlPct,
        }
      })

      return {
        totalUnrealizedPnl,
        totalMarketValue,
        positionDetails,
      }
    },
  }
}

export function calculatePositionSizing({
  initialCapital,
  accountRiskPct,
  tradeStopLossPct,
  entryPrice,
}: {
  initialCapital: number
  accountRiskPct: number
  tradeStopLossPct: number
  entryPrice?: number
}) {
  const maxRiskAmount = initialCapital * (accountRiskPct / 100)
  const allocatedCapital =
    tradeStopLossPct > 0 ? maxRiskAmount / (tradeStopLossPct / 100) : 0
  const maxShares =
    entryPrice && entryPrice > 0
      ? Math.floor(allocatedCapital / (entryPrice * 1000))
      : 0

  return {
    maxRiskAmount,
    allocatedCapital,
    maxShares,
    allocationPctOfNav:
      initialCapital > 0 ? (allocatedCapital / initialCapital) * 100 : 0,
  }
}
