export function getVnTimeSeconds(date: Date = new Date()): { dayOfWeek: number; totalSeconds: number } {
  // Convert date to Vietnam Time (UTC+7)
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
  const vnDate = new Date(utcMs + 7 * 3600000)
  const dayOfWeek = vnDate.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const h = vnDate.getHours()
  const m = vnDate.getMinutes()
  const s = vnDate.getSeconds()
  const totalSeconds = h * 3600 + m * 60 + s
  return { dayOfWeek, totalSeconds }
}

export function calculateSessionCountdown(date: Date = new Date()): {
  type: "ATO" | "ATC"
  label: string
  remainingSec: number
} | null {
  const { dayOfWeek, totalSeconds } = getVnTimeSeconds(date)
  // Trading days only (Mon-Fri)
  if (dayOfWeek < 1 || dayOfWeek > 5) return null

  // ATO: 09:00:00 -> 09:15:00 (32,400s -> 33,300s)
  if (totalSeconds >= 32400 && totalSeconds < 33300) {
    const remainingSec = 33300 - totalSeconds
    const mins = Math.floor(remainingSec / 60)
    const secs = remainingSec % 60
    return {
      type: "ATO",
      label: `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`,
      remainingSec,
    }
  }

  // ATC: 14:30:00 -> 14:45:00 (52,200s -> 53,100s)
  if (totalSeconds >= 52200 && totalSeconds < 53100) {
    const remainingSec = 53100 - totalSeconds
    const mins = Math.floor(remainingSec / 60)
    const secs = remainingSec % 60
    return {
      type: "ATC",
      label: `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`,
      remainingSec,
    }
  }

  return null
}

export function isTradingSessionOpen(date: Date = new Date()): boolean {
  const { dayOfWeek, totalSeconds } = getVnTimeSeconds(date)
  // Trading days only (Mon-Fri)
  if (dayOfWeek < 1 || dayOfWeek > 5) return false
  // HOSE Trading session: 09:00:00 (32,400s) -> 14:46:00 (53,160s)
  return totalSeconds >= 32400 && totalSeconds < 53160
}

export function isLunchBreak(date: Date = new Date()): boolean {
  const { dayOfWeek, totalSeconds } = getVnTimeSeconds(date)
  // Trading days only (Mon-Fri)
  if (dayOfWeek < 1 || dayOfWeek > 5) return false
  // Lunch break: 11:30:00 (41,400s) -> 13:00:00 (46,800s)
  return totalSeconds >= 41400 && totalSeconds < 46800
}

export type MarketSessionPhase = "PRE_MARKET" | "MORNING" | "LUNCH_BREAK" | "AFTERNOON" | "EOD_CLOSED"

export type MarketSessionStatus = {
  phase: MarketSessionPhase
  isLiveSession: boolean
  cacheBucketKey: string
  ttlSeconds: number
}

export function getMarketSessionStatus(date: Date = new Date()): MarketSessionStatus {
  const { dayOfWeek, totalSeconds } = getVnTimeSeconds(date)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

  if (isWeekend) {
    const daysUntilMonday = dayOfWeek === 6 ? 2 : 1
    const secondsRemainingToday = 86400 - totalSeconds
    const ttlSeconds = secondsRemainingToday + (daysUntilMonday - 1) * 86400 + 32400
    return {
      phase: "EOD_CLOSED",
      isLiveSession: false,
      cacheBucketKey: "eod_closed",
      ttlSeconds: Math.max(60, ttlSeconds),
    }
  }

  // Weekday before 09:00
  if (totalSeconds < 32400) {
    const ttlSeconds = 32400 - totalSeconds
    return {
      phase: "PRE_MARKET",
      isLiveSession: false,
      cacheBucketKey: "pre_market",
      ttlSeconds: Math.max(60, ttlSeconds),
    }
  }

  // Morning session: 09:00:00 -> 11:30:00
  if (totalSeconds >= 32400 && totalSeconds < 41400) {
    const currentBucket = Math.floor(totalSeconds / 300)
    const ttlSeconds = Math.max(5, Math.min(300 - (totalSeconds % 300), 41400 - totalSeconds))
    return {
      phase: "MORNING",
      isLiveSession: true,
      cacheBucketKey: `m_${currentBucket}`,
      ttlSeconds,
    }
  }

  // Lunch break: 11:30:00 -> 13:00:00
  if (totalSeconds >= 41400 && totalSeconds < 46800) {
    const ttlSeconds = 46800 - totalSeconds
    return {
      phase: "LUNCH_BREAK",
      isLiveSession: false,
      cacheBucketKey: "lunch_break",
      ttlSeconds: Math.max(60, ttlSeconds),
    }
  }

  // Afternoon session: 13:00:00 -> 14:46:00 (stops at 14:46)
  if (totalSeconds >= 46800 && totalSeconds < 53160) {
    const currentBucket = Math.floor(totalSeconds / 300)
    const ttlSeconds = Math.max(5, Math.min(300 - (totalSeconds % 300), 53160 - totalSeconds + 10))
    return {
      phase: "AFTERNOON",
      isLiveSession: true,
      cacheBucketKey: `a_${currentBucket}`,
      ttlSeconds,
    }
  }

  // EOD Closed: after 14:46 on weekdays
  const daysUntilNextSession = dayOfWeek === 5 ? 3 : 1
  const secondsRemainingToday = 86400 - totalSeconds
  const ttlSeconds = secondsRemainingToday + (daysUntilNextSession - 1) * 86400 + 32400
  return {
    phase: "EOD_CLOSED",
    isLiveSession: false,
    cacheBucketKey: "eod_closed",
    ttlSeconds: Math.max(60, ttlSeconds),
  }
}

