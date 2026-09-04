import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  COUNCIL_BASE_WEIGHTS,
  staticCouncilWeightProfile,
  type CouncilDirectionalAgentKey,
  type CouncilMarketRegime,
  type CouncilWeightProfile,
} from "@/modules/ai-council/calibration"
import { loadAiCouncilBenchmarkContext, type CouncilBenchmarkContext } from "@/modules/ai-council/market"

export interface CouncilAgentStat {
  asOfDate: string
  agentKey: CouncilDirectionalAgentKey
  marketRegime: "ALL" | CouncilMarketRegime
  sampleCount: number
  directionalCount: number
  hitRatePct: number | null
  brierScore: number | null
  averageSignedReturn5dPct: number | null
  skillFactor: number
  recommendedWeight: number
  calibrated: boolean
}

export interface CouncilLearningRefreshResult {
  outcomesBefore: number
  confirmations: number
  outcomesAfter: number
  agentStats: number
}

export interface CouncilConfirmationSummary {
  pending: number
  triggered: number
  failed: number
  expired: number
  triggerHitRatePct: number | null
}

export interface AiCouncilPerformanceData {
  asOfDate: string | null
  benchmark: CouncilBenchmarkContext
  overallStats: CouncilAgentStat[]
  regimeStats: CouncilAgentStat[]
  confirmations: CouncilConfirmationSummary
  totalRuns: number
  maturedRuns: number
}

