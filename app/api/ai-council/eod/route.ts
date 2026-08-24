import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { aiCouncilEodWorkflow } from "@/workflows/ai-council-eod-workflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.AI_COUNCIL_RUN_SECRET, process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const startedAt = new Date().toISOString()
    const run = await start(aiCouncilEodWorkflow, [startedAt])
    return NextResponse.json({
      ok: true,
      runId: run.runId,
      startedAt,
      schedule: "17:00 Asia/Ho_Chi_Minh on trading weekdays",
      behavior: "Final EOD market gate -> ten bounded fresh Wyckoff batches -> Top100 same-session validation -> deterministic Council -> advisory LLM debate.",
    })
  } catch (error) {
    console.error("AI Council EOD workflow failed to start", error)
    await notifyOpsError({
      source: "api/ai-council/eod",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
