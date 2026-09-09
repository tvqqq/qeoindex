import "server-only"

import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"
import {
  proveHotArchivePartitionEligibility,
  proveHotArchivePartitionsEligibility,
  type HotArchiveRetentionProof,
} from "./hot-retention"
import type { ProviderCoverageRange } from "./provider-coverage"

export { proveHotArchivePartitionEligibility, proveHotArchivePartitionsEligibility }
export type { HotArchiveRetentionProof }

const UPSERT_CHUNK_SIZE = 500
export const CHART_HOT_READ_PAGE_SIZE = 500
export const CHART_HOT_READ_MAX_PAGES = 64
const ARCHIVE_DISCOVERY_ROWS_PER_PARTITION = 300
const ARCHIVE_DISCOVERY_MAX_ROWS = 10_000

type PostgrestErrorLike = { code?: string | null; message?: string | null }

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

function requestedCoverageRange(row: Record<string, unknown>): ProviderCoverageRange | null {
  const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? row.detail as Record<string, unknown> : {}
  const from = finite(detail.requestedFrom)
  const to = finite(detail.requestedTo)
  if (from == null || to == null || to < from) return null
  return { from: Math.floor(from), to: Math.floor(to) }
}

function vietnamDateKey(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochSeconds * 1000))
}

function missingPartitionRpc(error: PostgrestErrorLike) {
  return error.code === "PGRST202" || /qeo_ensure_chart_intraday_session_partition/i.test(error.message ?? "") && /not find|not found/i.test(error.message ?? "")
}

function missingQeo149WriterRpc(error: PostgrestErrorLike) {
  return error.code === "PGRST202" || /qeo_upsert_chart_intraday_bars/i.test(error.message ?? "") && /not find|not found/i.test(error.message ?? "")
}

function missingHotContentIdentityColumns(error: PostgrestErrorLike) {
  const message = error.message ?? ""
  const missingColumn = error.code === "42703" || error.code === "PGRST204" || /column.*not found|could not find.*column/i.test(message)
  return missingColumn && /content_(digest|version)/i.test(message)
}

export class ChartHotContentIdentityUnavailableError extends Error {
  constructor(message = "QEO-149 HOT content identity schema is unavailable") {
    super(message)
    this.name = "ChartHotContentIdentityUnavailableError"
  }
}

async function ensureHotIntradaySessionPartitions(supabase: SupabaseClient, bars: CanonicalOhlcvBar[]) {
  const tradingDates = [...new Set(bars.map((bar) => vietnamDateKey(bar.time)))]
  for (const tradingDate of tradingDates) {
    const { error } = await supabase.rpc("qeo_ensure_chart_intraday_session_partition", { p_trading_date: tradingDate })
    if (error && !missingPartitionRpc(error)) throw new Error(`Chart session partition provisioning failed: ${error.message}`)
  }
}

export interface HotArchivePartition {
  ticker: string
  tradingDate: string
  from: number
  toExclusive: number
}

export interface HotIntradaySnapshot {
  bar: CanonicalOhlcvBar
  contentDigest: string
  contentVersion: number
}

export interface HotArchivePruneResult {
  status: "pruned" | "deferred"
  reason?: "content_mismatch" | "retention_mismatch"
  deletedRows: number
}

export interface HotSessionPartitionDropResult {
  status: "absent" | "blocked" | "dropped"
  tradingDate: string
  remainingRows: number
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
  if (to < from) return []

  const bars: CanonicalOhlcvBar[] = []
  for (let page = 0; page < CHART_HOT_READ_MAX_PAGES; page += 1) {
    const offset = page * CHART_HOT_READ_PAGE_SIZE
    const { data, error } = await supabase.from("chart_ohlcv_intraday").select("bar_time,open,high,low,close,volume")
      .eq("ticker", ticker).eq("base_resolution", "1m")
      .gte("bar_time", new Date(from * 1000).toISOString()).lte("bar_time", new Date(to * 1000).toISOString())
      .order("bar_time", { ascending: true })
      .range(offset, offset + CHART_HOT_READ_PAGE_SIZE - 1)
    if (error) throw new Error(`Chart hot-store read failed: ${error.message}`)

    const pageBars = (data || []).map((row) => storedRowToBar(row as Record<string, unknown>)).filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
    bars.push(...pageBars)
    if ((data || []).length < CHART_HOT_READ_PAGE_SIZE) return bars
  }

