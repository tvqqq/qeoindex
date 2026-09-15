import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { chartIntradayArchiveCatchupWorkflow } from "@/workflows/chart-intraday-archive-catchup"

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

  try {
    const startedAt = new Date().toISOString()
    const dispatchId = `qeo228-${randomUUID()}`
    const run = await start(chartIntradayArchiveCatchupWorkflow, [startedAt, dispatchId])
    return NextResponse.json({
      ok: true,
      mode: "chart-archive-catchup",
      scope: "canonical_universe",
      dispatchId,
      workflowRunId: run.runId,
      startedAt,
    }, {
      status: 202,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await notifyOpsError({
      source: "qeo228-chart-archive-catchup",
      message,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, mode: "chart-archive-catchup", error: message }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    })
  }
}
