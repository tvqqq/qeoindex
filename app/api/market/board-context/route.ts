import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import {
  isMarketBoardContextBootstrap,
  type MarketBoardContextBootstrap,
} from "@/modules/market/board/market-context-contract"
import { loadMarketBoardContext } from "@/modules/market/board/market-context-server"
import { getMarketSessionStatus } from "@/modules/market/realtime/session-countdown"
import { readThroughUiCache } from "@/modules/shared/cache/ui-data-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}
const CACHE_NAMESPACE = "market-board-context-v3"

function vietnamDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

function hasUsableContext(data: MarketBoardContextBootstrap) {
  return Boolean(data.impact)
}

export async function GET() {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response

  try {
    const now = new Date()
    const session = getMarketSessionStatus(now)
    const ttlSeconds = session.isLiveSession ? 10 : Math.min(session.ttlSeconds, 300)
    const key = `${vietnamDateKey(now)}:${session.cacheBucketKey}`

    const data = await readThroughUiCache({
      namespace: CACHE_NAMESPACE,
      key,
      tag: "market-board-context",
      name: "QeoIndex Market Board Context",
      ttlSeconds,
      validate: isMarketBoardContextBootstrap,
      shouldCache: hasUsableContext,
      load: () => loadMarketBoardContext(now),
    })

    const ok = hasUsableContext(data)
    return NextResponse.json({ ok, ...data }, { status: ok ? 200 : 503, headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      generatedAt: new Date().toISOString(),
      impact: null,
      errors: [error instanceof Error ? error.message : String(error)],
    }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
