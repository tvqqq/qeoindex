import { getVnTimeSeconds } from "./session-countdown.ts"
import type { IntradayPoint } from "../modules/market/realtime/intraday-5m.ts"

export const MARKET_SESSION_RESET_EVENT = "qeoindex:market-session-reset"

export type MarketUiPhase = "PRE_MARKET" | "ATO" | "CONTINUOUS" | "CLOSING_AUCTION" | "EOD"

const ATO_START_SECONDS = 9 * 3600
const MINI_CHART_START_SECONDS = 9 * 3600 + 15 * 60
const MINI_CHART_STOP_SECONDS = 14 * 3600 + 30 * 60
const EOD_START_SECONDS = 14 * 3600 + 46 * 60
const EOD_FINAL_BAR_SECONDS = 14 * 3600 + 45 * 60

export function getMarketUiPhase(date = new Date()): MarketUiPhase {
  const { dayOfWeek, totalSeconds } = getVnTimeSeconds(date)
  if (dayOfWeek < 1 || dayOfWeek > 5) return "EOD"
  if (totalSeconds < ATO_START_SECONDS) return "PRE_MARKET"
  if (totalSeconds < MINI_CHART_START_SECONDS) return "ATO"
  if (totalSeconds < MINI_CHART_STOP_SECONDS) return "CONTINUOUS"
  if (totalSeconds < EOD_START_SECONDS) return "CLOSING_AUCTION"
  return "EOD"
}

export function shouldAcceptRealtimeMiniChart(timestampSeconds: number) {
  return getMarketUiPhase(new Date(timestampSeconds * 1000)) === "CONTINUOUS"
}

export function sessionTimestampSeconds(date: Date, totalSeconds: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return Date.UTC(value("year"), value("month") - 1, value("day"), 0, 0, totalSeconds) / 1000 - 7 * 3600
}

export function newSessionReferencePoint(reference: number, date = new Date()): IntradayPoint[] {
  if (!Number.isFinite(reference) || reference <= 0) return []
  return [{ time: sessionTimestampSeconds(date, MINI_CHART_START_SECONDS), close: reference }]
}

export function miniChartPointsForDisplay(points: IntradayPoint[], date = new Date()) {
  const phase = getMarketUiPhase(date)
  const { dayOfWeek } = getVnTimeSeconds(date)
  if (dayOfWeek < 1 || dayOfWeek > 5) return points
  if (phase === "ATO") return []
  if (phase === "PRE_MARKET") return points

  const start = sessionTimestampSeconds(date, MINI_CHART_START_SECONDS)
  const stop = sessionTimestampSeconds(date, MINI_CHART_STOP_SECONDS)
  const visibleThrough = Math.min(stop, Math.floor(date.getTime() / 1000))
  const base = points.filter((point) => point.time >= start && point.time <= visibleThrough)
  if (phase !== "EOD") return base

  const finalBarStart = sessionTimestampSeconds(date, EOD_FINAL_BAR_SECONDS)
  const finalPoint = points.filter((point) => point.time >= finalBarStart).sort((a, b) => a.time - b.time).at(-1)
  if (!finalPoint || base.some((point) => point.time === finalPoint.time)) return base
  return [...base, finalPoint]
}
