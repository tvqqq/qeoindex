import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { researchReportsDailyWorkflow } from "@/workflows/research-reports-daily-workflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  if (!isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const startedAt = new Date().toISOString()
    const run = await start(researchReportsDailyWorkflow, [startedAt])
    return NextResponse.json({
      ok: true,
      workflowRunId: run.runId,
      startedAt,
      jobKey: "research_reports.daily",
      schedule: "07:05 Asia/Ho_Chi_Minh every calendar day",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Research Reports daily workflow failed to start", error)
    await notifyOpsError({
      source: "api/research-reports/daily",
      message,
      stack: error instanceof Error ? error.stack : undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, error: "Failed to start research reports workflow" }, { status: 500 })
  }
}
