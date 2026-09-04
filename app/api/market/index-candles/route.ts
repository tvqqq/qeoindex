import { NextRequest, NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import { fetchDnseIndexCandleHistory } from "@/modules/market/providers/dnse/index-candles"
import {
  INDEX_CHART_SYMBOLS,
  isIndexChartResolution,
  type CandleBar,
  type IndexChartResolution,
  type IndexChartSymbol,
} from "@/modules/market/realtime/index-candles"
import { isTradingSessionOpen } from "@/modules/market/realtime/session-countdown"

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
    resolution: IndexChartResolution
    generatedAt: string
    candles: Record<IndexChartSymbol, CandleBar[]>
    sessionDates: Partial<Record<IndexChartSymbol, string>>
    errors: Partial<Record<IndexChartSymbol, string>>
  }
}

const hotCache = new Map<IndexChartResolution, CachedPayload>()

export async function GET(request: NextRequest) {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response

  const rawResolution = request.nextUrl.searchParams.get("resolution") ?? "1"
  if (!isIndexChartResolution(rawResolution)) {
    return NextResponse.json(
      { ok: false, error: "Unsupported chart resolution" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const resolution = rawResolution
  const now = new Date()
  const cached = hotCache.get(resolution)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json(cached.data, { headers: NO_STORE_HEADERS })
  }

  const settled = await Promise.allSettled(
    INDEX_CHART_SYMBOLS.map((symbol) => fetchDnseIndexCandleHistory(symbol, now, resolution)),
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
    resolution,
    generatedAt: now.toISOString(),
    candles,
    sessionDates,
    errors,
  }

  if (ok) {
    hotCache.set(resolution, {
      data,
      expiresAt: Date.now() + (isTradingSessionOpen(now) ? 3_000 : 60_000),
    })
  }

  return NextResponse.json(data, { status: ok ? 200 : 503, headers: NO_STORE_HEADERS })
}
