import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import {
  chartHistoryClass,
  chartHistoryFloor,
  maxChartHistorySeconds,
} from "../../../modules/market/chart-data/history-policy.ts"
import type { ChartTimeframe } from "./stock-chart-types"

const DAY_SECONDS = 86400
const CLOSED_RANGE_CACHE_TTL_MS = 10 * 60 * 1000
const CLOSED_RANGE_CACHE_TO_TOLERANCE_SECONDS = 10 * 60
const CLOSED_RANGE_CACHE_MAX_ENTRIES = 24

const INITIAL_HISTORY_WINDOW_SECONDS: Record<ChartTimeframe, number> = {
  "1m": 5 * DAY_SECONDS,
  "15m": 21 * DAY_SECONDS,
  "30m": 31 * DAY_SECONDS,
  "1h": 90 * DAY_SECONDS,
  "2h": 150 * DAY_SECONDS,
  "4h": 186 * DAY_SECONDS,
  "1D": 0,
  "3D": 0,
  "1W": 0,
  "1M": 0,
  "1Q": 0,
  "1Y": 0,
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

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type RequestChartRangeOptions = { bypassCache?: boolean }
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

function cachedRange(input: ChartRangeInput): ChartHistoryResponse | null {
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

  best.lastUsedAt = now
  cacheHits += 1
  return {
    ...best.result,
    from: input.from,
    to: input.to,
    bars: best.result.bars.filter((bar) => bar.time >= input.from && bar.time <= input.to),
  }
}

function rememberClosedRange(input: ChartRangeInput, result: ChartHistoryResponse) {
  if (
    result.metadata?.sessionState !== "CLOSED"
    || !result.coverage.complete
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

  if (!options.bypassCache) {
    const cached = cachedRange(normalized)
    if (cached) return Promise.resolve(cached)
    cacheMisses += 1
  }

  const existing = inFlight.get(key)
  if (existing) return existing

  const params = new URLSearchParams({
    ticker: normalized.ticker,
    resolution: normalized.timeframe,
    from: String(normalized.from),
    to: String(normalized.to),
  })

  const promise = (async () => {
    const response = await fetchImpl(`/api/market/ohlcv?${params.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    })
    const body = await response.json() as Partial<ChartHistoryResponse> & { ok?: boolean; error?: string }
    if (!response.ok || body.ok !== true || !Array.isArray(body.bars)) {
      throw new Error(body.error || `Chart history request failed (${response.status})`)
    }
    const result = {
      ...(body as ChartHistoryResponse),
      bars: mergeChartBars([], body.bars),
    }
    rememberClosedRange(normalized, result)
    return result
  })().finally(() => {
    inFlight.delete(key)
  })

  inFlight.set(key, promise)
  return promise
}

export function requestFreshChartRange(
  input: ChartRangeInput,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
) {
  return requestChartRange(input, signal, fetchImpl, { bypassCache: true })
}
