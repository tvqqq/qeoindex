import { randomUUID } from "node:crypto"

import { fetchLongDailyMarketHistory } from "@/modules/market/history/index"
import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { buildWyckoffChartStudies } from "@/modules/wyckoff/chart-model"

export const WYCKOFF_MODEL_VERSION = "qeo-wyckoff-rule-v1"
export const WYCKOFF_AGGREGATION_VERSION = "vn-session-v1"
export const WYCKOFF_UNIVERSE_KEY = "vn_top_stocks"
const MAX_BATCH_SIZE = 10
const WYCKOFF_TIMEFRAME_COUNT = 2

export interface UnifiedWyckoffRunSummary {
  ok: boolean
  runId: string
  requested: number
  completed: Array<{ ticker: string; timeframes: number; dailyProvider: string }>
  errors: Array<{ ticker: string; error: string }>
  generatedAt: string
}

function isoFromSeconds(value: number) {
  return new Date(value * 1000).toISOString()
}

export async function runUnifiedWyckoff({ limit = MAX_BATCH_SIZE, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<UnifiedWyckoffRunSummary> {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")

  const canonical = await getCanonicalUniverse()
  if (!canonical.stocks.length) throw new Error("Canonical market universe returned no stocks")

  const safeLimit = Math.max(1, Math.min(MAX_BATCH_SIZE, limit))
  const safeOffset = Math.max(0, Math.min(canonical.stocks.length - 1, offset))
  const targets = canonical.stocks.slice(safeOffset, safeOffset + safeLimit)
  const runId = randomUUID()
  const startedAt = new Date().toISOString()

  const { error: runError } = await supabase.from("wyckoff_scan_runs").insert({
    id: runId,
    universe_key: WYCKOFF_UNIVERSE_KEY,
    universe_effective_date: canonical.sourceAsOfDate,
    model_version: WYCKOFF_MODEL_VERSION,
    aggregation_version: WYCKOFF_AGGREGATION_VERSION,
    status: "running",
    requested_count: targets.length,
    started_at: startedAt,
  })
  if (runError) throw new Error(`Cannot create Wyckoff run: ${runError.message}`)

  const completed: UnifiedWyckoffRunSummary["completed"] = []
  const errors: UnifiedWyckoffRunSummary["errors"] = []
  for (const stock of targets) {
    try {
      const daily = await fetchLongDailyMarketHistory(stock.ticker, new Date())
      if (!daily?.bars.length) throw new Error("Provider returned no Daily bars")
      const studies = buildWyckoffChartStudies({
        dailyBars: daily.bars,
        dailyProvider: daily.provider,
        dailyDetail: daily.detail,
      })
      const validStudies = studies.filter((study) => study.analysis && study.asOf)
      if (!validStudies.length) throw new Error("No Daily/Weekly timeframe has enough completed history")

      const dailyStudy = validStudies.find((study) => study.timeframe === "1D")
      if (dailyStudy?.asOf) {
        const { error: seriesError } = await supabase
          .from("wyckoff_chart_series")
          .upsert({
            ticker: stock.ticker,
            timeframe: "1D",
            bars: dailyStudy.bars,
            provider: dailyStudy.provider,
            provider_detail: dailyStudy.detail,
            derived: false,
            as_of: isoFromSeconds(dailyStudy.asOf),
            model_version: WYCKOFF_MODEL_VERSION,
            aggregation_version: WYCKOFF_AGGREGATION_VERSION,
            run_id: runId,
            updated_at: new Date().toISOString(),
          }, { onConflict: "ticker,timeframe" })
        if (seriesError) throw new Error(`Series write failed: ${seriesError.message}`)
      }

      const snapshotRows = validStudies.map((study) => ({
        id: randomUUID(),
        run_id: runId,
        ticker: stock.ticker,
        timeframe: study.timeframe,
        bar_closed_at: isoFromSeconds(study.asOf!),
        model_version: WYCKOFF_MODEL_VERSION,
        aggregation_version: WYCKOFF_AGGREGATION_VERSION,
        history_bar_count: study.bars.length,
        history_status: study.bars.length >= 60 ? "complete" : "incomplete",
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
        evidence: {
          provider: study.provider,
          providerDetail: study.detail,
          derived: study.derived,
          barCount: study.bars.length,
        },
        markers: study.markers,
        scenarios: study.scenarios,
      }))
      const { error: snapshotsError } = await supabase
        .from("wyckoff_analysis_snapshots")
        .upsert(snapshotRows, {
          onConflict: "ticker,timeframe,bar_closed_at,model_version,aggregation_version",
          ignoreDuplicates: true,
        })
      if (snapshotsError) throw new Error(`Snapshot write failed: ${snapshotsError.message}`)
      completed.push({ ticker: stock.ticker, timeframes: validStudies.length, dailyProvider: daily.provider })
    } catch (error) {
      errors.push({ ticker: stock.ticker, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const status = errors.length === 0 ? "published" : completed.length ? "partial" : "failed"
  const generatedAt = new Date().toISOString()
  await supabase.from("wyckoff_scan_runs").update({
    status,
    completed_count: completed.length,
    incomplete_count: completed.reduce((sum, item) => sum + (WYCKOFF_TIMEFRAME_COUNT - item.timeframes), 0),
    error_count: errors.length,
    diagnostics: {
      offset: safeOffset,
      limit: safeLimit,
      canonicalUniverseRunId: canonical.runId,
      canonicalUniverseCount: canonical.selectedCount,
      timeframes: ["1D", "1W"],
      errors: errors.slice(0, 10),
    },
    finished_at: generatedAt,
  }).eq("id", runId)

  return { ok: errors.length === 0, runId, requested: targets.length, completed, errors, generatedAt }
}
