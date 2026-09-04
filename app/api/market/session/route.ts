import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import { fetchDnseSessionHistory } from "@/modules/market/providers/dnse/market-runtime"
import { getOrderbookSnapshotFromSupabase, upsertOrderbookSnapshotToSupabase } from "@/lib/supabase/orderbook"
import { isTradingSessionOpen } from "@/lib/session-countdown"

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
const IN_SESSION_TTL_MS = 2_500
const OFF_SESSION_TTL_MS = 60_000

export function clearServerSessionCache() {
  serverCache.clear()
}

export async function GET(request: Request) {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response

  const symbol = parseSymbol(request)
  if (!symbol) {
    return NextResponse.json({ ok: false, message: "Missing valid symbol." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get("refresh") === "1"
  const now = new Date()
  const inSession = isTradingSessionOpen(now)

  if (!forceRefresh) {
    const cached = serverCache.get(symbol)
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.data, { headers: NO_STORE_HEADERS })
    }
  }

  if (!forceRefresh && !inSession) {
    try {
      const snapshot = await getOrderbookSnapshotFromSupabase(symbol)
      const hasMeaningfulOrderbook = Boolean(
        snapshot && (
          (snapshot.trades && snapshot.trades.length > 0) ||
          (snapshot.latestQuote?.bid && snapshot.latestQuote.bid.length > 0) ||
          (snapshot.foreign && (snapshot.foreign.totalBuyVolume > 0 || snapshot.foreign.totalBuyValue > 0))
        )
      )

      if (snapshot && hasMeaningfulOrderbook) {
        const payload = {
          ok: true,
          provider: "Supabase-Snapshot",
          storage: "Supabase Postgres",
          boardId: "G1",
          resolution: "1m",
          ...snapshot,
          completeness: {
            price: "full-session-1m",
            orderbook: "current-snapshot-plus-live",
            trades: snapshot.tradesTruncated ? "session-backfill-truncated" : "full-session-backfill",
          },
        }
        serverCache.set(symbol, { data: payload, expiresAt: Date.now() + OFF_SESSION_TTL_MS })
        return NextResponse.json(payload, { headers: NO_STORE_HEADERS })
      }
    } catch {
      // ignore and continue to direct fetch
    }
  }

  try {
    const history = await fetchDnseSessionHistory(symbol, now)
    const payload = {
      ok: true,
      provider: "DNSE",
      storage: "Supabase + In-Memory",
      boardId: "G1",
      resolution: "1m",
      ...history,
      completeness: {
        price: "full-session-1m",
        orderbook: "current-snapshot-plus-live",
        trades: history.tradesTruncated ? "session-backfill-truncated" : "full-session-backfill",
      },
    }
    const ttl = inSession ? IN_SESSION_TTL_MS : OFF_SESSION_TTL_MS
    serverCache.set(symbol, { data: payload, expiresAt: Date.now() + ttl })
    void upsertOrderbookSnapshotToSupabase(history)
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const fallback = await getOrderbookSnapshotFromSupabase(symbol)
    if (fallback) {
      const payload = {
        ok: true,
        provider: "Supabase-Snapshot",
        storage: "Supabase",
        boardId: "G1",
        resolution: "1m",
        ...fallback,
        completeness: {
          price: "full-session-1m",
          orderbook: "current-snapshot-plus-live",
          trades: fallback.tradesTruncated ? "session-backfill-truncated" : "full-session-backfill",
        },
      }
      return NextResponse.json(payload, { headers: NO_STORE_HEADERS })
    }

    return NextResponse.json({
      ok: false,
      provider: "DNSE",
      symbol,
      message: error instanceof Error ? error.message : String(error),
    }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
