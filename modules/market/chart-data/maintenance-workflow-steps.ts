import "server-only"

import { getCanonicalUniverse, getCanonicalUniverseVersion } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import {
  ingestClosedIntradayRange,
  readChartIntradayMaintenanceReport,
  recordQeo150CapacityStop,
  type Qeo150FreshnessRow,
} from "./maintenance"
import {
  expectedCompletedVietnamSession,
  qeo150SessionRange,
  type Qeo150AttemptOutcome,
  type Qeo150EvidenceCategory,
} from "./maintenance-policy"
import { readChartStorageCapacity, type ChartStorageCapacity } from "./storage-capacity"

const CANONICAL_QEO150_UNIVERSE_SIZE = 200
export const QEO150_MAINTENANCE_BATCH_SIZE = 10
export const QEO150_MAX_RETRYABLE_ATTEMPTS = 2
export const QEO150_RECONCILIATION_SLA_MINUTES = 30

export interface Qeo150MaintenanceStock {
  ticker: string
  rank: number
  exchange: string | null
}

export interface Qeo150MaintenanceContext {
  startedAt: string
  dispatchId: string
  universeRunId: string
  universeSourceAsOfDate: string
  selectedCount: number
  expectedSession: string
  stocks: Qeo150MaintenanceStock[]
  initialCapacity: ChartStorageCapacity
  initialRows: Qeo150FreshnessRow[]
}

export interface Qeo150MaintenanceTickerResult {
  ticker: string
  expectedSession: string
  actualSession: string | null
  current: boolean
  evidenceCategory: Qeo150EvidenceCategory
  outcome: Qeo150AttemptOutcome
  attempts: number
  provider: string | null
  rowCount: number
  error: string | null
}

export interface Qeo150MaintenanceCapacityGate {
  allowed: boolean
  capacity: ChartStorageCapacity
  reason: string | null
}

export interface Qeo150MaintenanceSummary {
  dispatchId: string
  startedAt: string
  finishedAt: string
  universeRunId: string
  universeSourceAsOfDate: string
  universeChangedDuringRun: boolean
  expectedSession: string
  selectedCount: number
  accountedTickers: number
  status: "complete" | "late" | "partial"
  slaDeadline: string
  slaMet: boolean
  counts: {
    verifiedCurrent: number
    noTrade: number
    suspension: number
    providerGap: number
    failure: number
    unknown: number
    retryableFailure: number
    capacityStop: number
  }
  capacity: {
    initialLevel: ChartStorageCapacity["level"]
    finalLevel: ChartStorageCapacity["level"]
    initialDatabaseBytes: number
    finalDatabaseBytes: number
  }
  rows: Qeo150FreshnessRow[]
}

function requireSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role unavailable for QEO-150 chart maintenance")
  return supabase
}

function validDispatchId(value: string) {
  const normalized = String(value || "").trim()
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(normalized)) throw new Error("QEO-150 maintenance requires a valid dispatchId")
  return normalized
}

function resultFromRow(
  row: Qeo150FreshnessRow,
  outcome: Qeo150AttemptOutcome,
  input: { attempts: number; provider?: string | null; rowCount?: number; error?: string | null },
): Qeo150MaintenanceTickerResult {
  return {
    ticker: row.ticker,
    expectedSession: row.expectedSession,
    actualSession: row.actualSession,
    current: row.current,
    evidenceCategory: row.evidenceCategory,
    outcome,
    attempts: input.attempts,
    provider: input.provider ?? null,
    rowCount: input.rowCount ?? 0,
    error: input.error ?? null,
  }
}

