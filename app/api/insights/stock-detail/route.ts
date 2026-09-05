import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { fetchStockDetailData } from "@/modules/research/insights/stock-detail-data"

const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json(
      { ok: false, error: "Invalid ticker symbol." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  try {
    const data = await fetchStockDetailData(ticker, auth.context.supabase)
    return NextResponse.json(
      { ok: true, data },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } },
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load stock detail." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
