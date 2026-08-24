import { NextRequest, NextResponse } from "next/server"

import { runAiCouncilDebateOperation } from "@/lib/ai-council-operations"
import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.AI_COUNCIL_RUN_SECRET, process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured" }, { status: 503 })
  }

  try {
    const result = await runAiCouncilDebateOperation(supabase)
    if (!result.ok) {
      const status = result.reason === "UPSTREAM_STALE" ? 424 : 409
      await notifyOpsError({
        source: "api/ai-council/debate-daily",
        message: result.detail,
        path: request.nextUrl.pathname,
        method: request.method,
        status,
      }).catch(() => undefined)
      return NextResponse.json(result, { status })
    }

    return NextResponse.json({
      ...result,
      schedule: "17:25 Asia/Ho_Chi_Minh on trading weekdays",
      behavior: "Operational endpoint for the advisory LLM stage. Production scheduling is owned by the dependency-driven EOD workflow and deterministic authority remains final.",
    })
  } catch (error) {
    console.error("AI Council P4.3 LLM debate failed", error)
    await notifyOpsError({
      source: "api/ai-council/debate-daily",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
