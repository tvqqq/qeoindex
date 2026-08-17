import { NextResponse } from "next/server"

import { fetchDnseOhlcHistory } from "@/lib/dnse-market-runtime"
import { intradaySnapshot } from "@/lib/intraday-5m"
import { fetchYahooFiveMinuteOhlcv } from "@/lib/yahoo-history"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}

function parseSymbols(request: Request) {
  const values = new URL(request.url).searchParams.get("symbols") ?? ""
  return [...new Set(values.split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{2,12}$/.test(symbol)))].slice(0, 50)
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R | undefined>(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results as R[]
}

export async function GET(request: Request) {
  const symbols = parseSymbols(request)
  if (!symbols.length) {
    return NextResponse.json({ ok: false, message: "Missing valid symbols." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const rows = await mapWithConcurrency(symbols, 6, async (symbol) => {
    try {
      const now = new Date()
      let provider: "DNSE" | "Yahoo" = "DNSE"
      let dnseError: string | null = null
      let points: Array<{ time: number; open: number; close: number }>
      try {
        points = await fetchDnseOhlcHistory(symbol, 5, now, 90)
      } catch (error) {
        dnseError = error instanceof Error ? error.message : String(error)
        provider = "Yahoo"
        points = await fetchYahooFiveMinuteOhlcv(symbol, now)
      }
      const snapshot = intradaySnapshot(points)
      return {
        symbol,
        provider,
        prices: points.map((point) => point.close),
        ...snapshot,
        lastBarAt: points.at(-1)?.time ?? null,
        fallbackReason: dnseError,
        error: null,
      }
    } catch (error) {
      return { symbol, provider: null, prices: [] as number[], reference: null, price: null, change: null, changePercent: null, lastBarAt: null, fallbackReason: null, error: error instanceof Error ? error.message : String(error) }
    }
  })

  const histories = Object.fromEntries(rows.map((row) => [row.symbol, row]))
  const successCount = rows.filter((row) => row.prices.length > 0).length
  return NextResponse.json({
    ok: successCount > 0,
    provider: "DNSE with Yahoo fallback",
    resolution: "5m",
    generatedAt: new Date().toISOString(),
    successCount,
    requestedCount: symbols.length,
    histories,
  }, { status: successCount > 0 ? 200 : 503, headers: NO_STORE_HEADERS })
}
