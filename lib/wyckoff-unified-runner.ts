import { randomUUID } from "node:crypto"

import { getCachedHourlyHistory, getCachedLongDailyHistory } from "@/lib/request-cache"
import { getScannerDataFresh } from "@/lib/scanner-data"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { buildWyckoffChartStudies } from "@/lib/wyckoff-chart-model"
import { UNIVERSE_SIZE } from "@/lib/wyckoff-universe"

export const WYCKOFF_MODEL_VERSION = "qeo-wyckoff-rule-v1"
export const WYCKOFF_AGGREGATION_VERSION = "vn-session-v1"

export interface UnifiedWyckoffRunSummary {
  ok: boolean
  runId: string
  requested: number
  completed: Array<{ ticker: string; timeframes: number; dailyProvider: string; hourlyProvider: string }>
  errors: Array<{ ticker: string; error: string }>
  generatedAt: string
}

function isoFromSeconds(value: number) {
  return new Date(value * 1000).toISOString()
}

export async function runUnifiedWyckoff({ limit = 10, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<UnifiedWyckoffRunSummary> {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")

  const scanner = await getScannerDataFresh()
  const safeLimit = Math.max(1, Math.min(10, limit))
  const safeOffset = Math.max(0, Math.min(UNIVERSE_SIZE - 1, offset))
  const targets = scanner.universe.slice(safeOffset, safeOffset + safeLimit)
  const runId = randomUUID()
  const startedAt = new Date().toISOString()

  const { error: runError } = await supabase.from("wyckoff_scan_runs").insert({
    id: runId,
    universe_effective_date: scanner.universeDate,
    model_version: WYCKOFF_MODEL_VERSION,
    aggregation_version: WYCKOFF_AGGREGATION_VERSION,
    status: "running",
    requested_count: targets.length,
    started_at: startedAt,
  })
  if (runError) throw new Error(`Cannot create Wyckoff run: ${runError.message}`)

  const memberships = scanner.universe.map((stock) => ({
    ticker: stock.ticker,
    exchange: stock.exchange,
    rank: stock.rank,
    sector: stock.sector,
    market_cap_billion: stock.marketCapT * 1000,
    effective_date: scanner.universeDate,
    active: stock.active,
    source: "notion",
    synced_at: startedAt,
  }))
  const { error: membershipError } = await supabase.from("wyckoff_universe_memberships").upsert(memberships, { onConflict: "universe_key,ticker,effective_date" })
  if (membershipError) throw new Error(`Cannot sync Wyckoff universe: ${membershipError.message}`)

  const completed: UnifiedWyckoffRunSummary["completed"] = []
  const errors: UnifiedWyckoffRunSummary["errors"] = []
  for (const stock of targets) {
    try {
      const [daily, hourly] = await Promise.all([
        getCachedLongDailyHistory(stock.ticker),
        getCachedHourlyHistory(stock.ticker),
      ])
      if (!daily?.bars.length || !hourly?.bars.length) throw new Error("Provider returned no Daily or 1H bars")
      const studies = buildWyckoffChartStudies({
        dailyBars: daily.bars,
        hourlyBars: hourly.bars,
        dailyProvider: daily.provider,
        dailyDetail: daily.detail,
        hourlyProvider: hourly.provider,
        hourlyDetail: hourly.detail,
      })
      const validStudies = studies.filter((study) => study.analysis && study.asOf)
      if (validStudies.length !== 5) {
        throw new Error(`Only ${validStudies.length}/5 timeframes have enough completed history`)
      }

      const seriesRows = validStudies.map((study) => ({
        ticker: stock.ticker,
        timeframe: study.timeframe,
        bars: study.bars,
        provider: study.provider,
        provider_detail: study.detail,
        derived: study.derived,
        as_of: isoFromSeconds(study.asOf!),
        model_version: WYCKOFF_MODEL_VERSION,
        aggregation_version: WYCKOFF_AGGREGATION_VERSION,
        run_id: runId,
        updated_at: new Date().toISOString(),
      }))
      const snapshotRows = validStudies.map((study) => ({
        id: randomUUID(),
        run_id: runId,
        ticker: stock.ticker,
        timeframe: study.timeframe,
        bar_closed_at: isoFromSeconds(study.asOf!),
        model_version: WYCKOFF_MODEL_VERSION,
        aggregation_version: WYCKOFF_AGGREGATION_VERSION,
        history_bar_count: study.bars.length,
        history_status: study.bars.length >= 120 ? "complete" : "incomplete",
        phase: study.analysis!.phase,
        wyckoff_state: study.analysis!.wyckoffState,
        ta_bias: study.analysis!.taBias,
        confidence: study.analysis!.confidence,
        bull_probability: study.analysis!.bullProbability,
        base_probability: study.analysis!.baseProbability,
        bear_probability: study.analysis!.bearProbability,
        support: study.analysis!.support,
        resistance: study.analysis!.resistance,
        confirmation: study.analysis!.confirmation,
        invalidation: study.analysis!.invalidation,
        what_changed: study.analysis!.whatChanged,
        technical: study.analysis!.technical,
        evidence: { provider: study.provider, providerDetail: study.detail, derived: study.derived, barCount: study.bars.length },
        markers: study.markers,
        scenarios: study.scenarios,
      }))

      const { error: seriesError } = await supabase.from("wyckoff_chart_series").upsert(seriesRows, { onConflict: "ticker,timeframe" })
      if (seriesError) throw new Error(`Series write failed: ${seriesError.message}`)
      const { error: snapshotsError } = await supabase.from("wyckoff_analysis_snapshots").upsert(snapshotRows, { onConflict: "ticker,timeframe,bar_closed_at,model_version,aggregation_version", ignoreDuplicates: true })
      if (snapshotsError) throw new Error(`Snapshot write failed: ${snapshotsError.message}`)
      completed.push({ ticker: stock.ticker, timeframes: validStudies.length, dailyProvider: daily.provider, hourlyProvider: hourly.provider })
    } catch (error) {
      errors.push({ ticker: stock.ticker, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const status = errors.length === 0 ? "published" : completed.length ? "partial" : "failed"
  const generatedAt = new Date().toISOString()
  await supabase.from("wyckoff_scan_runs").update({
    status,
    completed_count: completed.length,
    incomplete_count: 0,
    error_count: errors.length,
    diagnostics: { offset: safeOffset, limit: safeLimit, errors: errors.slice(0, 10) },
    finished_at: generatedAt,
  }).eq("id", runId)

  return { ok: errors.length === 0, runId, requested: targets.length, completed, errors, generatedAt }
}
