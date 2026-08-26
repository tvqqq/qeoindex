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
