import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { dailySignalWorkflow } from "@/workflows/daily-signal-workflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const startedAt = new Date().toISOString()
    const run = await start(dailySignalWorkflow, [startedAt])
    return NextResponse.json({
      ok: true,
      runId: run.runId,
      startedAt,
      schedule: "07:00 Asia/Ho_Chi_Minh on trading weekdays",
      behavior: "Refresh Daily scan -> wait durably for opening print -> BUY/SELL action -> adaptive monitoring vs VNINDEX",
    })
  } catch (error) {
    console.error("Daily signal workflow failed to start", error)
    await notifyOpsError({
      source: "api/signals/daily",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
