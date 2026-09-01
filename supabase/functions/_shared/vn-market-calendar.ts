const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh"

const VN_SECURITIES_MARKET_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-01-02",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-04-27",
  "2026-04-30",
  "2026-05-01",
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
])

export function vietnamDateKey(value: Date | string | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid Vietnam market calendar date")
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function weekdayForDateKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00+07:00`).getUTCDay()
}

export function isVietnamSecuritiesTradingDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false
  const weekday = weekdayForDateKey(dateKey)
  if (weekday === 0 || weekday === 6) return false
  return !VN_SECURITIES_MARKET_HOLIDAYS_2026.has(dateKey)
}

export function isVietnamSecuritiesTradingDay(value: Date | string | number = new Date()) {
  return isVietnamSecuritiesTradingDateKey(vietnamDateKey(value))
}

function addCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return vietnamDateKey(date)
}

export function nextVietnamSecuritiesTradingDateKey(dateKey: string) {
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addCalendarDays(dateKey, offset)
    if (isVietnamSecuritiesTradingDateKey(candidate)) return candidate
  }
  throw new Error(`Unable to resolve next Vietnam securities trading date after ${dateKey}`)
}
