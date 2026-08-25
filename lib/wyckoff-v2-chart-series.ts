import type { SupabaseClient } from "@supabase/supabase-js"

import {
  WYCKOFF_V2_AGGREGATION_VERSION,
  WYCKOFF_V2_MODEL_VERSION,
} from "./wyckoff-v2-builder.ts"
import type { OhlcvBar } from "./technical-indicators.ts"

export type WyckoffV2ChartSeriesTimeframe = "1H" | "1D"

export interface WyckoffV2RecentOhlcvRow {
  ticker: string
  timeframe: WyckoffV2ChartSeriesTimeframe
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

export interface WyckoffV2ChartSeriesRow {
  ticker: string
  timeframe: WyckoffV2ChartSeriesTimeframe
  bars: OhlcvBar[]
  provider: string
  provider_detail: string
  derived: false
  as_of: string
  model_version: string
  aggregation_version: string
  run_id: string
  updated_at: string
}

function normalizeTickers(input: string[]) {
  const tickers = [...new Set(input.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  for (const ticker of tickers) {
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid chart-series ticker: ${ticker}`)
  }
  return tickers
}

function toBar(row: WyckoffV2RecentOhlcvRow): OhlcvBar | null {
  const timestamp = new Date(row.bar_time).getTime()
  const open = Number(row.open)
  const high = Number(row.high)
  const low = Number(row.low)
  const close = Number(row.close)
  const volume = Number(row.volume)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  if (![open, high, low, close, volume].every(Number.isFinite)) return null
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return null
  return { time: Math.floor(timestamp / 1000), open, high, low, close, volume }
}

export function assertWyckoffV2ChartSeriesCoverage(
  inputTickers: string[],
  rows: WyckoffV2ChartSeriesRow[],
) {
  const tickers = normalizeTickers(inputTickers)
  const expected = tickers.flatMap((ticker) => [`${ticker}|1H`, `${ticker}|1D`])
  const actual = new Set(rows.map((row) => `${row.ticker}|${row.timeframe}`))
  const missing = expected.filter((key) => !actual.has(key))
  if (rows.length !== expected.length || actual.size !== expected.length || missing.length) {
    throw new Error(`WYCKOFF_CHART_SERIES_INCOMPLETE: expected ${expected.length} unique series; received ${actual.size}; missing=${missing.join(",") || "none"}`)
  }
  for (const row of rows) {
    if (!row.bars.length || row.bars.length > 260) throw new Error(`WYCKOFF_CHART_SERIES_INVALID: ${row.ticker}|${row.timeframe} bars=${row.bars.length}`)
  }
  return { expected: expected.length, actual: actual.size }
}

export function buildWyckoffV2ChartSeriesRows(args: {
  tickers: string[]
  rows: WyckoffV2RecentOhlcvRow[]
  runId: string
  updatedAt?: string
}) {
  const tickers = normalizeTickers(args.tickers)
  const tickerSet = new Set(tickers)
  const updatedAt = args.updatedAt ?? new Date().toISOString()
  const result: WyckoffV2ChartSeriesRow[] = []

  for (const ticker of tickers) {
    for (const timeframe of ["1H", "1D"] as const) {
      const usable = args.rows
        .filter((row) => tickerSet.has(row.ticker) && row.ticker === ticker && row.timeframe === timeframe)
        .map((row) => ({ row, bar: toBar(row) }))
        .filter((item): item is { row: WyckoffV2RecentOhlcvRow; bar: OhlcvBar } => Boolean(item.bar))
        .sort((left, right) => left.bar.time - right.bar.time)
        .slice(-260)
      if (!usable.length) continue
      const latest = usable.at(-1)!
      result.push({
        ticker,
        timeframe,
        bars: usable.map((item) => item.bar),
        provider: latest.row.provider || "Unknown",
        provider_detail: latest.row.provider_detail || "",
        derived: false,
        as_of: latest.row.bar_time,
        model_version: WYCKOFF_V2_MODEL_VERSION,
        aggregation_version: WYCKOFF_V2_AGGREGATION_VERSION,
        run_id: args.runId,
        updated_at: updatedAt,
      })
    }
  }

  return result
}

export async function loadWyckoffV2ChartSeriesRows(
  supabase: SupabaseClient,
  inputTickers: string[],
  runId: string,
) {
  const tickers = normalizeTickers(inputTickers)
  const rows: WyckoffV2RecentOhlcvRow[] = []
  for (let offset = 0; offset < tickers.length; offset += 10) {
    const batch = tickers.slice(offset, offset + 10)
    const { data, error } = await supabase.rpc("qeo_market_ohlcv_recent", {
      p_tickers: batch,
      p_limit: 260,
    })
    if (error) throw new Error(`Load recent OHLCV chart series failed for batch ${offset / 10 + 1}: ${error.message}`)
    rows.push(...((data || []) as WyckoffV2RecentOhlcvRow[]))
  }
  const series = buildWyckoffV2ChartSeriesRows({ tickers, rows, runId })
  assertWyckoffV2ChartSeriesCoverage(tickers, series)
  return series
}