  throw new Error(`Chart hot-store read reached its ${CHART_HOT_READ_MAX_PAGES}-page bound`)
}

function storedRowToSnapshot(row: Record<string, unknown>): HotIntradaySnapshot | null {
  const bar = storedRowToBar(row)
  const contentDigest = String(row.content_digest ?? "")
  const contentVersion = Number(row.content_version)
  if (!bar || !/^[a-f0-9]{64}$/.test(contentDigest) || !Number.isSafeInteger(contentVersion) || contentVersion <= 0) return null
  return { bar, contentDigest, contentVersion }
}

export function canonicalHotContentDigest(rows: HotIntradaySnapshot[]) {
  if (!rows.length) throw new Error("Cannot build a canonical HOT content digest from an empty snapshot")
  const sorted = [...rows].sort((left, right) => left.bar.time - right.bar.time)
  if (sorted.some((row, index) => index > 0 && row.bar.time === sorted[index - 1].bar.time)) throw new Error("Canonical HOT snapshot contains duplicate timestamps")
  return createHash("sha256").update(sorted.map((row) => row.contentDigest).join(""), "utf8").digest("hex")
}

export function canonicalHotContentVersion(rows: HotIntradaySnapshot[]) {
  if (!rows.length) throw new Error("Cannot build a canonical HOT content version from an empty snapshot")
  return Math.max(...rows.map((row) => row.contentVersion))
}

export async function readHotIntradaySnapshot(
  supabase: SupabaseClient,
  ticker: string,
  from: number,
  to: number,
): Promise<HotIntradaySnapshot[]> {
  const { data, error } = await supabase.from("chart_ohlcv_intraday")
    .select("bar_time,open,high,low,close,volume,content_digest,content_version")
    .eq("ticker", ticker).eq("base_resolution", "1m")
    .gte("bar_time", new Date(from * 1000).toISOString()).lte("bar_time", new Date(to * 1000).toISOString())
    .order("bar_time", { ascending: true })
  if (error) {
    if (missingHotContentIdentityColumns(error)) throw new ChartHotContentIdentityUnavailableError()
    throw new Error(`Chart hot-store snapshot read failed: ${error.message}`)
  }
  const rows = (data || []) as Array<Record<string, unknown>>
  const snapshots = rows.map(storedRowToSnapshot)
  if (snapshots.some((snapshot) => snapshot == null)) throw new Error("Chart hot-store snapshot contains unknown content identity")
  return snapshots.filter((snapshot): snapshot is HotIntradaySnapshot => Boolean(snapshot))
}

/**
 * Discover bounded candidates with the global session cutoff. The returned
 * partitions still require proveHotArchivePartitionEligibility before any
 * archive or prune authority is reached.
 */
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
  input: {
    manifestId: string
    sha256: string
    rowCount: number
    canonicalContentDigest: string
    canonicalContentVersion: number
    newerTradingDates: string[]
  },
): Promise<HotArchivePruneResult> {
  const { data, error } = await supabase.rpc("qeo_prune_verified_chart_intraday_partition", {
    p_manifest_id: input.manifestId,
    p_expected_sha256: input.sha256,
    p_expected_row_count: input.rowCount,
    p_expected_content_digest: input.canonicalContentDigest,
    p_expected_content_version: input.canonicalContentVersion,
    p_expected_newer_sessions: input.newerTradingDates,
  })
  if (error) throw new Error(`Chart hot archive prune RPC failed: ${error.message}`)
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const status = raw.status
  const deletedRows = finite(raw.deletedRows)
  if (status === "deferred" && (raw.reason === "content_mismatch" || raw.reason === "retention_mismatch") && deletedRows === 0) {
    return { status, reason: raw.reason, deletedRows }
  }
  if (status !== "pruned" || deletedRows == null || deletedRows !== input.rowCount) throw new Error(`Chart hot archive prune RPC returned invalid status=${String(status)} deletedRows=${String(raw.deletedRows)}`)
  return { status, deletedRows }
}

