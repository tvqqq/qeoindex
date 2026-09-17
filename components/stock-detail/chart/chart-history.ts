import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import {
  chartHistoryClass,
  chartHistoryFloor,
  maxChartHistorySeconds,
} from "../../../modules/market/chart-data/history-policy.ts"
import { aggregateChartTimeframe } from "../../../modules/market/chart-data/timeframes.ts"
import type { ChartTimeframe } from "./stock-chart-types"

const CLOSED_RANGE_CACHE_TTL_MS = 10 * 60 * 1000
const CLOSED_RANGE_CACHE_TO_TOLERANCE_SECONDS = 10 * 60
const CLOSED_RANGE_CACHE_MAX_ENTRIES = 24

const INITIAL_HISTORY_WINDOW_SECONDS: Record<ChartTimeframe, number> = {
  "1D": 0,
  "1W": 0,
  "1M": 0,
}

export interface ChartHistoryMetadata {
  priceBasis: "RAW"
  provider: string | null
  lastUpdatedAt: string
  sessionState: "LIVE" | "CLOSED"
  currentBarTime: number | null
  persistedThrough: number | null
}

export interface ChartHistoryResponse {
  ok: true
  ticker: string
  resolution: ChartTimeframe
  from: number
  to: number
  bars: OhlcvBar[]
  gaps: Array<{ fromTime: number; toTime: number; missingBars: number }>
  integrityIssues: unknown[]
  coverage: { complete: boolean; state: "COMPLETE" | "PARTIAL" }
  errors: Array<{ code: string }>
  metadata?: ChartHistoryMetadata | null
  generatedAt?: string
}

export interface ChartRangeInput {
  ticker: string
  timeframe: ChartTimeframe
  from: number
  to: number
}

export interface ChartHistorySlices {
  stableClosed: ChartRangeInput | null
  currentDateTail: ChartRangeInput | null
}

