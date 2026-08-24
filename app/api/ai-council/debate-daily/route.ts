import { NextRequest, NextResponse } from "next/server"

import {
  AI_COUNCIL_LLM_PROMPT_VERSION,
  runSelectedAiCouncilLlmDebates,
} from "@/lib/ai-council-llm"
import { enrichCouncilStocksForDebate } from "@/lib/ai-council-pre-market-evidence"
import { configuredCouncilResearchTickers } from "@/lib/ai-council-research-context"
import { getAiCouncilRuntimeData } from "@/lib/ai-council-runtime"
import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { notifyOpsError } from "@/lib/ops-alerts"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function firstValidationTicker(stocks: Awaited<ReturnType<typeof getAiCouncilRuntimeData>>["data"]["stocks"]) {
  const researchPilots = configuredCouncilResearchTickers()
  const researchPilot = [...stocks]
    .filter((stock) => researchPilots.has(stock.ticker))
    .sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999) || left.ticker.localeCompare(right.ticker))[0]?.ticker

  if (researchPilot) return researchPilot

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
    const runtimeData = await getAiCouncilRuntimeData(supabase, { includeHistory: false, includePromptEvidence: true })
    // Freeze raw provider/Wyckoff evidence first, then attach bounded Notion research as explicit
    // first-class packet fields. Deterministic scoring and signal authority remain unchanged.
    const evidenceFidelity = await enrichCouncilStocksForDebate(supabase, {
      ratingDate: runtimeData.data.ratingDate,
      stocks: runtimeData.data.stocks,
      promptVersion: AI_COUNCIL_LLM_PROMPT_VERSION,
    })
    const debateStocks = evidenceFidelity.stocks

    const priorDebates = await supabase
      .from("ai_council_llm_debates")
      .select("id", { count: "exact", head: true })

    if (priorDebates.error) {
      throw new Error(`Load prior LLM debate count failed: ${priorDebates.error.message}`)
    }

    const run = () => runSelectedAiCouncilLlmDebates(supabase, {
      ratingDate: runtimeData.data.ratingDate,
      stocks: debateStocks,
      benchmark: runtimeData.benchmark,
      weightProfile: runtimeData.weightProfile,
    })

    let result = await run()
    let validationBootstrap = false
    let validationTicker: string | null = null

    // First-live-run guardrail: if the event selector has never produced a debate,
    // prefer a research-context pilot ticker (MSN by default) so the first bounded
    // production call validates both market evidence and curated Notion context.
    if (
      result.enabled
      && result.selected === 0
      && (priorDebates.count || 0) === 0
      && !process.env.AI_COUNCIL_LLM_TICKERS?.trim()
    ) {
      validationTicker = firstValidationTicker(debateStocks)
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
      evidenceFidelity: {
        contextVersion: evidenceFidelity.contextVersion,
        contextsBuilt: evidenceFidelity.contextsBuilt,
        contextsReused: evidenceFidelity.contextsReused,
        contextsPersisted: evidenceFidelity.contextsPersisted,
        missingRunIdentities: evidenceFidelity.missingRunIdentities,
        ttaiRowsLoaded: evidenceFidelity.ttaiRowsLoaded,
        wyckoffRowsLoaded: evidenceFidelity.wyckoffRowsLoaded,
        detail: evidenceFidelity.detail,
      },
      researchContext: {
        contextVersion: evidenceFidelity.researchContextVersion,
        pilotTickers: [...configuredCouncilResearchTickers()],
        ready: evidenceFidelity.researchReady,
        unavailable: evidenceFidelity.researchUnavailable,
        reused: evidenceFidelity.researchReused,
        persisted: evidenceFidelity.researchPersisted,
        missingRunIdentities: evidenceFidelity.researchMissingRunIdentities,
      },
      validationBootstrap,
      validationTicker: validationBootstrap ? validationTicker : null,
      schedule: "17:25 Asia/Ho_Chi_Minh on trading weekdays",
      finalAuthority: "deterministic",
      behavior: "Freeze raw current KFSP/TTAI metrics + quarterly 4M/CANSLIM trajectory + raw Wyckoff MTF context, attach bounded point-in-time Notion Research Context as first-class Packet V2 evidence, and route OpenAI prompt caching by the combined prompt identity. Event-selected runs use Luna Bull/Bear -> Terra Risk/Chair -> Sol severe-conflict Chair. Deterministic scoring and signal authority never change.",
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
