import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"
import type { ProviderCoverageRange } from "./provider-coverage"

const UPSERT_CHUNK_SIZE = 500
const ARCHIVE_DISCOVERY_ROWS_PER_PARTITION = 300
const ARCHIVE_DISCOVERY_MAX_ROWS = 10_000

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
  if ((finite(row.row_count) ?? 0) <= 0) return null
  const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? row.detail as Record<string, unknown> : {}
  const requestedFrom = finite(detail.requestedFrom)
  const requestedTo = finite(detail.requestedTo)
  const actualFromMs = row.range_start ? new Date(String(row.range_start)).getTime() : NaN
  const actualToMs = row.range_end ? new Date(String(row.range_end)).getTime() : NaN
  const from = requestedFrom ?? (Number.isFinite(actualFromMs) ? Math.floor(actualFromMs / 1000) : null)
  const to = requestedTo ?? (Number.isFinite(actualToMs) ? Math.floor(actualToMs / 1000) : null)
  if (from == null || to == null || to < from) return null
  return { from: Math.floor(from), to: Math.floor(to) }
}

function vietnamDateKey(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochSeconds * 1000))
}

export interface HotArchivePartition {
  ticker: string
  tradingDate: string
  from: number
  toExclusive: number
}

export interface ChartProviderAttemptInput {
  ticker: string
  provider: string
  requestedFrom: number
  requestedTo: number
  bars?: CanonicalOhlcvBar[]
  fetchedAt?: string
  detail?: Record<string, unknown>
}

export interface Qeo107TerminalAttemptRange extends ProviderCoverageRange {
  outcome: "success" | "provider_gap"
}

function partitionFor(ticker: string, epochSeconds: number): HotArchivePartition {
  const tradingDate = vietnamDateKey(epochSeconds)
  const from = Math.floor(new Date(`${tradingDate}T00:00:00+07:00`).getTime() / 1000)
  return { ticker, tradingDate, from, toExclusive: from + 86400 }
}

export async function readHotIntradayRange(supabase: SupabaseClient, ticker: string, from: number, to: number): Promise<CanonicalOhlcvBar[]> {
  const { data, error } = await supabase.from("chart_ohlcv_intraday").select("bar_time,open,high,low,close,volume")
    .eq("ticker", ticker).eq("base_resolution", "1m")
    .gte("bar_time", new Date(from * 1000).toISOString()).lte("bar_time", new Date(to * 1000).toISOString())
    .order("bar_time", { ascending: true })
  if (error) throw new Error(`Chart hot-store read failed: ${error.message}`)
  return (data || []).map((row) => storedRowToBar(row as Record<string, unknown>)).filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
}

export async function listExpiredHotPartitions(supabase: SupabaseClient, input: { cutoff: number; maxPartitions?: number }): Promise<HotArchivePartition[]> {
  const maxPartitions = Math.max(1, Math.min(48, Math.floor(input.maxPartitions ?? 12)))
  const discoveryLimit = Math.min(ARCHIVE_DISCOVERY_MAX_ROWS, Math.max(1_000, maxPartitions * ARCHIVE_DISCOVERY_ROWS_PER_PARTITION))
  const { data, error } = await supabase.from("chart_ohlcv_intraday").select("ticker,bar_time")
    .eq("base_resolution", "1m").lt("bar_time", new Date(input.cutoff * 1000).toISOString())
    .order("bar_time", { ascending: true }).limit(discoveryLimit)
  if (error) throw new Error(`Chart hot archive discovery failed: ${error.message}`)
  const unique = new Map<string, HotArchivePartition>()
  for (const raw of (data || []) as Array<Record<string, unknown>>) {
    const ticker = String(raw.ticker || "").trim().toUpperCase()
    const timestamp = raw.bar_time ? new Date(String(raw.bar_time)).getTime() : NaN
    if (!ticker || !Number.isFinite(timestamp)) continue
    const partition = partitionFor(ticker, Math.floor(timestamp / 1000))
    const key = `${ticker}:${partition.tradingDate}`
    if (!unique.has(key)) unique.set(key, partition)
    if (unique.size >= maxPartitions) break
  }
  return [...unique.values()]
}

export async function pruneVerifiedHotIntradayPartition(
  supabase: SupabaseClient,
  input: { manifestId: string; sha256: string; rowCount: number },
): Promise<number> {
  const { data, error } = await supabase.rpc("qeo_prune_verified_chart_intraday_partition", {
    p_manifest_id: input.manifestId,
    p_expected_sha256: input.sha256,
    p_expected_row_count: input.rowCount,
  })
  if (error) throw new Error(`Chart hot archive prune RPC failed: ${error.message}`)
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const deletedRows = finite(raw.deletedRows)
  if (deletedRows == null || deletedRows !== input.rowCount) throw new Error(`Chart hot archive prune RPC returned invalid deletedRows=${String(raw.deletedRows)}`)
  return deletedRows
}

