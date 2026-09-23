import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { runDailyProvenanceCanary } from "@/modules/market/history/daily-provenance-canary"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return ""
  return authorization.slice("Bearer ".length).trim()
}

async function isSchedulerAuthorized(request: Request) {
  if (isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) return true

  const token = bearerToken(request)
  if (!token) return false
  const supabase = getSupabaseServerClient()
  if (!supabase) return false

  const { data, error } = await supabase.rpc("qeo_verify_eod_scheduler_secret", { p_secret: token })
  return !error && data === true
}

export async function POST(request: NextRequest) {
  if (!(await isSchedulerAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const ticker = request.nextUrl.searchParams.get("ticker")?.trim().toUpperCase() ?? ""
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) {
    return NextResponse.json({ ok: false, error: "ticker must be a valid canonical symbol." }, { status: 400 })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Canonical market data service unavailable." }, { status: 503 })
  }

  try {
    const result = await runDailyProvenanceCanary(supabase, ticker)
    return NextResponse.json({
      ok: result.passed,
      mode: "daily-provenance-canary",
      result,
    }, {
      status: result.passed ? 200 : 409,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    console.error("[qeo234-daily-provenance-canary]", error instanceof Error ? error.message : String(error))
    return NextResponse.json({
      ok: false,
      mode: "daily-provenance-canary",
      error: "Daily provenance canary unavailable.",
    }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    })
  }
}
