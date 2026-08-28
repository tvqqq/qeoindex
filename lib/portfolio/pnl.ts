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
  transaction_date: string
  note: string | null
  tags: string[]
  target_price: number | null
  stop_loss: number | null
}

export interface PortfolioPosition {
  ticker: string
  openQty: number           // số CP đang nắm
  avgCost: number           // giá vốn bình quân (nghìn VNĐ/CP)
  totalInvested: number     // tổng vốn đã đầu tư vào vị thế hiện tại
  realizedPnl: number       // lãi/lỗ đã chốt (nghìn VNĐ)
  targetPrice: number | null
  stopLoss: number | null
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
      totalCost: number // avg_cost * open_qty
      realizedPnl: number
      targetPrice: number | null
      stopLoss: number | null
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
        lastDate: tx.transaction_date,
      })
    }
    const pos = state.get(ticker)!
    pos.lastDate = tx.transaction_date

    // Update target/stoploss from latest transaction that has them
    if (tx.target_price !== null) pos.targetPrice = tx.target_price
    if (tx.stop_loss !== null) pos.stopLoss = tx.stop_loss

    switch (tx.action) {
      case "buy": {
        // AVCO: new avg_cost = (old total cost + new cost) / new total qty
        const newCost = tx.quantity * tx.price + tx.fee
        pos.totalCost += newCost
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
        const dividendTotal = tx.price * tx.quantity // total cash received
        // Reduce avg_cost: new total_cost = old_total_cost - dividend_total
        pos.totalCost = Math.max(0, pos.totalCost - dividendTotal)
        break
      }

      case "dividend_stock": {
        // Stock dividend: receive additional shares at 0 cost
        // quantity = number of bonus shares received
        // price = 0; fee = 0
        pos.openQty += tx.quantity
        // totalCost stays the same → avg_cost decreases
        break
      }

      case "rights": {
        // Rights issue: buy additional shares at discounted price
        const rightsCost = tx.quantity * tx.price + tx.fee
        pos.totalCost += rightsCost
        pos.openQty += tx.quantity
        break
      }
    }
  }

  // Build positions array (only open positions with qty > 0)
  const positions: PortfolioPosition[] = []
  let totalRealizedFromClosed = 0

  for (const [ticker, pos] of state.entries()) {
    totalRealizedFromClosed += pos.realizedPnl
    if (pos.openQty > 0) {
      positions.push({
        ticker,
        openQty: pos.openQty,
        avgCost: pos.openQty > 0 ? pos.totalCost / pos.openQty : 0,
        totalInvested: pos.totalCost,
        realizedPnl: pos.realizedPnl,
        targetPrice: pos.targetPrice,
        stopLoss: pos.stopLoss,
        lastTransactionDate: pos.lastDate,
      })
    }
  }

  const calcUnrealizedPnl = (currentPrices: Record<string, number>) => {
    let totalUnrealizedPnl = 0
    let totalMarketValue = 0

    const positionDetails = positions.map((pos) => {
      const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
      const marketValue = currentPrice * pos.openQty
      const unrealizedPnl = (currentPrice - pos.avgCost) * pos.openQty
      const unrealizedPnlPct =
        pos.avgCost > 0
          ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100
          : 0

      totalUnrealizedPnl += unrealizedPnl
      totalMarketValue += marketValue

      return {
        ...pos,
        currentPrice,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct,
      }
    })

    return { totalUnrealizedPnl, totalMarketValue, positionDetails }
  }

  return {
    positions,
    totalRealizedPnl: totalRealizedFromClosed,
    calcUnrealizedPnl,
  }
}
