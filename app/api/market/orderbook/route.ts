import { NextResponse } from "next/server"
import { fetchMarketOrderBook } from "@/lib/dnse-live-market"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,8}$/.test(symbol)) {
    return NextResponse.json({ ok: false, message: "Invalid symbol." }, { status: 400 })
  }

  try {
    const snapshot = await fetchMarketOrderBook(symbol)
    return NextResponse.json({ ok: true, snapshot }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      symbol,
    }, { status: 502 })
  }
}
