import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { dailySignalWorkflow } from "@/workflows/daily-signal-workflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== "production"
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const startedAt = new Date().toISOString()
  const run = await start(dailySignalWorkflow, [startedAt])
  return NextResponse.json({
    ok: true,
    runId: run.runId,
    startedAt,
    schedule: "07:00 Asia/Ho_Chi_Minh on trading weekdays",
    behavior: "Refresh Daily scan -> wait durably for opening print -> BUY/SELL action -> adaptive monitoring vs VNINDEX",
  })
}
