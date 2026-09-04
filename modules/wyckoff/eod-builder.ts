import type { CachedOhlcvHistory } from "../market/history/ohlcv-store.ts"
import { aggregateWeekly, type OhlcvBar, type TechnicalSnapshot } from "../../lib/technical-indicators.ts"
import {
  buildWyckoffChartStudies,
  type WyckoffEventMarker,
  type WyckoffScenario,
  type WyckoffChartTimeframe,
} from "./chart-model.ts"
import type { WyckoffScanResult } from "./engine.ts"
import type { WyckoffV2UniverseRow } from "./eod-universe.ts"

export const WYCKOFF_V2_PROMPT_VERSION = "notion-unified-v2"
export const WYCKOFF_V2_MODEL_VERSION = "qeo-wyckoff-rule-v1"
export const WYCKOFF_V2_AGGREGATION_VERSION = "vn-session-v1"
export const WYCKOFF_V2_MIN_BARS = 60

export interface WyckoffV2Evidence {
  provider: string
  providerDetail: string
  sourceUrl: string
  fetchedAt: string
  firstBarAt: string
  lastBarAt: string
  completedBars: number
  derived: boolean
  rulesTriggered: string[]
  missingReason: string
}

export interface WyckoffV2Snapshot {
  snapshot: string
  snapshotKey: string
  runKey: string
  ticker: string
  rank: number | null
  exchange: string
  sector: string
  timeframe: WyckoffChartTimeframe
  barClosedAt: string | null
  historyBarCount: number
  historyStatus: "Complete" | "Incomplete"
  provider: string
  providerDetail: string
  sourceUrl: string
  fetchedAt: string
  modelVersion: string
  aggregationVersion: string
  promptVersion: string
  phase: string | null
  wyckoffState: string | null
  taBias: "Bullish" | "Neutral" | "Bearish" | "Mixed" | null
  confidence: "HIGH" | "MEDIUM" | "LOW" | null
  bullProbability: number | null
  baseProbability: number | null
  bearProbability: number | null
  support: string | null
  resistance: string | null
  confirmation: string | null
  invalidation: string | null
  whatChanged: string | null
  technical: Partial<TechnicalSnapshot>
  evidence: WyckoffV2Evidence
  markers: WyckoffEventMarker[]
  scenarios: WyckoffScenario[]
  validationStatus: "Valid"
  validationError: string
}

function horizonFor(timeframe: WyckoffChartTimeframe) {
  return timeframe === "1D" ? "week" as const : "month" as const
}

function isoFromSeconds(value: number) {
  return new Date(value * 1000).toISOString()
}

function normalizeRules(analysis: WyckoffScanResult, markers: WyckoffEventMarker[]) {
  return [...new Set([...analysis.tags, ...markers.map((marker) => marker.label)])].slice(0, 24)
}

function normalizeScenarios(scenarios: WyckoffScenario[], analysis: WyckoffScanResult, timeframe: WyckoffChartTimeframe): WyckoffScenario[] {
  const horizon = horizonFor(timeframe)
  const evidence = [
    `Phase=${analysis.phase}`,
    `TA Bias=${analysis.taBias}`,
    `Price=${analysis.technical.price.toFixed(2)}`,
    `Relative Volume=${analysis.technical.relVolume == null ? "n/a" : analysis.technical.relVolume.toFixed(2)}`,
    ...analysis.tags,
  ].slice(0, 8)
  return scenarios.map((scenario) => {
    let trigger = scenario.trigger
    let confirmation = scenario.confirmation
    let invalidation = scenario.invalidation
    if (!trigger && scenario.key === "bull") trigger = `Giá Hold trên Support ${analysis.support} và Breakout/Reclaim Resistance ${analysis.resistance}.`
    if (!trigger && scenario.key === "base") trigger = `Giá tiếp tục dao động giữa Support ${analysis.support} và Resistance ${analysis.resistance} mà chưa có Follow-through.`
    if (!trigger && scenario.key === "bear") trigger = `Giá Breakdown dưới Support ${analysis.support} và không Reclaim được vùng vừa mất.`
    if (!confirmation && scenario.key === "bull") confirmation = analysis.confirmation
    if (!confirmation && scenario.key === "base") confirmation = "Biên độ và Volume tiếp tục co lại trong Trading Range; chưa xuất hiện Breakout/Breakdown có Hold."
    if (!confirmation && scenario.key === "bear") confirmation = analysis.confirmation
    if (!invalidation && scenario.key === "bull") invalidation = `Acceptance dưới Support ${analysis.support} làm suy yếu Bull case.`
    if (!invalidation && scenario.key === "base") invalidation = "Breakout hoặc Breakdown có Hold, Retest và Follow-through làm Base case không còn là kịch bản ít giả định nhất."
    if (!invalidation && scenario.key === "bear") invalidation = `Acceptance trên Resistance ${analysis.resistance} làm suy yếu Bear case.`
    return { ...scenario, horizon, trigger, confirmation, invalidation, evidence: scenario.evidence?.length ? scenario.evidence : evidence }
  })
}

