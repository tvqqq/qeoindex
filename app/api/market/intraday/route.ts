import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import {
  parseSymbols,
  getCachedIntraday5mSnapshot,
  getIntraday5mSnapshot,
} from "@/modules/market/realtime/intraday-5m-service"

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

  // Prefer the exact bucket, then today's latest known good snapshot. The board
  // already receives a live DNSE stream, so serving the latest cached 5m shape
  // is materially better than blocking a browser request on 100 provider calls.
  let snapshot = await getCachedIntraday5mSnapshot(symbols, now)
  const cacheLayer = snapshot ? "cache" : "provider"

  if (!snapshot) {
    snapshot = await getIntraday5mSnapshot(symbols, now)
  }

  const histories = Object.fromEntries(snapshot.rows.map((row) => [row.symbol, row]))
  const successCount = snapshot.rows.filter((row) => row.points.length > 0).length

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
