import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "@/modules/market/calendar"
import {
  createSupabaseDailyColdOhlcvStorage,
  listVerifiedColdManifests,
} from "@/modules/market/chart-data/cold-store"
import type { CanonicalOhlcvBar } from "@/modules/market/chart-data/contract"
import { DAILY_BACKFILL_DAYS } from "@/modules/market/history/contract"
import { fetchDailyMarketHistoryWindow } from "@/modules/market/history/index"

const DAY_MS = 86_400_000
const DAILY_DEEP_CHUNK_DAYS = 4 * 366
const MAX_TICKERS = 10
const MAX_CHUNKS_PER_TICKER = 3
const HOT_ARCHIVE_READ_LIMIT = 400

type StoredDailyRow = {
  bar_time?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  volume?: unknown
  provider?: unknown
}

export type DailyLeftEdgeStatus = "IN_PROGRESS" | "PROVIDER_BOUNDARY" | "LISTING_BOUNDARY" | "UNRECOVERABLE" | "RETRYABLE_ERROR"

export interface DailyColdTickerResult {
  ticker: string
  archivedHotRows: number
  deepArchivedRows: number
  manifests: string[]
  status: DailyLeftEdgeStatus
  earliestLocal: string | null
  error?: string
}

export interface DailyColdHistoryResult {
  requestedTickers: number
  archivedHotRows: number
  deepArchivedRows: number
  tickers: DailyColdTickerResult[]
}

