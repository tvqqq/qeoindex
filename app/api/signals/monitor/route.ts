import { NextRequest, NextResponse } from "next/server"
import { runSignalMonitor } from "@/lib/signal-monitor"
import { SIGNAL_ENGINE_VERSION } from "@/lib/signal-engine"
import { notifyOpsError } from "@/lib/ops-alerts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function authorized(request: NextRequest) {
  const candidates = [process.env.SIGNAL_MONITOR_SECRET, process.env.CRON_SECRET].filter(Boolean) as string[]
  if (!candidates.length) return false
  const auth = request.headers.get("authorization") ?? ""
  return candidates.some((secret) => auth === `Bearer ${secret}`)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  try {
    const result = await runSignalMonitor({ force: request.nextUrl.searchParams.get("force") === "1" })
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
