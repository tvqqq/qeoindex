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
  price: number       // nghìn VNĐ/cổ phiếu
  fee: number         // tổng phí + thuế (nghìn VNĐ)
  fee_rate?: number   // % phí (ví dụ 0.15%)
  transaction_date: string
  note: string | null
  tags: string[]
  setup_tags?: string[]
  mistake_tags?: string[]
  target_price?: number | null
  stop_loss?: number | null
  target_price_1?: number | null
  target_price_2?: number | null
  target_price_3?: number | null
  stop_loss_1?: number | null
  stop_loss_2?: number | null
  stop_loss_3?: number | null
}

export interface PortfolioPosition {
  ticker: string
  openQty: number           // số CP đang nắm
  avgCost: number           // giá vốn bình quân (nghìn VNĐ/CP)
  totalInvested: number     // tổng vốn đã đầu tư vào vị thế hiện tại (k₫)
  realizedPnl: number       // lãi/lỗ đã chốt (nghìn VNĐ)
  targetPrice: number | null
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
  /** Hàm tính unrealized PnL cần current prices từ ngoài */
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
  // state per ticker: qty, total cost basis, realized pnl
  const state = new Map<
    string,
    {
      openQty: number
      totalCost: number
      realizedPnl: number
      targetPrice: number | null
      stopLoss: number | null
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

  // Sort by date ascending to process chronologically
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
        targetPrice: null,
        stopLoss: null,
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

    // Track targets & stop loss from latest transaction if provided
    if (tx.target_price_1 != null) pos.targetPrice1 = tx.target_price_1
    if (tx.target_price_2 != null) pos.targetPrice2 = tx.target_price_2
    if (tx.target_price_3 != null) pos.targetPrice3 = tx.target_price_3
    if (tx.stop_loss_1 != null) pos.stopLoss1 = tx.stop_loss_1
    if (tx.stop_loss_2 != null) pos.stopLoss2 = tx.stop_loss_2
    if (tx.stop_loss_3 != null) pos.stopLoss3 = tx.stop_loss_3

    // Fallbacks for legacy single target/stoploss
    if (tx.target_price != null) pos.targetPrice = tx.target_price
    else if (pos.targetPrice1 != null) pos.targetPrice = pos.targetPrice1

    if (tx.stop_loss != null) pos.stopLoss = tx.stop_loss
    else if (pos.stopLoss1 != null) pos.stopLoss = pos.stopLoss1

    if (tx.setup_tags && tx.setup_tags.length > 0) {
      pos.setupTags = Array.from(new Set([...pos.setupTags, ...tx.setup_tags]))
    }
    if (tx.mistake_tags && tx.mistake_tags.length > 0) {
      pos.mistakeTags = Array.from(new Set([...pos.mistakeTags, ...tx.mistake_tags]))
    }

    switch (tx.action) {
      case "buy": {
        // AVCO update:
        // New total cost = old total cost + (buy price * qty) + fee
        const addCost = tx.price * tx.quantity + tx.fee
        pos.totalCost += addCost
        pos.openQty += tx.quantity
        break
      }

      case "sell": {
        if (pos.openQty <= 0) break // guard: no position to sell
        const sellQty = Math.min(tx.quantity, pos.openQty)
        const avgCost = pos.openQty > 0 ? pos.totalCost / pos.openQty : 0
        // Realized PnL = (sell price - avg cost) * qty - fee
        const realized = (tx.price - avgCost) * sellQty - tx.fee
        pos.realizedPnl += realized
        // Reduce cost basis proportionally
        pos.totalCost = avgCost * (pos.openQty - sellQty)
        pos.openQty -= sellQty
        break
      }

      case "dividend_cash": {
        // Cash dividend reduces cost basis (giảm giá vốn)
        // price field = amount per share in nghìn VNĐ
        if (pos.openQty <= 0) break
        const dividendAmount = tx.price * pos.openQty - tx.fee
        pos.totalCost = Math.max(0, pos.totalCost - dividendAmount)
        break
      }

      case "dividend_stock": {
        // Stock dividend: increases openQty, cost basis stays the same
        // -> reduces avgCost automatically
        pos.openQty += tx.quantity
        break
      }

      case "rights": {
        // Rights issue: buying additional shares at discount price
        const addCost = tx.price * tx.quantity + tx.fee
        pos.totalCost += addCost
        pos.openQty += tx.quantity
        break
      }
    }
  }

  // Build positions array — only include open positions (openQty > 0)
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
        targetPrice: pos.targetPrice,
        stopLoss: pos.stopLoss,
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

/**
 * Công thức Position Sizing chuẩn Quản trị Rủi ro (KFSP Capital Allocation)
 *
 * @param initialCapital Tổng vốn ban đầu / NAV hiện tại (VNĐ)
 * @param accountRiskPct % Cắt lỗ tối đa cho phép trên tổng tài sản (ví dụ: 1.0% hay 1.5%)
 * @param tradeStopLossPct % Cắt lỗ dự kiến trên deal tiếp theo (ví dụ: 5.0% hay 7.0%)
 * @param entryPrice Giá dự kiến mua (nghìn VNĐ / CP)
 */
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
