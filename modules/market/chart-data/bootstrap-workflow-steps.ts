import "server-only"

import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import {
  QEO107_HOT_RETENTION_SESSIONS,
  bootstrapChartIntradayChunk,
  qeo107BootstrapTarget,
  readChartIntradayCoverageReport,
  type Qeo107BootstrapChunk,
  type Qeo107BootstrapChunkResult,
  type Qeo107BootstrapTarget,
  type Qeo107CoverageRow,
} from "./bootstrap"

const CANONICAL_QEO107_UNIVERSE_SIZE = 200
export const QEO107_BOOTSTRAP_BATCH_SIZE = 10
export const QEO107_CAPACITY_WARN_BYTES = 350 * 1024 * 1024
export const QEO107_CAPACITY_HARD_STOP_BYTES = 400 * 1024 * 1024
const QEO107_CAPACITY_ROWS_PER_TICKER = 5 * 240
const QEO107_CAPACITY_BYTES_PER_ROW = 900

export interface Qeo107BootstrapStock {
  ticker: string
  rank: number
  exchange: string | null
}

export interface Qeo107StorageCapacity {
  databaseBytes: number
  hotRows: number
  hotHeapBytes: number
  hotIndexBytes: number
  hotTotalBytes: number
  partitionCount: number
  oldestHotSession: string | null
  newestHotSession: string | null
}

export interface Qeo107CapacityGate {
  capacity: Qeo107StorageCapacity
  upcomingTickers: number
  projectedBatchBytes: number
  projectedDatabaseBytes: number
  warning: boolean
  allowed: boolean
  reason: string | null
}

export interface Qeo107BootstrapContext {
  startedAt: string
  universeRunId: string
  universeSourceAsOfDate: string
  selectedCount: number
  stocks: Qeo107BootstrapStock[]
  target: Qeo107BootstrapTarget
  initialCapacity: Qeo107CapacityGate
}

export interface Qeo107BootstrapWorkflowSummary {
  stoppedEarly: boolean
  stopReason: string | null
  attemptedChunks: number
  succeededChunks: number
  skippedChunks: number
  providerGapChunks: number
  retryableFailureChunks: number
  failedChunks: number
  capacity: {
    warningCheckpoints: number
    initialDatabaseBytes: number
    finalDatabaseBytes: number
    warnBytes: number
    hardStopBytes: number
  }
  coverage: {
    tickerCount: number
    hotCoveredTickers: number
    partialHotTickers: number
    coldCoveredTickers: number
    derivedHourlyCoveredTickers: number
    providerGapTickers: number
    retryableFailureTickers: number
    failedAttemptTickers: number
  }
  rows: Qeo107CoverageRow[]
}

function requireSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role unavailable for QEO-107 chart bootstrap")
  return supabase
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function nullableString(value: unknown) {
  return value == null || value === "" ? null : String(value)
}

export function projectedBatchBytes(tickerCount: number) {
  return Math.max(0, Math.floor(tickerCount)) * QEO107_CAPACITY_ROWS_PER_TICKER * QEO107_CAPACITY_BYTES_PER_ROW
}

function capacityGate(capacity: Qeo107StorageCapacity, upcomingTickers: number): Qeo107CapacityGate {
  const projected = projectedBatchBytes(upcomingTickers)
  const projectedDatabaseBytes = capacity.databaseBytes + projected
  const allowed = capacity.databaseBytes < QEO107_CAPACITY_HARD_STOP_BYTES
    && projectedDatabaseBytes < QEO107_CAPACITY_HARD_STOP_BYTES
  const warning = capacity.databaseBytes >= QEO107_CAPACITY_WARN_BYTES
    || projectedDatabaseBytes >= QEO107_CAPACITY_WARN_BYTES
  const reason = allowed
    ? null
    : `QEO-107 capacity hard-stop: database=${capacity.databaseBytes} projected=${projectedDatabaseBytes} limit=${QEO107_CAPACITY_HARD_STOP_BYTES}; archive/prune or increase capacity before rerun.`
  return { capacity, upcomingTickers, projectedBatchBytes: projected, projectedDatabaseBytes, warning, allowed, reason }
}

async function readChartStorageCapacity(): Promise<Qeo107StorageCapacity> {
  const { data, error } = await requireSupabase().rpc("qeo_chart_storage_capacity")
  if (error) throw new Error(`QEO-107 capacity preflight failed: ${error.message}`)
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const databaseBytes = finiteNumber(raw.databaseBytes)
  if (databaseBytes <= 0) throw new Error("QEO-107 capacity preflight returned an invalid databaseBytes value")
  return {
    databaseBytes,
    hotRows: finiteNumber(raw.hotRows),
    hotHeapBytes: finiteNumber(raw.hotHeapBytes),
    hotIndexBytes: finiteNumber(raw.hotIndexBytes),
    hotTotalBytes: finiteNumber(raw.hotTotalBytes),
    partitionCount: finiteNumber(raw.partitionCount),
    oldestHotSession: nullableString(raw.oldestHotSession),
    newestHotSession: nullableString(raw.newestHotSession),
  }
}