export async function dropEmptyHotIntradaySessionPartition(
  supabase: SupabaseClient,
  tradingDate: string,
): Promise<HotSessionPartitionDropResult | null> {
  const { data, error } = await supabase.rpc("qeo_drop_empty_chart_intraday_session_partition", { p_trading_date: tradingDate })
  if (error?.code === "PGRST202") return null
  if (error) throw new Error(`Chart session partition reclaim failed: ${error.message}`)
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const status = raw.status
  if (status !== "absent" && status !== "blocked" && status !== "dropped") throw new Error(`Chart session partition reclaim returned invalid status=${String(status)}`)
  return {
    status,
    tradingDate,
    remainingRows: finite(raw.remainingRows) ?? 0,
  }
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
    if (detail.outcome === "provider_gap") {
      const range = requestedCoverageRange(row)
      if (range) ranges.push({ ...range, outcome: "provider_gap" })
      continue
    }
    if (detail.outcome !== "success" || (finite(row.row_count) ?? 0) <= 0) continue
    const range = provenanceCoverageRange(row)
    if (range) ranges.push({ ...range, outcome: "success" })
  }
  return ranges
}

export async function recordChartProviderAttempt(supabase: SupabaseClient, input: ChartProviderAttemptInput) {
  if (!Number.isInteger(input.requestedFrom) || !Number.isInteger(input.requestedTo) || input.requestedFrom <= 0 || input.requestedTo < input.requestedFrom) {
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

async function upsertHotIntradayBarsLegacy(
  supabase: SupabaseClient,
  sorted: CanonicalOhlcvBar[],
  rows: Array<Record<string, unknown>>,
) {
  await ensureHotIntradaySessionPartitions(supabase, sorted)
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE)
    const { error } = await supabase.from("chart_ohlcv_intraday").upsert(chunk, { onConflict: "ticker,base_resolution,bar_time" })
    if (error) throw new Error(`Chart hot-store legacy upsert failed: ${error.message}`)
  }
  return rows.length
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
    recordProvenance?: boolean
  },
) {
  if (!input.bars.length) return { batchId: null as string | null, rowCount: 0 }
  const sorted = [...input.bars].sort((a, b) => a.time - b.time)
  const fetchedAt = input.fetchedAt ?? new Date().toISOString()
  const provenance = input.provenanceBatchId
    ? { batchId: input.provenanceBatchId, rowCount: sorted.length }
    : input.recordProvenance === false
      ? { batchId: null, rowCount: sorted.length }
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
  let writtenRows = 0
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE)
    const { data, error } = await supabase.rpc("qeo_upsert_chart_intraday_bars", {
      p_ticker: input.ticker,
      p_rows: chunk,
    })
    if (error) {
      if (offset === 0 && missingQeo149WriterRpc(error)) {
        writtenRows = await upsertHotIntradayBarsLegacy(supabase, sorted, rows)
        break
      }
      throw new Error(`Chart hot-store writer RPC failed: ${error.message}`)
    }
    const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}
    const resultTicker = String(result.ticker ?? "").trim().toUpperCase()
    const resultRows = finite(result.rowCount)
    if (result.status !== "upserted" || resultTicker !== input.ticker.trim().toUpperCase() || resultRows == null || resultRows !== chunk.length) {
      throw new Error(`Chart hot-store writer RPC returned invalid result status=${String(result.status)} rowCount=${String(result.rowCount)}`)
    }
    writtenRows += resultRows
  }
  if (writtenRows !== rows.length) throw new Error(`Chart hot-store writer row accounting mismatch: expected ${rows.length}, wrote ${writtenRows}`)
  return { batchId: provenance.batchId, rowCount: writtenRows }
}
