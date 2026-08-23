import { NextRequest, NextResponse } from "next/server"

import { runSelectedAiCouncilLlmDebates } from "@/lib/ai-council-llm"
import { getAiCouncilRuntimeData } from "@/lib/ai-council-runtime"
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
    const runtimeData = await getAiCouncilRuntimeData(supabase, { includeHistory: false })
    const result = await runSelectedAiCouncilLlmDebates(supabase, {
      ratingDate: runtimeData.data.ratingDate,
      stocks: runtimeData.data.stocks,
      benchmark: runtimeData.benchmark,
      weightProfile: runtimeData.weightProfile,
    })
    return NextResponse.json({
      ok: true,
      status: result.enabled ? "completed" : "disabled",
      ...result,
      schedule: "17:25 Asia/Ho_Chi_Minh on trading weekdays",
      finalAuthority: "deterministic",
      behavior: "Event-select deterministic Council runs -> Luna Bull/Bear -> Terra Risk/Chair -> Sol Chair only on severe conflict -> immutable cost/cache audit. LLM output never overrides the deterministic signal.",
    })
  } catch (error) {
    console.error("AI Council P4.1 LLM debate failed", error)
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
