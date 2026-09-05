import {
  isVietnamSecuritiesTradingDateKey,
  nextVietnamSecuritiesTradingDateKey,
  vietnamDateKey,
} from "../../../modules/market/calendar.ts"
import type { ChartTimeframe } from "./stock-chart-types"

const VN_OFFSET_SECONDS = 7 * 60 * 60
const INTRADAY_MINUTES: Partial<Record<ChartTimeframe, number>> = {
  "1m": 1,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
}

function localParts(time: number) {
  const date = new Date((time + VN_OFFSET_SECONDS) * 1000)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  }
}

function dateKey(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function localEpochForDateKey(key: string, hour: number, minute: number) {
  return Math.floor(Date.parse(`${key}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`) / 1000)
}

function addCalendarDaysKey(key: string, days: number) {
  const date = new Date(`${key}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return vietnamDateKey(date)
}

function advanceTradingDays(key: string, count: number) {
  let cursor = key
  for (let i = 0; i < count; i += 1) cursor = nextVietnamSecuritiesTradingDateKey(cursor)
  return cursor
}

function firstTradingDateOnOrAfter(key: string) {
  return isVietnamSecuritiesTradingDateKey(key) ? key : nextVietnamSecuritiesTradingDateKey(key)
}

export function projectNextFutureTime(time: number, timeframe: ChartTimeframe) {
  const intradayMinutes = INTRADAY_MINUTES[timeframe]
  const parts = localParts(time)
  const currentDateKey = dateKey(parts.year, parts.month, parts.day)

  if (intradayMinutes) {
    const currentMinutes = parts.hour * 60 + parts.minute
    const nextMinutes = currentMinutes + intradayMinutes
    const morningEnd = 11 * 60 + 30
    const afternoonStart = 13 * 60
    const marketClose = 15 * 60

    if (currentMinutes < morningEnd) {
      if (nextMinutes < morningEnd) {
        return localEpochForDateKey(currentDateKey, Math.floor(nextMinutes / 60), nextMinutes % 60)
      }
      return localEpochForDateKey(currentDateKey, 13, 0)
    }

    if (currentMinutes >= afternoonStart && currentMinutes < marketClose && nextMinutes < marketClose) {
      return localEpochForDateKey(currentDateKey, Math.floor(nextMinutes / 60), nextMinutes % 60)
    }

    return localEpochForDateKey(nextVietnamSecuritiesTradingDateKey(currentDateKey), 9, 0)
  }

  if (timeframe === "1D") {
    return localEpochForDateKey(advanceTradingDays(currentDateKey, 1), parts.hour, parts.minute)
  }
  if (timeframe === "3D") {
    return localEpochForDateKey(advanceTradingDays(currentDateKey, 3), parts.hour, parts.minute)
  }
  if (timeframe === "1W") {
    const nextWeekCandidate = addCalendarDaysKey(currentDateKey, 7)
    return localEpochForDateKey(firstTradingDateOnOrAfter(nextWeekCandidate), parts.hour, parts.minute)
  }

  if (timeframe === "1M" || timeframe === "1Q") {
    const monthsToAdd = timeframe === "1M" ? 1 : 3
    const target = new Date(Date.UTC(parts.year, parts.month - 1 + monthsToAdd, 1, 0, 0, 0))
    const targetKey = dateKey(target.getUTCFullYear(), target.getUTCMonth() + 1, 1)
    return localEpochForDateKey(firstTradingDateOnOrAfter(targetKey), parts.hour, parts.minute)
  }

  const targetKey = dateKey(parts.year + 1, 1, 1)
  return localEpochForDateKey(firstTradingDateOnOrAfter(targetKey), parts.hour, parts.minute)
}

export function projectFutureTimes(lastTime: number, timeframe: ChartTimeframe, count: number) {
  const result: number[] = []
  let cursor = lastTime
  for (let i = 0; i < count; i += 1) {
    cursor = projectNextFutureTime(cursor, timeframe)
    result.push(cursor)
  }
  return result
}

export function formatFutureTimelineLabel(time: number, timeframe: ChartTimeframe) {
  const date = new Date(time * 1000)
  if (timeframe.includes("m") || timeframe.includes("h")) {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date)
  }
  if (timeframe === "1D" || timeframe === "3D" || timeframe === "1W") {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
    }).format(date)
  }
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}
