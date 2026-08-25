import type { SupabaseClient } from "@supabase/supabase-js"

import { getWyckoffCompanyMetadata } from "@/lib/wyckoff-company-metadata"
import type { OhlcvBar, TechnicalSnapshot } from "@/lib/technical-indicators"
import {
  buildWyckoffChartStudies,
  type WyckoffChartTimeframe,
  type WyckoffEventLabel,
  type WyckoffEventMarker,
  type WyckoffScenario,
  type WyckoffScenarioHorizon,
} from "@/lib/wyckoff-chart-model"
import type { WyckoffScanResult } from "@/lib/wyckoff-engine"

type SnapshotEvidence = {
  rulesTriggered?: unknown
  missingReason?: unknown
  [key: string]: unknown
}

type SnapshotRow = {
  ticker: string
  timeframe: WyckoffChartTimeframe
  bar_closed_at: string
  history_status: "complete" | "incomplete"
  phase: string | null
  wyckoff_state: string | null
  ta_bias: WyckoffScanResult["taBias"] | null
  confidence: WyckoffScanResult["confidence"] | null
  bull_probability: number | null
  base_probability: number | null
  bear_probability: number | null
  support: string | null
  resistance: string | null
  confirmation: string | null
  invalidation: string | null
  what_changed: string | null
  technical: Partial<TechnicalSnapshot>
  evidence?: SnapshotEvidence | null
  markers?: unknown
  scenarios?: unknown
  published_at: string
}

