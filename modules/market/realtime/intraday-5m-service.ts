import { Redis } from "@upstash/redis"
import { getCache } from "@vercel/functions"

import { intradaySnapshot, type IntradayPoint } from "@/modules/market/realtime/intraday-5m"
import { fetchYahooFiveMinuteSnapshot } from "@/modules/market/providers/yahoo/history"
import { MARKET_UNIVERSE_MAX_SIZE } from "@/modules/market/universe/selection"
import { getMarketSessionStatus, getVnTimeSeconds } from "@/modules/market/realtime/session-countdown"
import { sessionTimestampSeconds, shouldAcceptRealtimeMiniChart } from "@/modules/market/realtime/session-ui"
import { fetchLiveBatchQuotes } from "@/modules/market/realtime/broker-live-quotes"

export const FETCH_CONCURRENCY = 12
const INTRADAY_CACHE_VERSION = "market-universe:v11"

export type IntradayRow = {
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

export function getRedis() {
  if (redis !== undefined) return redis
  redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null
  return redis
}

export function vietnamDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export function latestSnapshotCacheKey(symbols: string[] | readonly string[], now: Date) {
  return `${INTRADAY_CACHE_VERSION}:${vietnamDateKey(now)}:latest:${symbols.join("-")}`
}

export function snapshotCacheKey(symbols: string[] | readonly string[], now: Date) {
  const status = getMarketSessionStatus(now)
  return `${INTRADAY_CACHE_VERSION}:${vietnamDateKey(now)}:${status.cacheBucketKey}:${symbols.join("-")}`
}

export function secondsToNextBucket(now: Date) {
  const status = getMarketSessionStatus(now)
  return status.ttlSeconds
}

export function isIntradayRow(value: unknown): value is IntradayRow {
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

export function isIntradaySnapshot(value: unknown, symbols: string[] | readonly string[]): value is IntradaySnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<IntradaySnapshot>
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length === 0) return false
  const validCount = snapshot.rows.filter(isIntradayRow).length
  return validCount >= Math.min(symbols.length * 0.5, 40)
}

export function isUsableCachedIntradaySnapshot(value: unknown, symbols: string[] | readonly string[], now: Date): value is IntradaySnapshot {
  if (!isIntradaySnapshot(value, symbols)) return false
  const { dayOfWeek, totalSeconds } = getVnTimeSeconds(now)
  if (dayOfWeek < 1 || dayOfWeek > 5 || totalSeconds < 14 * 3600 + 46 * 60) return true
  const finalBarAt = sessionTimestampSeconds(now, 14 * 3600 + 45 * 60)
  const finalRows = value.rows.filter((row) => isIntradayRow(row) && (row.lastBarAt ?? row.points.at(-1)?.time ?? 0) >= finalBarAt)
  return finalRows.length >= Math.min(symbols.length * 0.5, 40)
}

