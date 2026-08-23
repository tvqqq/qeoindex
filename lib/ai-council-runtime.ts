import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { applyCouncilWeightProfile, staticCouncilWeightProfile, type CouncilWeightProfile } from "@/lib/ai-council-calibration"
import { getAiCouncilData, type AiCouncilData } from "@/lib/ai-council-data"
import { loadCouncilWeightProfile } from "@/lib/ai-council-learning"
import { loadAiCouncilBenchmarkContext, type CouncilBenchmarkContext } from "@/lib/ai-council-market"

export interface AiCouncilRuntimeData {
  data: AiCouncilData
  benchmark: CouncilBenchmarkContext
  weightProfile: CouncilWeightProfile
}

export async function getAiCouncilRuntimeData(
  supabase: SupabaseClient,
  options: { includeHistory?: boolean } = {},
): Promise<AiCouncilRuntimeData> {
  const data = await getAiCouncilData(supabase, options)
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
