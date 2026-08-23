import { NextRequest, NextResponse } from "next/server"

import { applyCouncilWeightProfile } from "@/lib/ai-council-calibration"
import { getAiCouncilData } from "@/lib/ai-council-data"
import { loadCouncilWeightProfile, refreshAiCouncilLearningState } from "@/lib/ai-council-learning"
import { loadAiCouncilBenchmarkContext, syncAiCouncilMarketBenchmark } from "@/lib/ai-council-market"
import { persistAiCouncilData } from "@/lib/ai-council-persistence"
import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

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
    const now = new Date()
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

    let benchmarkSyncError = ""
    let benchmarkRows = 0
    try {
      const benchmarkSync = await syncAiCouncilMarketBenchmark(supabase, now)
      benchmarkRows = benchmarkSync.rowsUpserted
    } catch (error) {
      benchmarkSyncError = error instanceof Error ? error.message : String(error)
      console.warn("AI Council VNINDEX benchmark sync degraded", benchmarkSyncError)
    }

    const benchmark = await loadAiCouncilBenchmarkContext(supabase, data.ratingDate)
    const learningBefore = await refreshAiCouncilLearningState(supabase, data.ratingDate)
    const weightProfile = await loadCouncilWeightProfile(supabase, data.ratingDate, benchmark.regime)
    const calibratedData = {
      ...data,
      stocks: data.stocks.map((stock) => applyCouncilWeightProfile(stock, weightProfile)),
    }

    const result = await persistAiCouncilData(supabase, calibratedData, {
      marketRegime: benchmark.regime,
      weightProfile,
    })
    const learningAfter = await refreshAiCouncilLearningState(supabase, data.ratingDate)

    return NextResponse.json({
      ok: true,
      status: "completed",
      ...result,
      benchmark: {
        symbol: benchmark.symbol,
        sessionDate: benchmark.sessionDate,
        close: benchmark.close,
        regime: benchmark.regime,
        rowsUpserted: benchmarkRows,
        degraded: Boolean(benchmarkSyncError),
        error: benchmarkSyncError || undefined,
      },
      calibration: {
        source: weightProfile.source,
        sampleCount: weightProfile.sampleCount,
        weights: weightProfile.weights,
      },
      learningBefore,
      learningAfter,
      schedule: "17:15 Asia/Ho_Chi_Minh on trading weekdays",
      behavior: "Sync VNINDEX benchmark -> mature prior outcomes/confirmations -> calibrate bounded agent weights -> persist immutable Council v2 -> refresh alpha, confirmation outcomes and leaderboard stats.",
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
