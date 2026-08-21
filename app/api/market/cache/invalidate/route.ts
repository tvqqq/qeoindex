import { NextResponse } from "next/server"
import { Redis } from "@upstash/redis"
import { getCache } from "@vercel/functions"

import { clearServerSessionCache } from "@/app/api/market/session/route"
import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
}

function getRedis() {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null
}

export async function POST(request: Request) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.MARKET_CACHE_ADMIN_SECRET, process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const startedAt = performance.now()
  const cleared: string[] = []

  clearServerSessionCache()
  cleared.push("in-memory-session-cache")

  try {
    const marketCache = getCache({ namespace: "market-board-v8" })
    await marketCache.expireTag("market-board")
    cleared.push("vercel-runtime-cache:market-board")
  } catch {
    // Runtime cache is optional in local/test environments.
  }

  const redis = getRedis()
  let redisKeysRemoved = 0
  if (redis) {
    try {
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

  const supabase = getSupabaseServerClient()
  let supabaseStatus = "not_configured"
  let supabaseRowsCount = 0

  if (supabase) {
    try {
      const { data, error, count } = await supabase
        .from("stock_orderbook_snapshots")
        .select("symbol", { count: "exact" })

      if (!error && data) {
        supabaseStatus = "connected"
        supabaseRowsCount = count ?? data.length
      } else if (error) {
        supabaseStatus = "error"
        console.warn("[Cache Invalidate] Supabase inspection warning:", error.message)
      }
    } catch (error) {
      supabaseStatus = "error"
      console.warn("[Cache Invalidate] Supabase inspection exception:", error)
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
    },
    redis: {
      connected: Boolean(redis),
      keysRemoved: redisKeysRemoved,
    },
  }, { headers: NO_STORE_HEADERS })
}
