import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { qeoindexEodPipeline } from "@/workflows/qeoindex-eod-pipeline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function trigger(request: NextRequest) {
  if (!isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  try {
    const run = await start(qeoindexEodPipeline, [startedAt])
    return NextResponse.json({ ok: true, workflowRunId: run.runId, startedAt }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await notifyOpsError({ source: "qeoindex-eod-pipeline", message, path: request.nextUrl.pathname, method: request.method, status: 500 })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) { return trigger(request) }
export async function POST(request: NextRequest) { return trigger(request) }
