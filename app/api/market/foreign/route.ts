import { NextResponse } from "next/server"

import { fetchDnseForeignTrading } from "@/lib/dnse-market-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}

export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
    return NextResponse.json({ ok: false, message: "Missing or invalid symbol." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const snapshot = await fetchDnseForeignTrading(symbol)
    return NextResponse.json({ ok: true, provider: "DNSE", snapshot }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("DNSE foreign trading unavailable", { symbol, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ ok: false, message: "DNSE foreign trading is unavailable." }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
