import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { fetchYahooDailyOhlcv } from "@/modules/market/providers/yahoo/history"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Ticker không hợp lệ." }, { status: 400, headers: NO_STORE })
  }

  try {
    const bars = await fetchYahooDailyOhlcv(ticker, new Date(), 90)
    const formatted = bars.slice(-60).map((b) => {
      const d = new Date(b.time * 1000)
      const dateStr = d.toISOString().split("T")[0]
      return {
        date: dateStr,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }
    })

    return NextResponse.json({ ok: true, ticker, bars: formatted }, { headers: NO_STORE })
  } catch (error) {
    console.error(`[Ticker Bars] Failed to fetch bars for ${ticker}`, error)
    return NextResponse.json({ ok: false, error: "Không tải được dữ liệu giá." }, { status: 500, headers: NO_STORE })
  }
}
