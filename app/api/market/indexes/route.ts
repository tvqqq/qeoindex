import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import { fetchTradingViewIndexes } from "@/modules/market/providers/tradingview/index"
import { readThroughUiCache } from "@/modules/shared/cache/ui-data-cache"
import { getMarketSessionStatus } from "@/modules/market/realtime/session-countdown"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const INDEXES_CACHE_NAMESPACE = "market-indexes-v1"

function isIndexQuotesMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function vietnamDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export async function GET() {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response

  try {
    const now = new Date()
    const session = getMarketSessionStatus(now)
    const ttlSeconds = session.isLiveSession ? 15 : Math.min(session.ttlSeconds, 3600)
    const key = `indexes:${vietnamDateKey(now)}:${session.cacheBucketKey}`

    const quotes = await readThroughUiCache({
      namespace: INDEXES_CACHE_NAMESPACE,
      key,
      tag: "market-indexes",
      name: "QeoIndex Market Indexes",
      ttlSeconds,
      validate: isIndexQuotesMap,
      load: () => fetchTradingViewIndexes(),
    })

    return NextResponse.json({ ok: true, provider: "TradingView snapshot + DNSE live", quotes, errors: [], generatedAt: new Date().toISOString() }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({ ok: false, provider: "TradingView snapshot + DNSE live", quotes: {}, errors: [{ error: error instanceof Error ? error.message : String(error) }], generatedAt: new Date().toISOString() }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
