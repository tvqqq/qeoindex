import type { SupabaseClient } from "@supabase/supabase-js"

import type { WyckoffListItem } from "@/components/insights/wyckoff-chart-dashboard"
import { getWyckoffCompanyMetadata } from "@/lib/wyckoff-company-metadata"
import type { OhlcvBar } from "@/lib/technical-indicators"
import { buildWyckoffChartStudies, type WyckoffChartTimeframe } from "@/lib/wyckoff-chart-model"
import type { WyckoffScanResult } from "@/lib/wyckoff-engine"

type SnapshotRow = {
  ticker: string
  timeframe: WyckoffChartTimeframe
  bar_closed_at: string
  phase: string
  wyckoff_state: string
  ta_bias: WyckoffScanResult["taBias"]
  confidence: WyckoffScanResult["confidence"]
  bull_probability: number
  base_probability: number
  bear_probability: number
  support: string
  resistance: string
  confirmation: string
  invalidation: string
  what_changed: string
  technical: WyckoffScanResult["technical"]
  published_at: string
}

function toAnalysis(row: SnapshotRow): WyckoffScanResult {
  return {
    technical: row.technical,
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
    tags: [],
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
  const analyses = Object.fromEntries(selectedRows.map((row) => [row.timeframe, toAnalysis(row)])) as Partial<Record<WyckoffChartTimeframe, WyckoffScanResult>>
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
    .order("rank")
  if (membershipsError || !memberships?.length) return null

  const ticker = memberships.some((row) => row.ticker === requestedTicker) ? requestedTicker : memberships[0].ticker
  const tickers = memberships.map((row) => row.ticker)

  const [
    { data: dailyRows, error: dailyError },
    { data: selectedRows, error: selectedError },
    { data: seriesRows, error: seriesError },
    companyMetadata,
  ] = await Promise.all([
    supabase.from("wyckoff_latest_by_timeframe").select("*").eq("timeframe", "1D").in("ticker", tickers),
    supabase.from("wyckoff_latest_by_timeframe").select("*").eq("ticker", ticker),
    supabase.from("wyckoff_chart_series").select("*").eq("ticker", ticker).in("timeframe", ["1H", "1D"]),
    getWyckoffCompanyMetadata(supabase, [ticker]),
  ])
  if (dailyError || selectedError || seriesError || !selectedRows?.length || !seriesRows?.length) return null

  const studies = buildStudies(selectedRows as SnapshotRow[], seriesRows as Array<{ timeframe: WyckoffChartTimeframe; bars: OhlcvBar[]; provider: string; provider_detail: string }>)
  if (!studies) return null

  const dailyByTicker = new Map((dailyRows as SnapshotRow[]).map((row) => [row.ticker, row]))
  const stocks: WyckoffListItem[] = memberships.map((membership) => {
    const row = dailyByTicker.get(membership.ticker)
    return {
      ticker: membership.ticker,
      rank: membership.rank,
      sector: membership.sector || "",
      price: row?.technical.price ?? null,
      changePct: row?.technical.changePct ?? null,
      phase: row?.phase ?? "",
      bias: row?.ta_bias ?? "",
      confidence: row?.confidence ?? "",
      status: row ? "Complete" : "Pending",
      date: row?.bar_closed_at?.slice(0, 10) ?? "",
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

  const { data: latestMembership, error: membershipDateError } = await supabase
    .from("wyckoff_universe_memberships")
    .select("effective_date")
    .eq("universe_key", "hose_top100")
    .eq("active", true)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (membershipDateError || !latestMembership?.effective_date) return null

  const { data: membership, error: membershipError } = await supabase
    .from("wyckoff_universe_memberships")
    .select("ticker")
    .eq("universe_key", "hose_top100")
    .eq("effective_date", latestMembership.effective_date)
    .eq("active", true)
    .eq("ticker", ticker)
    .maybeSingle()
  if (membershipError || !membership?.ticker) return null

  const [
    { data: selectedRows, error: selectedError },
    { data: seriesRows, error: seriesError },
    companyMetadata,
  ] = await Promise.all([
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
