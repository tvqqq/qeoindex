import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"

const UPSERT_CHUNK_SIZE = 500
export const DERIVED_HOURLY_AGGREGATION_VERSION = "vn-session-v1"

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function storedRowToBar(row: Record<string, unknown>): CanonicalOhlcvBar | null {
  const timestamp = row.bar_time ? new Date(String(row.bar_time)).getTime() : NaN
  const open = finite(row.open)
  const high = finite(row.high)
  const low = finite(row.low)
  const close = finite(row.close)
  const volume = finite(row.volume)
  if (!Number.isFinite(timestamp) || open == null || high == null || low == null || close == null || volume == null) return null
  return { time: Math.floor(timestamp / 1000), open, high, low, close, volume }
}

export async function readDerivedHourlyRange(
  supabase: SupabaseClient,
  ticker: string,
  from: number,
  to: number,
): Promise<CanonicalOhlcvBar[]> {
  if (to < from) return []
  const { data, error } = await supabase
    .from("chart_ohlcv_derived_hourly")
    .select("bar_time,open,high,low,close,volume")
    .eq("ticker", ticker)
    .eq("resolution", "1h")
    .gte("bar_time", new Date(from * 1000).toISOString())
    .lte("bar_time", new Date(to * 1000).toISOString())
    .order("bar_time", { ascending: true })
  if (error) throw new Error(`Chart derived-hourly read failed: ${error.message}`)
  return (data || []).map((row) => storedRowToBar(row as Record<string, unknown>)).filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
}

export async function upsertDerivedHourlyBars(
  supabase: SupabaseClient,
  input: {
    ticker: string
    bars: CanonicalOhlcvBar[]
    sourceManifestId: string
    sourceSha256: string
    sourceRangeStart: number
    sourceRangeEnd: number
    sourceRawRowCount: number
    generatedAt?: string
  },
) {
  if (!input.bars.length) throw new Error("Cannot persist an empty derived-hourly partition")
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const rows = [...input.bars].sort((a, b) => a.time - b.time).map((bar) => ({
    ticker: input.ticker,
    resolution: "1h",
    bar_time: new Date(bar.time * 1000).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    source_manifest_id: input.sourceManifestId,
    source_sha256: input.sourceSha256,
    source_range_start: new Date(input.sourceRangeStart * 1000).toISOString(),
    source_range_end: new Date(input.sourceRangeEnd * 1000).toISOString(),
    source_raw_row_count: input.sourceRawRowCount,
    aggregation_version: DERIVED_HOURLY_AGGREGATION_VERSION,
    generated_at: generatedAt,
  }))
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const { error } = await supabase.from("chart_ohlcv_derived_hourly").upsert(rows.slice(offset, offset + UPSERT_CHUNK_SIZE), { onConflict: "ticker,resolution,bar_time" })
    if (error) throw new Error(`Chart derived-hourly upsert failed: ${error.message}`)
  }
  return { rowCount: rows.length }
}
