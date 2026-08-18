import { NextResponse } from "next/server"
import { Redis } from "@upstash/redis"
import { getCache } from "@vercel/functions"

import { clearServerSessionCache } from "@/app/api/market/session/route"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}

function getRedis() {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null
}

export async function POST(request: Request) {
  const startedAt = performance.now()
  const cleared: string[] = []

  // 1. Clear In-memory Session Cache
  clearServerSessionCache()
  cleared.push("in-memory-session-cache")

  // 2. Expire Vercel Runtime Cache tags
  try {
    const marketCache = getCache({ namespace: "market-board-v8" })
    await marketCache.expireTag("market-board")
    cleared.push("vercel-runtime-cache:market-board")
  } catch {
    // runtime cache not available or failed
  }

  // 3. Clear Upstash Redis keys for market
  const redis = getRedis()
  let redisKeysRemoved = 0
  if (redis) {
    try {
      // Find and delete qeoindex market cache keys
      const keys = await redis.keys("qeoindex:*")
      if (keys.length > 0) {
        await redis.del(...keys)
        redisKeysRemoved = keys.length
        cleared.push(`upstash-redis:${redisKeysRemoved}-keys`)
      }
    } catch (error) {
      console.warn("[Cache Invalidate] Redis deletion warning:", error)
    }
  }

  // 4. Inspect Supabase Connection & Stored Snapshots Count
  const supabase = getSupabaseServerClient()
  let supabaseStatus = "not_configured"
  let supabaseRowsCount = 0
  let storedSymbols: string[] = []

  if (supabase) {
    try {
      const { data, error, count } = await supabase
        .from("stock_orderbook_snapshots")
        .select("symbol", { count: "exact" })
      
      if (!error && data) {
        supabaseStatus = "connected"
        supabaseRowsCount = count ?? data.length
        storedSymbols = data.map((row) => row.symbol)
      } else if (error) {
        supabaseStatus = `error: ${error.message}`
      }
    } catch (error) {
      supabaseStatus = `exception: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return NextResponse.json({
    ok: true,
    message: "Cache invalidated successfully.",
    cleared,
    durationMs: Math.round(performance.now() - startedAt),
    supabase: {
      status: supabaseStatus,
      rowsCount: supabaseRowsCount,
      storedSymbols: storedSymbols.slice(0, 20),
    },
    redis: {
      connected: Boolean(redis),
      keysRemoved: redisKeysRemoved,
    },
  }, { headers: NO_STORE_HEADERS })
}

export async function GET(request: Request) {
  return POST(request)
}
