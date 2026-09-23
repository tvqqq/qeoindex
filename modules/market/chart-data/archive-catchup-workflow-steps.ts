import "server-only"

import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { runChartIntradayArchiveLifecycle, type ChartIntradayArchiveMetrics } from "./archive-lifecycle"
import { readChartStorageCapacity, type ChartStorageCapacity } from "./storage-capacity"

export const QEO228_ARCHIVE_BATCH_SIZE = 10
export const QEO228_MAX_PARTITIONS_PER_TICKER = 8
const MAX_CANONICAL_UNIVERSE_SIZE = 200

export interface Qeo228ArchiveCatchupContext {
  startedAt: string
  dispatchId: string
  universeRunId: string
  universeSourceAsOfDate: string
  selectedCount: number
  tickers: string[]
  initialCapacity: ChartStorageCapacity
}

export interface Qeo228ArchiveTickerResult {
  ticker: string
  status: "succeeded" | "partial" | "skipped" | "failed"
  partitionsConsidered: number
  partitionsArchived: number
  rowsArchived: number
  rowsPruned: number
  bytesWritten: number
  partitionsDeferred: number
  failures: number
  oldestHotBar: string | null
  error: string | null
}

export interface Qeo228ArchiveCatchupSummary {
  dispatchId: string
  startedAt: string
  finishedAt: string
  universeRunId: string
  universeSourceAsOfDate: string
  selectedCount: number
  accountedTickers: number
  status: "complete" | "partial"
  counts: {
    succeeded: number
    skipped: number
    partial: number
    failed: number
    partitionsConsidered: number
    partitionsArchived: number
    partitionsDeferred: number
    failures: number
    rowsArchived: number
    rowsPruned: number
    bytesWritten: number
  }
  capacity: {
    initialLevel: ChartStorageCapacity["level"]
    finalLevel: ChartStorageCapacity["level"]
    initialDatabaseBytes: number
    finalDatabaseBytes: number
    initialHotTotalBytes: number
    finalHotTotalBytes: number
  }
  results: Qeo228ArchiveTickerResult[]
}

function requireSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role unavailable for QEO-228 chart archive catch-up")
  return supabase
}

function validDispatchId(value: string) {
  const normalized = String(value || "").trim()
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(normalized)) throw new Error("QEO-228 archive catch-up requires a valid dispatchId")
  return normalized
}

function normalizeTicker(value: string) {
  const ticker = String(value || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("QEO-228 archive catch-up requires a valid ticker")
  return ticker
}

function metricsResult(ticker: string, metrics: ChartIntradayArchiveMetrics): Qeo228ArchiveTickerResult {
  return {
    ticker,
    status: metrics.status,
    partitionsConsidered: metrics.partitionsConsidered,
    partitionsArchived: metrics.partitionsArchived,
    rowsArchived: metrics.rowsArchived,
    rowsPruned: metrics.rowsPruned,
    bytesWritten: metrics.bytesWritten,
    partitionsDeferred: metrics.partitionsDeferred,
    failures: metrics.failures.length,
    oldestHotBar: metrics.oldestHotBar,
    error: metrics.failures.length ? metrics.failures.map((item) => `${item.tradingDate}: ${item.error}`).join("; ").slice(0, 1_000) : null,
  }
}

export async function startChartIntradayArchiveCatchupStep(
  startedAtIso: string,
  dispatchIdInput: string,
): Promise<Qeo228ArchiveCatchupContext> {
  "use step"

  const startedAt = new Date(startedAtIso)
  if (!Number.isFinite(startedAt.getTime())) throw new Error("QEO-228 archive catch-up requires a valid startedAt timestamp")
  const dispatchId = validDispatchId(dispatchIdInput)
  const universe = await getCanonicalUniverse()
  if (universe.selectedCount < 1 || universe.selectedCount > MAX_CANONICAL_UNIVERSE_SIZE || universe.stocks.length !== universe.selectedCount) {
    throw new Error(`QEO-228 invalid canonical universe size ${universe.selectedCount}`)
  }
  const tickers = universe.stocks.map((stock) => normalizeTicker(stock.ticker))
  const initialCapacity = await readChartStorageCapacity(requireSupabase())

  return {
    startedAt: startedAt.toISOString(),
    dispatchId,
    universeRunId: universe.runId,
    universeSourceAsOfDate: universe.sourceAsOfDate,
    selectedCount: universe.selectedCount,
    tickers,
    initialCapacity,
  }
}

export async function runChartIntradayArchiveTickerStep(input: {
  ticker: string
  referenceAt: string
}): Promise<Qeo228ArchiveTickerResult> {
  "use step"

  const ticker = normalizeTicker(input.ticker)
  const referenceAt = new Date(input.referenceAt)
  if (!Number.isFinite(referenceAt.getTime())) throw new Error("QEO-228 archive ticker step requires a valid referenceAt timestamp")

  try {
    const metrics = await runChartIntradayArchiveLifecycle(requireSupabase(), {
      referenceAt,
      ticker,
      maxPartitions: QEO228_MAX_PARTITIONS_PER_TICKER,
    })
    return metricsResult(ticker, metrics)
  } catch (cause) {
    return {
      ticker,
      status: "failed",
      partitionsConsidered: 0,
      partitionsArchived: 0,
      rowsArchived: 0,
      rowsPruned: 0,
      bytesWritten: 0,
      partitionsDeferred: 0,
      failures: 1,
      oldestHotBar: null,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

export async function finishChartIntradayArchiveCatchupStep(input: {
  context: Qeo228ArchiveCatchupContext
  results: Qeo228ArchiveTickerResult[]
}): Promise<Qeo228ArchiveCatchupSummary> {
  "use step"

  const finalCapacity = await readChartStorageCapacity(requireSupabase())
  const results = input.results
  const counts = {
    succeeded: results.filter((item) => item.status === "succeeded").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    partial: results.filter((item) => item.status === "partial").length,
    failed: results.filter((item) => item.status === "failed").length,
    partitionsConsidered: results.reduce((sum, item) => sum + item.partitionsConsidered, 0),
    partitionsArchived: results.reduce((sum, item) => sum + item.partitionsArchived, 0),
    partitionsDeferred: results.reduce((sum, item) => sum + item.partitionsDeferred, 0),
    failures: results.reduce((sum, item) => sum + item.failures, 0),
    rowsArchived: results.reduce((sum, item) => sum + item.rowsArchived, 0),
    rowsPruned: results.reduce((sum, item) => sum + item.rowsPruned, 0),
    bytesWritten: results.reduce((sum, item) => sum + item.bytesWritten, 0),
  }
  const accountedTickers = results.length
  const status = accountedTickers === input.context.selectedCount && counts.failed === 0 && counts.partial === 0
    ? "complete"
    : "partial"

  return {
    dispatchId: input.context.dispatchId,
    startedAt: input.context.startedAt,
    finishedAt: new Date().toISOString(),
    universeRunId: input.context.universeRunId,
    universeSourceAsOfDate: input.context.universeSourceAsOfDate,
    selectedCount: input.context.selectedCount,
    accountedTickers,
    status,
    counts,
    capacity: {
      initialLevel: input.context.initialCapacity.level,
      finalLevel: finalCapacity.level,
      initialDatabaseBytes: input.context.initialCapacity.databaseBytes,
      finalDatabaseBytes: finalCapacity.databaseBytes,
      initialHotTotalBytes: input.context.initialCapacity.hotTotalBytes,
      finalHotTotalBytes: finalCapacity.hotTotalBytes,
    },
    results,
  }
}
