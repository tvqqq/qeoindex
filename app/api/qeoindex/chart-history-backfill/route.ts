import { NextRequest, NextResponse } from "next/server"

import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { backfillChartIntradayHistoricalChunk } from "@/modules/market/chart-data/historical-backfill"
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

function epoch(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function POST(request: NextRequest) {
  if (!(await isSchedulerAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const ticker = request.nextUrl.searchParams.get("ticker")?.trim().toUpperCase() ?? ""
  const from = epoch(request.nextUrl.searchParams.get("from"))
  const to = epoch(request.nextUrl.searchParams.get("to"))
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) {
    return NextResponse.json({ ok: false, error: "ticker must be a valid canonical symbol." }, { status: 400 })
  }
  if (from == null || to == null || to <= from) {
    return NextResponse.json({ ok: false, error: "from/to must be a valid ascending epoch-second range." }, { status: 400 })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) return NextResponse.json({ ok: false, error: "Canonical market data service unavailable." }, { status: 503 })

  try {
    const result = await backfillChartIntradayHistoricalChunk(supabase, { ticker, from, to, referenceAt: new Date() })
    const ok = result.status === "succeeded" || result.status === "skipped"
    return NextResponse.json({ ok, mode: "chart-history-backfill", ticker, result }, {
      status: ok ? 200 : 207,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await notifyOpsError({
      source: "qeo172-chart-history-backfill",
      message,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, mode: "chart-history-backfill", ticker, error: message }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    })
  }
}
