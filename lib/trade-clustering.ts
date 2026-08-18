export interface ClusteredTrade {
  id: string
  time: string
  price: number
  volume: number
  side: "BUY" | "SELL" | "UNKNOWN"
  count: number
}

export function parseTradeSeconds(timeStr: string): number {
  if (!timeStr) return 0
  if (timeStr.includes("T") || timeStr.includes("-")) {
    const ms = Date.parse(timeStr)
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
  }
  const match = timeStr.match(/(\d{1,2}):(\d{2}):(\d{2})/)
  if (match) {
    const h = parseInt(match[1], 10) || 0
    const m = parseInt(match[2], 10) || 0
    const s = parseInt(match[3], 10) || 0
    return h * 3600 + m * 60 + s
  }
  const parsed = Date.parse(timeStr)
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000)
  return 0
}

/**
 * Gộp các giao dịch có cùng action (side) và diễn ra cùng giây hoặc cách nhau <= 1s thành 1 lệnh
 */
export function clusterTrades<T extends { id: string; time: string; price: number; volume: number; side: "BUY" | "SELL" | "UNKNOWN" }>(
  trades: T[]
): ClusteredTrade[] {
  if (!trades.length) return []
  const result: ClusteredTrade[] = []
  let currentCluster: {
    id: string
    time: string
    side: "BUY" | "SELL" | "UNKNOWN"
    totalVolume: number
    totalValue: number
    earliestSec: number
    count: number
  } | null = null

  for (const t of trades) {
    const sec = parseTradeSeconds(t.time)

    if (!currentCluster) {
      currentCluster = {
        id: t.id,
        time: t.time,
        side: t.side,
        totalVolume: t.volume,
        totalValue: t.price * t.volume,
        earliestSec: sec,
        count: 1,
      }
      continue
    }

    const isSameSide = t.side === currentCluster.side
    const secDiff = Math.abs(currentCluster.earliestSec - sec)
    const isWithin1Sec = secDiff <= 1

    if (isSameSide && isWithin1Sec) {
      currentCluster.totalVolume += t.volume
      currentCluster.totalValue += t.price * t.volume
      currentCluster.earliestSec = Math.min(currentCluster.earliestSec, sec)
      currentCluster.count += 1
    } else {
      const avgPrice = currentCluster.totalVolume > 0 
        ? currentCluster.totalValue / currentCluster.totalVolume 
        : 0
      result.push({
        id: currentCluster.id,
        time: currentCluster.time,
        price: avgPrice,
        volume: currentCluster.totalVolume,
        side: currentCluster.side,
        count: currentCluster.count,
      })

      currentCluster = {
        id: t.id,
        time: t.time,
        side: t.side,
        totalVolume: t.volume,
        totalValue: t.price * t.volume,
        earliestSec: sec,
        count: 1,
      }
    }
  }

  if (currentCluster) {
    const avgPrice = currentCluster.totalVolume > 0 
      ? currentCluster.totalValue / currentCluster.totalVolume 
      : 0
    result.push({
      id: currentCluster.id,
      time: currentCluster.time,
      price: avgPrice,
      volume: currentCluster.totalVolume,
      side: currentCluster.side,
      count: currentCluster.count,
    })
  }

  return result
}
