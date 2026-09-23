import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { normalizeResearchReportSummaryImageBackfillMaxReports } from "@/modules/research-reports/summary-image-backfill"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { researchReportSummaryImageBackfillWorkflow } from "@/workflows/research-report-summary-image-backfill-workflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

function normalizeReason(value: unknown): string {
  if (typeof value !== "string") return "Research Report legacy summary-image backfill"
  const reason = value.trim()
  if (reason.length < 8 || reason.length > 240) {
    throw new Error("reason must contain 8 to 240 characters")
  }
  return reason
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    let body: Record<string, unknown> = {}
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>
      }
    } catch {
      body = {}
    }

    const maxReports = normalizeResearchReportSummaryImageBackfillMaxReports(body.maxReports ?? 20)
    const reason = normalizeReason(body.reason)
    const startedAt = new Date().toISOString()
    const run = await start(researchReportSummaryImageBackfillWorkflow, [{
      startedAt,
      maxReports,
      reason,
    }])

    return NextResponse.json({
      ok: true,
      workflowRunId: run.runId,
      startedAt,
      jobKey: "research_reports.image_backfill",
      maxReports,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Research Report summary image backfill failed to start", error)
    await notifyOpsError({
      source: "api/research-reports/images/backfill",
      message,
      stack: error instanceof Error ? error.stack : undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
