import "server-only"

import { getCanonicalUniverse, getCanonicalUniverseVersion } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { readChartIntradayMaintenanceReport, type Qeo150FreshnessRow } from "./maintenance"
import { isQeo150RecoverableCompletedSession, type Qeo150AttemptOutcome } from "./maintenance-policy"
import { readChartStorageCapacity, type ChartStorageCapacity } from "./storage-capacity"
import type { Qeo150MaintenanceTickerResult } from "./maintenance-workflow-steps"

const CANONICAL_QEO150_UNIVERSE_SIZE = 200
export const QEO150_RECOVERY_MAX_TICKERS = 10

export interface Qeo150MaintenanceRecoveryContext {
  startedAt: string
  dispatchId: string
  sessionDate: string
  universeRunId: string
  universeSourceAsOfDate: string
  selectedCount: number
  stocks: Array<{ ticker: string; rank: number; exchange: string | null }>
  initialCapacity: ChartStorageCapacity
  initialRows: Qeo150FreshnessRow[]
}

export interface Qeo150MaintenanceRecoverySummary {
  dispatchId: string
  startedAt: string
  finishedAt: string
  sessionDate: string
  universeRunId: string
  universeSourceAsOfDate: string
  universeChangedDuringRun: boolean
  selectedCount: number
  accountedTickers: number
  status: "complete" | "partial"
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
  if (!supabase) throw new Error("Supabase service role unavailable for QEO-150 chart maintenance recovery")
  return supabase
}

function validDispatchId(value: string) {
  const normalized = String(value || "").trim()
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(normalized)) throw new Error("QEO-150 recovery requires a valid dispatchId")
  return normalized
}

function normalizedRecoveryTickers(tickers: string[]) {
  const normalized = [...new Set(tickers.map((ticker) => String(ticker || "").trim().toUpperCase()).filter(Boolean))]
  if (!normalized.length || normalized.length > QEO150_RECOVERY_MAX_TICKERS) {
    throw new Error(`QEO-150 recovery requires 1-${QEO150_RECOVERY_MAX_TICKERS} canonical tickers`)
  }
  if (normalized.some((ticker) => !/^[A-Z0-9]{2,12}$/.test(ticker))) {
    throw new Error("QEO-150 recovery received an invalid ticker")
  }
  return normalized
}

export async function startChartIntradayMaintenanceRecoveryStep(input: {
  startedAtIso: string
  dispatchId: string
  sessionDate: string
  tickers: string[]
}): Promise<Qeo150MaintenanceRecoveryContext> {
  "use step"

  const startedAt = new Date(input.startedAtIso)
  if (!Number.isFinite(startedAt.getTime())) throw new Error("QEO-150 recovery requires a valid startedAt timestamp")
  const dispatchId = validDispatchId(input.dispatchId)
  const sessionDate = String(input.sessionDate || "").trim()
  if (!isQeo150RecoverableCompletedSession(sessionDate, startedAt)) {
    throw new Error(`QEO-150 recovery requires a completed Vietnam trading session: ${sessionDate || "missing"}`)
  }

  const requestedTickers = normalizedRecoveryTickers(input.tickers)
  const universe = await getCanonicalUniverse()
  if (universe.selectedCount !== CANONICAL_QEO150_UNIVERSE_SIZE || universe.stocks.length !== CANONICAL_QEO150_UNIVERSE_SIZE) {
    throw new Error(`QEO-150 recovery requires canonical ${CANONICAL_QEO150_UNIVERSE_SIZE} universe, found ${universe.selectedCount}`)
  }
  const canonicalTickers = new Set(universe.stocks.map((stock) => stock.ticker.toUpperCase()))
  const outsideCanonical = requestedTickers.filter((ticker) => !canonicalTickers.has(ticker))
  if (outsideCanonical.length) {
    throw new Error(`QEO-150 recovery tickers must belong to the canonical universe: ${outsideCanonical.join(", ")}`)
  }

  const stockByTicker = new Map(universe.stocks.map((stock) => [stock.ticker.toUpperCase(), stock]))
  const stocks = requestedTickers.map((ticker) => {
    const stock = stockByTicker.get(ticker)
    if (!stock) throw new Error(`QEO-150 recovery canonical ticker disappeared: ${ticker}`)
    return { ticker, rank: stock.rank, exchange: stock.exchange }
  })
  const supabase = requireSupabase()
  const [initialRows, initialCapacity] = await Promise.all([
    readChartIntradayMaintenanceReport(supabase, {
      tickers: requestedTickers,
      referenceAt: startedAt,
      expectedSession: sessionDate,
    }),
    readChartStorageCapacity(supabase),
  ])
  if (initialRows.length !== requestedTickers.length) {
    throw new Error(`QEO-150 recovery initial coverage mismatch ${initialRows.length}/${requestedTickers.length}`)
  }

  return {
    startedAt: startedAt.toISOString(),
    dispatchId,
    sessionDate,
    universeRunId: universe.runId,
    universeSourceAsOfDate: universe.sourceAsOfDate,
    selectedCount: requestedTickers.length,
    stocks,
    initialCapacity,
    initialRows,
  }
}

export async function finishChartIntradayMaintenanceRecoveryStep(input: {
  context: Qeo150MaintenanceRecoveryContext
  results: Qeo150MaintenanceTickerResult[]
}): Promise<Qeo150MaintenanceRecoverySummary> {
  "use step"

  const resultByTicker = new Map(input.results.map((result) => [result.ticker, result]))
  const outcomeOverrides = new Map<string, Qeo150AttemptOutcome>(
    input.results.map((result) => [result.ticker, result.outcome]),
  )
  const referenceAt = new Date(input.context.startedAt)
  const supabase = requireSupabase()
  const [rows, finalCapacity, latestUniverse] = await Promise.all([
    readChartIntradayMaintenanceReport(supabase, {
      tickers: input.context.stocks.map((stock) => stock.ticker),
      referenceAt,
      expectedSession: input.context.sessionDate,
      outcomeOverrides,
      dispatchId: input.context.dispatchId,
    }),
    readChartStorageCapacity(supabase),
    getCanonicalUniverseVersion(),
  ])
  const accountedTickers = rows.filter((row) => resultByTicker.has(row.ticker)).length
  const structurallyComplete = rows.length === input.context.selectedCount && accountedTickers === input.context.selectedCount

  return {
    dispatchId: input.context.dispatchId,
    startedAt: input.context.startedAt,
    finishedAt: new Date().toISOString(),
    sessionDate: input.context.sessionDate,
    universeRunId: input.context.universeRunId,
    universeSourceAsOfDate: input.context.universeSourceAsOfDate,
    universeChangedDuringRun: latestUniverse.runId !== input.context.universeRunId,
    selectedCount: input.context.selectedCount,
    accountedTickers,
    status: structurallyComplete ? "complete" : "partial",
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
