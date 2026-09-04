import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { runAiCouncilDebateOperation } from "@/modules/ai-council/operations"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return ""
  return authorization.slice("Bearer ".length).trim()
}

async function isCouncilRecoveryAuthorized(request: Request, supabase: SupabaseClient) {
  if (isMachineRequestAuthorized(
    request,
    [process.env.AI_COUNCIL_RUN_SECRET, process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) return true

  const token = bearerToken(request)
  if (!token) return false
  const { data, error } = await supabase.rpc("qeo_verify_eod_scheduler_secret", { p_secret: token })
  return !error && data === true
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured" }, { status: 503 })
  }

  if (!(await isCouncilRecoveryAuthorized(request, supabase))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const ratingDate = request.nextUrl.searchParams.get("ratingDate")?.trim() || undefined
  const parsedRatingDate = ratingDate ? new Date(`${ratingDate}T08:15:00.000Z`) : null
  if (ratingDate && (!/^\d{4}-\d{2}-\d{2}$/.test(ratingDate) || !parsedRatingDate || !Number.isFinite(parsedRatingDate.getTime()))) {
    return NextResponse.json({ ok: false, error: "INVALID_RATING_DATE" }, { status: 400 })
  }

  try {
    const result = await runAiCouncilDebateOperation(supabase, ratingDate)
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
