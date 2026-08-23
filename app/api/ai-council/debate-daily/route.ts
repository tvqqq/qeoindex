import { NextRequest, NextResponse } from "next/server"

import { runSelectedAiCouncilLlmDebates } from "@/lib/ai-council-llm"
import { getAiCouncilRuntimeData } from "@/lib/ai-council-runtime"
import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function firstValidationTicker(stocks: Awaited<ReturnType<typeof getAiCouncilRuntimeData>>["data"]["stocks"]) {
  return [...stocks]
    .filter((stock) => Boolean(stock.ticker))
    .sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999) || left.ticker.localeCompare(right.ticker))[0]?.ticker || null
}

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
    const priorDebates = await supabase
      .from("ai_council_llm_debates")
      .select("id", { count: "exact", head: true })

    if (priorDebates.error) {
      throw new Error(`Load prior LLM debate count failed: ${priorDebates.error.message}`)
    }

    const run = () => runSelectedAiCouncilLlmDebates(supabase, {
      ratingDate: runtimeData.data.ratingDate,
      stocks: runtimeData.data.stocks,
      benchmark: runtimeData.benchmark,
      weightProfile: runtimeData.weightProfile,
    })

    let result = await run()
    let validationBootstrap = false
    let validationTicker: string | null = null

    // P4.2 first-live-run guardrail: if the event selector has never produced a debate yet,
    // run exactly one high-quality deterministic stock through the advisory LLM path.
    // This guarantees one real Luna/Terra production audit without permanently changing
    // the event-selection policy or consuming the normal 3-ticker budget on future days.
    if (
      result.enabled
      && result.selected === 0
      && (priorDebates.count || 0) === 0
      && !process.env.AI_COUNCIL_LLM_TICKERS?.trim()
    ) {
      validationTicker = firstValidationTicker(runtimeData.data.stocks)
      if (validationTicker) {
        const originalTickers = process.env.AI_COUNCIL_LLM_TICKERS
        const originalMaxTickers = process.env.AI_COUNCIL_LLM_MAX_TICKERS
        try {
          process.env.AI_COUNCIL_LLM_TICKERS = validationTicker
          process.env.AI_COUNCIL_LLM_MAX_TICKERS = "1"
          result = await run()
          validationBootstrap = result.selected > 0
        } finally {
          if (originalTickers == null) delete process.env.AI_COUNCIL_LLM_TICKERS
          else process.env.AI_COUNCIL_LLM_TICKERS = originalTickers
          if (originalMaxTickers == null) delete process.env.AI_COUNCIL_LLM_MAX_TICKERS
          else process.env.AI_COUNCIL_LLM_MAX_TICKERS = originalMaxTickers
        }
      }
    }

    return NextResponse.json({
      ok: true,
      status: result.enabled ? "completed" : "disabled",
      ...result,
      validationBootstrap,
      validationTicker: validationBootstrap ? validationTicker : null,
      schedule: "17:25 Asia/Ho_Chi_Minh on trading weekdays",
      finalAuthority: "deterministic",
      behavior: "Event-select deterministic Council runs -> Luna Bull/Bear -> Terra Risk/Chair -> Sol Chair only on severe conflict -> immutable cost/cache audit. On the first live production day only, one deterministic stock is used as a bounded validation bootstrap if no event qualifies. LLM output never overrides the deterministic signal.",
    })
  } catch (error) {
    console.error("AI Council P4.2 LLM debate failed", error)
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
