import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../calendar"
import type { ChartResolution } from "./contract"

const DAY_SECONDS = 86400
const SHORT_HISTORY_DAYS = 31
const HOT_RETENTION_LOOKBACK_LIMIT_DAYS = 30

export const CHART_HOT_RETENTION_SESSIONS = 5
export const SHORT_HISTORY_SECONDS = SHORT_HISTORY_DAYS * DAY_SECONDS
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

function previousVietnamDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() - 1)
  return vietnamDateKey(date)
}

function vietnamSessionStartEpoch(dateKey: string) {
  return Math.floor(new Date(`${dateKey}T00:00:00+07:00`).getTime() / 1000)
}

export function chartHotRetentionCutoff(referenceAt: Date) {
  let dateKey = vietnamDateKey(referenceAt)
  let retainedSessions = 0

  for (let inspectedDays = 0; inspectedDays <= HOT_RETENTION_LOOKBACK_LIMIT_DAYS; inspectedDays += 1) {
    if (isVietnamSecuritiesTradingDateKey(dateKey)) {
      retainedSessions += 1
      if (retainedSessions === CHART_HOT_RETENTION_SESSIONS) return vietnamSessionStartEpoch(dateKey)
    }
    dateKey = previousVietnamDateKey(dateKey)
  }

  throw new Error(`Unable to resolve ${CHART_HOT_RETENTION_SESSIONS} Vietnam trading sessions before ${referenceAt.toISOString()}`)
}
