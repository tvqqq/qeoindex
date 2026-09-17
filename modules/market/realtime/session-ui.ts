import { getMarketSessionStatus, getVnTimeSeconds, isLunchBreak } from "./session-countdown.ts"
import type { IntradayPoint } from "./intraday-5m.ts"

export const MARKET_SESSION_RESET_EVENT = "qeoindex:market-session-reset"

export type MarketUiPhase = "PRE_MARKET" | "ATO" | "CONTINUOUS" | "CLOSING_AUCTION" | "EOD"

const ATO_START_SECONDS = 9 * 3600
const MINI_CHART_START_SECONDS = 9 * 3600 + 15 * 60
const LUNCH_START_SECONDS = 11 * 3600 + 30 * 60
const MINI_CHART_STOP_SECONDS = 14 * 3600 + 30 * 60
const EOD_START_SECONDS = 14 * 3600 + 46 * 60
const EOD_FINAL_BAR_SECONDS = 14 * 3600 + 45 * 60
const FIVE_MINUTE_SECONDS = 5 * 60
const LATEST_LIVE_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 1000

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

export function isLatestMiniChartSnapshotFresh(generatedAt: string, now = new Date()) {
  const generated = new Date(generatedAt)
  const generatedMs = generated.getTime()
  const nowMs = now.getTime()
  if (!Number.isFinite(generatedMs) || generatedMs > nowMs) return false

  const currentPhase = getMarketSessionStatus(now).phase
  const generatedPhase = getMarketSessionStatus(generated).phase

  if (currentPhase === "EOD_CLOSED") {
    return true
  }

  if (currentPhase === "PRE_MARKET") {
    return generatedPhase === "PRE_MARKET"
  }

  if (currentPhase === "LUNCH_BREAK") {
    if (generatedPhase === "LUNCH_BREAK") return true
    if (generatedPhase !== "MORNING") return false

    const lunchStartMs = sessionTimestampSeconds(now, LUNCH_START_SECONDS) * 1000
    return generatedMs >= lunchStartMs - LATEST_LIVE_SNAPSHOT_MAX_AGE_MS && generatedMs <= lunchStartMs
  }

  if (currentPhase === "MORNING" || currentPhase === "AFTERNOON") {
    return generatedPhase === currentPhase && nowMs - generatedMs <= LATEST_LIVE_SNAPSHOT_MAX_AGE_MS
  }

  return false
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
  const base = points.filter((point) => (
    point.time >= start
    && point.time <= visibleThrough
    && !isLunchBreak(new Date(point.time * 1000))
  ))
  if (phase !== "EOD") return base

  const finalBarStart = sessionTimestampSeconds(date, EOD_FINAL_BAR_SECONDS)
  const finalPoint = points
    .filter((point) => point.time >= finalBarStart && point.time < finalBarStart + FIVE_MINUTE_SECONDS)
    .sort((a, b) => a.time - b.time)
    .at(-1)
  if (!finalPoint || base.some((point) => point.time === finalPoint.time)) return base
  return [...base, finalPoint]
}
