import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { fetchLiveBatchQuotes, type LiveBatchQuote } from "@/modules/market/realtime/broker-live-quotes"
import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { MARKET_UNIVERSE_MAX_SIZE } from "@/modules/market/universe/selection"
import { getCanonicalBoardOverviewSnapshots } from "@/modules/shared/supabase/board-overview"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}

export async function POST(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const rawSymbols = (body as Record<string, unknown>).symbols
  if (!Array.isArray(rawSymbols) || rawSymbols.length > MARKET_UNIVERSE_MAX_SIZE) {
    return NextResponse.json({ ok: false, error: "Invalid symbols." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const symbols = rawSymbols.map((symbol) => String(symbol ?? "").trim().toUpperCase())
  if (symbols.some((symbol) => !/^[A-Z0-9]{2,12}$/.test(symbol)) || new Set(symbols).size !== symbols.length) {
    return NextResponse.json({ ok: false, error: "Invalid symbols." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const canonical = await getCanonicalUniverse()
    const canonicalSymbols = new Set(canonical.stocks.map((stock) => stock.ticker))
    if (symbols.some((symbol) => !canonicalSymbols.has(symbol))) {
      return NextResponse.json({ ok: false, error: "Unsupported symbol." }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const [brokerQuotes, snapshots] = await Promise.all([
      fetchLiveBatchQuotes(symbols),
      getCanonicalBoardOverviewSnapshots(symbols),
    ])
    const quotes: Record<string, LiveBatchQuote> = { ...brokerQuotes }

    for (const symbol of symbols) {
      if (quotes[symbol]?.price && quotes[symbol].price! > 0) continue
      const snapshot = snapshots[symbol]
      const price = snapshot?.latest_price || snapshot?.reference_price
      if (!snapshot || !price || price <= 0) continue
      const reference = snapshot.reference_price || price
      quotes[symbol] = {
        symbol,
        price,
        reference,
        ceiling: snapshot.ceiling_price,
        floor: snapshot.floor_price,
        change: price - reference,
        changePercent: reference > 0 ? ((price - reference) / reference) * 100 : 0,
        volume: snapshot.total_volume,
      }
    }

    const missingSymbols = symbols.filter((symbol) => !quotes[symbol]?.price || Number(quotes[symbol].price) <= 0)
    if (missingSymbols.length > 0) {
      return NextResponse.json({
        ok: false,
        error: "Unable to reconcile all requested market quotes.",
        missingSymbols,
      }, { status: 503, headers: NO_STORE_HEADERS })
    }

    return NextResponse.json({ ok: true, quotes, updatedAt: new Date().toISOString() }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("[Market Board Quotes] reconcile failed", error)
    return NextResponse.json({ ok: false, error: "Unable to reconcile market quotes." }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
