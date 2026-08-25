import type { SupabaseClient } from "@supabase/supabase-js"

import type { CachedOhlcvHistory } from "./ohlcv-history-store.ts"
import type { HistoricalProvider, RawHistoryTimeframe } from "./market-history-contract.ts"
import type { OhlcvBar } from "./technical-indicators.ts"

export const DAILY_V2_CACHE_LIMIT = 1700
export const HOURLY_V2_CACHE_LIMIT = 360

export interface StoredV2OhlcvRow {
  ticker: string
  timeframe: RawHistoryTimeframe
  bar_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  provider: string
  provider_detail: string
  source_url: string
  fetched_at: string
}

function provider(value: string): HistoricalProvider {
  return value === "DNSE" ? "DNSE" : "Fallback"
}

function validBar(row: StoredV2OhlcvRow): OhlcvBar | null {
  const timestamp = new Date(row.bar_time).getTime()
  const values = [row.open, row.high, row.low, row.close, row.volume].map(Number)
  if (!Number.isFinite(timestamp) || timestamp <= 0 || values.some((value) => !Number.isFinite(value))) return null
  const [open, high, low, close, volume] = values
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return null
  return { time: Math.floor(timestamp / 1000), open, high, low, close, volume }
}

export function cachedHistoryFromRows(
  ticker: string,
  timeframe: RawHistoryTimeframe,
  inputRows: StoredV2OhlcvRow[],
): CachedOhlcvHistory {
  const rows = inputRows
    .filter((row) => row.ticker === ticker && row.timeframe === timeframe)
    .slice()
    .sort((a, b) => new Date(a.bar_time).getTime() - new Date(b.bar_time).getTime())
  const usable = rows
    .map((row) => ({ row, bar: validBar(row) }))
    .filter((item): item is { row: StoredV2OhlcvRow; bar: OhlcvBar } => Boolean(item.bar))
  if (!usable.length) throw new Error(`OHLCV cache has no usable ${timeframe} bars for ${ticker}`)
  const latest = usable.at(-1)!
  return {
    ticker,
    timeframe,
    bars: usable.map((item) => item.bar),
    provider: provider(latest.row.provider),
    detail: latest.row.provider_detail,
    sourceUrl: latest.row.source_url,
    fetchedAt: latest.row.fetched_at,
    firstBarAt: usable[0].row.bar_time,
    lastBarAt: latest.row.bar_time,
  }
}

async function loadRows(
  supabase: SupabaseClient,
  ticker: string,
  timeframe: RawHistoryTimeframe,
  limit: number,
) {
  const { data, error } = await supabase
    .from("market_ohlcv_history")
    .select("ticker,timeframe,bar_time,open,high,low,close,volume,provider,provider_detail,source_url,fetched_at")
    .eq("ticker", ticker)
    .eq("timeframe", timeframe)
    .order("bar_time", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`OHLCV cache read failed for ${ticker} ${timeframe}: ${error.message}`)
  return (data || []) as StoredV2OhlcvRow[]
}

export async function loadWyckoffV2CachedTickerHistory(supabase: SupabaseClient, tickerInput: string) {
  const ticker = tickerInput.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid ticker: ${tickerInput}`)
  const [dailyRows, hourlyRows] = await Promise.all([
    loadRows(supabase, ticker, "1D", DAILY_V2_CACHE_LIMIT),
    loadRows(supabase, ticker, "1H", HOURLY_V2_CACHE_LIMIT),
  ])
  return {
    daily: cachedHistoryFromRows(ticker, "1D", dailyRows),
    hourly: cachedHistoryFromRows(ticker, "1H", hourlyRows),
  }
}
