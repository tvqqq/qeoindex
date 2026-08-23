import { NextRequest, NextResponse } from "next/server"

import { getAiCouncilData } from "@/lib/ai-council-data"
import { persistAiCouncilData } from "@/lib/ai-council-persistence"
import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    const data = await getAiCouncilData(supabase, { includeHistory: false })
    if (!data.ratingDate || !data.stocks.length) {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        ratingDate: data.ratingDate,
        stockCount: data.stocks.length,
        detail: data.message,
      })
    }

    const result = await persistAiCouncilData(supabase, data)
    return NextResponse.json({
      ok: true,
      status: "completed",
      ...result,
      schedule: "17:15 Asia/Ho_Chi_Minh on trading weekdays",
      behavior: "Persist immutable Council revisions + specialist votes, then refresh D+1/D+5/D+20 close-to-close outcomes.",
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
