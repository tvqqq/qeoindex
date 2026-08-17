import { NextResponse } from "next/server"

import { fetchTradingViewIndexes } from "@/lib/tradingview-index"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

export async function GET() {
  try {
    const quotes = await fetchTradingViewIndexes()
    return NextResponse.json({ ok: true, provider: "TradingView snapshot + DNSE live", quotes, errors: [], generatedAt: new Date().toISOString() }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({ ok: false, provider: "TradingView snapshot + DNSE live", quotes: {}, errors: [{ error: error instanceof Error ? error.message : String(error) }], generatedAt: new Date().toISOString() }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
