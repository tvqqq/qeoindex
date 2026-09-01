import type { SupabaseClient } from "@supabase/supabase-js"

import {
  DAILY_BACKFILL_DAYS,
  DAILY_DELTA_DAYS,
  HOURLY_BACKFILL_DAYS,
  HOURLY_DELTA_DAYS,
  type HistoricalProvider,
  type RawHistoryTimeframe,
} from "./market-history-contract.ts"
import type { OhlcvBar } from "./technical-indicators.ts"

export const OHLCV_BATCH_SIZE = 10
export const OHLCV_PROVIDER_CONCURRENCY = 4
export const OHLCV_UPSERT_CHUNK_SIZE = 500
export const DAILY_REQUIRED_MONTHS = 60
export const HOURLY_REQUIRED_RAW_BARS = 240

export interface OhlcvCoverage {
  ticker: string
  timeframe: RawHistoryTimeframe
  rowCount: number
  firstBarTime: string | null
  lastBarTime: string | null
  distinctMonths: number
}

export interface OhlcvRefreshPlan {
  mode: "backfill" | "delta"
  timeframe: RawHistoryTimeframe
  lookbackDays: number
}

export interface OhlcvLimitedCoverage {
  ticker: string
  timeframe: RawHistoryTimeframe
  actual: number
  required: number
  metric: "distinctMonths" | "rawBars"
}

export interface OhlcvRefreshError {
  ticker: string
  error: string
}

export interface OhlcvUniverseRefreshResult {
  requestedTickers: number
  completedTickers: number
  failedTickers: number
  dailyFetchedBars: number
  /** Deprecated compatibility field. Persistent Wyckoff refresh is Daily-only. */
  hourlyFetchedBars?: number
  backfillOperations: number
  deltaOperations: number
  limitedCoverage: OhlcvLimitedCoverage[]
  errors: OhlcvRefreshError[]
}

export interface CachedOhlcvHistory {
  ticker: string
  timeframe: RawHistoryTimeframe
  bars: OhlcvBar[]
  provider: HistoricalProvider
  detail: string
  sourceUrl: string
  fetchedAt: string
  firstBarAt: string | null
  lastBarAt: string | null
}

type CoverageRpcRow = {
  ticker?: unknown
  timeframe?: unknown
  row_count?: unknown
  first_bar_time?: unknown
  last_bar_time?: unknown
  distinct_months?: unknown
}

type StoredOhlcvRow = {
  ticker?: unknown
  timeframe?: unknown
  bar_time?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  volume?: unknown
  provider?: unknown
  provider_detail?: unknown
  source_url?: unknown
  fetched_at?: unknown
}

type TickerRefreshSuccess = {
  ticker: string
  dailyFetchedBars: number
  plans: OhlcvRefreshPlan[]
}

type TickerRefreshOutcome =
  | { ok: true; result: TickerRefreshSuccess }
  | { ok: false; error: OhlcvRefreshError }

