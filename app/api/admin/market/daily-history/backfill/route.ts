import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { backfillDailyColdHistory } from "@/modules/market/history/daily-cold-history"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const MAX_TICKERS = 10
const MAX_CHUNKS_PER_TICKER = 3

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return ""
  return authorization.slice("Bearer ".length).trim()
}

async function isAuthorized(request: Request) {
  if (isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) {
    return true
  }
  const token = bearerToken(request)
  if (!token) return false
  const supabase = getSupabaseServerClient()
  if (!supabase) return false
  const { data, error } = await supabase.rpc("qeo_verify_eod_scheduler_secret", { p_secret: token })
  return !error && data === true
}

function requestedTickers(value: unknown) {
  if (!Array.isArray(value)) throw new Error("tickers must be an array")
  const tickers = [...new Set(value.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))]
  if (!tickers.length || tickers.length > MAX_TICKERS) throw new Error(`tickers must contain 1-${MAX_TICKERS} unique symbols`)
  return tickers
}

function requestedChunks(value: unknown) {
  if (value == null) return 1
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CHUNKS_PER_TICKER) {
    throw new Error(`maxChunksPerTicker must be an integer from 1-${MAX_CHUNKS_PER_TICKER}`)
  }
  return parsed
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured" }, { status: 503 })
  }

  try {
    const body = await request.json().catch(() => ({})) as { tickers?: unknown; maxChunksPerTicker?: unknown }
    const tickers = requestedTickers(body.tickers)
    const maxChunksPerTicker = requestedChunks(body.maxChunksPerTicker)
    const result = await backfillDailyColdHistory(supabase, { tickers, maxChunksPerTicker })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("QEO-106 Daily cold-history backfill failed", error)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