export async function mapWithConcurrency<T, R>(items: T[] | readonly T[], concurrency: number, worker: (item: T) => Promise<R>) {
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

export async function fetchDnseFiveMinutePoints(symbol: string, now: Date): Promise<IntradayPoint[] | null> {
  const vnDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
  const [y, m, d] = vnDateStr.split("-").map(Number)
  const from = Math.floor(Date.UTC(y, m - 1, d, 2, 0, 0) / 1000)
  const to = Math.max(from + 300, Math.floor(now.getTime() / 1000))

  try {
    const res = await fetch(`https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?resolution=5&symbol=${symbol.toUpperCase()}&from=${from}&to=${to}`, {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(3500),
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

export async function fetchSnapshot(symbols: string[] | readonly string[], now: Date): Promise<IntradaySnapshot> {
  const liveBatchResult = await fetchLiveBatchQuotes(symbols).catch(() => ({} as Record<string, any>))
  const rows = await mapWithConcurrency(symbols, FETCH_CONCURRENCY, async (symbol): Promise<IntradayRow> => {
    const dnsePoints = await fetchDnseFiveMinutePoints(symbol, now)
    if (dnsePoints && dnsePoints.length > 0) {
      const live = liveBatchResult[symbol]
      const reference = live?.reference ?? dnsePoints[0]?.close ?? null
      const price = dnsePoints.at(-1)?.close ?? live?.price ?? null
      const change = price !== null && reference !== null ? price - reference : null
      const changePercent = price !== null && reference !== null && reference > 0 ? ((price - reference) / reference) * 100 : null
      return {
        symbol,
        provider: "Yahoo",
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
  })

  const enhancedRows = rows.map((row) => {
    const live = liveBatchResult[row.symbol]
    if (!live || !live.price) return row
    const reference = live.reference ?? row.reference ?? live.price
    const price = live.price
    const change = live.change ?? (reference > 0 ? price - reference : 0)
    const changePercent = live.changePercent ?? (reference > 0 ? ((price - reference) / reference) * 100 : 0)

    let points = row.points
    if (points.length > 0 && price > 0 && shouldAcceptRealtimeMiniChart(Math.floor(now.getTime() / 1000))) {
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

export async function getCachedIntraday5mSnapshot(symbols: string[] | readonly string[], now: Date = new Date()): Promise<IntradaySnapshot | null> {
  const bucketKey = snapshotCacheKey(symbols, now)
  const latestKey = latestSnapshotCacheKey(symbols, now)
  const cache = getCache({ namespace: "market-board-v11" })

  try {
    const cached = await cache.get(bucketKey)
    if (isUsableCachedIntradaySnapshot(cached, symbols, now)) return cached
  } catch { /* Runtime Cache fail open */ }

  const redisClient = getRedis()
  if (redisClient) {
    try {
      const cached = await redisClient.get<IntradaySnapshot>(bucketKey)
      if (isUsableCachedIntradaySnapshot(cached, symbols, now)) return cached
    } catch { /* Redis fail open */ }

    try {
      const cachedLatest = await redisClient.get<IntradaySnapshot>(latestKey)
      if (isUsableCachedIntradaySnapshot(cachedLatest, symbols, now)) return cachedLatest
    } catch { /* Redis fail open */ }
  }

  try {
    const cachedLatest = await cache.get(latestKey)
    if (isUsableCachedIntradaySnapshot(cachedLatest, symbols, now)) return cachedLatest
  } catch { /* Runtime Cache fail open */ }

  return null
}

export async function getIntraday5mSnapshot(symbols: string[] | readonly string[], now: Date = new Date()): Promise<IntradaySnapshot> {
  const cached = await getCachedIntraday5mSnapshot(symbols, now)
  if (cached) return cached

  const snapshot = await fetchSnapshot(symbols, now)
  const key = snapshotCacheKey(symbols, now)
  const latestKey = latestSnapshotCacheKey(symbols, now)
  const cache = getCache({ namespace: "market-board-v11" })
  const redisClient = getRedis()
  const writeTtl = secondsToNextBucket(now)
  const latestTtl = 86400

  void Promise.allSettled([
    cache.set(key, snapshot, { ttl: writeTtl, tags: ["market-board"], name: "Top Stocks 5m snapshot" }),
    cache.set(latestKey, snapshot, { ttl: latestTtl, tags: ["market-board"], name: "Top Stocks 5m latest" }),
    redisClient ? redisClient.set(key, snapshot, { ex: writeTtl }) : Promise.resolve(),
    redisClient ? redisClient.set(latestKey, snapshot, { ex: latestTtl }) : Promise.resolve(),
  ])

  return snapshot
}

export function parseSymbols(request: Request) {
  const values = new URL(request.url).searchParams.get("symbols") ?? ""
  return [...new Set(values.split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{2,12}$/.test(symbol)))].slice(0, MARKET_UNIVERSE_MAX_SIZE)
}
