import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseColdOhlcvStorage } from "./cold-store"
import type { CanonicalOhlcvBar } from "./contract"
import { persistVerifiedDerivedHourlyGeneration } from "./derived-hourly-store"
import { chartHotSessionRetentionCutoff } from "./history-policy"
import {
  abandonChartIntradayRange,
  canonicalProviderRangeContentId,
  ChartClosedRangeCoordinationUnavailableError,
  claimChartIntradayRange,
  completeChartIntradayRange,
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
import { CHART_PROVIDER_SOURCE_KEY, runClosedRangeIngestion } from "./provider-ingestion"
import { missingProviderRanges } from "./provider-coverage"
import { aggregateChartTimeframe } from "./timeframes"

export const QEO107_HOT_RETENTION_SESSIONS = 5

export interface Qeo107BootstrapChunk {
  index: number
  from: number
  to: number
  class: "HOT_FIRST"
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

export interface Qeo107HotSessionCoverageRow {
  ticker: string
  hotSessionCount: number
  firstHotSession: string | null
  lastHotSession: string | null
}

export interface Qeo107CoverageRow {
  ticker: string
  hotRowCount: number
  hotFirstBarTime: string | null
  hotLastBarTime: string | null
  hotSessionCount: number
  firstHotSession: string | null
  lastHotSession: string | null
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

class Qeo107RecordedTerminalResult extends Error {
  constructor(readonly result: Qeo107BootstrapChunkResult) {
    super(result.error ?? result.status)
    this.name = "Qeo107RecordedTerminalResult"
  }
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
  const hotCutoff = chartHotSessionRetentionCutoff(referenceAt)
  const chunk: Qeo107BootstrapChunk = { index: 0, from: hotCutoff, to: targetTo, class: "HOT_FIRST" }
  return {
    referenceAt: referenceAt.toISOString(),
    targetFrom: hotCutoff,
    targetTo,
    hotCutoff,
    chunks: [{ ...chunk, class: "HOT_FIRST" }],
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

function busyResult(ticker: string, chunk: Qeo107BootstrapChunk): Qeo107BootstrapChunkResult {
  return {
    ...skippedResult(ticker, chunk),
    status: "retryable_failure",
    failureCodes: ["QEO-148:RANGE_BUSY"],
    error: "Closed-range ingestion is owned by another active lease",
  }
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function nullableString(value: unknown) {
  return value == null || value === "" ? null : String(value)
}

export async function readChartIntradaySessionCoverage(
  supabase: SupabaseClient,
  input: { tickers: string[]; referenceAt?: Date },
): Promise<Qeo107HotSessionCoverageRow[]> {
  const tickers = [...new Set(input.tickers.map(validTicker))]
  if (!tickers.length) return []
  const referenceAt = input.referenceAt ?? new Date()
  const { data, error } = await supabase.rpc("qeo_chart_intraday_session_coverage", {
    p_tickers: tickers,
    p_hot_cutoff: new Date(chartHotSessionRetentionCutoff(referenceAt) * 1000).toISOString(),
  })
  if (error) throw new Error(`QEO-107 HOT session coverage failed: ${error.message}`)
  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    ticker: String(row.ticker || "").trim().toUpperCase(),
    hotSessionCount: finiteNumber(row.hot_session_count),
    firstHotSession: nullableString(row.first_hot_session),
    lastHotSession: nullableString(row.last_hot_session),
  }))
}

async function alreadyTerminal(
  supabase: SupabaseClient,
  ticker: string,
  chunk: Qeo107BootstrapChunk,
  referenceAt: Date,
) {
  const sessionCoverage = await readChartIntradaySessionCoverage(supabase, { tickers: [ticker], referenceAt })
  const hotSessionCount = sessionCoverage[0]?.hotSessionCount ?? 0
  if (hotSessionCount >= QEO107_HOT_RETENTION_SESSIONS) return true

  const attempted = await readQeo107TerminalAttemptRanges(supabase, ticker, chunk.from, chunk.to)
  const providerGaps = attempted.filter(({ outcome }) => outcome === "provider_gap")
  return missingProviderRanges(
    { from: chunk.from, to: chunk.to },
    providerGaps.map(({ from, to }) => ({ from, to })),
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

async function executeBootstrapChunkWork(
  supabase: SupabaseClient,
  input: {
    ticker: string
    chunk: Qeo107BootstrapChunk
    referenceAt: Date
    provider: ChartOhlcvProvider
    hotCutoff: number
  },
) {
  let providerResult
  try {
    providerResult = normalizeChartProviderResult(await input.provider.fetch({
      ticker: input.ticker,
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
      ticker: input.ticker,
      chunk: input.chunk,
      outcome: status,
      failureCodes,
      error: cause.message,
    })
    throw new Qeo107RecordedTerminalResult({
      ticker: input.ticker,
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
    })
  }

  const bars = [...providerResult.bars]
    .filter((bar) => bar.time >= input.chunk.from && bar.time <= input.chunk.to)
    .sort((a, b) => a.time - b.time)
  if (!bars.length) {
    const error = `${providerResult.provider} returned no usable canonical 1m bars`
    const failureCodes = [`${providerResult.provider}:EMPTY_COVERAGE`]
    await recordProviderFailure(supabase, { ticker: input.ticker, chunk: input.chunk, outcome: "provider_gap", failureCodes, error })
    throw new Qeo107RecordedTerminalResult({
      ticker: input.ticker,
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
      failureCodes,
      error,
    })
  }

  const hotBars = bars.filter((bar) => bar.time >= input.hotCutoff)
  const coldBars = bars.filter((bar) => bar.time < input.hotCutoff)
  let archivedPartitions = 0
  let derivedHourlyRows = 0

  if (hotBars.length) {
    await upsertHotIntradayBars(supabase, {
      ticker: input.ticker,
      bars: hotBars,
      provider: providerResult.provider,
      fetchedAt: input.referenceAt.toISOString(),
      recordProvenance: false,
    })
  }

  if (coldBars.length) {
    const coldStorage = createSupabaseColdOhlcvStorage(supabase)
    for (const partition of partitionByVietnamTradingDate(coldBars)) {
      const archived = await coldStorage.archiveVerifiedPartition({ ticker: input.ticker, bars: partition.bars })
      const hourlyBars = aggregateChartTimeframe(partition.bars, "1h")
      if (!hourlyBars.length) throw new Error(`QEO-107 ${input.ticker} ${partition.tradingDate} produced no deterministic 1h bars`)
      const cached = await persistVerifiedDerivedHourlyGeneration(supabase, {
        ticker: input.ticker,
        bars: hourlyBars,
        sourceManifestId: archived.manifestId,
        sourceSha256: archived.sha256,
        sourceRangeStart: partition.bars[0].time,
        sourceRangeEnd: partition.bars.at(-1)!.time,
        sourceRawRowCount: archived.rowCount,
        sourceFormatVersion: 1,
        sourceCanonicalContentDigest: null,
        sourceCanonicalContentVersion: null,
        generatedAt: input.referenceAt.toISOString(),
      })
      archivedPartitions += 1
      derivedHourlyRows += cached.rowCount
    }
  }

  const provenance = await recordChartProviderAttempt(supabase, {
    ticker: input.ticker,
    provider: providerResult.provider,
    requestedFrom: input.chunk.from,
    requestedTo: input.chunk.to,
    bars,
    fetchedAt: input.referenceAt.toISOString(),
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

  const result: Qeo107BootstrapChunkResult = {
    ticker: input.ticker,
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
  return {
    value: result,
    completion: {
      provider: providerResult.provider,
      rowCount: bars.length,
      provenanceBatchId: provenance.batchId,
      contentId: canonicalProviderRangeContentId({
        provider: providerResult.provider,
        requestedFrom: input.chunk.from,
        requestedTo: input.chunk.to,
        bars,
      }),
    },
  }
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
  const hotCutoff = chartHotSessionRetentionCutoff(referenceAt)
  if (await alreadyTerminal(supabase, ticker, input.chunk, referenceAt)) return skippedResult(ticker, input.chunk)

  const provider = input.provider ?? createPrimaryChartOhlcvProvider()
  const work = () => executeBootstrapChunkWork(supabase, {
    ticker,
    chunk: input.chunk,
    referenceAt,
    provider,
    hotCutoff,
  })
  const coordinator = {
    claim: (claimInput: Parameters<typeof claimChartIntradayRange>[1]) => claimChartIntradayRange(supabase, claimInput),
    complete: (completionInput: Parameters<typeof completeChartIntradayRange>[1]) => completeChartIntradayRange(supabase, completionInput),
    abandon: (abandonInput: Parameters<typeof abandonChartIntradayRange>[1]) => abandonChartIntradayRange(supabase, abandonInput),
  }

  try {
    const coordinated = await runClosedRangeIngestion({
      ticker,
      sourceKey: CHART_PROVIDER_SOURCE_KEY,
      from: input.chunk.from,
      to: input.chunk.to,
    }, coordinator, work)
    if (coordinated.status === "completed") return coordinated.value
    if (coordinated.status === "reused") return skippedResult(ticker, input.chunk)
    return busyResult(ticker, input.chunk)
  } catch (error) {
    if (error instanceof Qeo107RecordedTerminalResult) return error.result
    if (!(error instanceof ChartClosedRangeCoordinationUnavailableError)) throw error
    // QEO-148 migration is quarantined until release authorization. Keep the
    // existing bootstrap available, but do not synthesize durable success.
    try {
      return (await work()).value
    } catch (fallbackError) {
      if (fallbackError instanceof Qeo107RecordedTerminalResult) return fallbackError.result
      throw fallbackError
    }
  }
}

export async function readChartIntradayCoverageReport(
  supabase: SupabaseClient,
  input: { tickers: string[]; referenceAt?: Date },
): Promise<Qeo107CoverageRow[]> {
  const tickers = [...new Set(input.tickers.map(validTicker))]
  if (!tickers.length) return []
  const referenceAt = input.referenceAt ?? new Date()
  const hotCutoff = new Date(chartHotSessionRetentionCutoff(referenceAt) * 1000).toISOString()
  const [coverageResult, sessionRows] = await Promise.all([
    supabase.rpc("qeo_chart_intraday_coverage", {
      p_tickers: tickers,
      p_hot_cutoff: hotCutoff,
    }),
    readChartIntradaySessionCoverage(supabase, { tickers, referenceAt }),
  ])
  if (coverageResult.error) throw new Error(`QEO-107 intraday coverage report failed: ${coverageResult.error.message}`)
  const sessionsByTicker = new Map(sessionRows.map((row) => [row.ticker, row]))
  return ((coverageResult.data || []) as Array<Record<string, unknown>>).map((row) => {
    const ticker = String(row.ticker || "").trim().toUpperCase()
    const session = sessionsByTicker.get(ticker)
    return {
      ticker,
      hotRowCount: finiteNumber(row.hot_row_count),
      hotFirstBarTime: nullableString(row.hot_first_bar_time),
      hotLastBarTime: nullableString(row.hot_last_bar_time),
      hotSessionCount: session?.hotSessionCount ?? 0,
      firstHotSession: session?.firstHotSession ?? null,
      lastHotSession: session?.lastHotSession ?? null,
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
    }
  })
}
