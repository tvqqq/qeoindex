import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseColdOhlcvStorage } from "./cold-store"
import type { CanonicalOhlcvBar } from "./contract"
import { upsertDerivedHourlyBars } from "./derived-hourly-store"
import { chartHotRetentionCutoff } from "./history-policy"
import {
  readQeo107TerminalAttemptRanges,
  recordChartProviderAttempt,
  upsertHotIntradayBars,
} from "./hot-store"
import {
  ChartOhlcvProviderWaterfallError,
  createPrimaryChartOhlcvProvider,
  normalizeChartProviderResult,
  type ChartOhlcvProvider,
} from "./provider"
import { missingProviderRanges } from "./provider-coverage"
import { aggregateChartTimeframe } from "./timeframes"

const DAY_SECONDS = 86_400
export const QEO107_INTRADAY_TARGET_DAYS = 366
export const QEO107_PROVIDER_CHUNK_DAYS = 31
export const QEO107_CHUNK_COUNT = Math.ceil(QEO107_INTRADAY_TARGET_DAYS / QEO107_PROVIDER_CHUNK_DAYS)

export interface Qeo107BootstrapChunk {
  index: number
  from: number
  to: number
  class: "HOT_FIRST" | "COLD_BACKFILL"
}

export interface Qeo107BootstrapTarget {
  referenceAt: string
  targetFrom: number
  targetTo: number
  hotCutoff: number
  chunks: Qeo107BootstrapChunk[]
}

export type Qeo107BootstrapChunkStatus = "succeeded" | "skipped" | "provider_gap" | "retryable_failure" | "failed"

export interface Qeo107BootstrapChunkResult {
  ticker: string
  chunkIndex: number
  from: number
  to: number
  status: Qeo107BootstrapChunkStatus
  provider: string | null
  fetchedRows: number
  hotRows: number
  coldRows: number
  archivedPartitions: number
  derivedHourlyRows: number
  failureCodes: string[]
  error: string | null
}

export interface Qeo107CoverageRow {
  ticker: string
  hotRowCount: number
  hotFirstBarTime: string | null
  hotLastBarTime: string | null
  coldManifestCount: number
  coldRowCount: number
  coldFirstBarTime: string | null
  coldLastBarTime: string | null
  derivedHourlyRowCount: number
  derivedFirstBarTime: string | null
  derivedLastBarTime: string | null
  successfulRequestCount: number
  providerGapCount: number
  retryableFailureCount: number
  failedAttemptCount: number
  lastAttemptAt: string | null
}

