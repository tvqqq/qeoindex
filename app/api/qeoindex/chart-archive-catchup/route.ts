import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return ""
  return authorization.slice("Bearer ".length).trim()
}

async function isSchedulerAuthorized(request: Request) {
  if (isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) return true
  const token = bearerToken(request)
  if (!token) return false
  const supabase = getSupabaseServerClient()
  if (!supabase) return false
  const { data, error } = await supabase.rpc("qeo_verify_eod_scheduler_secret", { p_secret: token })
  return !error && data === true
}

export async function POST(request: NextRequest) {
  if (!(await isSchedulerAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json({
    ok: false,
    error: { code: "INTRADAY_CHART_OPERATION_RETIRED", message: "Chart archive catch-up is retired by QEO-238." },
  }, { status: 410, headers: { "Cache-Control": "private, no-store" } })
}
