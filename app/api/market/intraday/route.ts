import { NextResponse } from "next/server"

import { fetchDnseMinuteHistory } from "@/lib/dnse-market-runtime"

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
      const points = await fetchDnseMinuteHistory(symbol, new Date(), 90)
      return { symbol, prices: points.map((point) => point.close), lastBarAt: points.at(-1)?.time ?? null, error: null }
    } catch (error) {
      return { symbol, prices: [] as number[], lastBarAt: null, error: error instanceof Error ? error.message : String(error) }
    }
  })

  const histories = Object.fromEntries(rows.map((row) => [row.symbol, row]))
  const successCount = rows.filter((row) => row.prices.length > 0).length
  return NextResponse.json({
    ok: successCount > 0,
    provider: "DNSE",
    resolution: "1m",
    generatedAt: new Date().toISOString(),
    successCount,
    requestedCount: symbols.length,
    histories,
  }, { status: successCount > 0 ? 200 : 503, headers: NO_STORE_HEADERS })
}