type AgentStatRow = {
  as_of_date: string
  agent_key: string
  market_regime: string
  sample_count: number
  directional_count: number
  hit_rate_pct: number | null
  brier_score: number | null
  average_signed_return_5d_pct: number | null
  skill_factor: number
  recommended_weight: number
  calibrated: boolean
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isAgentKey(value: string): value is CouncilDirectionalAgentKey {
  return value === "wyckoff" || value === "momentum" || value === "fundamental" || value === "flow" || value === "market"
}

function normalizeAgentStat(row: AgentStatRow): CouncilAgentStat | null {
  const agentKey = row.agent_key
  if (!isAgentKey(agentKey)) return null
  const regime = row.market_regime
  if (regime !== "ALL" && regime !== "RISK_ON" && regime !== "NEUTRAL" && regime !== "RISK_OFF" && regime !== "UNKNOWN") return null
  return {
    asOfDate: row.as_of_date,
    agentKey,
    marketRegime: regime,
    sampleCount: Number(row.sample_count || 0),
    directionalCount: Number(row.directional_count || 0),
    hitRatePct: numberOrNull(row.hit_rate_pct),
    brierScore: numberOrNull(row.brier_score),
    averageSignedReturn5dPct: numberOrNull(row.average_signed_return_5d_pct),
    skillFactor: Number(row.skill_factor || 1),
    recommendedWeight: Number(row.recommended_weight || COUNCIL_BASE_WEIGHTS[agentKey]),
    calibrated: Boolean(row.calibrated),
  }
}

export async function refreshAiCouncilLearningState(
  supabase: SupabaseClient,
  asOfDate: string,
): Promise<CouncilLearningRefreshResult> {
  const before = await supabase.rpc("refresh_ai_council_outcomes")
  if (before.error) throw new Error(`Refresh Council outcomes failed: ${before.error.message}`)

  const confirmations = await supabase.rpc("refresh_ai_council_confirmations", { p_expiry_sessions: 10 })
  if (confirmations.error) throw new Error(`Refresh Council confirmations failed: ${confirmations.error.message}`)

  const after = await supabase.rpc("refresh_ai_council_outcomes")
  if (after.error) throw new Error(`Refresh Council conditional outcomes failed: ${after.error.message}`)

  const stats = await supabase.rpc("refresh_ai_council_agent_stats", { p_as_of_date: asOfDate })
  if (stats.error) throw new Error(`Refresh Council calibration failed: ${stats.error.message}`)

  return {
    outcomesBefore: Number(before.data || 0),
    confirmations: Number(confirmations.data || 0),
    outcomesAfter: Number(after.data || 0),
    agentStats: Number(stats.data || 0),
  }
}

async function loadStatsForDate(supabase: SupabaseClient, asOfDate: string) {
  const result = await supabase
    .from("ai_council_agent_stats")
    .select("as_of_date,agent_key,market_regime,sample_count,directional_count,hit_rate_pct,brier_score,average_signed_return_5d_pct,skill_factor,recommended_weight,calibrated")
    .eq("as_of_date", asOfDate)

  if (result.error) throw new Error(`Load Council agent stats failed: ${result.error.message}`)
  return ((result.data || []) as AgentStatRow[]).map(normalizeAgentStat).filter((row): row is CouncilAgentStat => Boolean(row))
}

function profileFromStats(
  rows: CouncilAgentStat[],
  regime: CouncilMarketRegime,
  source: CouncilWeightProfile["source"],
): CouncilWeightProfile | null {
  if (rows.length !== 5 || !rows.every((row) => row.calibrated)) return null
  const weights = { ...COUNCIL_BASE_WEIGHTS }
  for (const row of rows) weights[row.agentKey] = row.recommendedWeight
  return {
    weights,
    source,
    calibrationVersion: source === "regime-calibrated" ? "adaptive-brier-regime-v1" : "adaptive-brier-overall-v1",
    sampleCount: Math.min(...rows.map((row) => row.sampleCount)),
    regime,
  }
}

export async function loadCouncilWeightProfile(
  supabase: SupabaseClient,
  asOfDate: string,
  regime: CouncilMarketRegime,
): Promise<CouncilWeightProfile> {
  const stats = await loadStatsForDate(supabase, asOfDate)
  const regimeRows = stats.filter((row) => row.marketRegime === regime)
  const regimeProfile = profileFromStats(regimeRows, regime, "regime-calibrated")
  if (regimeProfile) return regimeProfile

  const overallRows = stats.filter((row) => row.marketRegime === "ALL")
  const overallProfile = profileFromStats(overallRows, regime, "overall-calibrated")
  if (overallProfile) return overallProfile

  return staticCouncilWeightProfile(regime)
}

export async function getAiCouncilPerformanceData(supabase: SupabaseClient): Promise<AiCouncilPerformanceData> {
  const latestStatsDate = await supabase
    .from("ai_council_agent_stats")
    .select("as_of_date")
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  const asOfDate = latestStatsDate.data?.as_of_date ? String(latestStatsDate.data.as_of_date) : null
  const stats = asOfDate ? await loadStatsForDate(supabase, asOfDate) : []
  const benchmark = await loadAiCouncilBenchmarkContext(supabase, asOfDate || new Date().toISOString().slice(0, 10))

  const confirmationsResult = await supabase
    .from("ai_council_confirmations")
    .select("status,trigger_direction_correct_5d")
  const confirmationRows = confirmationsResult.error ? [] : (confirmationsResult.data || [])
  const statusCounts = { pending: 0, triggered: 0, failed: 0, expired: 0 }
  let resolvedTriggerCount = 0
  let correctTriggerCount = 0
  for (const row of confirmationRows) {
    const status = String(row.status)
    if (status === "pending" || status === "triggered" || status === "failed" || status === "expired") statusCounts[status] += 1
    if (status === "triggered" && row.trigger_direction_correct_5d != null) {
      resolvedTriggerCount += 1
      if (row.trigger_direction_correct_5d) correctTriggerCount += 1
    }
  }

  const runsCount = await supabase.from("ai_council_runs").select("id", { count: "exact", head: true })
  const maturedCount = await supabase.from("ai_council_outcomes").select("run_id", { count: "exact", head: true }).eq("outcome_status", "matured")

  return {
    asOfDate,
    benchmark,
    overallStats: stats.filter((row) => row.marketRegime === "ALL").sort((left, right) => right.recommendedWeight - left.recommendedWeight),
    regimeStats: stats.filter((row) => row.marketRegime !== "ALL").sort((left, right) => left.marketRegime.localeCompare(right.marketRegime) || right.recommendedWeight - left.recommendedWeight),
    confirmations: {
      ...statusCounts,
      triggerHitRatePct: resolvedTriggerCount ? (correctTriggerCount / resolvedTriggerCount) * 100 : null,
    },
    totalRuns: runsCount.count || 0,
    maturedRuns: maturedCount.count || 0,
  }
}