function barsFor(timeframe: WyckoffChartTimeframe, daily: OhlcvBar[]) {
  return timeframe === "1D" ? daily : aggregateWeekly(daily)
}

export function buildWyckoffV2TickerSnapshots(args: {
  stock: WyckoffV2UniverseRow
  daily: CachedOhlcvHistory
  hourly?: CachedOhlcvHistory
  runKey: string
  scanDate: string
}): WyckoffV2Snapshot[] {
  if (args.daily.ticker !== args.stock.ticker) throw new Error(`WYCKOFF_BUILD_CACHE_MISMATCH: ${args.stock.ticker}`)
  if (!args.daily.bars.length) throw new Error(`WYCKOFF_BUILD_CACHE_EMPTY: ${args.stock.ticker}`)

  const studies = buildWyckoffChartStudies({
    dailyBars: args.daily.bars,
    dailyProvider: args.daily.provider,
    dailyDetail: args.daily.detail,
  })

  return studies.map((study): WyckoffV2Snapshot => {
    const bars = barsFor(study.timeframe, args.daily.bars)
    const historyBarCount = bars.length
    const historyStatus = historyBarCount >= WYCKOFF_V2_MIN_BARS ? "Complete" : "Incomplete"
    const firstBarAt = bars[0] ? isoFromSeconds(bars[0].time) : args.daily.firstBarAt ?? ""
    const lastBarAt = bars.at(-1) ? isoFromSeconds(bars.at(-1)!.time) : args.daily.lastBarAt ?? ""
    const missingReason = historyStatus === "Incomplete"
      ? `Only ${historyBarCount} completed bars; minimum ${WYCKOFF_V2_MIN_BARS} completed bars required for ${study.timeframe}.`
      : ""
    if (historyStatus === "Complete" && !study.analysis) {
      throw new Error(`WYCKOFF_BUILD_ANALYSIS_FAILED: ${args.stock.ticker} ${study.timeframe}: ${study.error || "analysis unavailable"}`)
    }
    const analysis = historyStatus === "Complete" ? study.analysis! : null
    const markers = analysis ? study.markers.slice(0, 24) : []
    const scenarios = analysis ? normalizeScenarios(study.scenarios, analysis, study.timeframe) : []
    if (analysis) {
      const probabilitySum = analysis.bullProbability + analysis.baseProbability + analysis.bearProbability
      if (probabilitySum !== 100 || scenarios.length !== 3) throw new Error(`WYCKOFF_BUILD_SCENARIO_INVALID: ${args.stock.ticker} ${study.timeframe}`)
    }
    const snapshotKey = `${args.runKey}|${args.stock.ticker}|${study.timeframe}`
    return {
      snapshot: `${args.stock.ticker} · ${study.timeframe} · ${args.scanDate}`,
      snapshotKey,
      runKey: args.runKey,
      ticker: args.stock.ticker,
      rank: args.stock.rank,
      exchange: args.stock.exchange,
      sector: args.stock.sector,
      timeframe: study.timeframe,
      barClosedAt: bars.at(-1) ? isoFromSeconds(bars.at(-1)!.time) : null,
      historyBarCount,
      historyStatus,
      provider: args.daily.provider,
      providerDetail: study.detail,
      sourceUrl: args.daily.sourceUrl,
      fetchedAt: args.daily.fetchedAt,
      modelVersion: WYCKOFF_V2_MODEL_VERSION,
      aggregationVersion: WYCKOFF_V2_AGGREGATION_VERSION,
      promptVersion: WYCKOFF_V2_PROMPT_VERSION,
      phase: analysis?.phase ?? null,
      wyckoffState: analysis?.wyckoffState ?? null,
      taBias: analysis?.taBias ?? null,
      confidence: analysis?.confidence ?? null,
      bullProbability: analysis?.bullProbability ?? null,
      baseProbability: analysis?.baseProbability ?? null,
      bearProbability: analysis?.bearProbability ?? null,
      support: analysis?.support ?? null,
      resistance: analysis?.resistance ?? null,
      confirmation: analysis?.confirmation ?? null,
      invalidation: analysis?.invalidation ?? null,
      whatChanged: analysis?.whatChanged ?? null,
      technical: analysis?.technical ?? {},
      evidence: {
        provider: args.daily.provider,
        providerDetail: study.detail,
        sourceUrl: args.daily.sourceUrl,
        fetchedAt: args.daily.fetchedAt,
        firstBarAt,
        lastBarAt,
        completedBars: historyBarCount,
        derived: study.derived,
        rulesTriggered: analysis ? normalizeRules(analysis, markers) : [],
        missingReason,
      },
      markers,
      scenarios,
      validationStatus: "Valid",
      validationError: "",
    }
  })
}
