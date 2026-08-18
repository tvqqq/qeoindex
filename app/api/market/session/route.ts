import { NextResponse } from "next/server"

import { fetchDnseSessionHistory } from "@/lib/dnse-market-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}

function parseSymbol(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").trim().toUpperCase()
  return /^[A-Z0-9]{2,12}$/.test(symbol) ? symbol : ""
}

interface SessionCacheItem {
  data: any
  expiresAt: number
}
const serverCache = new Map<string, SessionCacheItem>()
const SERVER_TTL_MS = 15_000

export async function GET(request: Request) {
  const symbol = parseSymbol(request)
  if (!symbol) {
    return NextResponse.json({ ok: false, message: "Missing valid symbol." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const cached = serverCache.get(symbol)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json(cached.data, { headers: NO_STORE_HEADERS })
  }

  try {
    const history = await fetchDnseSessionHistory(symbol, new Date())
    const payload = {
      ok: true,
      provider: "DNSE",
      boardId: "G1",
      resolution: "1m",
      ...history,
      completeness: {
        price: "full-session-1m",
        orderbook: "current-snapshot-plus-live",
        trades: history.tradesTruncated ? "session-backfill-truncated" : "full-session-backfill",
      },
    }
    serverCache.set(symbol, { data: payload, expiresAt: Date.now() + SERVER_TTL_MS })
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      provider: "DNSE",
      symbol,
      message: error instanceof Error ? error.message : String(error),
    }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
