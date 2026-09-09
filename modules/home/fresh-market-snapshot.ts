import "server-only"

import { fetchTradingViewIndexes } from "@/modules/market/providers/tradingview/index"

export type FreshHomepageIndexSnapshot = {
  value: number
  changePct: number
  advances: number | null
  declines: number | null
  updatedAt: string
}

const HOMEPAGE_INDEX_TIMEOUT_MS = 3_000

function finiteInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed)
}

export async function getFreshHomepageIndexSnapshot(): Promise<FreshHomepageIndexSnapshot | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), HOMEPAGE_INDEX_TIMEOUT_MS)
    })
    const quotes = await Promise.race([
      fetchTradingViewIndexes(),
      timeout,
    ])

    if (!quotes) return null
    const vnindex = quotes.VNINDEX
    if (!vnindex || !Number.isFinite(vnindex.value) || vnindex.value <= 0 || !Number.isFinite(vnindex.changePercent)) {
      return null
    }

    return {
      value: vnindex.value,
      changePct: vnindex.changePercent,
      advances: finiteInteger(vnindex.advances),
      declines: finiteInteger(vnindex.declines),
      updatedAt: vnindex.updatedAt || new Date().toISOString(),
    }
  } catch {
    return null
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
