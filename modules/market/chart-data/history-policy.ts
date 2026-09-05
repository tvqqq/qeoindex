import type { ChartResolution } from "./contract"

const DAY_SECONDS = 86400
export const CHART_HOT_RETENTION_DAYS = 31
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

function vietnamDateKey(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochSeconds * 1000))
}

export function chartHotRetentionCutoff(referenceAt: Date) {
  const rollingEpoch = Math.floor(referenceAt.getTime() / 1000) - CHART_HOT_RETENTION_DAYS * DAY_SECONDS
  const rollingDate = vietnamDateKey(rollingEpoch)
  return Math.floor(new Date(`${rollingDate}T00:00:00+07:00`).getTime() / 1000) + DAY_SECONDS
}
