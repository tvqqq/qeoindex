import { NextResponse } from "next/server"

import { fetchDnseIndexCandleHistory } from "@/lib/dnse-index-candles"
import { INDEX_CHART_SYMBOLS, type CandleBar, type IndexChartSymbol } from "@/lib/index-candles"
import { isTradingSessionOpen } from "@/lib/session-countdown"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
}

type CachedPayload = {
  expiresAt: number
  data: {
    ok: boolean
    resolution: "1"
    generatedAt: string
    candles: Record<IndexChartSymbol, CandleBar[]>
    sessionDates: Partial<Record<IndexChartSymbol, string>>
    errors: Partial<Record<IndexChartSymbol, string>>
  }
}

let hotCache: CachedPayload | null = null

export async function GET() {
  const now = new Date()
  if (hotCache && Date.now() < hotCache.expiresAt) {
    return NextResponse.json(hotCache.data, { headers: NO_STORE_HEADERS })
  }

  const settled = await Promise.allSettled(
    INDEX_CHART_SYMBOLS.map((symbol) => fetchDnseIndexCandleHistory(symbol, now)),
  )
  const candles: Record<IndexChartSymbol, CandleBar[]> = { VNINDEX: [], VN30F1M: [] }
  const sessionDates: Partial<Record<IndexChartSymbol, string>> = {}
  const errors: Partial<Record<IndexChartSymbol, string>> = {}

  settled.forEach((result, index) => {
    const symbol = INDEX_CHART_SYMBOLS[index]
    if (result.status === "fulfilled") {
      candles[symbol] = result.value.bars
      sessionDates[symbol] = result.value.sessionDate
    } else {
      errors[symbol] = result.reason instanceof Error ? result.reason.message : "DNSE OHLC unavailable"
    }
  })

  const ok = INDEX_CHART_SYMBOLS.some((symbol) => candles[symbol].length > 0)
  const data = {
    ok,
    resolution: "1" as const,
    generatedAt: now.toISOString(),
    candles,
    sessionDates,
    errors,
  }

  if (ok) {
    hotCache = {
      data,
      expiresAt: Date.now() + (isTradingSessionOpen(now) ? 3_000 : 60_000),
    }
  }

  return NextResponse.json(data, { status: ok ? 200 : 503, headers: NO_STORE_HEADERS })
}
