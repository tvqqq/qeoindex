import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"

const UPSERT_CHUNK_SIZE = 500
const MANIFEST_ID_CHUNK_SIZE = 100
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

export async function readDerivedHourlyByManifest(
  supabase: SupabaseClient,
  manifestId: string,
): Promise<CanonicalOhlcvBar[]> {
  const { data, error } = await supabase
    .from("chart_ohlcv_derived_hourly")
    .select("bar_time,open,high,low,close,volume")
    .eq("source_manifest_id", manifestId)
    .eq("resolution", "1h")
    .order("bar_time", { ascending: true })
  if (error) throw new Error(`Chart derived-hourly manifest read failed: ${error.message}`)
  return (data || []).map((row) => storedRowToBar(row as Record<string, unknown>)).filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
}

export async function derivedHourlyColdCoverageComplete(
  supabase: SupabaseClient,
  input: { ticker: string; from: number; to: number },
): Promise<boolean> {
  if (input.to < input.from) return true
  const { data: manifests, error: manifestError } = await supabase
    .from("chart_ohlcv_cold_manifests")
    .select("id")
    .eq("ticker", input.ticker)
    .eq("base_resolution", "1m")
    .not("verified_at", "is", null)
    .lte("range_start", new Date(input.to * 1000).toISOString())
    .gte("range_end", new Date(input.from * 1000).toISOString())
  if (manifestError) throw new Error(`Chart derived-hourly coverage manifest read failed: ${manifestError.message}`)

  const manifestIds = (manifests || []).map((row) => String(row.id || "")).filter(Boolean)
  if (!manifestIds.length) return false

  const covered = new Set<string>()
  for (let offset = 0; offset < manifestIds.length; offset += MANIFEST_ID_CHUNK_SIZE) {
    const ids = manifestIds.slice(offset, offset + MANIFEST_ID_CHUNK_SIZE)
    const { data, error } = await supabase
      .from("chart_ohlcv_derived_hourly")
      .select("source_manifest_id")
      .eq("ticker", input.ticker)
      .eq("resolution", "1h")
      .in("source_manifest_id", ids)
    if (error) throw new Error(`Chart derived-hourly coverage read failed: ${error.message}`)
    for (const row of data || []) covered.add(String(row.source_manifest_id || ""))
  }
  return manifestIds.every((id) => covered.has(id))
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
