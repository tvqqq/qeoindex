export const ADMIN_TIME_ZONE = "Asia/Ho_Chi_Minh"

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: ADMIN_TIME_ZONE,
  hour12: false,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const TIME_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: ADMIN_TIME_ZONE,
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const DATE_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: ADMIN_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

function asDate(value: string | number | Date) {
  return value instanceof Date ? value : new Date(value)
}

export function formatAdminDateTime(value: string | number | Date) {
  return DATE_TIME_FORMATTER.format(asDate(value))
}

export function formatAdminTime(value: string | number | Date) {
  return TIME_FORMATTER.format(asDate(value))
}

export function formatAdminDate(value: string | number | Date) {
  return DATE_FORMATTER.format(asDate(value))
}

export function formatAdminDuration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—"
  if (value < 1000) return `${Math.round(value)}ms`

  let seconds = Math.round(value / 1000)
  const hours = Math.floor(seconds / 3600)
  seconds -= hours * 3600
  const minutes = Math.floor(seconds / 60)
  seconds -= minutes * 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(" ")
}

export function formatAdminTokenCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—"
  if (value >= 1_000_000) {
    const formatted = (value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")
    return `${formatted}M`
  }
  if (value >= 1_000) {
    const formatted = (value / 1_000).toFixed(value >= 100_000 ? 1 : value >= 10_000 ? 1 : 2).replace(/\.0+$/, "")
    return `${formatted}K`
  }
  return String(Math.round(value))
}
