import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { executeSystemJob } from "@/lib/admin/job-telemetry"
import { notifyOpsError } from "@/lib/ops-alerts"
import { ingestLatestReadyWyckoffRun } from "@/lib/wyckoff-notion-ingest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function ingest(request: NextRequest) {
  if (!isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  try {
    const { result } = await executeSystemJob({
      jobKey: "wyckoff.ingest",
      trigger: "external",
      telemetry: "required",
      fn: ingestLatestReadyWyckoffRun,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await notifyOpsError({ source: "wyckoff-notion-ingest", message, path: request.nextUrl.pathname, method: request.method, status: 500 })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) { return ingest(request) }
export async function POST(request: NextRequest) { return ingest(request) }
