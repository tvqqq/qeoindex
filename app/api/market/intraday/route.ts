import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import {
  parseSymbols,
  getCachedIntraday5mSnapshot,
  getIntraday5mSnapshot,
} from "@/modules/market/realtime/intraday-5m-service"
import { miniChartPointsForDisplay } from "@/modules/market/realtime/session-ui"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
}

export async function GET(request: Request) {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response

  const startedAt = performance.now()
  const symbols = parseSymbols(request)
  if (!symbols.length) {
    return NextResponse.json({ ok: false, message: "Missing valid symbols." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const now = new Date()

  // Prefer the exact bucket, then a recent latest snapshot. During a live session
  // the service accepts only the current or immediately previous 5-minute bucket,
  // so a fresh page cannot inherit an hours-old morning chart before realtime starts.
  let snapshot = await getCachedIntraday5mSnapshot(symbols, now)
  const cacheLayer = snapshot ? "cache" : "provider"

  if (!snapshot) {
    snapshot = await getIntraday5mSnapshot(symbols, now)
  }

  const displayRows = snapshot.rows.map((row) => {
    const points = miniChartPointsForDisplay(row.points, now)
    return {
      ...row,
      points,
      lastBarAt: points.at(-1)?.time ?? null,
    }
  })
  const histories = Object.fromEntries(displayRows.map((row) => [row.symbol, row]))
  const successCount = displayRows.filter((row) => row.points.length > 0).length

  return NextResponse.json({
    ok: successCount > 0,
    provider: "5m snapshot + DNSE live",
    resolution: "5m",
    generatedAt: snapshot.generatedAt,
    durationMs: Math.round(performance.now() - startedAt),
    cacheLayer,
    cacheHits: cacheLayer === "cache" ? successCount : 0,
    successCount,
    requestedCount: symbols.length,
    histories,
  }, { status: successCount > 0 ? 200 : 503, headers: NO_STORE_HEADERS })
}