export async function startChartIntradayMaintenanceStep(
  startedAtIso: string,
  dispatchIdInput: string,
): Promise<Qeo150MaintenanceContext> {
  "use step"

  const startedAt = new Date(startedAtIso)
  if (!Number.isFinite(startedAt.getTime())) throw new Error("QEO-150 maintenance requires a valid startedAt timestamp")
  const dispatchId = validDispatchId(dispatchIdInput)
  const universe = await getCanonicalUniverse()
  if (universe.selectedCount !== CANONICAL_QEO150_UNIVERSE_SIZE || universe.stocks.length !== CANONICAL_QEO150_UNIVERSE_SIZE) {
    throw new Error(`QEO-150 requires canonical ${CANONICAL_QEO150_UNIVERSE_SIZE} universe, found ${universe.selectedCount}`)
  }
  const expectedSession = expectedCompletedVietnamSession(startedAt)
  const stocks = universe.stocks.map((stock) => ({ ticker: stock.ticker, rank: stock.rank, exchange: stock.exchange }))
  const tickers = stocks.map((stock) => stock.ticker)
  const [initialRows, initialCapacity] = await Promise.all([
    readChartIntradayMaintenanceReport(requireSupabase(), { tickers, referenceAt: startedAt, expectedSession }),
    readChartStorageCapacity(requireSupabase()),
  ])
  if (initialRows.length !== stocks.length) throw new Error(`QEO-150 initial coverage mismatch ${initialRows.length}/${stocks.length}`)

  return {
    startedAt: startedAt.toISOString(),
    dispatchId,
    universeRunId: universe.runId,
    universeSourceAsOfDate: universe.sourceAsOfDate,
    selectedCount: stocks.length,
    expectedSession,
    stocks,
    initialCapacity,
    initialRows,
  }
}

export async function checkChartIntradayMaintenanceCapacityStep(): Promise<Qeo150MaintenanceCapacityGate> {
  "use step"

  const capacity = await readChartStorageCapacity(requireSupabase())
  return {
    allowed: capacity.level !== "HARD_STOP",
    capacity,
    reason: capacity.level === "HARD_STOP"
      ? `QEO-150 capacity hard-stop at ${capacity.databaseBytes} bytes; maintenance will not fetch or write more 1m data.`
      : null,
  }
}

export async function runChartIntradayMaintenanceTickerStep(input: {
  ticker: string
  expectedSession: string
  dispatchId: string
  referenceAt: string
  attempt: number
}): Promise<Qeo150MaintenanceTickerResult> {
  "use step"

  const referenceAt = new Date(input.referenceAt)
  if (!Number.isFinite(referenceAt.getTime())) throw new Error("QEO-150 ticker step requires a valid referenceAt timestamp")
  const supabase = requireSupabase()
  const before = (await readChartIntradayMaintenanceReport(supabase, {
    tickers: [input.ticker],
    referenceAt,
    expectedSession: input.expectedSession,
    dispatchId: input.dispatchId,
  }))[0]
  if (!before) throw new Error(`QEO-150 missing pre-ingestion freshness row for ${input.ticker}`)
  if (before.current) return resultFromRow(before, "already_fresh", { attempts: input.attempt })
  if (before.evidenceCategory === "no_trade") return resultFromRow(before, "no_trade", { attempts: input.attempt })
  if (before.evidenceCategory === "suspension") return resultFromRow(before, "suspension", { attempts: input.attempt })

  const ingested = await ingestClosedIntradayRange(supabase, {
    ticker: input.ticker,
    expectedSession: input.expectedSession,
    dispatchId: input.dispatchId,
    referenceAt,
  })
  const override = new Map<string, Qeo150AttemptOutcome>([[input.ticker, ingested.outcome]])
  const after = (await readChartIntradayMaintenanceReport(supabase, {
    tickers: [input.ticker],
    referenceAt,
    expectedSession: input.expectedSession,
    outcomeOverrides: override,
    dispatchId: input.dispatchId,
  }))[0]
  if (!after) throw new Error(`QEO-150 missing post-ingestion freshness row for ${input.ticker}`)

  let outcome: Qeo150AttemptOutcome = ingested.outcome
  let error = ingested.error
  if ((ingested.outcome === "ingested" || ingested.outcome === "reused") && !after.current) {
    outcome = after.evidenceCategory === "provider_gap" ? "provider_gap" : "unknown"
    error = error ?? `QEO-150 ${input.ticker} persisted/reused provider evidence but actual HOT session is ${after.actualSession ?? "missing"}, expected ${input.expectedSession}`
  }
  return resultFromRow(after, outcome, {
    attempts: input.attempt,
    provider: ingested.provider,
    rowCount: ingested.rowCount,
    error,
  })
}

