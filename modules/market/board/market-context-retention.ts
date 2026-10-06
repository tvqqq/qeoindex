import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../calendar.ts"
import { previousTradingSessionDateKey } from "./market-context-metrics.ts"

export type RetainedMetricSource = "finhay-vnindex" | "index-quote" | "top200-partial"
export type RetainedLiquidity = {
  day: string
  source: "finhay-vnindex" | "index-quote"
  asOf: string
  value: number
  volume?: number
}
export type RetainedForeign = {
  day: string
  source: "finhay-vnindex" | "top200-partial"
  asOf: string
  buy: number
  sell: number
}

/**
 * The previous session remains the displayed session until 09:00 ICT on the
 * next exchange trading day. This includes weekends and exchange holidays.
 * At 09:00, the old session stops qualifying even if the new feed is empty.
 */
export function displayedMarketMetricDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) return ""
  const day = vietnamDateKey(now)
  const seconds = ((Math.floor(now.getTime() / 1000) + 7 * 3600) % 86400 + 86400) % 86400
  if (isVietnamSecuritiesTradingDateKey(day) && seconds >= 9 * 3600) return day
  return previousTradingSessionDateKey(day) ?? ""
}

export function validSessionMetricTimestamp(value: string, day: string): boolean {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const ms = Date.parse(value)
  return Number.isFinite(ms)
    && ms >= Date.parse(`${day}T09:00:00+07:00`)
    && ms < Date.parse(`${day}T23:59:59+07:00`)
    && ms <= Date.now() + 5_000
}

const BASE = "qeoindex:board-metric-retained:v1"
type StoreReader = { getItem(key: string): string | null }
type StoreWriter = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

function key(kind: "liquidity" | "foreign", source: RetainedMetricSource, day: string) {
  return `${BASE}:${kind}:${source}:${day}`
}

/** Strictly source-and-session-scoped; no hybrid full-HOSE / Top-200 sums. */
export function readRetainedMetric(
  store: StoreReader,
  kind: "liquidity",
  source: RetainedLiquidity["source"],
  day: string,
): RetainedLiquidity | null
export function readRetainedMetric(
  store: StoreReader,
  kind: "foreign",
  source: RetainedForeign["source"],
  day: string,
): RetainedForeign | null
export function readRetainedMetric(
  store: StoreReader,
  kind: "liquidity" | "foreign",
  source: RetainedMetricSource,
  day: string,
): RetainedLiquidity | RetainedForeign | null {
  if (!day) return null
  try {
    const parsed: unknown = JSON.parse(store.getItem(key(kind, source, day)) ?? "null")
    if (!parsed || typeof parsed !== "object") return null
    const value = parsed as Record<string, unknown>
    if (value.day !== day || value.source !== source
      || typeof value.asOf !== "string" || !validSessionMetricTimestamp(value.asOf, day)) return null
    if (kind === "liquidity") {
      if (source === "top200-partial" || typeof value.value !== "number"
        || !Number.isFinite(value.value) || value.value < 0) return null
      if (value.volume !== undefined && (typeof value.volume !== "number"
        || !Number.isFinite(value.volume) || value.volume < 0)) return null
      return { day, source, asOf: value.asOf, value: value.value, ...(value.volume === undefined ? {} : { volume: value.volume as number }) }
    }
    if (source === "index-quote" || typeof value.buy !== "number" || typeof value.sell !== "number"
      || !Number.isFinite(value.buy) || !Number.isFinite(value.sell)
      || value.buy < 0 || value.sell < 0) return null
    return { day, source, asOf: value.asOf, buy: value.buy, sell: value.sell }
  } catch {
    return null
  }
}

export function writeRetainedMetric(
  store: StoreWriter,
  kind: "liquidity" | "foreign",
  metric: RetainedLiquidity | RetainedForeign,
): void {
  if (!validSessionMetricTimestamp(metric.asOf, metric.day)) return
  try {
    // Network responses can arrive out of order. Never replace the last
    // verified EOD sample with an older response from the same source.
    let previous: unknown = null
    try { previous = JSON.parse(store.getItem(key(kind, metric.source, metric.day)) ?? "null") }
    catch { /* Corrupt snapshots are overwritten by the next valid reading. */ }
    if (previous && typeof previous === "object") {
      const stored = previous as Record<string, unknown>
      if (stored.day === metric.day && stored.source === metric.source
        && typeof stored.asOf === "string"
        && validSessionMetricTimestamp(stored.asOf, metric.day)
        && Date.parse(stored.asOf) > Date.parse(metric.asOf)) return
    }
    const daysKey = `${BASE}:${kind}:${metric.source}:days`
    let current: unknown = []
    try { current = JSON.parse(store.getItem(daysKey) ?? "[]") } catch { /* Reset corrupted index. */ }
    const valid = Array.isArray(current)
      ? current.filter((day): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day))
      : []
    const days = [...new Set([...valid, metric.day])].sort()
    const keep = days.slice(-3)
    if (!keep.includes(metric.day)) return
    for (const expired of days.slice(0, -3)) store.removeItem?.(key(kind, metric.source, expired))
    store.setItem(key(kind, metric.source, metric.day), JSON.stringify(metric))
    store.setItem(daysKey, JSON.stringify(keep))
  } catch {
    // Browser storage is optional; never invent a metric when unavailable.
  }
}
