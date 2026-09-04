import type { SupabaseClient } from "@supabase/supabase-js"

import type { CachedOhlcvHistory } from "../market/history/ohlcv-store.ts"
import {
  decodeGroupedDailyOhlcvResponse,
  type GroupedDailyOhlcvRow,
} from "../market/history/ohlcv-grouped.ts"
import type { HistoricalProvider } from "../market/history/contract.ts"
import type { OhlcvBar } from "../shared/technical/indicators.ts"

export const DAILY_V2_CACHE_LIMIT = 1700
export const V2_CACHE_BATCH_SIZE = 5

export type StoredV2OhlcvRow = GroupedDailyOhlcvRow

export interface WyckoffV2CachedHistory {
  daily: CachedOhlcvHistory
  hourly: CachedOhlcvHistory
}

export interface WyckoffV2PartialCacheResult {
  histories: Map<string, WyckoffV2CachedHistory>
  errors: Array<{ ticker: string; error: string }>
}

function normalizeTickers(input: string[]) {
  const tickers = [...new Set(input.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  if (!tickers.length) throw new Error("OHLCV cache read requires at least one ticker")
  for (const ticker of tickers) {
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid ticker: ${ticker}`)
  }
  return tickers
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

export function cachedHistoryFromRows(ticker: string, inputRows: StoredV2OhlcvRow[]): CachedOhlcvHistory {
  const rows = inputRows
    .filter((row) => row.ticker === ticker && row.timeframe === "1D")
    .slice()
    .sort((a, b) => new Date(a.bar_time).getTime() - new Date(b.bar_time).getTime())
  const usable = rows
    .map((row) => ({ row, bar: validBar(row) }))
    .filter((item): item is { row: StoredV2OhlcvRow; bar: OhlcvBar } => Boolean(item.bar))
  if (!usable.length) throw new Error(`OHLCV cache has no usable Daily bars for ${ticker}`)
  const latest = usable.at(-1)!
  return {
    ticker,
    timeframe: "1D",
    bars: usable.map((item) => item.bar),
    provider: provider(latest.row.provider),
    detail: latest.row.provider_detail,
    sourceUrl: latest.row.source_url,
    fetchedAt: latest.row.fetched_at,
    firstBarAt: usable[0].row.bar_time,
    lastBarAt: latest.row.bar_time,
  }
}

export async function loadWyckoffV2CachedHistoriesPartial(
  supabase: SupabaseClient,
  inputTickers: string[],
): Promise<WyckoffV2PartialCacheResult> {
  const tickers = normalizeTickers(inputTickers)
  const histories = new Map<string, WyckoffV2CachedHistory>()
  const errors: Array<{ ticker: string; error: string }> = []

  for (let offset = 0; offset < tickers.length; offset += V2_CACHE_BATCH_SIZE) {
    const batch = tickers.slice(offset, offset + V2_CACHE_BATCH_SIZE)
    const { data, error } = await supabase.rpc("qeo_market_ohlcv_recent_grouped", {
      p_tickers: batch,
      p_limit: DAILY_V2_CACHE_LIMIT,
    })
    if (error) throw new Error(`OHLCV cache batch read failed for ${batch.join(",")}: ${error.message}`)

    const grouped = decodeGroupedDailyOhlcvResponse(data, batch)
    for (const ticker of batch) {
      try {
        const rows = grouped.get(ticker) || []
        if (!rows.length) throw new Error(`OHLCV cache batch missing Daily history for ${ticker}`)
        const daily = cachedHistoryFromRows(ticker, rows)
        histories.set(ticker, {
          daily,
          // Compatibility alias for legacy modules during the cutover. It points to Daily data and is never persisted as intraday history.
          hourly: daily,
        })
      } catch (tickerError) {
        errors.push({ ticker, error: tickerError instanceof Error ? tickerError.message : String(tickerError) })
      }
    }
  }

  return { histories, errors }
}

export async function loadWyckoffV2CachedHistories(
  supabase: SupabaseClient,
  inputTickers: string[],
): Promise<Map<string, WyckoffV2CachedHistory>> {
  const tickers = normalizeTickers(inputTickers)
  const result = await loadWyckoffV2CachedHistoriesPartial(supabase, tickers)
  if (result.errors.length || result.histories.size !== tickers.length) {
    const missing = tickers.filter((ticker) => !result.histories.has(ticker))
    throw new Error(
      `OHLCV cache batch incomplete: missing=${missing.join(",") || "unknown"}`
      + `${result.errors.length ? `; errors=${result.errors.slice(0, 5).map((item) => `${item.ticker}: ${item.error}`).join(" | ")}` : ""}`,
    )
  }
  return result.histories
}

export async function loadWyckoffV2CachedTickerHistory(supabase: SupabaseClient, tickerInput: string) {
  const ticker = normalizeTickers([tickerInput])[0]
  const histories = await loadWyckoffV2CachedHistories(supabase, [ticker])
  return histories.get(ticker)!
}
