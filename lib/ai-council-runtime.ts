import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { applyCouncilWeightProfile, staticCouncilWeightProfile, type CouncilWeightProfile } from "@/lib/ai-council-calibration"
import { getAiCouncilData, type AiCouncilData } from "@/lib/ai-council-data"
import { getAiCouncilEodData } from "@/lib/ai-council-eod-data"
import { loadCouncilWeightProfile } from "@/lib/ai-council-learning"
import { loadAiCouncilBenchmarkContext, type CouncilBenchmarkContext } from "@/lib/ai-council-market"

export interface AiCouncilRuntimeData {
  data: AiCouncilData
  benchmark: CouncilBenchmarkContext
  weightProfile: CouncilWeightProfile
}

export interface AiCouncilRuntimeOptions {
  includeHistory?: boolean
  includePromptEvidence?: boolean
  includeEodMarketOverlay?: boolean
}

export async function getAiCouncilRuntimeData(
  supabase: SupabaseClient,
  options: AiCouncilRuntimeOptions = {},
): Promise<AiCouncilRuntimeData> {
  const dataOptions = {
    includeHistory: options.includeHistory,
    includePromptEvidence: options.includePromptEvidence,
  }
  const data = options.includeEodMarketOverlay
    ? await getAiCouncilEodData(supabase, dataOptions)
    : await getAiCouncilData(supabase, dataOptions)

  if (!data.ratingDate || !data.stocks.length) {
    const benchmark = await loadAiCouncilBenchmarkContext(supabase, new Date().toISOString().slice(0, 10))
    return { data, benchmark, weightProfile: staticCouncilWeightProfile(benchmark.regime) }
  }

  const benchmark = await loadAiCouncilBenchmarkContext(supabase, data.ratingDate)
  const weightProfile = await loadCouncilWeightProfile(supabase, data.ratingDate, benchmark.regime)
  return {
    data: {
      ...data,
      stocks: data.stocks.map((stock) => applyCouncilWeightProfile(stock, weightProfile)),
      message: `${data.message} Weight profile: ${weightProfile.source} (${weightProfile.calibrationVersion}), market regime ${benchmark.regime}.`,
    },
    benchmark,
    weightProfile,
  }
}