export async function startChartIntradayBootstrapStep(startedAtIso: string): Promise<Qeo107BootstrapContext> {
  "use step"

  const startedAt = new Date(startedAtIso)
  if (Number.isNaN(startedAt.getTime())) throw new Error("QEO-107 bootstrap requires a valid startedAt timestamp")
  const universe = await getCanonicalUniverse()
  if (universe.selectedCount !== CANONICAL_QEO107_UNIVERSE_SIZE || universe.stocks.length !== CANONICAL_QEO107_UNIVERSE_SIZE) {
    throw new Error(`QEO-107 requires canonical ${CANONICAL_QEO107_UNIVERSE_SIZE} universe, found ${universe.selectedCount}`)
  }
  const capacity = await readChartStorageCapacity()
  return {
    startedAt: startedAt.toISOString(),
    universeRunId: universe.runId,
    universeSourceAsOfDate: universe.sourceAsOfDate,
    selectedCount: universe.selectedCount,
    stocks: universe.stocks.map((stock) => ({ ticker: stock.ticker, rank: stock.rank, exchange: stock.exchange })),
    target: qeo107BootstrapTarget(startedAt),
    initialCapacity: capacityGate(capacity, Math.min(QEO107_BOOTSTRAP_BATCH_SIZE, universe.stocks.length)),
  }
}

export async function checkChartIntradayBootstrapCapacityStep(input: { upcomingTickers: number }): Promise<Qeo107CapacityGate> {
  "use step"

  return capacityGate(await readChartStorageCapacity(), input.upcomingTickers)
}

export async function runChartIntradayBootstrapTickerStep(input: {
  ticker: string
  chunk: Qeo107BootstrapChunk
  referenceAt: string
}): Promise<Qeo107BootstrapChunkResult> {
  "use step"

  const referenceAt = new Date(input.referenceAt)
  if (Number.isNaN(referenceAt.getTime())) throw new Error("QEO-107 ticker step requires a valid referenceAt timestamp")
  return bootstrapChartIntradayChunk(requireSupabase(), {
    ticker: input.ticker,
    chunk: input.chunk,
    referenceAt,
  })
}

export async function finishChartIntradayBootstrapStep(input: {
  context: Qeo107BootstrapContext
  stoppedEarly: boolean
  stopReason: string | null
  attemptedChunks: number
  succeededChunks: number
  skippedChunks: number
  providerGapChunks: number
  retryableFailureChunks: number
  failedChunks: number
  capacityWarningCheckpoints: number
}): Promise<Qeo107BootstrapWorkflowSummary> {
  "use step"

  const rows = await readChartIntradayCoverageReport(requireSupabase(), {
    tickers: input.context.stocks.map((stock) => stock.ticker),
    referenceAt: new Date(input.context.startedAt),
  })
  if (rows.length !== input.context.selectedCount) {
    throw new Error(`QEO-107 coverage report mismatch ${rows.length}/${input.context.selectedCount}`)
  }
  const finalCapacity = await readChartStorageCapacity()
  return {
    stoppedEarly: input.stoppedEarly,
    stopReason: input.stopReason,
    attemptedChunks: input.attemptedChunks,
    succeededChunks: input.succeededChunks,
    skippedChunks: input.skippedChunks,
    providerGapChunks: input.providerGapChunks,
    retryableFailureChunks: input.retryableFailureChunks,
    failedChunks: input.failedChunks,
    capacity: {
      warningCheckpoints: input.capacityWarningCheckpoints,
      initialDatabaseBytes: input.context.initialCapacity.capacity.databaseBytes,
      finalDatabaseBytes: finalCapacity.databaseBytes,
      warnBytes: QEO107_CAPACITY_WARN_BYTES,
      hardStopBytes: QEO107_CAPACITY_HARD_STOP_BYTES,
    },
    coverage: {
      tickerCount: rows.length,
      hotCoveredTickers: rows.filter((row) => row.hotSessionCount >= QEO107_HOT_RETENTION_SESSIONS).length,
      partialHotTickers: rows.filter((row) => row.hotSessionCount > 0 && row.hotSessionCount < QEO107_HOT_RETENTION_SESSIONS).length,
      coldCoveredTickers: rows.filter((row) => row.coldManifestCount > 0).length,
      derivedHourlyCoveredTickers: rows.filter((row) => row.derivedHourlyRowCount > 0).length,
      providerGapTickers: rows.filter((row) => row.providerGapCount > 0).length,
      retryableFailureTickers: rows.filter((row) => row.retryableFailureCount > 0).length,
      failedAttemptTickers: rows.filter((row) => row.failedAttemptCount > 0).length,
    },
    rows,
  }
}
