import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { refreshOhlcvHistoryBatch } from "@/modules/market/history/ohlcv-store"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import {
  QEO107_HOT_RETENTION_SESSIONS,
  bootstrapChartIntradayChunk,
  qeo107BootstrapTarget,
  readChartIntradayCoverageReport,
} from "./bootstrap"
import { readChartStorageCapacity } from "./storage-capacity"

export const QEO105_BOOTSTRAP_BATCH_SIZE = 5
export const QEO105_MAX_RETRYABLE_ATTEMPTS = 2

export type Qeo105TickerStatus = "pending" | "running" | "ready" | "provider_gap" | "retryable" | "failed" | "capacity_stop"
export type Qeo105DailyStatus = "pending" | "running" | "ready" | "retryable" | "failed"
export type Qeo105IntradayStatus = "pending" | "running" | "ready" | "provider_gap" | "retryable" | "failed" | "capacity_stop"

export interface Qeo105TickerState {
  ticker: string
  status: Qeo105TickerStatus
  dailyStatus: Qeo105DailyStatus
  intradayStatus: Qeo105IntradayStatus
  attemptCount: number
  dailyRows: number
  dailyLastBarTime: string | null
  intradayHotSessions: number
  lastError: string | null
}

export interface Qeo105UniverseBootstrapContext {
  claimed: boolean
  reason: string | null
  startedAt: string
  dispatchId: string
  transitionId: string
  universeKey: string | null
  previousRunId: string | null
  newRunId: string | null
  addedTickers: string[]
  removedTickers: string[]
  unchangedCount: number
  transitionAttemptCount: number
  tickers: Qeo105TickerState[]
}

export interface Qeo105DailyResult {
  ticker: string
  status: "ready" | "retryable" | "failed"
  skipped: boolean
  dailyRows: number
  dailyLastBarTime: string | null
  error: string | null
}

export interface Qeo105IntradayResult {
  ticker: string
  status: "ready" | "provider_gap" | "retryable" | "failed" | "capacity_stop"
  skipped: boolean
  hotSessionCount: number
  failureCodes: string[]
  error: string | null
}

export interface Qeo105UniverseBootstrapSummary {
  transitionId: string
  dispatchId: string
  startedAt: string
  finishedAt: string
  claimed: boolean
  reason: string | null
  previousRunId: string | null
  newRunId: string | null
  addedTickers: string[]
  removedTickers: string[]
  unchangedCount: number
  status: "noop" | "complete" | "retryable" | "partial" | "failed"
  counts: {
    total: number
    ready: number
    retryable: number
    providerGap: number
    failed: number
    capacityStop: number
  }
  tickers: Qeo105TickerState[]
}

function requireSupabase(): SupabaseClient {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role unavailable for QEO-105 universe bootstrap")
  return supabase as unknown as SupabaseClient
}

function validUuid(value: string, label: string) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`QEO-105 requires a valid ${label}`)
  }
  return normalized
}

