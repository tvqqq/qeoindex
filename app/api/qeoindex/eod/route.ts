import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { runChartIntradayArchiveLifecycle } from "@/modules/market/chart-data/archive-lifecycle"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { qeoindexEodPipeline } from "@/workflows/qeoindex-eod-pipeline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return ""
  return authorization.slice("Bearer ".length).trim()
}

function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function historicalStartedAt(sessionDate: string, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    throw new Error("sessionDate must use YYYY-MM-DD")
  }
  const parsed = new Date(`${sessionDate}T08:15:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || vietnamDateKey(parsed) !== sessionDate) {
    throw new Error("sessionDate is not a valid calendar date")
  }
  if (sessionDate >= vietnamDateKey(now)) {
    throw new Error("sessionDate backfill must be earlier than today in Asia/Ho_Chi_Minh")
  }
  return parsed.toISOString()
}

function archivePartitionLimit(value: string | null) {
  if (!value) return 1
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : null
}

async function isQeoIndexSchedulerAuthorized(request: Request) {
  if (isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) return true

  const token = bearerToken(request)
  if (!token) return false
  const supabase = getSupabaseServerClient()
  if (!supabase) return false

  const { data, error } = await supabase.rpc("qeo_verify_eod_scheduler_secret", { p_secret: token })
  return !error && data === true
}

async function trigger(request: NextRequest) {
  if (!(await isQeoIndexSchedulerAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const mode = request.nextUrl.searchParams.get("mode")?.trim() || ""
  if (mode === "chart-archive") {
    if (request.method !== "POST") {
      return NextResponse.json({ ok: false, error: "Chart archive recovery requires POST." }, { status: 405, headers: { Allow: "POST" } })
    }
    const maxPartitions = archivePartitionLimit(request.nextUrl.searchParams.get("maxPartitions"))
    if (maxPartitions == null) {
      return NextResponse.json({ ok: false, error: "maxPartitions must be an integer from 1 to 12." }, { status: 400 })
    }
    const supabase = getSupabaseServerClient()
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Canonical market data service unavailable." }, { status: 503 })
    }
    try {
      const result = await runChartIntradayArchiveLifecycle(supabase, { referenceAt: new Date(), maxPartitions })
      return NextResponse.json({ ok: result.status !== "partial", mode, result }, { status: result.status === "partial" ? 207 : 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await notifyOpsError({ source: "qeo103-chart-archive", message, path: request.nextUrl.pathname, method: request.method, status: 500 })
      return NextResponse.json({ ok: false, mode, error: message }, { status: 500 })
    }
  }

  if (mode) {
    return NextResponse.json({ ok: false, error: "Unsupported EOD operation mode." }, { status: 400 })
  }

  const now = new Date()
  const sessionDate = request.nextUrl.searchParams.get("sessionDate")?.trim() || ""
  let startedAt = now.toISOString()
  if (sessionDate) {
    try {
      startedAt = historicalStartedAt(sessionDate, now)
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  }

  try {
    const run = await start(qeoindexEodPipeline, [startedAt])
    return NextResponse.json({
      ok: true,
      workflowRunId: run.runId,
      startedAt,
      sessionDate: sessionDate || vietnamDateKey(now),
      historicalBackfill: Boolean(sessionDate),
    }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await notifyOpsError({ source: "qeoindex-eod-pipeline", message, path: request.nextUrl.pathname, method: request.method, status: 500 })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) { return trigger(request) }
export async function POST(request: NextRequest) { return trigger(request) }
