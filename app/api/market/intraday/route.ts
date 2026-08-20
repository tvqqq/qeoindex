import { NextResponse } from "next/server"
import { getCache } from "@vercel/functions"

import {
  parseSymbols,
  snapshotCacheKey,
  latestSnapshotCacheKey,
  secondsToNextBucket,
  isIntradaySnapshot,
  getRedis,
  fetchSnapshot,
  type IntradaySnapshot,
} from "@/lib/intraday-5m-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
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
  const cache = getCache({ namespace: "market-board-v10" })
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