function validTicker(value: string) {
  const ticker = String(value || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid QEO-105 ticker: ${value}`)
  return ticker
}

function validDispatchId(value: string) {
  const normalized = String(value || "").trim()
  if (!/^qeo105-[A-Za-z0-9_-]{8,128}$/.test(normalized)) throw new Error("QEO-105 requires a valid dispatchId")
  return normalized
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => validTicker(String(item))))].sort()
}

function finiteNonNegative(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length ? value : null
}

function tickerState(value: unknown): Qeo105TickerState {
  const raw = object(value)
  return {
    ticker: validTicker(String(raw.ticker ?? "")),
    status: String(raw.status ?? "pending") as Qeo105TickerStatus,
    dailyStatus: String(raw.dailyStatus ?? "pending") as Qeo105DailyStatus,
    intradayStatus: String(raw.intradayStatus ?? "pending") as Qeo105IntradayStatus,
    attemptCount: finiteNonNegative(raw.attemptCount),
    dailyRows: finiteNonNegative(raw.dailyRows),
    dailyLastBarTime: nullableString(raw.dailyLastBarTime),
    intradayHotSessions: finiteNonNegative(raw.intradayHotSessions),
    lastError: nullableString(raw.lastError),
  }
}

async function updateTickerState(
  supabase: SupabaseClient,
  transitionId: string,
  ticker: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("chart_universe_bootstrap_tickers")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("transition_id", transitionId)
    .eq("ticker", ticker)
  if (error) throw new Error(`QEO-105 ticker state update failed for ${ticker}: ${error.message}`)
}

async function readDailyCoverage(supabase: SupabaseClient, ticker: string) {
  const { data, error } = await supabase.rpc("qeo_market_ohlcv_coverage", { p_tickers: [ticker] })
  if (error) throw new Error(`QEO-105 Daily coverage failed for ${ticker}: ${error.message}`)
  const row = ((data || []) as Array<Record<string, unknown>>).find((item) => String(item.timeframe) === "1D")
  return {
    rowCount: finiteNonNegative(row?.row_count),
    lastBarTime: nullableString(row?.last_bar_time),
  }
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error ?? "unknown")).replace(/[\r\n\t]+/g, " ").slice(0, 500)
}

export async function startChartUniverseBootstrapStep(
  transitionIdInput: string,
  startedAtIso: string,
  dispatchIdInput: string,
): Promise<Qeo105UniverseBootstrapContext> {
  "use step"

  const transitionId = validUuid(transitionIdInput, "transitionId")
  const dispatchId = validDispatchId(dispatchIdInput)
  const startedAt = new Date(startedAtIso)
  if (!Number.isFinite(startedAt.getTime())) throw new Error("QEO-105 requires a valid startedAt timestamp")

  const { data, error } = await requireSupabase().rpc("qeo_claim_chart_universe_bootstrap_transition", {
    p_transition_id: transitionId,
    p_dispatch_id: dispatchId,
  })
  if (error) throw new Error(`QEO-105 transition claim failed: ${error.message}`)
  const raw = object(data)
  const claimed = raw.claimed === true
  if (!claimed) {
    return {
      claimed: false,
      reason: nullableString(raw.reason) ?? "not_claimed",
      startedAt: startedAt.toISOString(),
      dispatchId,
      transitionId,
      universeKey: null,
      previousRunId: null,
      newRunId: null,
      addedTickers: [],
      removedTickers: [],
      unchangedCount: 0,
      transitionAttemptCount: 0,
      tickers: [],
    }
  }

  const addedTickers = stringArray(raw.addedTickers)
  const tickers = Array.isArray(raw.tickers) ? raw.tickers.map(tickerState) : []
  const tickerSet = new Set(tickers.map((item) => item.ticker))
  if (tickers.length !== addedTickers.length || addedTickers.some((ticker) => !tickerSet.has(ticker))) {
    throw new Error(`QEO-105 transition state mismatch: ${tickers.length}/${addedTickers.length} ticker rows`)
  }

  return {
    claimed: true,
    reason: null,
    startedAt: startedAt.toISOString(),
    dispatchId,
    transitionId,
    universeKey: nullableString(raw.universeKey),
    previousRunId: raw.previousRunId ? validUuid(String(raw.previousRunId), "previousRunId") : null,
    newRunId: raw.newRunId ? validUuid(String(raw.newRunId), "newRunId") : null,
    addedTickers,
    removedTickers: stringArray(raw.removedTickers),
    unchangedCount: finiteNonNegative(raw.unchangedCount),
    transitionAttemptCount: finiteNonNegative(raw.attemptCount),
    tickers,
  }
}

export async function runChartUniverseDailyBootstrapStep(input: {
  transitionId: string
  ticker: string
  dailyStatus: Qeo105DailyStatus
  intradayStatus: Qeo105IntradayStatus
  referenceAt: string
}): Promise<Qeo105DailyResult> {
  "use step"

  const transitionId = validUuid(input.transitionId, "transitionId")
  const ticker = validTicker(input.ticker)
  if (input.dailyStatus === "ready") {
    const coverage = await readDailyCoverage(requireSupabase(), ticker)
    return { ticker, status: "ready", skipped: true, dailyRows: coverage.rowCount, dailyLastBarTime: coverage.lastBarTime, error: null }
  }

  const supabase = requireSupabase()
  try {
    await updateTickerState(supabase, transitionId, ticker, { status: "running", daily_status: "running", last_error: null })
    const referenceAt = new Date(input.referenceAt)
    if (!Number.isFinite(referenceAt.getTime())) throw new Error("invalid referenceAt")
    const result = await refreshOhlcvHistoryBatch(supabase, [ticker], referenceAt)
    if (result.failedTickers > 0 || result.completedTickers !== 1) {
      const detail = result.errors.map((item) => item.error).join(" | ") || "Daily bootstrap did not complete"
      throw new Error(detail)
    }
    const coverage = await readDailyCoverage(supabase, ticker)
    if (coverage.rowCount <= 0 || !coverage.lastBarTime) throw new Error("Daily persistence verification returned no canonical rows")
    const overallStatus: Qeo105TickerStatus = input.intradayStatus === "ready" ? "ready" : "running"
    await updateTickerState(supabase, transitionId, ticker, {
      status: overallStatus,
      daily_status: "ready",
      daily_rows: coverage.rowCount,
      daily_last_bar_time: coverage.lastBarTime,
      last_error: null,
    })
    return { ticker, status: "ready", skipped: false, dailyRows: coverage.rowCount, dailyLastBarTime: coverage.lastBarTime, error: null }
  } catch (error) {
    const message = boundedError(error)
    try {
      await updateTickerState(supabase, transitionId, ticker, { status: "retryable", daily_status: "retryable", last_error: message })
    } catch {
      // Preserve the original provider/persistence error if state recording also fails.
    }
    return { ticker, status: "retryable", skipped: false, dailyRows: 0, dailyLastBarTime: null, error: message }
  }
}

export async function runChartUniverseIntradayBootstrapStep(input: {
  transitionId: string
  ticker: string
  intradayStatus: Qeo105IntradayStatus
  referenceAt: string
}): Promise<Qeo105IntradayResult> {
  "use step"

  const transitionId = validUuid(input.transitionId, "transitionId")
  const ticker = validTicker(input.ticker)
  const supabase = requireSupabase()
  if (input.intradayStatus === "ready") {
    const coverage = await readChartIntradayCoverageReport(supabase, { tickers: [ticker], referenceAt: new Date(input.referenceAt) })
    return { ticker, status: "ready", skipped: true, hotSessionCount: coverage[0]?.hotSessionCount ?? 0, failureCodes: [], error: null }
  }

  try {
    const referenceAt = new Date(input.referenceAt)
    if (!Number.isFinite(referenceAt.getTime())) throw new Error("invalid referenceAt")
    const capacity = await readChartStorageCapacity(supabase)
    if (capacity.level === "HARD_STOP") {
      const message = `QEO-105 capacity hard-stop at ${capacity.databaseBytes} bytes`
      await updateTickerState(supabase, transitionId, ticker, { status: "capacity_stop", intraday_status: "capacity_stop", last_error: message })
      return { ticker, status: "capacity_stop", skipped: false, hotSessionCount: 0, failureCodes: ["QEO-105:CAPACITY_STOP"], error: message }
    }

    await updateTickerState(supabase, transitionId, ticker, { status: "running", intraday_status: "running", last_error: null })
    const target = qeo107BootstrapTarget(referenceAt)
    const results = []
    for (const chunk of target.chunks) {
      results.push(await bootstrapChartIntradayChunk(supabase, { ticker, chunk, referenceAt }))
    }

    const coverage = await readChartIntradayCoverageReport(supabase, { tickers: [ticker], referenceAt })
    const row = coverage[0]
    const hotSessionCount = row?.hotSessionCount ?? 0
    const failureCodes = [...new Set(results.flatMap((result) => result.failureCodes))]

    if (hotSessionCount >= QEO107_HOT_RETENTION_SESSIONS) {
      await updateTickerState(supabase, transitionId, ticker, {
        status: "ready",
        intraday_status: "ready",
        intraday_hot_sessions: hotSessionCount,
        last_error: null,
      })
      return { ticker, status: "ready", skipped: results.every((result) => result.status === "skipped"), hotSessionCount, failureCodes, error: null }
    }

    const directProviderGap = results.some((result) => result.status === "provider_gap") || (row?.providerGapCount ?? 0) > 0
    const directRetryable = results.some((result) => result.status === "retryable_failure") || (row?.retryableFailureCount ?? 0) > 0
    const directFailed = results.some((result) => result.status === "failed") || (row?.failedAttemptCount ?? 0) > 0
    const status: Qeo105IntradayResult["status"] = directProviderGap ? "provider_gap" : directRetryable ? "retryable" : directFailed ? "failed" : "retryable"
    const message = `QEO-105 ${ticker} HOT coverage ${hotSessionCount}/${QEO107_HOT_RETENTION_SESSIONS}`
    await updateTickerState(supabase, transitionId, ticker, {
      status,
      intraday_status: status,
      intraday_hot_sessions: hotSessionCount,
      last_error: message,
    })
    return { ticker, status, skipped: false, hotSessionCount, failureCodes, error: message }
  } catch (error) {
    const message = boundedError(error)
    try {
      await updateTickerState(supabase, transitionId, ticker, { status: "retryable", intraday_status: "retryable", last_error: message })
    } catch {
      // Preserve original failure if durable telemetry is unavailable.
    }
    return { ticker, status: "retryable", skipped: false, hotSessionCount: 0, failureCodes: [], error: message }
  }
}

export async function finishChartUniverseBootstrapStep(input: {
  context: Qeo105UniverseBootstrapContext
}): Promise<Qeo105UniverseBootstrapSummary> {
  "use step"

  if (!input.context.claimed) {
    return {
      transitionId: input.context.transitionId,
      dispatchId: input.context.dispatchId,
      startedAt: input.context.startedAt,
      finishedAt: new Date().toISOString(),
      claimed: false,
      reason: input.context.reason,
      previousRunId: input.context.previousRunId,
      newRunId: input.context.newRunId,
      addedTickers: input.context.addedTickers,
      removedTickers: input.context.removedTickers,
      unchangedCount: input.context.unchangedCount,
      status: "noop",
      counts: { total: 0, ready: 0, retryable: 0, providerGap: 0, failed: 0, capacityStop: 0 },
      tickers: [],
    }
  }

  const supabase = requireSupabase()
  const { data: finishData, error: finishError } = await supabase.rpc("qeo_finish_chart_universe_bootstrap_transition", {
    p_transition_id: input.context.transitionId,
    p_error: null,
  })
  if (finishError) throw new Error(`QEO-105 transition finish failed: ${finishError.message}`)
  const finished = object(finishData)
  const { data: tickerRows, error: tickerError } = await supabase
    .from("chart_universe_bootstrap_tickers")
    .select("ticker,status,daily_status,intraday_status,attempt_count,daily_rows,daily_last_bar_time,intraday_hot_sessions,last_error")
    .eq("transition_id", input.context.transitionId)
    .order("ticker")
  if (tickerError) throw new Error(`QEO-105 final ticker report failed: ${tickerError.message}`)
  const tickers = ((tickerRows || []) as Array<Record<string, unknown>>).map((raw) => tickerState({
    ticker: raw.ticker,
    status: raw.status,
    dailyStatus: raw.daily_status,
    intradayStatus: raw.intraday_status,
    attemptCount: raw.attempt_count,
    dailyRows: raw.daily_rows,
    dailyLastBarTime: raw.daily_last_bar_time,
    intradayHotSessions: raw.intraday_hot_sessions,
    lastError: raw.last_error,
  }))
  const dailyReady = tickers.filter((ticker) => ticker.dailyStatus === "ready").length
  const intradayReady = tickers.filter((ticker) => ticker.intradayStatus === "ready").length
  const normalizedStatus = String(finished.status || "failed") as Qeo105UniverseBootstrapSummary["status"]

  return {
    transitionId: input.context.transitionId,
    dispatchId: input.context.dispatchId,
    startedAt: input.context.startedAt,
    finishedAt: new Date().toISOString(),
    claimed: true,
    reason: dailyReady === tickers.length && intradayReady === tickers.length ? null : "incomplete_stage_readiness",
    previousRunId: input.context.previousRunId,
    newRunId: input.context.newRunId,
    addedTickers: input.context.addedTickers,
    removedTickers: input.context.removedTickers,
    unchangedCount: input.context.unchangedCount,
    status: normalizedStatus === "complete" || normalizedStatus === "retryable" || normalizedStatus === "partial" ? normalizedStatus : "failed",
    counts: {
      total: tickers.length,
      ready: tickers.filter((ticker) => ticker.status === "ready").length,
      retryable: tickers.filter((ticker) => ticker.status === "retryable").length,
      providerGap: tickers.filter((ticker) => ticker.status === "provider_gap").length,
      failed: tickers.filter((ticker) => ticker.status === "failed").length,
      capacityStop: tickers.filter((ticker) => ticker.status === "capacity_stop").length,
    },
    tickers,
  }
}
