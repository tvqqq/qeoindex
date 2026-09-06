import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const RETIRED_CODE = "DAILY_DEEP_COLD_RETIRED"

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

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({
    ok: false,
    code: RETIRED_CODE,
    error: "Daily deep-cold backfill is retired. market_ohlcv_history is bounded to the canonical ~8-year bootstrap and then maintained incrementally by EOD refresh.",
  }, { status: 410 })
}
