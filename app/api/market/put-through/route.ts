import { NextResponse } from "next/server"

import { requireApiFeature } from "@/lib/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: Request) {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase()
  if (!symbol || !/^[A-Z0-9]{2,12}$/.test(symbol)) {
    return NextResponse.json({ ok: false, message: "Invalid symbol" }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const res = await fetch("https://bgapidatafeed.vps.com.vn/getlistpt", {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(3500),
    })
    if (!res.ok) {
      return NextResponse.json({ ok: true, symbol, putThrough: [] }, { headers: NO_STORE_HEADERS })
    }
    const list = await res.json()
    if (!Array.isArray(list)) {
      return NextResponse.json({ ok: true, symbol, putThrough: [] }, { headers: NO_STORE_HEADERS })
    }

    const deals = list
      .filter((item: any) => String(item?.sym || "").toUpperCase().trim() === symbol)
      .map((item: any, idx: number) => {
        const rawPrice = finiteNumber(item?.price)
        const price = rawPrice && rawPrice > 1000 ? rawPrice / 1000 : (rawPrice ?? 0)
        const volume = finiteNumber(item?.volume) ?? 0
        const rawValue = finiteNumber(item?.value) ?? 0
        const value = rawValue > 0 ? rawValue * 1000 : price * 1000 * volume
        return {
          id: String(item?.transId || item?.id || `pt-${idx}`),
          time: String(item?.time || "—"),
          price,
          volume,
          value,
          sym: symbol,
          type: String(item?.type || "PTM"),
        }
      })
      .sort((a, b) => (b.time > a.time ? 1 : -1))

    return NextResponse.json({ ok: true, symbol, putThrough: deals }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({ ok: false, message: String(error) }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
