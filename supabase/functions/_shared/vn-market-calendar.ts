const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh"

// Official HNX/VNX cash-market closure dates for the historical range currently
// retained by QeoIndex. Weekends are rejected separately. Keep this list in
// sync with public.market_trading_sessions (QEO-106).
const VN_SECURITIES_MARKET_HOLIDAYS = new Set([
  "2018-01-01",
  "2018-02-14",
  "2018-02-15",
  "2018-02-16",
  "2018-02-19",
  "2018-02-20",
  "2018-04-25",
  "2018-04-30",
  "2018-05-01",
  "2018-09-03",
  "2018-12-31",
  "2019-01-01",
  "2019-02-04",
  "2019-02-05",
  "2019-02-06",
  "2019-02-07",
  "2019-02-08",
  "2019-04-15",
  "2019-04-29",
  "2019-04-30",
  "2019-05-01",
  "2019-09-02",
  "2020-01-01",
  "2020-01-23",
  "2020-01-24",
  "2020-01-27",
  "2020-01-28",
  "2020-01-29",
  "2020-04-02",
  "2020-04-30",
  "2020-05-01",
  "2020-09-02",
  "2021-01-01",
  "2021-02-10",
  "2021-02-11",
  "2021-02-12",
  "2021-02-15",
  "2021-02-16",
  "2021-04-21",
  "2021-04-30",
  "2021-05-03",
  "2021-09-02",
  "2021-09-03",
  "2022-01-03",
  "2022-01-31",
  "2022-02-01",
  "2022-02-02",
  "2022-02-03",
  "2022-02-04",
  "2022-04-11",
  "2022-05-02",
  "2022-05-03",
  "2022-09-01",
  "2022-09-02",
  "2023-01-02",
  "2023-01-20",
  "2023-01-23",
  "2023-01-24",
  "2023-01-25",
  "2023-01-26",
  "2023-05-01",
  "2023-05-02",
  "2023-05-03",
  "2023-09-01",
  "2023-09-04",
  "2024-01-01",
  "2024-02-08",
  "2024-02-09",
  "2024-02-12",
  "2024-02-13",
  "2024-02-14",
  "2024-04-18",
  "2024-04-29",
  "2024-04-30",
  "2024-05-01",
  "2024-09-02",
  "2024-09-03",
  "2025-01-01",
  "2025-01-27",
  "2025-01-28",
  "2025-01-29",
  "2025-01-30",
  "2025-01-31",
  "2025-04-07",
  "2025-04-30",
  "2025-05-01",
  "2025-05-02",
  "2025-09-01",
  "2025-09-02",
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
  return !VN_SECURITIES_MARKET_HOLIDAYS.has(dateKey)
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
