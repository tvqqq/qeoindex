import type { ChartResolution } from "./contract"
import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../calendar.ts"

const DAY_SECONDS = 86400
export const CHART_HOT_RETENTION_DAYS = 31
export const CHART_HOT_RETENTION_SESSIONS = 5
export const SHORT_HISTORY_SECONDS = CHART_HOT_RETENTION_DAYS * DAY_SECONDS
export const MID_HISTORY_SECONDS = 366 * DAY_SECONDS

export type ChartHistoryClass = "SHORT" | "MID" | "LONG"

export function chartHistoryClass(resolution: ChartResolution): ChartHistoryClass {
  if (resolution === "1m" || resolution === "15m" || resolution === "30m") return "SHORT"
  if (resolution === "1h" || resolution === "2h" || resolution === "4h") return "MID"
  return "LONG"
}

export function maxChartHistorySeconds(resolution: ChartResolution): number | null {
  const kind = chartHistoryClass(resolution)
  if (kind === "SHORT") return SHORT_HISTORY_SECONDS
  if (kind === "MID") return MID_HISTORY_SECONDS
  return null
}

export function clampChartHistoryRange(input: { resolution: ChartResolution; from: number; to: number; now?: number }) {
  const maxSpan = maxChartHistorySeconds(input.resolution)
  if (maxSpan == null) return { from: input.from, to: input.to, clamped: false }
  const floor = input.to - maxSpan
  if (input.from >= floor) return { from: input.from, to: input.to, clamped: false }
  return { from: floor, to: input.to, clamped: true }
}

export function chartHistoryFloor(resolution: ChartResolution, to: number): number {
  const maxSpan = maxChartHistorySeconds(resolution)
  return maxSpan == null ? 1 : Math.max(1, to - maxSpan)
}

function vietnamMidnightEpoch(dateKey: string) {
  return Math.floor(new Date(`${dateKey}T00:00:00+07:00`).getTime() / 1000)
}

function addVietnamCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return vietnamDateKey(date)
}

/**
 * Product chart horizon remains 31 calendar days for short timeframes.
 * This helper is intentionally separate: it is the physical PostgreSQL HOT
 * retention boundary for canonical raw 1m data and keeps exactly the latest
 * five Vietnam securities trading sessions, including the current trading
 * date when applicable.
 */
export function chartHotSessionRetentionCutoff(referenceAt: Date) {
  let cursor = vietnamDateKey(referenceAt)
  let sessions = 0

  for (let guard = 0; guard < 32; guard += 1) {
    if (isVietnamSecuritiesTradingDateKey(cursor)) {
      sessions += 1
      if (sessions === CHART_HOT_RETENTION_SESSIONS) return vietnamMidnightEpoch(cursor)
    }
    cursor = addVietnamCalendarDays(cursor, -1)
  }

  throw new Error("Unable to resolve five-session chart HOT retention cutoff")
}

/**
 * Legacy product-horizon cutoff. Keep this 31-day behavior separate from the
 * physical 1m HOT storage retention so chart UX can still request older Cold
 * data without forcing PostgreSQL to retain it.
 */
export function chartHotRetentionCutoff(referenceAt: Date) {
  const rollingEpoch = Math.floor(referenceAt.getTime() / 1000) - CHART_HOT_RETENTION_DAYS * DAY_SECONDS
  const rollingDate = vietnamDateKey(rollingEpoch * 1000)
  return vietnamMidnightEpoch(rollingDate) + DAY_SECONDS
}
