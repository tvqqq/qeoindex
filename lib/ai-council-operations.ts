import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { applyCouncilWeightProfile } from "@/lib/ai-council-calibration"
import { AiCouncilUpstreamStaleError, assertAiCouncilEodFreshness } from "@/lib/ai-council-freshness"
import {
  AI_COUNCIL_LLM_PROMPT_VERSION,
  runSelectedAiCouncilLlmDebates,
} from "@/lib/ai-council-llm"
import { loadCouncilWeightProfile, refreshAiCouncilLearningState } from "@/lib/ai-council-learning"
import { syncAiCouncilMarketBenchmark } from "@/lib/ai-council-market"
import { persistAiCouncilData } from "@/lib/ai-council-persistence"
import { enrichCouncilStocksForDebate } from "@/lib/ai-council-pre-market-evidence"
import { configuredCouncilResearchTickers } from "@/lib/ai-council-research-context"
import { getAiCouncilRuntimeData } from "@/lib/ai-council-runtime"
import { getAiCouncilRuntimeConfig } from "@/lib/admin/settings"
import type { EodMarketSynthesisContext } from "@/lib/qeoindex-eod-market-synthesis-step"

function firstValidationTicker(
  stocks: Awaited<ReturnType<typeof getAiCouncilRuntimeData>>["data"]["stocks"],
  researchTickers?: string[],
) {
  const researchPilots = configuredCouncilResearchTickers(researchTickers)
  const researchPilot = [...stocks]
    .filter((stock) => researchPilots.has(stock.ticker))
    .sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999) || left.ticker.localeCompare(right.ticker))[0]?.ticker

  if (researchPilot) return researchPilot

  return [...stocks]
    .filter((stock) => Boolean(stock.ticker))
    .sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999) || left.ticker.localeCompare(right.ticker))[0]?.ticker || null
}

export async function runAiCouncilDailyOperation(supabase: SupabaseClient, now = new Date(), ratingDate?: string) {
  let benchmarkSyncError = ""
  let benchmarkRows = 0
  try {
    const benchmarkSync = await syncAiCouncilMarketBenchmark(supabase, now)
    benchmarkRows = benchmarkSync.rowsUpserted
  } catch (error) {
    benchmarkSyncError = error instanceof Error ? error.message : String(error)
    console.warn("AI Council VNINDEX benchmark sync degraded", benchmarkSyncError)
  }

  const runtimeData = await getAiCouncilRuntimeData(supabase, {
    includeHistory: false,
    includeEodMarketOverlay: true,
    ratingDate,
  })
  const data = runtimeData.data
  const benchmark = runtimeData.benchmark

  if (!data.ratingDate || !data.stocks.length) {
    return {
      ok: false as const,
      status: "skipped" as const,
      reason: "NO_RATING_DATA" as const,
      ratingDate: data.ratingDate,
      stockCount: data.stocks.length,
      detail: data.message,
    }
  }

  let freshness
  try {
    freshness = await assertAiCouncilEodFreshness(supabase, {
      ratingDate: data.ratingDate,
      tickers: data.stocks.map((stock) => stock.ticker),
      benchmarkSessionDate: benchmark.sessionDate,
      marketSource: ratingDate ? "persistent_ohlcv" : "live_snapshot",
    })
  } catch (error) {
    if (error instanceof AiCouncilUpstreamStaleError) {
      return {
        ok: false as const,
        status: "skipped" as const,
        reason: "UPSTREAM_STALE" as const,
        ratingDate: data.ratingDate,
        freshness: error.report,
        detail: "Deterministic Council was not persisted because EOD market/Wyckoff/VNINDEX evidence is not aligned to the same completed session.",
      }
    }
    throw error
  }

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

  return {
    ok: true as const,
    status: "completed" as const,
    ...result,
    freshness,
    ratingDate: data.ratingDate,
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
  }
}

