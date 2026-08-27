import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { runAiCouncilDailyOperation } from "@/lib/ai-council-operations"
import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

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
  const operationDate = ratingDate ? new Date(`${ratingDate}T08:15:00.000Z`) : new Date()
  if (ratingDate && (!/^\d{4}-\d{2}-\d{2}$/.test(ratingDate) || !Number.isFinite(operationDate.getTime()))) {
    return NextResponse.json({ ok: false, error: "INVALID_RATING_DATE" }, { status: 400 })
  }

  try {
    const result = await runAiCouncilDailyOperation(supabase, operationDate, ratingDate)
    if (!result.ok) {
      const status = result.reason === "UPSTREAM_STALE" ? 424 : 409
      await notifyOpsError({
        source: "api/ai-council/daily",
        message: result.detail,
        path: request.nextUrl.pathname,
        method: request.method,
        status,
      }).catch(() => undefined)
      return NextResponse.json(result, { status })
    }

    return NextResponse.json({
      ...result,
      schedule: "17:15 Asia/Ho_Chi_Minh on trading weekdays",
      behavior: "Operational endpoint for the deterministic stage. Production scheduling is owned by the dependency-driven EOD workflow.",
    })
  } catch (error) {
    console.error("AI Council daily persistence failed", error)
    await notifyOpsError({
      source: "api/ai-council/daily",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
