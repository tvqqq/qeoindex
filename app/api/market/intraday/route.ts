import { Redis } from "@upstash/redis"
import { getCache } from "@vercel/functions"
import { NextResponse } from "next/server"

import { FIVE_MINUTE_SECONDS, intradaySnapshot, type IntradayPoint } from "@/lib/intraday-5m"
import { fetchYahooFiveMinuteSnapshot } from "@/lib/yahoo-history"
import { UNIVERSE_SIZE } from "@/lib/wyckoff-universe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}
const FETCH_CONCURRENCY = 12

type IntradayRow = {
  symbol: string
  provider: "Yahoo" | null
  points: IntradayPoint[]
  reference: number | null
  price: number | null
  change: number | null
  changePercent: number | null
  lastBarAt: number | null
  fallbackReason: null
  error: string | null
}

type IntradaySnapshot = {
  rows: IntradayRow[]
  generatedAt: string
}

let redis: Redis | null | undefined

function getRedis() {
  if (redis !== undefined) return redis
  redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null
  return redis
}

function isIntradayRow(value: unknown): value is IntradayRow {
  if (!value || typeof value !== "object") return false
  const row = value as Partial<IntradayRow>
  return typeof row.symbol === "string"
    && Array.isArray(row.points)
    && row.points.length > 0
    && row.points.every((point) => typeof point?.time === "number" && point.time > 0 && typeof point?.close === "number" && point.close > 0)
    && typeof row.reference === "number"
    && row.reference > 0
    && typeof row.price === "number"
    && row.price > 0
}

function isIntradaySnapshot(value: unknown, symbols: string[]): value is IntradaySnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<IntradaySnapshot>
  if (!Array.isArray(snapshot.rows) || !snapshot.rows.every(isIntradayRow)) return false
  return symbols.every((symbol) => snapshot.rows?.some((row) => row.symbol === symbol))
}

function parseSymbols(request: Request) {
  const values = new URL(request.url).searchParams.get("symbols") ?? ""
  return [...new Set(values.split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{2,12}$/.test(symbol)))].slice(0, UNIVERSE_SIZE)
}

function vietnamDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

function snapshotCacheKey(symbols: string[], now: Date) {
  const timestamp = Math.floor(now.getTime() / 1000)
  return `top100:v7:${vietnamDateKey(now)}:${Math.floor(timestamp / FIVE_MINUTE_SECONDS)}:${symbols.join("-")}`
}

function secondsToNextBucket(now: Date) {
  const timestamp = Math.floor(now.getTime() / 1000)
  return Math.max(1, FIVE_MINUTE_SECONDS - (timestamp % FIVE_MINUTE_SECONDS))
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

async function fetchSnapshot(symbols: string[], now: Date): Promise<IntradaySnapshot> {
  const rows = await mapWithConcurrency(symbols, FETCH_CONCURRENCY, async (symbol): Promise<IntradayRow> => {
    try {
      const yahoo = await fetchYahooFiveMinuteSnapshot(symbol, now)
      const bars = yahoo.bars
      const snapshot = intradaySnapshot(bars, yahoo.reference)
      return {
        symbol,
        provider: "Yahoo",
        points: bars.map(({ time, close }) => ({ time, close })),
        ...snapshot,
        lastBarAt: bars.at(-1)?.time ?? null,
        fallbackReason: null,
        error: null,
      }
    } catch (error) {
      return {
        symbol,
        provider: null,
        points: [],
        reference: null,
        price: null,
        change: null,
        changePercent: null,
        lastBarAt: null,
        fallbackReason: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  return { rows, generatedAt: new Date().toISOString() }
}

export async function GET(request: Request) {
  const startedAt = performance.now()
  const symbols = parseSymbols(request)
  if (!symbols.length) {
    return NextResponse.json({ ok: false, message: "Missing valid symbols." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const now = new Date()
  const key = snapshotCacheKey(symbols, now)
  const ttl = secondsToNextBucket(now)
  const cache = getCache({ namespace: "market-board-v7" })
  let snapshot: IntradaySnapshot | null = null
  let cacheLayer: "runtime" | "redis" | "provider" = "provider"

  try {
    const cached = await cache.get(key)
    if (isIntradaySnapshot(cached, symbols)) {
      snapshot = cached
      cacheLayer = "runtime"
    }
  } catch { /* Runtime Cache is an optimization; continue to Redis/Yahoo. */ }

  const redisClient = getRedis()
  if (!snapshot && redisClient) {
    try {
      const cached = await redisClient.get<IntradaySnapshot>(key)
      if (isIntradaySnapshot(cached, symbols)) {
        snapshot = cached
        cacheLayer = "redis"
        try {
          await cache.set(key, snapshot, { ttl, tags: ["market-board"], name: "Top 100 5m snapshot" })
        } catch { /* Redis hit remains usable if the regional cache write fails. */ }
      }
    } catch { /* Redis is an optional shared L2; provider fetching remains canonical. */ }
  }

  if (!snapshot) {
    snapshot = await fetchSnapshot(symbols, now)
    const writeTtl = secondsToNextBucket(new Date())
    await Promise.allSettled([
      cache.set(key, snapshot, { ttl: writeTtl, tags: ["market-board"], name: "Top 100 5m snapshot" }),
      redisClient ? redisClient.set(key, snapshot, { ex: writeTtl }) : Promise.resolve(),
    ])
  }

  const histories = Object.fromEntries(snapshot.rows.map((row) => [row.symbol, row]))
  const successCount = snapshot.rows.filter((row) => row.points.length > 0).length
  return NextResponse.json({
    ok: successCount > 0,
    provider: "Yahoo bootstrap + DNSE live",
    resolution: "5m",
    generatedAt: snapshot.generatedAt,
    durationMs: Math.round(performance.now() - startedAt),
    cacheLayer,
    cacheHits: cacheLayer === "provider" ? 0 : successCount,
    successCount,
    requestedCount: symbols.length,
    histories,
  }, { status: successCount > 0 ? 200 : 503, headers: NO_STORE_HEADERS })
}