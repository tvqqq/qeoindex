import { NextResponse } from "next/server"

import { fetchDnseSessionHistory } from "@/lib/dnse-market-runtime"
import { getOrderbookSnapshotFromSupabase, upsertOrderbookSnapshotToSupabase } from "@/lib/supabase/orderbook"

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

export function clearServerSessionCache() {
  serverCache.clear()
}

export async function GET(request: Request) {
  const symbol = parseSymbol(request)
  if (!symbol) {
    return NextResponse.json({ ok: false, message: "Missing valid symbol." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get("refresh") === "1"

  // 1. In-memory hot cache
  if (!forceRefresh) {
    const cached = serverCache.get(symbol)
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.data, { headers: NO_STORE_HEADERS })
    }
  }

  // 2. Fast-path: Check Supabase Snapshot first for instant sub-20ms response
  if (!forceRefresh) {
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
        serverCache.set(symbol, { data: payload, expiresAt: Date.now() + SERVER_TTL_MS })

        // Asynchronously refresh in background from DNSE to keep snapshot fresh
        void fetchDnseSessionHistory(symbol, new Date())
          .then((freshHistory) => {
            if (freshHistory && (freshHistory.prices.length > 0 || freshHistory.trades.length > 0 || freshHistory.latestQuote?.matchPrice)) {
              void upsertOrderbookSnapshotToSupabase(freshHistory)
            }
          })
          .catch(() => { /* silent background error */ })

        return NextResponse.json(payload, { headers: NO_STORE_HEADERS })
      }
    } catch {
      // ignore and continue to direct DNSE fetch
    }
  }

  // 3. Fetch canonical DNSE session history & persist snapshot to Supabase
  try {
    const history = await fetchDnseSessionHistory(symbol, new Date())
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
    serverCache.set(symbol, { data: payload, expiresAt: Date.now() + SERVER_TTL_MS })
    void upsertOrderbookSnapshotToSupabase(history)
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS })
  } catch (error) {
    // 4. Final fallback to Supabase snapshot if DNSE API is unavailable / rate-limited
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
