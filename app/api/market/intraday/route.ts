import { NextResponse } from "next/server"
import { getCache } from "@vercel/functions"

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
const SNAPSHOT_CACHE_TTL_SECONDS = 15
const FETCH_CONCURRENCY = 12

type IntradayRow = {
  symbol: string
  provider: "Yahoo" | null
  prices: number[]
  reference: number | null
  price: number | null
  change: number | null
  changePercent: number | null
  lastBarAt: number | null
  fallbackReason: null
  error: string | null
  cacheHit: boolean
}

function isIntradayRow(value: unknown): value is Omit<IntradayRow, "cacheHit"> {
  if (!value || typeof value !== "object") return false
  const row = value as Partial<IntradayRow>
  return typeof row.symbol === "string" && Array.isArray(row.prices) && row.prices.length > 0 && typeof row.price === "number"
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
  const startedAt = performance.now()
  const symbols = parseSymbols(request)
  if (!symbols.length) {
    return NextResponse.json({ ok: false, message: "Missing valid symbols." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const cache = getCache({ namespace: "market-board-v3" })
  const rows = await mapWithConcurrency(symbols, FETCH_CONCURRENCY, async (symbol): Promise<IntradayRow> => {
    try {
      const now = new Date()
      try {
        const cached = await cache.get(symbol)
        if (isIntradayRow(cached)) return { ...cached, cacheHit: true }
      } catch { /* Runtime Cache is an optimization; provider fetch remains canonical. */ }

      const points = await fetchYahooFiveMinuteOhlcv(symbol, now)
      const snapshot = intradaySnapshot(points)
      const row = {
        symbol,
        provider: "Yahoo" as const,
        prices: points.map((point) => point.close),
        ...snapshot,
        lastBarAt: points.at(-1)?.time ?? null,
        fallbackReason: null,
        error: null,
      }
      try {
        await cache.set(symbol, row, { ttl: SNAPSHOT_CACHE_TTL_SECONDS, tags: ["market-board", `market-board:${symbol}`], name: `5m ${symbol}` })
      } catch { /* Do not fail the board when Runtime Cache is unavailable. */ }
      return { ...row, cacheHit: false }
    } catch (error) {
      return { symbol, provider: null, prices: [], reference: null, price: null, change: null, changePercent: null, lastBarAt: null, fallbackReason: null, error: error instanceof Error ? error.message : String(error), cacheHit: false }
    }
  })

  const histories = Object.fromEntries(rows.map((row) => [row.symbol, row]))
  const successCount = rows.filter((row) => row.prices.length > 0).length
  return NextResponse.json({
    ok: successCount > 0,
    provider: "Yahoo bootstrap + DNSE live",
    resolution: "5m",
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    cacheHits: rows.filter((row) => row.cacheHit).length,
    successCount,
    requestedCount: symbols.length,
    histories,
  }, { status: successCount > 0 ? 200 : 503, headers: NO_STORE_HEADERS })
}
