import { NextRequest, NextResponse } from "next/server"

import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { runChartIntradayArchiveLifecycle } from "@/modules/market/chart-data/archive-lifecycle"
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

function partitionLimit(value: string | null) {
  if (!value) return 12
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : null
}

export async function POST(request: NextRequest) {
  if (!(await isSchedulerAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const ticker = request.nextUrl.searchParams.get("ticker")?.trim().toUpperCase() ?? ""
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) {
    return NextResponse.json({ ok: false, error: "ticker must be a valid canonical symbol." }, { status: 400 })
  }
  const maxPartitions = partitionLimit(request.nextUrl.searchParams.get("maxPartitions"))
  if (maxPartitions == null) {
    return NextResponse.json({ ok: false, error: "maxPartitions must be an integer from 1 to 12." }, { status: 400 })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) return NextResponse.json({ ok: false, error: "Canonical market data service unavailable." }, { status: 503 })

  try {
    const result = await runChartIntradayArchiveLifecycle(supabase, {
      referenceAt: new Date(),
      maxPartitions,
      ticker,
    })
    return NextResponse.json({
      ok: result.status !== "partial",
      mode: "chart-archive-targeted",
      ticker,
      result,
    }, {
      status: result.status === "partial" ? 207 : 200,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await notifyOpsError({
      source: "qeo172-chart-archive-targeted",
      message,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, mode: "chart-archive-targeted", ticker, error: message }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    })
  }
}
