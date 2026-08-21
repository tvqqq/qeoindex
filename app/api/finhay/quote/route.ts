import { NextResponse } from "next/server"
import { requireApiFeature } from "@/lib/auth/server"
import { getFinhayIndexQuote, getFinhayStockQuote } from "@/lib/finhay-live"
import { getActiveFinhayAccessToken } from "@/lib/finhay-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseList(value: string | null, max: number) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z0-9]{2,12}$/.test(item))
    .slice(0, max)
}

export async function GET(request: Request) {
  const auth = await requireApiFeature("finhay_live")
  if (!auth.ok) return auth.response

  const accessToken = await getActiveFinhayAccessToken()
  if (!accessToken) {
    return NextResponse.json({ ok: false, state: "AUTH_REQUIRED", connectUrl: "/api/finhay/auth/start" }, { status: 401 })
  }

  const url = new URL(request.url)
  const symbols = parseList(url.searchParams.get("symbols"), 50)
  const indexes = parseList(url.searchParams.get("indexes"), 5)
  if (!symbols.length && !indexes.length) {
    return NextResponse.json({ ok: false, message: "Provide symbols and/or indexes." }, { status: 400 })
  }

  const quotes: Record<string, unknown> = {}
  const errors: Array<{ symbol: string; error: string }> = []

  const stockResults = await Promise.allSettled(symbols.map((symbol) => getFinhayStockQuote(accessToken, symbol)))
  stockResults.forEach((result, index) => {
    const symbol = symbols[index]
    if (result.status === "fulfilled") quotes[symbol] = result.value
    else errors.push({ symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
  })

  const indexResults = await Promise.allSettled(indexes.map((symbol) => getFinhayIndexQuote(accessToken, symbol)))
  indexResults.forEach((result, index) => {
    const symbol = indexes[index]
    if (result.status === "fulfilled") quotes[symbol] = result.value
    else errors.push({ symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
  })

  return NextResponse.json({
    ok: errors.length === 0,
    state: "LIVE",
    provider: "Finhay MCP",
    quotes,
    errors,
    generatedAt: new Date().toISOString(),
  }, { status: errors.length && !Object.keys(quotes).length ? 502 : 200 })
}