export interface PreparedChartHistory {
  ticker: string
  timeframe: ChartTimeframe
  range: { from: number; to: number }
  result: ChartHistoryResponse
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type RequestChartRangeOptions = { bypassCache?: boolean; now?: Date }
type ClosedRangeCacheEntry = {
  input: ChartRangeInput
  result: ChartHistoryResponse
  expiresAt: number
  lastUsedAt: number
}

const inFlight = new Map<string, Promise<ChartHistoryResponse>>()
const closedRangeCache = new Map<string, ClosedRangeCacheEntry>()
let cacheHits = 0
let cacheMisses = 0

export function historyWindowSeconds(timeframe: ChartTimeframe) {
  return INITIAL_HISTORY_WINDOW_SECONDS[timeframe]
}

export function initialChartHistoryRange(timeframe: ChartTimeframe, to: number) {
  if (chartHistoryClass(timeframe) === "LONG") return { from: 1, to }
  const window = historyWindowSeconds(timeframe)
  const maxSpan = maxChartHistorySeconds(timeframe)
  const boundedWindow = maxSpan == null ? window : Math.min(window, maxSpan)
  return { from: Math.max(chartHistoryFloor(timeframe, to), to - boundedWindow), to }
}

export function olderChartHistoryRange(timeframe: ChartTimeframe, earliest: number, horizonTo: number) {
  const floor = chartHistoryFloor(timeframe, horizonTo)
  if (earliest <= floor + 1) return null
  const to = earliest - 1
  if (chartHistoryClass(timeframe) === "LONG") return { from: 1, to }
  const from = Math.max(floor, to - historyWindowSeconds(timeframe))
  return from < to ? { from, to } : null
}

export function mergeChartBars(existing: OhlcvBar[], incoming: OhlcvBar[]) {
  const byTime = new Map<number, OhlcvBar>()
  for (const bar of existing) byTime.set(bar.time, bar)
  for (const bar of incoming) byTime.set(bar.time, bar)
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

export function deriveChartBarsFromDailySeed(
  dailyBars: OhlcvBar[],
  timeframe: ChartTimeframe,
): OhlcvBar[] {
  return aggregateChartTimeframe(dailyBars, timeframe)
}

/**
 * QEO-238/QEO-241: every active chart timeframe is derived from completed Daily bars,
 * so the whole bounded request is stable and there is no mutable intraday tail.
 */
export function planChartHistorySlices(input: ChartRangeInput): ChartHistorySlices {
  return {
    stableClosed: { ...input, ticker: input.ticker.toUpperCase() },
    currentDateTail: null,
  }
}

export function isStableClosedChartRange(input: ChartRangeInput, now: Date = new Date()) {
  if (!Number.isFinite(input.from) || !Number.isFinite(input.to) || input.from > input.to) return false
  return input.to <= Math.floor(now.getTime() / 1000)
}

function requestKey(input: ChartRangeInput) {
  return `${input.ticker.toUpperCase()}:${input.timeframe}:${input.from}:${input.to}`
}

function cachePrefix(input: ChartRangeInput) {
  return `${input.ticker.toUpperCase()}:${input.timeframe}:`
}

function pruneClosedRangeCache(now: number) {
  for (const [key, entry] of closedRangeCache) {
    if (entry.expiresAt <= now) closedRangeCache.delete(key)
  }
  if (closedRangeCache.size <= CLOSED_RANGE_CACHE_MAX_ENTRIES) return
  const oldest = [...closedRangeCache.entries()]
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
    .slice(0, closedRangeCache.size - CLOSED_RANGE_CACHE_MAX_ENTRIES)
  for (const [key] of oldest) closedRangeCache.delete(key)
}

function findCachedRange(
  input: ChartRangeInput,
  options: { touch: boolean; trackHit: boolean },
): ChartHistoryResponse | null {
  const now = Date.now()
  pruneClosedRangeCache(now)
  const prefix = cachePrefix(input)
  let best: ClosedRangeCacheEntry | null = null
  for (const [key, entry] of closedRangeCache) {
    if (!key.startsWith(prefix)) continue
    if (entry.input.from > input.from) continue
    if (entry.input.to + CLOSED_RANGE_CACHE_TO_TOLERANCE_SECONDS < input.to) continue
    if (!best || entry.input.from < best.input.from || entry.input.to > best.input.to) best = entry
  }
  if (!best) return null

  if (options.touch) best.lastUsedAt = now
  if (options.trackHit) cacheHits += 1
  return {
    ...best.result,
    from: input.from,
    to: input.to,
    bars: best.result.bars.filter((bar) => bar.time >= input.from && bar.time <= input.to),
  }
}

function rememberClosedRange(input: ChartRangeInput, result: ChartHistoryResponse, nowDate: Date) {
  if (
    !isStableClosedChartRange(input, nowDate)
    || result.metadata?.sessionState !== "CLOSED"
    || !result.coverage.complete
    || result.coverage.state !== "COMPLETE"
    || result.gaps.length > 0
    || result.integrityIssues.length > 0
    || result.errors.length > 0
  ) return

  const now = Date.now()
  closedRangeCache.set(requestKey(input), {
    input: { ...input, ticker: input.ticker.toUpperCase() },
    result,
    expiresAt: now + CLOSED_RANGE_CACHE_TTL_MS,
    lastUsedAt: now,
  })
  pruneClosedRangeCache(now)
}

export function peekClosedChartRange(input: ChartRangeInput, now: Date = new Date()) {
  const normalized = { ...input, ticker: input.ticker.toUpperCase() }
  if (!isStableClosedChartRange(normalized, now)) return null
  return findCachedRange(normalized, { touch: false, trackHit: false })
}

export function chartHistoryCacheStats() {
  pruneClosedRangeCache(Date.now())
  return { entries: closedRangeCache.size, hits: cacheHits, misses: cacheMisses }
}

export function clearChartHistoryCache() {
  closedRangeCache.clear()
  cacheHits = 0
  cacheMisses = 0
}

export function requestChartRange(
  input: ChartRangeInput,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
  options: RequestChartRangeOptions = {},
): Promise<ChartHistoryResponse> {
  const normalized = { ...input, ticker: input.ticker.toUpperCase() }
  const key = requestKey(normalized)
  const now = options.now ?? new Date()
  const stable = isStableClosedChartRange(normalized, now)
  const transportMode = !options.bypassCache && stable ? "stable" : "fresh"
  const flightKey = `${key}:${transportMode}`

  if (!options.bypassCache && stable) {
    const cached = findCachedRange(normalized, { touch: true, trackHit: true })
    if (cached) return Promise.resolve(cached)
    cacheMisses += 1
  }

  const existing = inFlight.get(flightKey)
  if (existing) return existing

  const params = new URLSearchParams({
    ticker: normalized.ticker,
    resolution: normalized.timeframe,
    from: String(normalized.from),
    to: String(normalized.to),
  })
  const promise = fetchImpl(`/api/market/ohlcv?${params}`, {
    signal,
    cache: options.bypassCache || !stable ? "no-store" : "default",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Chart history request failed: ${response.status}`)
      const payload = await response.json() as ChartHistoryResponse
      if (!payload.ok) throw new Error("Chart history response is invalid")
      if (!options.bypassCache && stable) rememberClosedRange(normalized, payload, now)
      return payload
    })
    .finally(() => {
      if (inFlight.get(flightKey) === promise) inFlight.delete(flightKey)
    })
  inFlight.set(flightKey, promise)
  return promise
}

export function requestFreshChartRange(
  input: ChartRangeInput,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
) {
  return requestChartRange(input, signal, fetchImpl, { bypassCache: true })
}

export async function prepareInitialChartHistory(input: {
  ticker: string
  timeframe: ChartTimeframe
  now?: Date
  signal?: AbortSignal
  fetchImpl?: FetchLike
}): Promise<PreparedChartHistory> {
  const now = input.now ?? new Date()
  const to = Math.floor(now.getTime() / 1000)
  const range = initialChartHistoryRange(input.timeframe, to)
  const slices = planChartHistorySlices({ ticker: input.ticker, timeframe: input.timeframe, ...range })
  if (!slices.stableClosed) throw new Error("Daily chart history requires a stable closed range")
  const result = await requestChartRange(slices.stableClosed, input.signal, input.fetchImpl, { now })
  return {
    ticker: input.ticker.trim().toUpperCase(),
    timeframe: input.timeframe,
    range,
    result,
  }
}

export const loadInitialChartHistory = prepareInitialChartHistory

export function adjacentPrefetchTargets(tickers: string[], ticker: string) {
  const normalized = ticker.trim().toUpperCase()
  const index = tickers.findIndex((candidate) => candidate.trim().toUpperCase() === normalized)
  if (index < 0) return []
  return [tickers[index - 1], tickers[index + 1]].filter((candidate): candidate is string => Boolean(candidate))
}