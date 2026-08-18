export interface ClusteredTrade {
  id: string
  time: string
  price: number
  volume: number
  side: "BUY" | "SELL" | "UNKNOWN"
  count: number
}

export function parseTradeSeconds(timeStr: string | number): number {
  if (!timeStr) return 0
  if (typeof timeStr === "number") {
    return timeStr > 1_000_000_000_000 ? Math.floor(timeStr / 1000) : timeStr
  }
  const str = String(timeStr).trim()
  if (str.includes("T") || str.includes("-")) {
    const ms = Date.parse(str)
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
  }
  const match = str.match(/(\d{1,2}):(\d{2}):(\d{2})/)
  if (match) {
    const h = parseInt(match[1], 10) || 0
    const m = parseInt(match[2], 10) || 0
    const s = parseInt(match[3], 10) || 0
    return h * 3600 + m * 60 + s
  }
  const num = Number(str)
  if (!Number.isNaN(num) && num > 0) {
    return num > 1_000_000_000_000 ? Math.floor(num / 1000) : num
  }
  const parsed = Date.parse(str)
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000)
  return 0
}

/**
 * Gộp các giao dịch có cùng mức giá (price), cùng chiều (side) và diễn ra cùng giây hoặc cách nhau <= 1s thành 1 lệnh
 */
export function clusterTrades<T extends { id: string; time: string; price: number; volume: number; side: "BUY" | "SELL" | "UNKNOWN" }>(
  trades: T[]
): ClusteredTrade[] {
  if (!trades.length) return []
  const result: ClusteredTrade[] = []
  let currentCluster: {
    id: string
    time: string
    price: number
    side: "BUY" | "SELL" | "UNKNOWN"
    totalVolume: number
    earliestSec: number
    count: number
  } | null = null

  for (const t of trades) {
    const sec = parseTradeSeconds(t.time)

    if (!currentCluster) {
      currentCluster = {
        id: t.id,
        time: t.time,
        price: t.price,
        side: t.side,
        totalVolume: t.volume,
        earliestSec: sec,
        count: 1,
      }
      continue
    }

    const isSamePrice = Math.abs(t.price - currentCluster.price) < 0.0001
    const isSameSide = t.side === currentCluster.side
    const secDiff = Math.abs(currentCluster.earliestSec - sec)
    const isWithin1Sec = secDiff <= 1

    if (isSamePrice && isSameSide && isWithin1Sec) {
      currentCluster.totalVolume += t.volume
      currentCluster.earliestSec = Math.min(currentCluster.earliestSec, sec)
      currentCluster.count += 1
    } else {
      result.push({
        id: currentCluster.id,
        time: currentCluster.time,
        price: currentCluster.price,
        volume: currentCluster.totalVolume,
        side: currentCluster.side,
        count: currentCluster.count,
      })

      currentCluster = {
        id: t.id,
        time: t.time,
        price: t.price,
        side: t.side,
        totalVolume: t.volume,
        earliestSec: sec,
        count: 1,
      }
    }
  }

  if (currentCluster) {
    result.push({
      id: currentCluster.id,
      time: currentCluster.time,
      price: currentCluster.price,
      volume: currentCluster.totalVolume,
      side: currentCluster.side,
      count: currentCluster.count,
    })
  }

  return result
}
