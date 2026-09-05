import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"
import type { ProviderCoverageRange } from "./provider-coverage"

const UPSERT_CHUNK_SIZE = 500

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

function provenanceCoverageRange(row: Record<string, unknown>): ProviderCoverageRange | null {
  const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
    ? row.detail as Record<string, unknown>
    : {}
  const requestedFrom = finite(detail.requestedFrom)
  const requestedTo = finite(detail.requestedTo)
  const actualFromMs = row.range_start ? new Date(String(row.range_start)).getTime() : NaN
  const actualToMs = row.range_end ? new Date(String(row.range_end)).getTime() : NaN
  const from = requestedFrom ?? (Number.isFinite(actualFromMs) ? Math.floor(actualFromMs / 1000) : null)
  const to = requestedTo ?? (Number.isFinite(actualToMs) ? Math.floor(actualToMs / 1000) : null)
  if (from == null || to == null || to < from) return null
  return { from: Math.floor(from), to: Math.floor(to) }
}

export async function readHotIntradayRange(
  supabase: SupabaseClient,
  ticker: string,
  from: number,
  to: number,
): Promise<CanonicalOhlcvBar[]> {
  const { data, error } = await supabase
    .from("chart_ohlcv_intraday")
    .select("bar_time,open,high,low,close,volume")
    .eq("ticker", ticker)
    .eq("base_resolution", "1m")
    .gte("bar_time", new Date(from * 1000).toISOString())
    .lte("bar_time", new Date(to * 1000).toISOString())
    .order("bar_time", { ascending: true })

  if (error) throw new Error(`Chart hot-store read failed: ${error.message}`)
  return (data || []).map((row) => storedRowToBar(row as Record<string, unknown>)).filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
}

/**
 * Provenance stores the exact request bounds in detail.requestedFrom/To.
 * Reading those bounds lets the service distinguish "we fetched this range"
 * from "we merely have a recent suffix of this range".
 */
export async function readProviderRequestCoverage(
  supabase: SupabaseClient,
  ticker: string,
  from: number,
  to: number,
): Promise<ProviderCoverageRange[]> {
  const { data, error } = await supabase
    .from("chart_ohlcv_provenance_batches")
    .select("range_start,range_end,detail")
    .eq("ticker", ticker)
    .eq("base_resolution", "1m")
    .lte("range_start", new Date(to * 1000).toISOString())
    .gte("range_end", new Date(from * 1000).toISOString())
    .order("range_start", { ascending: true })

  if (error) throw new Error(`Chart provenance coverage read failed: ${error.message}`)
  return (data || [])
    .map((row) => provenanceCoverageRange(row as Record<string, unknown>))
    .filter((range): range is ProviderCoverageRange => Boolean(range))
}

export async function upsertHotIntradayBars(
  supabase: SupabaseClient,
  input: {
    ticker: string
    bars: CanonicalOhlcvBar[]
    provider: string
    fetchedAt?: string
    detail?: Record<string, unknown>
  },
) {
  if (!input.bars.length) return { batchId: null as string | null, rowCount: 0 }
  const sorted = [...input.bars].sort((a, b) => a.time - b.time)
  const fetchedAt = input.fetchedAt ?? new Date().toISOString()
  const { data: batch, error: batchError } = await supabase
    .from("chart_ohlcv_provenance_batches")
    .insert({
      provider: input.provider,
      ticker: input.ticker,
      base_resolution: "1m",
      range_start: new Date(sorted[0].time * 1000).toISOString(),
      range_end: new Date(sorted.at(-1)!.time * 1000).toISOString(),
      row_count: sorted.length,
      fetched_at: fetchedAt,
      detail: input.detail ?? {},
    })
    .select("id")
    .single()
  if (batchError || !batch?.id) throw new Error(`Chart provenance insert failed: ${batchError?.message ?? "missing batch id"}`)

  const rows = sorted.map((bar) => ({
    ticker: input.ticker,
    base_resolution: "1m",
    bar_time: new Date(bar.time * 1000).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    provenance_batch_id: batch.id,
    fetched_at: fetchedAt,
  }))

  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE)
    const { error } = await supabase
      .from("chart_ohlcv_intraday")
      .upsert(chunk, { onConflict: "ticker,base_resolution,bar_time" })
    if (error) throw new Error(`Chart hot-store upsert failed: ${error.message}`)
  }

  return { batchId: String(batch.id), rowCount: rows.length }
}