const EVENT_LABELS = new Set<WyckoffEventLabel>(["SPR", "UT", "SOS", "SOW", "TEST", "LPS", "LPSY"])
const SCENARIO_HORIZONS = new Set<WyckoffScenarioHorizon>(["intraday", "swing", "week", "month", "long_term"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : null
}

function timestampSeconds(value: unknown) {
  const numeric = finiteNumber(value)
  if (numeric != null && numeric > 0) return numeric > 10_000_000_000 ? Math.round(numeric / 1000) : Math.round(numeric)
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : null
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
}

function horizonForTimeframe(timeframe: WyckoffChartTimeframe): WyckoffScenarioHorizon {
  if (timeframe === "1H") return "intraday"
  if (timeframe === "4H") return "swing"
  if (timeframe === "1D") return "week"
  if (timeframe === "1W") return "month"
  return "long_term"
}

function scenarioColor(key: WyckoffScenario["key"]) {
  if (key === "bull") return "#22c98a"
  if (key === "bear") return "#ff4757"
  return "#a7b0bd"
}

function normalizeMarker(value: unknown): WyckoffEventMarker | null {
  if (!isRecord(value)) return null
  const time = timestampSeconds(value.time)
  const label = typeof value.label === "string" ? value.label.trim().toUpperCase() as WyckoffEventLabel : null
  const tone = value.tone === "bullish" || value.tone === "bearish" || value.tone === "neutral" ? value.tone : "neutral"
  if (time == null || !label || !EVENT_LABELS.has(label)) return null
  return {
    time,
    label,
    tone,
    detail: typeof value.detail === "string" ? value.detail.trim() : "",
  }
}

function normalizeScenario(value: unknown, timeframe: WyckoffChartTimeframe): WyckoffScenario | null {
  if (!isRecord(value)) return null
  const key = value.key === "bull" || value.key === "base" || value.key === "bear" ? value.key : null
  const probability = finiteNumber(value.probability)
  const target = finiteNumber(value.target)
  if (!key || probability == null || probability < 0 || probability > 100 || target == null || target <= 0) return null
  const path = Array.isArray(value.path) ? value.path.flatMap((point) => {
    if (!isRecord(point)) return []
    const time = timestampSeconds(point.time)
    const pointValue = finiteNumber(point.value)
    return time != null && pointValue != null && pointValue > 0 ? [{ time, value: pointValue }] : []
  }) : []
  if (!path.length) return null
  const horizon = typeof value.horizon === "string" && SCENARIO_HORIZONS.has(value.horizon as WyckoffScenarioHorizon)
    ? value.horizon as WyckoffScenarioHorizon
    : horizonForTimeframe(timeframe)
  const defaultLabel = key === "bull" ? "Cầu thắng" : key === "bear" ? "Cung áp đảo" : "Kịch bản cơ sở"
  return {
    key,
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : defaultLabel,
    probability: Math.round(probability),
    color: scenarioColor(key),
    target,
    description: typeof value.description === "string" ? value.description.trim() : "",
    path,
    horizon,
    trigger: typeof value.trigger === "string" ? value.trigger.trim() : undefined,
    confirmation: typeof value.confirmation === "string" ? value.confirmation.trim() : undefined,
    invalidation: typeof value.invalidation === "string" ? value.invalidation.trim() : undefined,
    evidence: strings(value.evidence),
  }
}

function toAnalysis(row: SnapshotRow): WyckoffScanResult | null {
  if (
    row.history_status !== "complete"
    || !row.phase
    || !row.wyckoff_state
    || !row.ta_bias
    || !row.confidence
    || row.bull_probability == null
    || row.base_probability == null
    || row.bear_probability == null
    || !row.support
    || !row.resistance
    || !row.confirmation
    || !row.invalidation
    || !row.what_changed
    || typeof row.technical.price !== "number"
  ) return null
  return {
    technical: row.technical as TechnicalSnapshot,
    wyckoffState: row.wyckoff_state,
    phase: row.phase,
    taBias: row.ta_bias,
    confidence: row.confidence,
    bullProbability: row.bull_probability,
    baseProbability: row.base_probability,
    bearProbability: row.bear_probability,
    support: row.support,
    resistance: row.resistance,
    confirmation: row.confirmation,
    invalidation: row.invalidation,
    whatChanged: row.what_changed,
    tags: strings(row.evidence?.rulesTriggered),
  }
}

function buildStudies(
  selectedRows: SnapshotRow[],
  seriesRows: Array<{
    timeframe: WyckoffChartTimeframe
    bars: OhlcvBar[]
    provider: string
    provider_detail: string
  }>,
) {
  const completeRows = selectedRows.flatMap((row) => {
    const analysis = toAnalysis(row)
    return analysis ? [{ row, analysis }] : []
  })
  const analyses = Object.fromEntries(completeRows.map(({ row, analysis }) => [row.timeframe, analysis])) as Partial<Record<WyckoffChartTimeframe, WyckoffScanResult>>
  const markerOverrides = Object.fromEntries(completeRows.map(({ row }) => [
    row.timeframe,
    Array.isArray(row.markers) ? row.markers.map(normalizeMarker).filter((marker): marker is WyckoffEventMarker => marker !== null) : [],
  ])) as Partial<Record<WyckoffChartTimeframe, WyckoffEventMarker[]>>
  const scenarioOverrides = Object.fromEntries(completeRows.map(({ row }) => [
    row.timeframe,
    Array.isArray(row.scenarios) ? row.scenarios.map((scenario) => normalizeScenario(scenario, row.timeframe)).filter((scenario): scenario is WyckoffScenario => scenario !== null) : [],
  ])) as Partial<Record<WyckoffChartTimeframe, WyckoffScenario[]>>
  const dailySeries = seriesRows.find((row) => row.timeframe === "1D")
  const hourlySeries = seriesRows.find((row) => row.timeframe === "1H")
  if (!dailySeries || !hourlySeries) return null

  return buildWyckoffChartStudies({
    dailyBars: dailySeries.bars,
    hourlyBars: hourlySeries.bars,
    dailyProvider: dailySeries.provider,
    dailyDetail: dailySeries.provider_detail,
    hourlyProvider: hourlySeries.provider,
    hourlyDetail: hourlySeries.provider_detail,
    analysisOverrides: analyses,
    markerOverrides,
    scenarioOverrides,
  })
}

export async function getUnifiedWyckoffData(supabase: SupabaseClient, requestedTicker: string) {
  const { data: latestMembership, error: membershipDateError } = await supabase
    .from("wyckoff_universe_memberships")
    .select("effective_date")
    .eq("universe_key", "hose_top100")
    .eq("active", true)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (membershipDateError || !latestMembership?.effective_date) return null

  const { data: memberships, error: membershipsError } = await supabase
    .from("wyckoff_universe_memberships")
    .select("ticker,rank,sector")
    .eq("universe_key", "hose_top100")
    .eq("effective_date", latestMembership.effective_date)
    .eq("active", true)
    .order("rank", { ascending: true, nullsFirst: false })
    .order("ticker", { ascending: true })
  if (membershipsError || !memberships?.length) return null

  const ticker = memberships.some((row) => row.ticker === requestedTicker) ? requestedTicker : memberships[0].ticker
  const tickers = memberships.map((row) => row.ticker)

  const [
    { data: watchlistRows, error: watchlistError },
    { data: selectedRows, error: selectedError },
    { data: seriesRows, error: seriesError },
    companyMetadata,
  ] = await Promise.all([
    supabase.from("wyckoff_latest_by_timeframe").select("*").in("timeframe", ["1H", "1D", "1W"]).in("ticker", tickers),
    supabase.from("wyckoff_latest_by_timeframe").select("*").eq("ticker", ticker),
    supabase.from("wyckoff_chart_series").select("*").eq("ticker", ticker).in("timeframe", ["1H", "1D"]),
    getWyckoffCompanyMetadata(supabase, [ticker]),
  ])
  if (watchlistError || selectedError || seriesError || !selectedRows?.length || !seriesRows?.length) return null

  const studies = buildStudies(selectedRows as SnapshotRow[], seriesRows as Array<{ timeframe: WyckoffChartTimeframe; bars: OhlcvBar[]; provider: string; provider_detail: string }>)
  if (!studies) return null

  const snapshotByTickerTimeframe = new Map(
    (watchlistRows as SnapshotRow[]).map((row) => [`${row.ticker}|${row.timeframe}`, row] as const),
  )
  const stocks = memberships.map((membership) => {
    const row1H = snapshotByTickerTimeframe.get(`${membership.ticker}|1H`)
    const row1D = snapshotByTickerTimeframe.get(`${membership.ticker}|1D`)
    const row1W = snapshotByTickerTimeframe.get(`${membership.ticker}|1W`)
    return {
      ticker: membership.ticker,
      rank: membership.rank,
      sector: membership.sector || "",
      price: typeof row1D?.technical?.price === "number" ? row1D.technical.price : null,
      changePct: typeof row1D?.technical?.changePct === "number" ? row1D.technical.changePct : null,
      phase: row1D?.phase ?? "",
      phase1H: row1H?.phase ?? "",
      phase1D: row1D?.phase ?? "",
      phase1W: row1W?.phase ?? "",
      bias: row1D?.ta_bias ?? "",
      confidence: row1D?.confidence ?? "",
      status: row1D ? (row1D.history_status === "complete" ? "Complete" : "Incomplete") : "Pending",
      date: row1D?.bar_closed_at?.slice(0, 10) ?? "",
    }
  })

  const selectedMetadata = companyMetadata.get(ticker)
  return {
    ticker,
    companyName: selectedMetadata?.companyName ?? ticker,
    exchange: selectedMetadata?.exchange ?? "HOSE",
    studies,
    stocks,
    generatedAt: selectedRows[0].published_at as string,
  }
}

export async function getUnifiedWyckoffTickerData(supabase: SupabaseClient, requestedTicker: string) {
  const ticker = requestedTicker.trim().toUpperCase()
  if (!ticker) return null

  const [{ data: selectedRows, error: selectedError }, { data: seriesRows, error: seriesError }, companyMetadata] = await Promise.all([
    supabase.from("wyckoff_latest_by_timeframe").select("*").eq("ticker", ticker),
    supabase.from("wyckoff_chart_series").select("*").eq("ticker", ticker).in("timeframe", ["1H", "1D"]),
    getWyckoffCompanyMetadata(supabase, [ticker]),
  ])
  if (selectedError || seriesError || !selectedRows?.length || !seriesRows?.length) return null
  const studies = buildStudies(selectedRows as SnapshotRow[], seriesRows as Array<{ timeframe: WyckoffChartTimeframe; bars: OhlcvBar[]; provider: string; provider_detail: string }>)
  if (!studies) return null
  const selectedMetadata = companyMetadata.get(ticker)
  return {
    ticker,
    companyName: selectedMetadata?.companyName ?? ticker,
    exchange: selectedMetadata?.exchange ?? "HOSE",
    studies,
    generatedAt: selectedRows[0].published_at as string,
  }
}