export async function runAiCouncilDebateOperation(
  supabase: SupabaseClient,
  ratingDate?: string,
  marketSynthesis?: EodMarketSynthesisContext | null,
) {
  const runtimeConfig = await getAiCouncilRuntimeConfig()
  const runtimeData = await getAiCouncilRuntimeData(supabase, {
    includeHistory: false,
    includePromptEvidence: true,
    includeEodMarketOverlay: true,
    ratingDate,
  })

  if (!runtimeData.data.ratingDate || !runtimeData.data.stocks.length) {
    return {
      ok: false as const,
      status: "skipped" as const,
      reason: "NO_RATING_DATA" as const,
      ratingDate: runtimeData.data.ratingDate,
      finalAuthority: "deterministic" as const,
      detail: runtimeData.data.message,
    }
  }

  let freshness
  try {
    freshness = await assertAiCouncilEodFreshness(supabase, {
      ratingDate: runtimeData.data.ratingDate,
      tickers: runtimeData.data.stocks.map((stock) => stock.ticker),
      benchmarkSessionDate: runtimeData.benchmark.sessionDate,
      marketSource: ratingDate ? "persistent_ohlcv" : "live_snapshot",
    })
  } catch (error) {
    if (error instanceof AiCouncilUpstreamStaleError) {
      return {
        ok: false as const,
        status: "skipped" as const,
        reason: "UPSTREAM_STALE" as const,
        ratingDate: runtimeData.data.ratingDate,
        freshness: error.report,
        finalAuthority: "deterministic" as const,
        detail: "LLM evidence freeze and OpenAI calls were skipped because the deterministic upstream evidence is not aligned to one completed EOD session.",
      }
    }
    throw error
  }

  const evidenceFidelity = await enrichCouncilStocksForDebate(supabase, {
    ratingDate: runtimeData.data.ratingDate,
    stocks: runtimeData.data.stocks,
    promptVersion: AI_COUNCIL_LLM_PROMPT_VERSION,
  })
  const debateStocks = marketSynthesis
    ? evidenceFidelity.stocks.map((stock) => {
        const existingResearch = (stock as unknown as { researchContext?: Record<string, unknown> }).researchContext
        return {
          ...stock,
          researchContext: {
            ...(existingResearch || {}),
            marketSynthesis: {
              purpose: "Same-session market-level AI context for advisory debate only; deterministic Council remains final authority.",
              ...marketSynthesis,
            },
          },
        }
      })
    : evidenceFidelity.stocks

  const priorDebates = await supabase
    .from("ai_council_llm_debates")
    .select("run_id", { count: "exact", head: true })
  if (priorDebates.error) {
    throw new Error(`Load prior LLM debate count failed: ${priorDebates.error.message}`)
  }

  const run = () => runSelectedAiCouncilLlmDebates(supabase, {
    ratingDate: runtimeData.data.ratingDate,
    stocks: debateStocks,
    benchmark: runtimeData.benchmark,
    weightProfile: runtimeData.weightProfile,
    runtimeConfig,
  })

  let result = await run()
  let validationBootstrap = false
  let validationTicker: string | null = null

  if (
    result.enabled
    && result.selected === 0
    && (priorDebates.count || 0) === 0
    && !runtimeConfig.tickers.length
    && !process.env.AI_COUNCIL_LLM_TICKERS?.trim()
  ) {
    validationTicker = firstValidationTicker(debateStocks, runtimeConfig.researchTickers)
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

  return {
    ok: true as const,
    status: result.enabled ? "completed" as const : "disabled" as const,
    ...result,
    freshness,
    ratingDate: runtimeData.data.ratingDate,
    marketSynthesis: marketSynthesis ? {
      sessionDate: marketSynthesis.sessionDate,
      asOf: marketSynthesis.asOf,
      evidenceHash: marketSynthesis.evidenceHash,
      posture: marketSynthesis.posture,
      confidence: marketSynthesis.confidence,
    } : null,
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
      pilotTickers: [...configuredCouncilResearchTickers(runtimeConfig.researchTickers)],
      ready: evidenceFidelity.researchReady,
      unavailable: evidenceFidelity.researchUnavailable,
      reused: evidenceFidelity.researchReused,
      persisted: evidenceFidelity.researchPersisted,
      missingRunIdentities: evidenceFidelity.researchMissingRunIdentities,
    },
    validationBootstrap,
    validationTicker: validationBootstrap ? validationTicker : null,
    finalAuthority: "deterministic" as const,
  }
}
