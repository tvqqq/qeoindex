import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { executeSystemJob } from "@/lib/admin/job-telemetry"
import { runSignalMonitor } from "@/lib/signal-monitor"
import { SIGNAL_ENGINE_VERSION } from "@/lib/signal-engine"
import { notifyOpsError } from "@/lib/ops-alerts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.SIGNAL_MONITOR_SECRET, process.env.CRON_SECRET],
  )) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { result } = await executeSystemJob({
      jobKey: "signals.monitor",
      trigger: "external",
      telemetry: "required",
      terminalUpdateFailure: "preserve-domain-success",
      fn: () => runSignalMonitor({ force: request.nextUrl.searchParams.get("force") === "1" }),
      isSuccess: (value) => !value.missingQuotes?.length,
    })
    return NextResponse.json(result, { status: result.missingQuotes?.length ? 207 : 200 })
  } catch (error) {
    console.error("Intraday signal monitor failed", error)
    await notifyOpsError({
      source: "api/signals/monitor",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
      metadata: { engineVersion: SIGNAL_ENGINE_VERSION },
    })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error), engineVersion: SIGNAL_ENGINE_VERSION }, { status: 500 })
  }
}