export async function recordChartIntradayMaintenanceCapacityStopStep(input: {
  tickers: string[]
  expectedSession: string
  dispatchId: string
  referenceAt: string
  reason: string
}): Promise<Qeo150MaintenanceTickerResult[]> {
  "use step"

  const referenceAt = new Date(input.referenceAt)
  const supabase = requireSupabase()
  await Promise.all(input.tickers.map((ticker) => recordQeo150CapacityStop(supabase, {
    ticker,
    expectedSession: input.expectedSession,
    dispatchId: input.dispatchId,
    reason: input.reason,
  })))
  const overrides = new Map(input.tickers.map((ticker) => [ticker, "capacity_stop" as const]))
  const rows = await readChartIntradayMaintenanceReport(supabase, {
    tickers: input.tickers,
    referenceAt,
    expectedSession: input.expectedSession,
    outcomeOverrides: overrides,
    dispatchId: input.dispatchId,
  })
  return rows.map((row) => resultFromRow(row, "capacity_stop", { attempts: 0, error: input.reason }))
}

export async function finishChartIntradayMaintenanceStep(input: {
  context: Qeo150MaintenanceContext
  results: Qeo150MaintenanceTickerResult[]
}): Promise<Qeo150MaintenanceSummary> {
  "use step"

  const resultByTicker = new Map(input.results.map((result) => [result.ticker, result]))
  const outcomeOverrides = new Map<string, Qeo150AttemptOutcome>(
    [...resultByTicker.values()].map((result) => [result.ticker, result.outcome]),
  )
  const referenceAt = new Date(input.context.startedAt)
  const [rows, finalCapacity, latestUniverse] = await Promise.all([
    readChartIntradayMaintenanceReport(requireSupabase(), {
      tickers: input.context.stocks.map((stock) => stock.ticker),
      referenceAt,
      expectedSession: input.context.expectedSession,
      outcomeOverrides,
      dispatchId: input.context.dispatchId,
    }),
    readChartStorageCapacity(requireSupabase()),
    getCanonicalUniverseVersion(),
  ])
  const finishedAt = new Date()
  const sessionRange = qeo150SessionRange(input.context.expectedSession)
  const slaDeadline = new Date(sessionRange.to * 1000 + QEO150_RECONCILIATION_SLA_MINUTES * 60_000)
  const accountedTickers = rows.filter((row) => resultByTicker.has(row.ticker)).length
  const structurallyComplete = rows.length === input.context.selectedCount && accountedTickers === input.context.selectedCount
  const slaMet = structurallyComplete && finishedAt.getTime() <= slaDeadline.getTime()
  const status: Qeo150MaintenanceSummary["status"] = !structurallyComplete ? "partial" : slaMet ? "complete" : "late"

  return {
    dispatchId: input.context.dispatchId,
    startedAt: input.context.startedAt,
    finishedAt: finishedAt.toISOString(),
    universeRunId: input.context.universeRunId,
    universeSourceAsOfDate: input.context.universeSourceAsOfDate,
    universeChangedDuringRun: latestUniverse.runId !== input.context.universeRunId,
    expectedSession: input.context.expectedSession,
    selectedCount: input.context.selectedCount,
    accountedTickers,
    status,
    slaDeadline: slaDeadline.toISOString(),
    slaMet,
    counts: {
      verifiedCurrent: rows.filter((row) => row.current).length,
      noTrade: rows.filter((row) => row.evidenceCategory === "no_trade").length,
      suspension: rows.filter((row) => row.evidenceCategory === "suspension").length,
      providerGap: rows.filter((row) => row.evidenceCategory === "provider_gap").length,
      failure: rows.filter((row) => row.evidenceCategory === "failure").length,
      unknown: rows.filter((row) => row.evidenceCategory === "unknown").length,
      retryableFailure: input.results.filter((result) => result.outcome === "retryable_failure").length,
      capacityStop: input.results.filter((result) => result.outcome === "capacity_stop").length,
    },
    capacity: {
      initialLevel: input.context.initialCapacity.level,
      finalLevel: finalCapacity.level,
      initialDatabaseBytes: input.context.initialCapacity.databaseBytes,
      finalDatabaseBytes: finalCapacity.databaseBytes,
    },
    rows,
  }
}