function validTicker(tickerInput: string) {
  const ticker = String(tickerInput || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid QEO-107 ticker: ${tickerInput}`)
  return ticker
}

function lastCompletedMinute(referenceAt: Date) {
  return Math.floor(referenceAt.getTime() / 60_000) * 60 - 60
}

export function qeo107BootstrapTarget(referenceAt = new Date()): Qeo107BootstrapTarget {
  const targetTo = lastCompletedMinute(referenceAt)
  const targetFrom = targetTo - QEO107_INTRADAY_TARGET_DAYS * DAY_SECONDS
  const chunks: Qeo107BootstrapChunk[] = []
  for (let index = 0; index < QEO107_CHUNK_COUNT; index += 1) {
    const to = targetTo - index * QEO107_PROVIDER_CHUNK_DAYS * DAY_SECONDS
    const from = Math.max(targetFrom, to - QEO107_PROVIDER_CHUNK_DAYS * DAY_SECONDS)
    if (to <= targetFrom) break
    chunks.push({ index, from, to, class: index === 0 ? "HOT_FIRST" : "COLD_BACKFILL" })
  }
  return {
    referenceAt: referenceAt.toISOString(),
    targetFrom,
    targetTo,
    hotCutoff: chartHotRetentionCutoff(referenceAt),
    chunks,
  }
}

function vietnamDateKey(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000))
}

function partitionByVietnamTradingDate(bars: CanonicalOhlcvBar[]) {
  const groups = new Map<string, CanonicalOhlcvBar[]>()
  for (const bar of bars) {
    const key = vietnamDateKey(bar.time)
    const group = groups.get(key) ?? []
    group.push(bar)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tradingDate, rows]) => ({ tradingDate, bars: rows.sort((a, b) => a.time - b.time) }))
}

function skippedResult(ticker: string, chunk: Qeo107BootstrapChunk): Qeo107BootstrapChunkResult {
  return {
    ticker,
    chunkIndex: chunk.index,
    from: chunk.from,
    to: chunk.to,
    status: "skipped",
    provider: null,
    fetchedRows: 0,
    hotRows: 0,
    coldRows: 0,
    archivedPartitions: 0,
    derivedHourlyRows: 0,
    failureCodes: [],
    error: null,
  }
}

async function alreadyTerminal(supabase: SupabaseClient, ticker: string, chunk: Qeo107BootstrapChunk) {
  const attempted = await readQeo107TerminalAttemptRanges(supabase, ticker, chunk.from, chunk.to)
  return missingProviderRanges(
    { from: chunk.from, to: chunk.to },
    attempted.map(({ from, to }) => ({ from, to })),
  ).length === 0
}

async function recordProviderFailure(
  supabase: SupabaseClient,
  input: {
    ticker: string
    chunk: Qeo107BootstrapChunk
    outcome: "provider_gap" | "retryable_failure" | "failed"
    failureCodes: string[]
    error: string
  },
) {
  await recordChartProviderAttempt(supabase, {
    ticker: input.ticker,
    provider: "WATERFALL",
    requestedFrom: input.chunk.from,
    requestedTo: input.chunk.to,
    detail: {
      workflow: "QEO-107",
      outcome: input.outcome,
      chunkIndex: input.chunk.index,
      failureCodes: input.failureCodes,
      error: input.error,
    },
  })
}

export async function bootstrapChartIntradayChunk(
  supabase: SupabaseClient,
  input: {
    ticker: string
    chunk: Qeo107BootstrapChunk
    referenceAt?: Date
    provider?: ChartOhlcvProvider
  },
): Promise<Qeo107BootstrapChunkResult> {
  const ticker = validTicker(input.ticker)
  const referenceAt = input.referenceAt ?? new Date()
  const hotCutoff = chartHotRetentionCutoff(referenceAt)
  if (await alreadyTerminal(supabase, ticker, input.chunk)) return skippedResult(ticker, input.chunk)

  const provider = input.provider ?? createPrimaryChartOhlcvProvider()
  let providerResult
  try {
    providerResult = normalizeChartProviderResult(await provider.fetch({
      ticker,
      resolution: "1m",
      from: input.chunk.from,
      to: input.chunk.to,
      includeCurrent: false,
    }), "CUSTOM")
  } catch (cause) {
    if (!(cause instanceof ChartOhlcvProviderWaterfallError)) throw cause
    const status: Qeo107BootstrapChunkStatus = cause.terminalCoverageGap
      ? "provider_gap"
      : cause.retryable
        ? "retryable_failure"
        : "failed"
    const failureCodes = cause.failures.map((failure) => `${failure.provider}:${failure.code}`)
    await recordProviderFailure(supabase, {
      ticker,
      chunk: input.chunk,
      outcome: status,
      failureCodes,
      error: cause.message,
    })
    return {
      ticker,
      chunkIndex: input.chunk.index,
      from: input.chunk.from,
      to: input.chunk.to,
      status,
      provider: null,
      fetchedRows: 0,
      hotRows: 0,
      coldRows: 0,
      archivedPartitions: 0,
      derivedHourlyRows: 0,
      failureCodes,
      error: cause.message,
    }
  }

  const bars = [...providerResult.bars]
    .filter((bar) => bar.time >= input.chunk.from && bar.time <= input.chunk.to)
    .sort((a, b) => a.time - b.time)
  if (!bars.length) {
    const error = `${providerResult.provider} returned no usable canonical 1m bars`
    await recordProviderFailure(supabase, {
      ticker,
      chunk: input.chunk,
      outcome: "provider_gap",
      failureCodes: [`${providerResult.provider}:EMPTY_COVERAGE`],
      error,
    })
    return {
      ticker,
      chunkIndex: input.chunk.index,
      from: input.chunk.from,
      to: input.chunk.to,
      status: "provider_gap",
      provider: providerResult.provider,
      fetchedRows: 0,
      hotRows: 0,
      coldRows: 0,
      archivedPartitions: 0,
      derivedHourlyRows: 0,
      failureCodes: [`${providerResult.provider}:EMPTY_COVERAGE`],
      error,
    }
  }

  const hotBars = bars.filter((bar) => bar.time >= hotCutoff)
  const coldBars = bars.filter((bar) => bar.time < hotCutoff)
  let archivedPartitions = 0
  let derivedHourlyRows = 0

  if (hotBars.length) {
    await upsertHotIntradayBars(supabase, {
      ticker,
      bars: hotBars,
      provider: providerResult.provider,
      fetchedAt: referenceAt.toISOString(),
      recordProvenance: false,
    })
  }

  if (coldBars.length) {
    const coldStorage = createSupabaseColdOhlcvStorage(supabase)
    for (const partition of partitionByVietnamTradingDate(coldBars)) {
      const archived = await coldStorage.archiveVerifiedPartition({ ticker, bars: partition.bars })
      const hourlyBars = aggregateChartTimeframe(partition.bars, "1h")
      if (!hourlyBars.length) throw new Error(`QEO-107 ${ticker} ${partition.tradingDate} produced no deterministic 1h bars`)
      const cached = await upsertDerivedHourlyBars(supabase, {
        ticker,
        bars: hourlyBars,
        sourceManifestId: archived.manifestId,
        sourceSha256: archived.sha256,
        sourceRangeStart: partition.bars[0].time,
        sourceRangeEnd: partition.bars.at(-1)!.time,
        sourceRawRowCount: archived.rowCount,
        generatedAt: referenceAt.toISOString(),
      })
      archivedPartitions += 1
      derivedHourlyRows += cached.rowCount
    }
  }

  await recordChartProviderAttempt(supabase, {
    ticker,
    provider: providerResult.provider,
    requestedFrom: input.chunk.from,
    requestedTo: input.chunk.to,
    bars,
    fetchedAt: referenceAt.toISOString(),
    detail: {
      workflow: "QEO-107",
      outcome: "success",
      chunkIndex: input.chunk.index,
      actualFrom: bars[0].time,
      actualTo: bars.at(-1)!.time,
      hotRows: hotBars.length,
      coldRows: coldBars.length,
      archivedPartitions,
      derivedHourlyRows,
    },
  })

  return {
    ticker,
    chunkIndex: input.chunk.index,
    from: input.chunk.from,
    to: input.chunk.to,
    status: "succeeded",
    provider: providerResult.provider,
    fetchedRows: bars.length,
    hotRows: hotBars.length,
    coldRows: coldBars.length,
    archivedPartitions,
    derivedHourlyRows,
    failureCodes: [],
    error: null,
  }
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function nullableString(value: unknown) {
  return value == null || value === "" ? null : String(value)
}

export async function readChartIntradayCoverageReport(
  supabase: SupabaseClient,
  input: { tickers: string[]; referenceAt?: Date },
): Promise<Qeo107CoverageRow[]> {
  const tickers = [...new Set(input.tickers.map(validTicker))]
  if (!tickers.length) return []
  const referenceAt = input.referenceAt ?? new Date()
  const { data, error } = await supabase.rpc("qeo_chart_intraday_coverage", {
    p_tickers: tickers,
    p_hot_cutoff: new Date(chartHotRetentionCutoff(referenceAt) * 1000).toISOString(),
  })
  if (error) throw new Error(`QEO-107 intraday coverage report failed: ${error.message}`)
  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    ticker: String(row.ticker || "").trim().toUpperCase(),
    hotRowCount: finiteNumber(row.hot_row_count),
    hotFirstBarTime: nullableString(row.hot_first_bar_time),
    hotLastBarTime: nullableString(row.hot_last_bar_time),
    coldManifestCount: finiteNumber(row.cold_manifest_count),
    coldRowCount: finiteNumber(row.cold_row_count),
    coldFirstBarTime: nullableString(row.cold_first_bar_time),
    coldLastBarTime: nullableString(row.cold_last_bar_time),
    derivedHourlyRowCount: finiteNumber(row.derived_hourly_row_count),
    derivedFirstBarTime: nullableString(row.derived_first_bar_time),
    derivedLastBarTime: nullableString(row.derived_last_bar_time),
    successfulRequestCount: finiteNumber(row.successful_request_count),
    providerGapCount: finiteNumber(row.provider_gap_count),
    retryableFailureCount: finiteNumber(row.retryable_failure_count),
    failedAttemptCount: finiteNumber(row.failed_attempt_count),
    lastAttemptAt: nullableString(row.last_attempt_at),
  }))
}
