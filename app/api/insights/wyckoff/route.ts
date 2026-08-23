import { NextResponse } from "next/server"

import { requireApiUser } from "@/lib/auth/server"
import { getUnifiedWyckoffTickerData } from "@/lib/wyckoff-unified-data"

const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json(
      { ok: false, error: "Invalid ticker." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  const data = await getUnifiedWyckoffTickerData(auth.context.supabase, ticker)
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Wyckoff data is unavailable for this ticker." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    )
  }

  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } },
  )
}
