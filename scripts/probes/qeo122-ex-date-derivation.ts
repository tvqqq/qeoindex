// QEO-122 source-validation probe only.
// This historical derivation is intentionally bounded to a verified probe regime
// and MUST NOT be imported by production runtime surfaces.

import {
  hasVietnamSecuritiesTradingCalendarCoverage,
  isVietnamSecuritiesTradingDateKey,
  vietnamDateKey,
} from "../../modules/market/calendar.ts"

const SUPPORTED_REGIME = "verified-record-minus-one-trading-session-v1"
const CALENDAR_VERSION = "vn-securities-calendar-2018-2026-v1"
const METHOD = "record_date_previous_verified_trading_session"

export type ProbeExchange = "HOSE" | "HNX" | "UPCOM"

export type ProbeExDateResult = {
  exDate: string
  method: typeof METHOD
  calendarVersion: typeof CALENDAR_VERSION
}

function previousCalendarDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  if (!Number.isFinite(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() - 1)
  return vietnamDateKey(date)
}

export function deriveProbeExDate(input: {
  recordDate: string
  exchange: ProbeExchange
  regimeVersion: string
}): ProbeExDateResult | null {
  if (input.regimeVersion !== SUPPORTED_REGIME) return null
  if (!hasVietnamSecuritiesTradingCalendarCoverage(input.recordDate)) return null
  if (!isVietnamSecuritiesTradingDateKey(input.recordDate)) return null
  if (input.exchange !== "HOSE" && input.exchange !== "HNX" && input.exchange !== "UPCOM") return null

  let cursor = input.recordDate
  for (let offset = 1; offset <= 14; offset += 1) {
    const previous = previousCalendarDateKey(cursor)
    if (!previous || !hasVietnamSecuritiesTradingCalendarCoverage(previous)) return null
    cursor = previous
    if (!isVietnamSecuritiesTradingDateKey(cursor)) continue
    return {
      exDate: cursor,
      method: METHOD,
      calendarVersion: CALENDAR_VERSION,
    }
  }

  return null
}
