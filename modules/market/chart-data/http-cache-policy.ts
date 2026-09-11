import type { ChartResolution } from "./contract"
import { chartHistoryClass } from "./history-policy.ts"
import {
  isVietnamSecuritiesTradingDay,
  vietnamDateKey,
} from "../calendar.ts"

export interface ChartHttpCacheInput {
  ticker: string
  timeframe: ChartResolution
  from: number
  to: number
}

export interface ChartHttpCacheResult {
  coverage: { complete: boolean; state: "COMPLETE" | "PARTIAL" }
  gaps: unknown[]
  integrityIssues: unknown[]
  errors: unknown[]
  metadata?: { sessionState?: "LIVE" | "CLOSED" } | null
}

export type ChartHttpCachePolicy =
  | { cacheControl: "private, max-age=600"; vary: "Cookie" }
  | { cacheControl: "no-store" }

function vietnamTradingOpenEpoch(now: Date) {
  return Math.floor(Date.parse(`${vietnamDateKey(now)}T09:00:00+07:00`) / 1000)
}

function isStableRange(input: ChartHttpCacheInput, now: Date) {
  const nowEpoch = Math.floor(now.getTime() / 1000)
  if (!Number.isFinite(input.from) || !Number.isFinite(input.to) || input.from > input.to || input.to > nowEpoch) {
    return false
  }
  if (chartHistoryClass(input.timeframe) === "LONG") return true
  if (!isVietnamSecuritiesTradingDay(now)) return true
  return input.to < vietnamTradingOpenEpoch(now)
}

export function chartHttpCachePolicy(
  input: ChartHttpCacheInput,
  result: ChartHttpCacheResult,
  now: Date = new Date(),
): ChartHttpCachePolicy {
  const safe = isStableRange(input, now)
    && result.metadata?.sessionState === "CLOSED"
    && result.coverage.complete
    && result.coverage.state === "COMPLETE"
    && result.gaps.length === 0
    && result.integrityIssues.length === 0
    && result.errors.length === 0

  return safe
    ? { cacheControl: "private, max-age=600", vary: "Cookie" }
    : { cacheControl: "no-store" }
}