function finite(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function coverageKey(ticker: string, timeframe: RawHistoryTimeframe) {
  return `${ticker}|${timeframe}`
}

export function normalizeOhlcvTickers(input: string[], max = 100) {
  if (!Array.isArray(input) || input.length === 0) throw new Error("OHLCV refresh requires at least one ticker")
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of input) {
    const ticker = String(value || "").trim().toUpperCase()
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid ticker: ${value}`)
    if (!seen.has(ticker)) {
      seen.add(ticker)
      result.push(ticker)
    }
  }
  if (result.length > max) throw new Error(`OHLCV refresh supports at most ${max} unique tickers`)
  return result
}

export function buildOhlcvRefreshPlan(
  coverage: OhlcvCoverage | null,
  timeframe: RawHistoryTimeframe,
  bootstrapCompleted = false,
): OhlcvRefreshPlan {
  if (timeframe === "1D") {
    const needsBackfill = !bootstrapCompleted && (!coverage || coverage.distinctMonths < DAILY_REQUIRED_MONTHS)
    return {
      mode: needsBackfill ? "backfill" : "delta",
      timeframe,
      lookbackDays: needsBackfill ? DAILY_BACKFILL_DAYS : DAILY_DELTA_DAYS,
    }
  }

  const needsBackfill = !coverage || coverage.rowCount < HOURLY_REQUIRED_RAW_BARS
  return {
    mode: needsBackfill ? "backfill" : "delta",
    timeframe,
    lookbackDays: needsBackfill ? HOURLY_BACKFILL_DAYS : HOURLY_DELTA_DAYS,
  }
}

async function loadCoverageMap(supabase: SupabaseClient, tickers: string[]) {
  if (!tickers.length) return new Map<string, OhlcvCoverage>()
  const { data, error } = await supabase.rpc("qeo_market_ohlcv_coverage", { p_tickers: tickers })
  if (error) throw new Error(`OHLCV coverage query failed: ${error.message}`)
  const map = new Map<string, OhlcvCoverage>()
  for (const raw of (data || []) as CoverageRpcRow[]) {
    const ticker = String(raw.ticker || "").trim().toUpperCase()
    const timeframe = String(raw.timeframe || "") as RawHistoryTimeframe
    if (!ticker || (timeframe !== "1D" && timeframe !== "1H")) continue
    map.set(coverageKey(ticker, timeframe), {
      ticker,
      timeframe,
      rowCount: finite(raw.row_count) ?? 0,
      firstBarTime: raw.first_bar_time ? String(raw.first_bar_time) : null,
      lastBarTime: raw.last_bar_time ? String(raw.last_bar_time) : null,
      distinctMonths: finite(raw.distinct_months) ?? 0,
    })
  }
  return map
}

async function loadDailyBootstrapState(supabase: SupabaseClient, tickers: string[]) {
  const completed = new Set<string>()
  if (!tickers.length) return completed
  const { data, error } = await supabase
    .from("market_ohlcv_bootstrap_state")
    .select("ticker")
    .eq("timeframe", "1D")
    .eq("completed", true)
    .in("ticker", tickers)
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return completed
    throw new Error(`OHLCV bootstrap state query failed: ${error.message}`)
  }
  for (const row of data || []) completed.add(String(row.ticker || "").trim().toUpperCase())
  return completed
}

function toStoredRows(input: {
  ticker: string
  timeframe: "1D"
  bars: OhlcvBar[]
  provider: HistoricalProvider
  detail: string
  sourceUrl: string
  fetchedAt: string
}) {
  return input.bars
    .filter((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      && bar.time > 0 && bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0 && bar.volume >= 0)
    .map((bar) => ({
      ticker: input.ticker,
      timeframe: input.timeframe,
      bar_time: new Date(bar.time * 1000).toISOString(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      provider: input.provider,
      provider_detail: input.detail,
      source_url: input.sourceUrl,
      fetched_at: input.fetchedAt,
    }))
}

async function upsertStoredRows(supabase: SupabaseClient, rows: ReturnType<typeof toStoredRows>) {
  for (let offset = 0; offset < rows.length; offset += OHLCV_UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + OHLCV_UPSERT_CHUNK_SIZE)
    if (!chunk.length) continue
    const { error } = await supabase.from("market_ohlcv_history").upsert(chunk, { onConflict: "ticker,timeframe,bar_time" })
    if (error) throw new Error(`OHLCV history upsert failed: ${error.message}`)
  }
}

async function persistBootstrapComplete(
  supabase: SupabaseClient,
  ticker: string,
  provider: HistoricalProvider,
  rows: ReturnType<typeof toStoredRows>,
) {
  const first = rows[0]?.bar_time ?? null
  const last = rows.at(-1)?.bar_time ?? null
  const { error } = await supabase.from("market_ohlcv_bootstrap_state").upsert({
    ticker,
    timeframe: "1D",
    completed: true,
    provider,
    first_bar_time: first,
    last_bar_time: last,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "ticker,timeframe" })
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    throw new Error(`OHLCV bootstrap state upsert failed: ${error.message}`)
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()))
  return results
}

async function refreshTicker(
  supabase: SupabaseClient,
  ticker: string,
  coverage: Map<string, OhlcvCoverage>,
  bootstrapCompleted: boolean,
  now: Date,
): Promise<TickerRefreshSuccess> {
  const dailyPlan = buildOhlcvRefreshPlan(coverage.get(coverageKey(ticker, "1D")) ?? null, "1D", bootstrapCompleted)
  const { fetchDailyMarketHistoryWindow } = await import("./market-history.ts")
  const daily = await fetchDailyMarketHistoryWindow(ticker, dailyPlan.lookbackDays, now)
  const dailyRows = toStoredRows({ ticker, timeframe: "1D", ...daily })
  if (!dailyRows.length) throw new Error("Provider returned no usable completed Daily bars")
  await upsertStoredRows(supabase, dailyRows)
  if (dailyPlan.mode === "backfill") await persistBootstrapComplete(supabase, ticker, daily.provider, dailyRows)
  return { ticker, dailyFetchedBars: dailyRows.length, plans: [dailyPlan] }
}

function limitedCoverageFor(tickers: string[], coverage: Map<string, OhlcvCoverage>): OhlcvLimitedCoverage[] {
  const warnings: OhlcvLimitedCoverage[] = []
  for (const ticker of tickers) {
    const daily = coverage.get(coverageKey(ticker, "1D"))
    if (!daily || daily.distinctMonths < DAILY_REQUIRED_MONTHS) {
      warnings.push({ ticker, timeframe: "1D", actual: daily?.distinctMonths ?? 0, required: DAILY_REQUIRED_MONTHS, metric: "distinctMonths" })
    }
  }
  return warnings
}

export async function refreshOhlcvHistoryBatch(
  supabase: SupabaseClient,
  inputTickers: string[],
  now = new Date(),
): Promise<OhlcvUniverseRefreshResult> {
  const tickers = normalizeOhlcvTickers(inputTickers, OHLCV_BATCH_SIZE)
  const [coverage, bootstrapState] = await Promise.all([
    loadCoverageMap(supabase, tickers),
    loadDailyBootstrapState(supabase, tickers),
  ])
  const outcomes = await mapWithConcurrency<string, TickerRefreshOutcome>(tickers, OHLCV_PROVIDER_CONCURRENCY, async (ticker) => {
    try {
      return { ok: true, result: await refreshTicker(supabase, ticker, coverage, bootstrapState.has(ticker), now) }
    } catch (error) {
      return { ok: false, error: { ticker, error: error instanceof Error ? error.message : String(error) } }
    }
  })
  const successes = outcomes.filter((outcome): outcome is Extract<TickerRefreshOutcome, { ok: true }> => outcome.ok).map((outcome) => outcome.result)
  const errors = outcomes.filter((outcome): outcome is Extract<TickerRefreshOutcome, { ok: false }> => !outcome.ok).map((outcome) => outcome.error)
  const successfulTickers = successes.map((item) => item.ticker)
  const postCoverage = successfulTickers.length ? await loadCoverageMap(supabase, successfulTickers) : new Map<string, OhlcvCoverage>()
  return {
    requestedTickers: tickers.length,
    completedTickers: successes.length,
    failedTickers: errors.length,
    dailyFetchedBars: successes.reduce((sum, item) => sum + item.dailyFetchedBars, 0),
    hourlyFetchedBars: 0,
    backfillOperations: successes.reduce((sum, item) => sum + item.plans.filter((plan) => plan.mode === "backfill").length, 0),
    deltaOperations: successes.reduce((sum, item) => sum + item.plans.filter((plan) => plan.mode === "delta").length, 0),
    limitedCoverage: limitedCoverageFor(successfulTickers, postCoverage),
    errors,
  }
}

function aggregateRefreshResults(results: OhlcvUniverseRefreshResult[]): OhlcvUniverseRefreshResult {
  return results.reduce<OhlcvUniverseRefreshResult>((acc, item) => ({
    requestedTickers: acc.requestedTickers + item.requestedTickers,
    completedTickers: acc.completedTickers + item.completedTickers,
    failedTickers: acc.failedTickers + item.failedTickers,
    dailyFetchedBars: acc.dailyFetchedBars + item.dailyFetchedBars,
    hourlyFetchedBars: 0,
    backfillOperations: acc.backfillOperations + item.backfillOperations,
    deltaOperations: acc.deltaOperations + item.deltaOperations,
    limitedCoverage: [...acc.limitedCoverage, ...item.limitedCoverage],
    errors: [...acc.errors, ...item.errors],
  }), {
    requestedTickers: 0, completedTickers: 0, failedTickers: 0, dailyFetchedBars: 0, hourlyFetchedBars: 0,
    backfillOperations: 0, deltaOperations: 0, limitedCoverage: [], errors: [],
  })
}

export async function refreshOhlcvHistoryUniverse(
  supabase: SupabaseClient,
  inputTickers: string[],
  now = new Date(),
): Promise<OhlcvUniverseRefreshResult> {
  const tickers = normalizeOhlcvTickers(inputTickers, 100)
  const batchResults: OhlcvUniverseRefreshResult[] = []
  for (let offset = 0; offset < tickers.length; offset += OHLCV_BATCH_SIZE) {
    batchResults.push(await refreshOhlcvHistoryBatch(supabase, tickers.slice(offset, offset + OHLCV_BATCH_SIZE), now))
  }
  return aggregateRefreshResults(batchResults)
}

function storedRowToBar(row: StoredOhlcvRow): OhlcvBar | null {
  const timestamp = row.bar_time ? new Date(String(row.bar_time)).getTime() : NaN
  const open = finite(row.open)
  const high = finite(row.high)
  const low = finite(row.low)
  const close = finite(row.close)
  const volume = finite(row.volume)
  if (!Number.isFinite(timestamp) || timestamp <= 0 || open == null || high == null || low == null || close == null || volume == null) return null
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return null
  return { time: Math.floor(timestamp / 1000), open, high, low, close, volume }
}

export async function loadCachedOhlcvHistory(
  supabase: SupabaseClient,
  tickerInput: string,
  timeframe: RawHistoryTimeframe,
): Promise<CachedOhlcvHistory> {
  if (timeframe !== "1D") throw new Error(`Persistent Wyckoff OHLCV supports Daily only; received ${timeframe}`)
  const [ticker] = normalizeOhlcvTickers([tickerInput], 1)
  const rows: StoredOhlcvRow[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("market_ohlcv_history")
      .select("ticker,timeframe,bar_time,open,high,low,close,volume,provider,provider_detail,source_url,fetched_at")
      .eq("ticker", ticker)
      .eq("timeframe", "1D")
      .order("bar_time", { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`OHLCV cache read failed for ${ticker} 1D: ${error.message}`)
    const page = (data || []) as StoredOhlcvRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  const bars = rows.map(storedRowToBar).filter((bar): bar is OhlcvBar => Boolean(bar))
  if (!bars.length) throw new Error(`OHLCV cache has no usable 1D bars for ${ticker}`)
  const latest: StoredOhlcvRow = rows.at(-1) ?? {}
  return {
    ticker,
    timeframe: "1D",
    bars,
    provider: String(latest.provider || "Fallback") === "DNSE" ? "DNSE" : "Fallback",
    detail: String(latest.provider_detail || "Supabase OHLCV cache"),
    sourceUrl: String(latest.source_url || ""),
    fetchedAt: String(latest.fetched_at || ""),
    firstBarAt: rows[0]?.bar_time ? String(rows[0].bar_time) : null,
    lastBarAt: latest.bar_time ? String(latest.bar_time) : null,
  }
}

export async function loadCachedOhlcvPair(supabase: SupabaseClient, ticker: string) {
  const daily = await loadCachedOhlcvHistory(supabase, ticker, "1D")
  return { daily }
}
