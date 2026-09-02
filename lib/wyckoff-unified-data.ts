import type { SupabaseClient } from "@supabase/supabase-js"

import { getCanonicalUniverse } from "@/lib/market-universe"
import { getWyckoffCompanyMetadata } from "@/lib/wyckoff-company-metadata"
import type { OhlcvBar } from "@/lib/technical-indicators"
import { buildWyckoffChartStudies, type WyckoffChartTimeframe } from "@/lib/wyckoff-chart-model"

interface SnapshotRow {
  ticker: string
  timeframe: WyckoffChartTimeframe
  bar_closed_at: string
  history_status?: string | null
  phase: string | null
  ta_bias: string | null
  confidence: string | null
  technical: Record<string, unknown> | null
  published_at: string
}

interface SeriesRow {
  ticker: string
  timeframe: "1D"
  bars: OhlcvBar[]
  provider: string
  provider_detail: string
}

function buildStudies(seriesRows: SeriesRow[]) {
  const dailySeries = seriesRows.find((row) => row.timeframe === "1D")
  if (!dailySeries?.bars?.length) return null
  return buildWyckoffChartStudies({
    dailyBars: dailySeries.bars,
    dailyProvider: dailySeries.provider,
    dailyDetail: dailySeries.provider_detail,
  })
}

function stockRows(
  memberships: Array<{ ticker: string; rank: number; sector?: string | null }>,
  snapshots: SnapshotRow[],
) {
  const byKey = new Map(snapshots.map((row) => [`${row.ticker}|${row.timeframe}`, row] as const))
  return memberships.map((membership) => {
    const row1D = byKey.get(`${membership.ticker}|1D`)
    const row1W = byKey.get(`${membership.ticker}|1W`)
    const price = typeof row1D?.technical?.price === "number" ? row1D.technical.price : null
    const changePct = typeof row1D?.technical?.changePct === "number" ? row1D.technical.changePct : null
    return {
      ticker: membership.ticker,
      rank: membership.rank,
      sector: membership.sector || "",
      price,
      changePct,
      phase: row1D?.phase ?? "",
      phase1D: row1D?.phase ?? "",
      phase1W: row1W?.phase ?? "",
      bias: row1D?.ta_bias ?? "",
      confidence: row1D?.confidence ?? "",
      status: row1D ? (row1D.history_status === "complete" ? "Complete" : "Incomplete") : "Pending",
      date: row1D?.bar_closed_at?.slice(0, 10) ?? "",
    }
  })
}

async function loadTickerSeries(supabase: SupabaseClient, ticker: string) {
  const { data, error } = await supabase
    .from("wyckoff_chart_series")
    .select("ticker,timeframe,bars,provider,provider_detail")
    .eq("ticker", ticker)
    .eq("timeframe", "1D")
  if (error) return null
  return (data || []) as SeriesRow[]
}

export async function getUnifiedWyckoffData(supabase: SupabaseClient, requestedTicker: string) {
  const canonical = await getCanonicalUniverse()
  const memberships = canonical.stocks.map((stock) => ({
    ticker: stock.ticker,
    rank: stock.rank,
    sector: stock.sector,
  }))
  if (!memberships.length) return null

  const ticker = memberships.some((row) => row.ticker === requestedTicker) ? requestedTicker : memberships[0].ticker
  const tickers = memberships.map((row) => row.ticker)
  const [{ data: watchlistRows, error: watchlistError }, { data: selectedRows, error: selectedError }, seriesRows, companyMetadata] = await Promise.all([
    supabase.from("wyckoff_latest_by_timeframe").select("ticker,timeframe,bar_closed_at,history_status,phase,ta_bias,confidence,technical,published_at").in("timeframe", ["1D", "1W"]).in("ticker", tickers),
    supabase.from("wyckoff_latest_by_timeframe").select("ticker,timeframe,bar_closed_at,history_status,phase,ta_bias,confidence,technical,published_at").eq("ticker", ticker).in("timeframe", ["1D", "1W"]),
    loadTickerSeries(supabase, ticker),
    getWyckoffCompanyMetadata(supabase, [ticker]),
  ])
  if (watchlistError || selectedError || !selectedRows?.length || !seriesRows?.length) return null
  const studies = buildStudies(seriesRows)
  if (!studies) return null
  const selectedMetadata = companyMetadata.get(ticker)
  return {
    ticker,
    companyName: selectedMetadata?.companyName ?? ticker,
    exchange: selectedMetadata?.exchange ?? "HOSE",
    studies,
    stocks: stockRows(memberships, (watchlistRows || []) as SnapshotRow[]),
    generatedAt: String(selectedRows[0].published_at || new Date().toISOString()),
  }
}

export async function getUnifiedWyckoffTickerData(supabase: SupabaseClient, requestedTicker: string) {
  const ticker = requestedTicker.trim().toUpperCase()
  if (!ticker) return null
  const [{ data: selectedRows, error: selectedError }, seriesRows, companyMetadata] = await Promise.all([
    supabase.from("wyckoff_latest_by_timeframe").select("ticker,timeframe,bar_closed_at,history_status,phase,ta_bias,confidence,technical,published_at").eq("ticker", ticker).in("timeframe", ["1D", "1W"]),
    loadTickerSeries(supabase, ticker),
    getWyckoffCompanyMetadata(supabase, [ticker]),
  ])
  if (selectedError || !selectedRows?.length || !seriesRows?.length) return null
  const studies = buildStudies(seriesRows)
  if (!studies) return null
  const selectedMetadata = companyMetadata.get(ticker)
  return {
    ticker,
    companyName: selectedMetadata?.companyName ?? ticker,
    exchange: selectedMetadata?.exchange ?? "HOSE",
    sector: selectedMetadata?.sector,
    studies,
    generatedAt: String(selectedRows[0].published_at || new Date().toISOString()),
  }
}
