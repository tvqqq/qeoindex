import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import {
  chartHistoryClass,
  chartHistoryFloor,
  maxChartHistorySeconds,
} from "../../../modules/market/chart-data/history-policy.ts"
import {
  isVietnamSecuritiesTradingDay,
  vietnamDateKey,
} from "../../../modules/market/calendar.ts"
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

function vietnamTradingOpenEpoch(now: Date) {
  return Math.floor(Date.parse(`${vietnamDateKey(now)}T09:00:00+07:00`) / 1000)
}

export function planChartHistorySlices(input: ChartRangeInput, now: Date = new Date()): ChartHistorySlices {
  const normalized = { ...input, ticker: input.ticker.toUpperCase() }
  if (chartHistoryClass(normalized.timeframe) === "LONG" || !isVietnamSecuritiesTradingDay(now)) {
    return { stableClosed: normalized, currentDateTail: null }
  }

  const open = vietnamTradingOpenEpoch(now)
  const stableTo = Math.min(normalized.to, open - 1)
  const tailFrom = Math.max(normalized.from, open)
  return {
    stableClosed: normalized.from <= stableTo
      ? { ...normalized, to: stableTo }
      : null,
    currentDateTail: tailFrom <= normalized.to
      ? { ...normalized, from: tailFrom }
      : null,
  }
}

export function isStableClosedChartRange(input: ChartRangeInput, now: Date = new Date()) {
  if (!Number.isFinite(input.from) || !Number.isFinite(input.to) || input.from > input.to) return false
  const nowEpoch = Math.floor(now.getTime() / 1000)
  if (input.to > nowEpoch) return false
  if (chartHistoryClass(input.timeframe) === "LONG") return true
  if (!isVietnamSecuritiesTradingDay(now)) return true
  return input.to < vietnamTradingOpenEpoch(now)
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

  const promise = (async () => {
    const response = await fetchImpl(`/api/market/ohlcv?${params.toString()}`, {
      cache: transportMode === "stable" ? "default" : "no-store",
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
    rememberClosedRange(normalized, result, now)
    return result
  })().finally(() => {
    inFlight.delete(flightKey)
  })

  inFlight.set(flightKey, promise)
  return promise
}

export function requestFreshChartRange(
  input: ChartRangeInput,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
) {
  return requestChartRange(input, signal, fetchImpl, { bypassCache: true, now: new Date() })
}

export async function prefetchStableChartRange(
  input: ChartRangeInput,
  signal?: AbortSignal,
  now: Date = new Date(),
  fetchImpl: FetchLike = fetch,
) {
  if (!isStableClosedChartRange(input, now)) return null
  return requestChartRange(input, signal, fetchImpl, { now })
}

function combineHistoryResults(
  input: ChartRangeInput,
  stableResult: ChartHistoryResponse | null,
  tailResult: ChartHistoryResponse | null,
): ChartHistoryResponse {
  const results = [stableResult, tailResult].filter((result): result is ChartHistoryResponse => result != null)
  const complete = results.length > 0 && results.every((result) => result.coverage.complete && result.coverage.state === "COMPLETE")
  let bars: OhlcvBar[] = []
  for (const result of results) bars = mergeChartBars(bars, result.bars)
  const metadata = tailResult?.metadata ?? stableResult?.metadata ?? null
  return {
    ok: true,
    ticker: input.ticker.toUpperCase(),
    resolution: input.timeframe,
    from: input.from,
    to: input.to,
    bars,
    gaps: results.flatMap((result) => result.gaps),
    integrityIssues: results.flatMap((result) => result.integrityIssues),
    coverage: { complete, state: complete ? "COMPLETE" : "PARTIAL" },
    errors: results.flatMap((result) => result.errors),
    metadata,
    generatedAt: tailResult?.generatedAt ?? stableResult?.generatedAt,
  }
}

export async function loadInitialChartHistory({
  ticker,
  timeframe,
  now = new Date(),
  signal,
  fetchImpl = fetch,
}: {
  ticker: string
  timeframe: ChartTimeframe
  now?: Date
  signal?: AbortSignal
  fetchImpl?: FetchLike
}) {
  const to = Math.floor(now.getTime() / 1000)
  const range = initialChartHistoryRange(timeframe, to)
  const input: ChartRangeInput = { ticker: ticker.toUpperCase(), timeframe, ...range }
  const slices = planChartHistorySlices(input, now)
  const [stableResult, tailResult] = await Promise.all([
    slices.stableClosed
      ? requestChartRange(slices.stableClosed, signal, fetchImpl, { now })
      : Promise.resolve(null),
    slices.currentDateTail
      ? requestFreshChartRange(slices.currentDateTail, signal, fetchImpl)
      : Promise.resolve(null),
  ])
  return { range, result: combineHistoryResults(input, stableResult, tailResult) }
}

function assertPreparedResult(result: ChartHistoryResponse) {
  if (
    !result.coverage.complete
    || result.coverage.state !== "COMPLETE"
    || result.gaps.length > 0
    || result.integrityIssues.length > 0
    || result.errors.length > 0
  ) {
    throw new Error("Target chart history is incomplete; keeping the previously committed chart.")
  }
}

export async function prepareInitialChartHistory({
  ticker,
  timeframe,
  now = new Date(),
  signal,
  fetchImpl = fetch,
}: {
  ticker: string
  timeframe: ChartTimeframe
  now?: Date
  signal?: AbortSignal
  fetchImpl?: FetchLike
}): Promise<PreparedChartHistory> {
  const loaded = await loadInitialChartHistory({ ticker, timeframe, now, signal, fetchImpl })
  assertPreparedResult(loaded.result)
  return {
    ticker: ticker.toUpperCase(),
    timeframe,
    range: loaded.range,
    result: loaded.result,
  }
}

export async function prefetchInitialStableChartHistory({
  ticker,
  timeframe,
  now = new Date(),
  signal,
  fetchImpl = fetch,
}: {
  ticker: string
  timeframe: ChartTimeframe
  now?: Date
  signal?: AbortSignal
  fetchImpl?: FetchLike
}) {
  const to = Math.floor(now.getTime() / 1000)
  const range = initialChartHistoryRange(timeframe, to)
  const slices = planChartHistorySlices({ ticker: ticker.toUpperCase(), timeframe, ...range }, now)
  if (!slices.stableClosed) return null
  return prefetchStableChartRange(slices.stableClosed, signal, now, fetchImpl)
}

export function adjacentPrefetchTargets(order: string[], active: string) {
  const normalized = order.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
  const activeTicker = active.trim().toUpperCase()
  const index = normalized.indexOf(activeTicker)
  if (index < 0) return []
  const result: string[] = []
  if (index > 0) result.push(normalized[index - 1])
  if (index + 1 < normalized.length) result.push(normalized[index + 1])
  return [...new Set(result)].slice(0, 2)
}
