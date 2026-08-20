import { Redis } from "@upstash/redis"
import { getCache } from "@vercel/functions"
import { NextResponse } from "next/server"

import { FIVE_MINUTE_SECONDS, intradaySnapshot, type IntradayPoint } from "@/lib/intraday-5m"
import { fetchYahooFiveMinuteSnapshot } from "@/lib/yahoo-history"
import { UNIVERSE_SIZE } from "@/lib/wyckoff-universe"
import { isLunchBreak, getMarketSessionStatus } from "@/lib/session-countdown"

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

export type IntradaySnapshot = {
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

function latestSnapshotCacheKey(symbols: string[] | readonly string[], now: Date) {
  return `top100:v8:${vietnamDateKey(now)}:latest:${symbols.join("-")}`
}

export async function getCachedIntraday5mSnapshot(symbols: string[] | readonly string[], now: Date = new Date()): Promise<IntradaySnapshot | null> {
  const bucketKey = snapshotCacheKey(symbols, now)
  const latestKey = latestSnapshotCacheKey(symbols, now)
  const cache = getCache({ namespace: "market-board-v8" })

  // 1. Exact bucket from Runtime Cache
  try {
    const cached = await cache.get(bucketKey)
    if (isIntradaySnapshot(cached, symbols)) return cached
  } catch { /* Runtime Cache fail open */ }

  const redisClient = getRedis()
  if (redisClient) {
    // 2. Exact bucket from Redis
    try {
      const cached = await redisClient.get<IntradaySnapshot>(bucketKey)
      if (isIntradaySnapshot(cached, symbols)) return cached
    } catch { /* Redis fail open */ }

    // 3. Fallback to latest available snapshot of today from Redis
    try {
      const cachedLatest = await redisClient.get<IntradaySnapshot>(latestKey)
      if (isIntradaySnapshot(cachedLatest, symbols)) return cachedLatest
    } catch { /* Redis fail open */ }
  }

  // 4. Fallback to latest snapshot from Runtime Cache
  try {
    const cachedLatest = await cache.get(latestKey)
    if (isIntradaySnapshot(cachedLatest, symbols)) return cachedLatest
  } catch { /* Runtime Cache fail open */ }

  return null
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

function isIntradaySnapshot(value: unknown, symbols: string[] | readonly string[]): value is IntradaySnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<IntradaySnapshot>
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length === 0) return false
  const validCount = snapshot.rows.filter(isIntradayRow).length
  return validCount >= Math.min(symbols.length * 0.5, 40)
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

function snapshotCacheKey(symbols: string[] | readonly string[], now: Date) {
  const status = getMarketSessionStatus(now)
  return `top100:v8:${vietnamDateKey(now)}:${status.cacheBucketKey}:${symbols.join("-")}`
}

function secondsToNextBucket(now: Date) {
  const status = getMarketSessionStatus(now)
  return status.ttlSeconds
}

async function mapWithConcurrency<T, R>(items: T[] | readonly T[], concurrency: number, worker: (item: T) => Promise<R>) {
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

import { fetchLiveBatchQuotes } from "@/lib/broker-live-quotes"

async function fetchDnseFiveMinutePoints(symbol: string, now: Date): Promise<IntradayPoint[] | null> {
  const to = Math.floor(now.getTime() / 1000)
  const from = Math.floor(new Date(now).setHours(9, 0, 0, 0) / 1000)
  try {
    const res = await fetch(`https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?resolution=5&symbol=${symbol.toUpperCase()}&from=${from}&to=${to}`, {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data?.t) || !Array.isArray(data?.c) || !data.t.length) return null

    const points: IntradayPoint[] = []
    for (let i = 0; i < data.t.length; i++) {
      const time = Number(data.t[i])
      const close = Number(data.c[i])
      if (Number.isFinite(time) && time > 0 && Number.isFinite(close) && close > 0) {
        points.push({ time, close })
      }
    }
    return points.length > 0 ? points : null
  } catch {
    return null
  }
}

async function fetchSnapshot(symbols: string[] | readonly string[], now: Date): Promise<IntradaySnapshot> {
  const [liveBatchResult, rows] = await Promise.all([
    fetchLiveBatchQuotes(symbols),
    mapWithConcurrency(symbols, FETCH_CONCURRENCY, async (symbol): Promise<IntradayRow> => {
      // 1. Try high-fidelity DNSE 5m Chart API first (full continuous session bars)
      const dnsePoints = await fetchDnseFiveMinutePoints(symbol, now)
      if (dnsePoints && dnsePoints.length > 0) {
        const live = liveBatchResult[symbol]
        const reference = live?.reference ?? dnsePoints[0]?.close ?? null
        const price = dnsePoints.at(-1)?.close ?? live?.price ?? null
        const change = price !== null && reference !== null ? price - reference : null
        const changePercent = price !== null && reference !== null && reference > 0 ? ((price - reference) / reference) * 100 : null
        return {
          symbol,
          provider: "Yahoo", // Keep polymorphic contract provider type
          points: dnsePoints,
          reference,
          price,
          change,
          changePercent,
          lastBarAt: dnsePoints.at(-1)?.time ?? null,
          fallbackReason: null,
          error: null,
        }
      }

      // 2. Fallback to Yahoo if DNSE is unavailable
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
        const live = liveBatchResult[symbol]
        return {
          symbol,
          provider: null,
          points: [],
          reference: live?.reference ?? null,
          price: live?.price ?? null,
          change: live?.change ?? null,
          changePercent: live?.changePercent ?? null,
          lastBarAt: null,
          fallbackReason: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  ])

  // Merge fast live broker prices onto intraday rows
  const enhancedRows = rows.map((row) => {
    const live = liveBatchResult[row.symbol]
    if (!live || !live.price) return row
    const reference = live.reference ?? row.reference ?? live.price
    const price = live.price
    const change = live.change ?? (reference > 0 ? price - reference : 0)
    const changePercent = live.changePercent ?? (reference > 0 ? ((price - reference) / reference) * 100 : 0)
    
    // Add current live price to points if points exist (skip during lunch break)
    let points = row.points
    if (points.length > 0 && price > 0 && !isLunchBreak(now)) {
      const nowSec = Math.floor(now.getTime() / 1000)
      const lastPoint = points[points.length - 1]
      if (lastPoint && Math.abs(nowSec - lastPoint.time) < 300) {
        points = [...points.slice(0, -1), { time: lastPoint.time, close: price }]
      } else {
        points = [...points, { time: nowSec, close: price }]
      }
    }

    return {
      ...row,
      reference,
      price,
      change,
      changePercent,
      points,
    }
  })

  return { rows: enhancedRows, generatedAt: new Date().toISOString() }
}

export async function GET(request: Request) {
  const startedAt = performance.now()
  const symbols = parseSymbols(request)
  if (!symbols.length) {
    return NextResponse.json({ ok: false, message: "Missing valid symbols." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const now = new Date()
  const key = snapshotCacheKey(symbols, now)
  const latestKey = latestSnapshotCacheKey(symbols, now)
  const ttl = secondsToNextBucket(now)
  const cache = getCache({ namespace: "market-board-v8" })
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
    const latestTtl = 86400 // Keep daily latest in Redis for 24h
    await Promise.allSettled([
      cache.set(key, snapshot, { ttl: writeTtl, tags: ["market-board"], name: "Top 100 5m snapshot" }),
      cache.set(latestKey, snapshot, { ttl: latestTtl, tags: ["market-board"], name: "Top 100 5m latest" }),
      redisClient ? redisClient.set(key, snapshot, { ex: writeTtl }) : Promise.resolve(),
      redisClient ? redisClient.set(latestKey, snapshot, { ex: latestTtl }) : Promise.resolve(),
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