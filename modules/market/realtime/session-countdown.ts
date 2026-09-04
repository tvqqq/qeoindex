import {
  isVietnamSecuritiesTradingDay,
  nextVietnamSecuritiesTradingDateKey,
  vietnamDateKey,
} from "../calendar.ts"

export function getVnTimeSeconds(date: Date = new Date()): { dayOfWeek: number; totalSeconds: number } {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
  const vnDate = new Date(utcMs + 7 * 3600000)
  const dayOfWeek = vnDate.getDay()
  const h = vnDate.getHours()
  const m = vnDate.getMinutes()
  const s = vnDate.getSeconds()
  return { dayOfWeek, totalSeconds: h * 3600 + m * 60 + s }
}

export function calculateSessionCountdown(date: Date = new Date()): {
  type: "ATO" | "ATC"
  label: string
  remainingSec: number
} | null {
  if (!isVietnamSecuritiesTradingDay(date)) return null
  const { totalSeconds } = getVnTimeSeconds(date)

  if (totalSeconds >= 32400 && totalSeconds < 33300) {
    const remainingSec = 33300 - totalSeconds
    const mins = Math.floor(remainingSec / 60)
    const secs = remainingSec % 60
    return { type: "ATO", label: `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`, remainingSec }
  }

  if (totalSeconds >= 52200 && totalSeconds < 53100) {
    const remainingSec = 53100 - totalSeconds
    const mins = Math.floor(remainingSec / 60)
    const secs = remainingSec % 60
    return { type: "ATC", label: `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`, remainingSec }
  }

  return null
}

export function isTradingSessionOpen(date: Date = new Date()): boolean {
  if (!isVietnamSecuritiesTradingDay(date)) return false
  const { totalSeconds } = getVnTimeSeconds(date)
  return totalSeconds >= 32400 && totalSeconds < 53160
}

export function isLunchBreak(date: Date = new Date()): boolean {
  if (!isVietnamSecuritiesTradingDay(date)) return false
  const { totalSeconds } = getVnTimeSeconds(date)
  return totalSeconds >= 41400 && totalSeconds < 46800
}

export type MarketSessionPhase = "PRE_MARKET" | "MORNING" | "LUNCH_BREAK" | "AFTERNOON" | "EOD_CLOSED"

export type MarketSessionStatus = {
  phase: MarketSessionPhase
  isLiveSession: boolean
  cacheBucketKey: string
  ttlSeconds: number
}

function secondsUntilNextTradingOpen(date: Date) {
  const nextDate = nextVietnamSecuritiesTradingDateKey(vietnamDateKey(date))
  const nextOpen = Date.parse(`${nextDate}T09:00:00+07:00`)
  return Math.max(60, Math.floor((nextOpen - date.getTime()) / 1000))
}

function closedStatus(ttlSeconds: number): MarketSessionStatus {
  return { phase: "EOD_CLOSED", isLiveSession: false, cacheBucketKey: "eod_closed", ttlSeconds: Math.max(60, ttlSeconds) }
}

export function getMarketSessionStatus(date: Date = new Date()): MarketSessionStatus {
  const { totalSeconds } = getVnTimeSeconds(date)

  if (!isVietnamSecuritiesTradingDay(date)) {
    return closedStatus(secondsUntilNextTradingOpen(date))
  }

  if (totalSeconds < 32400) {
    return { phase: "PRE_MARKET", isLiveSession: false, cacheBucketKey: "pre_market", ttlSeconds: Math.max(60, 32400 - totalSeconds) }
  }

  if (totalSeconds < 41400) {
    const currentBucket = Math.floor(totalSeconds / 300)
    return {
      phase: "MORNING",
      isLiveSession: true,
      cacheBucketKey: `m_${currentBucket}`,
      ttlSeconds: Math.max(5, Math.min(300 - (totalSeconds % 300), 41400 - totalSeconds)),
    }
  }

  if (totalSeconds < 46800) {
    return { phase: "LUNCH_BREAK", isLiveSession: false, cacheBucketKey: "lunch_break", ttlSeconds: Math.max(60, 46800 - totalSeconds) }
  }

  if (totalSeconds < 53160) {
    const currentBucket = Math.floor(totalSeconds / 300)
    return {
      phase: "AFTERNOON",
      isLiveSession: true,
      cacheBucketKey: `a_${currentBucket}`,
      ttlSeconds: Math.max(5, Math.min(300 - (totalSeconds % 300), 53160 - totalSeconds + 10)),
    }
  }

  return closedStatus(secondsUntilNextTradingOpen(date))
}