function normalizeTickers(input: string[]) {
  const tickers = [...new Set(input.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))]
  if (!tickers.length || tickers.length > MAX_TICKERS) throw new Error(`Daily cold history requires 1-${MAX_TICKERS} tickers`)
  for (const ticker of tickers) {
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid ticker: ${ticker}`)
  }
  return tickers
}

function toBar(row: StoredDailyRow): CanonicalOhlcvBar | null {
  const timestamp = row.bar_time ? new Date(String(row.bar_time)).getTime() : NaN
  const bar = {
    time: Math.floor(timestamp / 1000),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }
  if (!Number.isFinite(timestamp)) return null
  if (![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) return null
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0 || bar.volume < 0) return null
  if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) return null
  return bar
}

function validTradingBars(bars: CanonicalOhlcvBar[]) {
  return bars
    .filter((bar) => isVietnamSecuritiesTradingDateKey(vietnamDateKey(bar.time * 1000)))
    .sort((a, b) => a.time - b.time)
}

function providerBackfillBars(provider: string, bars: CanonicalOhlcvBar[]) {
  const valid = validTradingBars(bars)
  // Generic Yahoo/Fallback zero-volume rows were the QEO-106 phantom-session
  // failure mode. Without independent final-close evidence they cannot become
  // immutable Cold history. VCI/DNSE/VNDirect/TitanLabs retain their real bars.
  return provider === "Fallback" ? valid.filter((bar) => bar.volume > 0) : valid
}

function providerExhaustedWithoutData(message: string) {
  const providers = ["VCI", "DNSE", "Yahoo", "VNDirect", "TitanLabs"]
  return providers.every((provider) => message.includes(`${provider}: ${provider} returned no usable completed Daily bars`))
}

function earliestLocalEpoch(...values: Array<number | null>) {
  return values.filter((value): value is number => value != null).sort((a, b) => a - b)[0] ?? null
}

function isoOrNull(epoch: number | null) {
  return epoch == null ? null : new Date(epoch * 1000).toISOString()
}

function partitionByVietnamYear(bars: CanonicalOhlcvBar[]) {
  const groups = new Map<string, CanonicalOhlcvBar[]>()
  for (const bar of bars) {
    const year = vietnamDateKey(bar.time * 1000).slice(0, 4)
    const current = groups.get(year) ?? []
    current.push(bar)
    groups.set(year, current)
  }
  return [...groups.values()].map((group) => group.sort((a, b) => a.time - b.time))
}

async function earliestHotEpoch(supabase: SupabaseClient, ticker: string) {
  const { data, error } = await supabase
    .from("market_ohlcv_history")
    .select("bar_time")
    .eq("ticker", ticker)
    .eq("timeframe", "1D")
    .order("bar_time", { ascending: true })
    .limit(1)
  if (error) throw new Error(`Load earliest Daily hot row failed for ${ticker}: ${error.message}`)
  const value = data?.[0]?.bar_time ? new Date(String(data[0].bar_time)).getTime() : NaN
  return Number.isFinite(value) ? Math.floor(value / 1000) : null
}

async function earliestColdEpoch(supabase: SupabaseClient, ticker: string) {
  const manifests = await listVerifiedColdManifests(supabase, { ticker, baseResolution: "1D", limit: 1 })
  return manifests[0]?.rangeStart ?? null
}

async function saveState(supabase: SupabaseClient, input: {
  ticker: string
  earliestHot: number | null
  earliestCold: number | null
  status: DailyLeftEdgeStatus
  boundaryTime?: number | null
  provider?: string | null
  windowFrom?: number | null
  windowTo?: number | null
  detail?: Record<string, unknown>
}) {
  const { error } = await supabase.from("chart_daily_history_state").upsert({
    ticker: input.ticker,
    earliest_hot_bar: input.earliestHot == null ? null : new Date(input.earliestHot * 1000).toISOString(),
    earliest_cold_bar: input.earliestCold == null ? null : new Date(input.earliestCold * 1000).toISOString(),
    left_edge_status: input.status,
    boundary_time: input.boundaryTime == null ? null : new Date(input.boundaryTime * 1000).toISOString(),
    provider: input.provider ?? null,
    last_window_from: input.windowFrom == null ? null : new Date(input.windowFrom * 1000).toISOString(),
    last_window_to: input.windowTo == null ? null : new Date(input.windowTo * 1000).toISOString(),
    detail: input.detail ?? {},
    updated_at: new Date().toISOString(),
  }, { onConflict: "ticker" })
  if (error) throw new Error(`Persist Daily history state failed for ${input.ticker}: ${error.message}`)
}

async function loadTerminalStatus(supabase: SupabaseClient, ticker: string): Promise<DailyLeftEdgeStatus | null> {
  const { data, error } = await supabase
    .from("chart_daily_history_state")
    .select("left_edge_status")
    .eq("ticker", ticker)
    .maybeSingle()
  if (error) throw new Error(`Load Daily history state failed for ${ticker}: ${error.message}`)
  const status = String(data?.left_edge_status || "") as DailyLeftEdgeStatus
  return ["PROVIDER_BOUNDARY", "LISTING_BOUNDARY", "UNRECOVERABLE"].includes(status) ? status : null
}

export async function archiveExpiredDailyHotHistory(supabase: SupabaseClient, ticker: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - DAILY_BACKFILL_DAYS * DAY_MS)
  const { data, error } = await supabase
    .from("market_ohlcv_history")
    .select("bar_time,open,high,low,close,volume,provider")
    .eq("ticker", ticker)
    .eq("timeframe", "1D")
    .lt("bar_time", cutoff.toISOString())
    .order("bar_time", { ascending: true })
    .limit(HOT_ARCHIVE_READ_LIMIT)
  if (error) throw new Error(`Load expired Daily hot rows failed for ${ticker}: ${error.message}`)

  const rows = (data || []) as StoredDailyRow[]
  const bars = validTradingBars(rows.map(toBar).filter((bar): bar is CanonicalOhlcvBar => Boolean(bar)))
  if (!bars.length) return { rows: 0, manifests: [] as string[] }

  const firstYear = vietnamDateKey(bars[0].time * 1000).slice(0, 4)
  const partition = bars.filter((bar) => vietnamDateKey(bar.time * 1000).startsWith(firstYear))
  const providers = [...new Set(rows.map((row) => String(row.provider || "")).filter(Boolean))]
  const coldStorage = createSupabaseDailyColdOhlcvStorage(supabase)
  const archived = await coldStorage.archiveVerifiedPartition({
    ticker,
    bars: partition,
    provenance: { kind: "DAILY_HOT_AGING", source: "market_ohlcv_history", providers, hotCutoff: cutoff.toISOString() },
  })

  const { data: prune, error: pruneError } = await supabase.rpc("qeo_prune_verified_chart_daily_partition", {
    p_manifest_id: archived.manifestId,
    p_expected_sha256: archived.sha256,
    p_expected_row_count: archived.rowCount,
  })
  if (pruneError) throw new Error(`Verified Daily hot prune failed for ${ticker}: ${pruneError.message}`)
  return { rows: Number((prune as { deletedRows?: unknown } | null)?.deletedRows ?? archived.rowCount), manifests: [archived.manifestId] }
}

async function backfillTicker(supabase: SupabaseClient, ticker: string, maxChunksPerTicker: number, now: Date): Promise<DailyColdTickerResult> {
  const manifests: string[] = []
  let archivedHotRows = 0
  let deepArchivedRows = 0

  const terminal = await loadTerminalStatus(supabase, ticker)
  if (terminal) {
    const earliest = earliestLocalEpoch(await earliestHotEpoch(supabase, ticker), await earliestColdEpoch(supabase, ticker))
    return { ticker, archivedHotRows, deepArchivedRows, manifests, status: terminal, earliestLocal: isoOrNull(earliest) }
  }

  const hotArchive = await archiveExpiredDailyHotHistory(supabase, ticker, now)
  archivedHotRows += hotArchive.rows
  manifests.push(...hotArchive.manifests)

  let status: DailyLeftEdgeStatus = "IN_PROGRESS"
  let lastProvider: string | null = null
  for (let chunk = 0; chunk < maxChunksPerTicker; chunk += 1) {
    const hot = await earliestHotEpoch(supabase, ticker)
    const cold = await earliestColdEpoch(supabase, ticker)
    const earliestLocal = earliestLocalEpoch(hot, cold)
    if (earliestLocal == null) throw new Error(`No canonical Daily anchor exists for ${ticker}`)

    const windowToMs = earliestLocal * 1000 - DAY_MS
    const cursorNow = new Date(windowToMs)
    const windowFrom = Math.floor((windowToMs - DAILY_DEEP_CHUNK_DAYS * DAY_MS) / 1000)
    const windowTo = Math.floor(windowToMs / 1000)

    try {
      const history = await fetchDailyMarketHistoryWindow(ticker, DAILY_DEEP_CHUNK_DAYS, cursorNow)
      lastProvider = history.provider
      const older = providerBackfillBars(history.provider, history.bars)
        .filter((bar) => bar.time < earliestLocal)
      if (!older.length) {
        status = "PROVIDER_BOUNDARY"
        await saveState(supabase, {
          ticker,
          earliestHot: hot,
          earliestCold: cold,
          status,
          boundaryTime: earliestLocal,
          provider: history.provider,
          windowFrom,
          windowTo,
          detail: { reason: "provider-returned-no-older-bars", sourceUrl: history.sourceUrl, providerDetail: history.detail },
        })
        break
      }

      const coldStorage = createSupabaseDailyColdOhlcvStorage(supabase)
      const partitionResults = []
      for (const partition of partitionByVietnamYear(older)) {
        const archived = await coldStorage.archiveVerifiedPartition({
          ticker,
          bars: partition,
          provenance: {
            kind: "DAILY_DEEP_BACKFILL",
            provider: history.provider,
            providerDetail: history.detail,
            sourceUrl: history.sourceUrl,
            fetchedAt: history.fetchedAt,
            requestedWindowFrom: new Date(windowFrom * 1000).toISOString(),
            requestedWindowTo: new Date(windowTo * 1000).toISOString(),
          },
        })
        manifests.push(archived.manifestId)
        deepArchivedRows += archived.rowCount
        partitionResults.push(archived)
      }

      const refreshedHot = await earliestHotEpoch(supabase, ticker)
      const refreshedCold = await earliestColdEpoch(supabase, ticker)
      await saveState(supabase, {
        ticker,
        earliestHot: refreshedHot,
        earliestCold: refreshedCold,
        status: "IN_PROGRESS",
        provider: history.provider,
        windowFrom,
        windowTo,
        detail: { manifestIds: partitionResults.map((item) => item.manifestId), sourceUrl: history.sourceUrl, providerDetail: history.detail },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const refreshedHot = await earliestHotEpoch(supabase, ticker)
      const refreshedCold = await earliestColdEpoch(supabase, ticker)
      const refreshedEarliest = earliestLocalEpoch(refreshedHot, refreshedCold)

      if (providerExhaustedWithoutData(message)) {
        status = "PROVIDER_BOUNDARY"
        await saveState(supabase, {
          ticker,
          earliestHot: refreshedHot,
          earliestCold: refreshedCold,
          status,
          boundaryTime: refreshedEarliest,
          provider: null,
          windowFrom,
          windowTo,
          detail: { reason: "all-approved-providers-returned-no-data", error: message.slice(0, 1000) },
        })
        break
      }

      status = "RETRYABLE_ERROR"
      await saveState(supabase, {
        ticker,
        earliestHot: refreshedHot,
        earliestCold: refreshedCold,
        status,
        provider: lastProvider,
        windowFrom,
        windowTo,
        detail: { error: message.slice(0, 1000) },
      })
      return {
        ticker,
        archivedHotRows,
        deepArchivedRows,
        manifests,
        status,
        earliestLocal: isoOrNull(refreshedEarliest),
        error: message,
      }
    }
  }

  const finalHot = await earliestHotEpoch(supabase, ticker)
  const finalCold = await earliestColdEpoch(supabase, ticker)
  const earliest = earliestLocalEpoch(finalHot, finalCold)
  return { ticker, archivedHotRows, deepArchivedRows, manifests, status, earliestLocal: isoOrNull(earliest) }
}

export async function backfillDailyColdHistory(
  supabase: SupabaseClient,
  input: { tickers: string[]; maxChunksPerTicker?: number; now?: Date },
): Promise<DailyColdHistoryResult> {
  const tickers = normalizeTickers(input.tickers)
  const maxChunksPerTicker = Math.max(1, Math.min(MAX_CHUNKS_PER_TICKER, Math.floor(input.maxChunksPerTicker ?? 1)))
  const now = input.now ?? new Date()
  const results: DailyColdTickerResult[] = []
  for (const ticker of tickers) {
    try {
      results.push(await backfillTicker(supabase, ticker, maxChunksPerTicker, now))
    } catch (error) {
      results.push({
        ticker,
        archivedHotRows: 0,
        deepArchivedRows: 0,
        manifests: [],
        status: "RETRYABLE_ERROR",
        earliestLocal: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return {
    requestedTickers: tickers.length,
    archivedHotRows: results.reduce((sum, item) => sum + item.archivedHotRows, 0),
    deepArchivedRows: results.reduce((sum, item) => sum + item.deepArchivedRows, 0),
    tickers: results,
  }
}
