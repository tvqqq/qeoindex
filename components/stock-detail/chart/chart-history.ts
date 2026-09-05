import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import {
  chartHistoryClass,
  chartHistoryFloor,
  maxChartHistorySeconds,
} from "../../../modules/market/chart-data/history-policy.ts"
import type { ChartTimeframe } from "./stock-chart-types"

const DAY_SECONDS = 86400

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
  generatedAt?: string
}

export interface ChartRangeInput {
  ticker: string
  timeframe: ChartTimeframe
  from: number
  to: number
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const inFlight = new Map<string, Promise<ChartHistoryResponse>>()

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

export function requestChartRange(
  input: ChartRangeInput,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<ChartHistoryResponse> {
  const key = requestKey(input)
  const existing = inFlight.get(key)
  if (existing) return existing

  const params = new URLSearchParams({
    ticker: input.ticker.toUpperCase(),
    resolution: input.timeframe,
    from: String(input.from),
    to: String(input.to),
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
    return {
      ...(body as ChartHistoryResponse),
      bars: mergeChartBars([], body.bars),
    }
  })().finally(() => {
    inFlight.delete(key)
  })

  inFlight.set(key, promise)
  return promise
}