export async function readOldestHotIntradayTime(supabase: SupabaseClient): Promise<number | null> {
  const { data, error } = await supabase.from("chart_ohlcv_intraday").select("bar_time").eq("base_resolution", "1m").order("bar_time", { ascending: true }).limit(1)
  if (error) throw new Error(`Chart oldest hot bar read failed: ${error.message}`)
  const value = (data || [])[0]?.bar_time
  const timestamp = value ? new Date(String(value)).getTime() : NaN
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

export async function readProviderRequestCoverage(supabase: SupabaseClient, ticker: string, from: number, to: number): Promise<ProviderCoverageRange[]> {
  const { data, error } = await supabase.from("chart_ohlcv_provenance_batches").select("row_count,range_start,range_end,detail")
    .eq("ticker", ticker).eq("base_resolution", "1m")
    .lte("range_start", new Date(to * 1000).toISOString()).gte("range_end", new Date(from * 1000).toISOString())
    .order("range_start", { ascending: true })
  if (error) throw new Error(`Chart provenance coverage read failed: ${error.message}`)
  return (data || []).map((row) => provenanceCoverageRange(row as Record<string, unknown>)).filter((range): range is ProviderCoverageRange => Boolean(range))
}

export async function readQeo107TerminalAttemptRanges(
  supabase: SupabaseClient,
  ticker: string,
  from: number,
  to: number,
): Promise<Qeo107TerminalAttemptRange[]> {
  const { data, error } = await supabase.from("chart_ohlcv_provenance_batches").select("row_count,range_start,range_end,detail")
    .eq("ticker", ticker).eq("base_resolution", "1m")
    .lte("range_start", new Date(to * 1000).toISOString()).gte("range_end", new Date(from * 1000).toISOString())
    .order("fetched_at", { ascending: true })
  if (error) throw new Error(`QEO-107 bootstrap attempt read failed: ${error.message}`)

  const ranges: Qeo107TerminalAttemptRange[] = []
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? row.detail as Record<string, unknown> : {}
    if (detail.workflow !== "QEO-107") continue
    const outcome = detail.outcome === "provider_gap" ? "provider_gap" : (finite(row.row_count) ?? 0) > 0 ? "success" : null
    if (!outcome) continue
    const range = provenanceCoverageRange({ ...row, row_count: outcome === "provider_gap" ? 1 : row.row_count })
    if (range) ranges.push({ ...range, outcome })
  }
  return ranges
}

export async function recordChartProviderAttempt(supabase: SupabaseClient, input: ChartProviderAttemptInput) {
  if (!Number.isInteger(input.requestedFrom) || !Number.isInteger(input.requestedTo) || input.requestedFrom <= 0 || input.requestedTo <= input.requestedFrom) {
    throw new Error("Chart provenance attempt requires a valid requested range")
  }
  const bars = [...(input.bars ?? [])].sort((a, b) => a.time - b.time)
  const fetchedAt = input.fetchedAt ?? new Date().toISOString()
  const rangeStart = bars[0]?.time ?? input.requestedFrom
  const rangeEnd = bars.at(-1)?.time ?? input.requestedTo
  const { data: batch, error } = await supabase.from("chart_ohlcv_provenance_batches").insert({
    provider: input.provider,
    ticker: input.ticker,
    base_resolution: "1m",
    range_start: new Date(rangeStart * 1000).toISOString(),
    range_end: new Date(rangeEnd * 1000).toISOString(),
    row_count: bars.length,
    fetched_at: fetchedAt,
    detail: {
      ...(input.detail ?? {}),
      requestedFrom: input.requestedFrom,
      requestedTo: input.requestedTo,
    },
  }).select("id").single()
  if (error || !batch?.id) throw new Error(`Chart provenance insert failed: ${error?.message ?? "missing batch id"}`)
  return { batchId: String(batch.id), rowCount: bars.length }
}

export async function upsertHotIntradayBars(
  supabase: SupabaseClient,
  input: {
    ticker: string
    bars: CanonicalOhlcvBar[]
    provider: string
    fetchedAt?: string
    detail?: Record<string, unknown>
    provenanceBatchId?: string | null
  },
) {
  if (!input.bars.length) return { batchId: null as string | null, rowCount: 0 }
  const sorted = [...input.bars].sort((a, b) => a.time - b.time)
  const fetchedAt = input.fetchedAt ?? new Date().toISOString()
  const provenance = input.provenanceBatchId
    ? { batchId: input.provenanceBatchId, rowCount: sorted.length }
    : await recordChartProviderAttempt(supabase, {
        ticker: input.ticker,
        provider: input.provider,
        requestedFrom: finite(input.detail?.requestedFrom) ?? sorted[0].time,
        requestedTo: finite(input.detail?.requestedTo) ?? sorted.at(-1)!.time,
        bars: sorted,
        fetchedAt,
        detail: input.detail,
      })
  const rows = sorted.map((bar) => ({
    ticker: input.ticker, base_resolution: "1m", bar_time: new Date(bar.time * 1000).toISOString(),
    open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
    provenance_batch_id: provenance.batchId, fetched_at: fetchedAt,
  }))
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const { error } = await supabase.from("chart_ohlcv_intraday").upsert(rows.slice(offset, offset + UPSERT_CHUNK_SIZE), { onConflict: "ticker,base_resolution,bar_time" })
    if (error) throw new Error(`Chart hot-store upsert failed: ${error.message}`)
  }
  return { batchId: provenance.batchId, rowCount: rows.length }
}
