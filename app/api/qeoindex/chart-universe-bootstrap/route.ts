import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { chartUniverseBootstrapWorkflow } from "@/workflows/chart-universe-bootstrap"

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

function transitionId(value: string | null) {
  const normalized = String(value || "").trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null
}

export async function POST(request: NextRequest) {
  if (!(await isSchedulerAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const requestedTransitionId = transitionId(request.nextUrl.searchParams.get("transitionId"))
  if (!requestedTransitionId) {
    return NextResponse.json({ ok: false, error: "transitionId must be a UUID." }, { status: 400 })
  }

  try {
    const startedAt = new Date().toISOString()
    const dispatchId = `qeo105-${randomUUID()}`
    const run = await start(chartUniverseBootstrapWorkflow, [requestedTransitionId, startedAt, dispatchId])
    return NextResponse.json({
      ok: true,
      mode: "chart-universe-bootstrap",
      transitionId: requestedTransitionId,
      dispatchId,
      workflowRunId: run.runId,
      startedAt,
    }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await notifyOpsError({
      source: "qeo105-chart-universe-bootstrap",
      message,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, mode: "chart-universe-bootstrap", transitionId: requestedTransitionId, error: message }, { status: 500 })
  }
}
