import { isVietnamSecuritiesTradingDateKey } from "../calendar"

export type IntradayValuePoint = { minute: number; value: number }
export type IntradayForeignPoint = { minute: number; buy: number; sell: number }

export function previousTradingSessionDateKey(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) return null
  const date = new Date(`${day}T00:00:00Z`)
  for (let offset = 0; offset < 14; offset += 1) {
    date.setUTCDate(date.getUTCDate() - 1)
    const previous = date.toISOString().slice(0, 10)
    if (isVietnamSecuritiesTradingDateKey(previous)) return previous
  }
  return null
}

export function vietnamSessionMinute(timestampMs: number): number {
  return ((Math.floor(timestampMs / 60_000) + 420) % 1440 + 1440) % 1440
}

/** No forward extrapolation: values exist only between real recorded samples. */
export function observedValueAtMinute(points: readonly IntradayValuePoint[], minute: number): number | undefined {
  if (!points.length || !Number.isFinite(minute)) return undefined
  const first = vietnamSessionMinute(points[0].minute)
  const last = vietnamSessionMinute(points[points.length - 1].minute)
  if (minute < first || minute > last) return undefined
  let observed: number | undefined
  for (const point of points) {
    if (vietnamSessionMinute(point.minute) > minute) break
    if (Number.isFinite(point.value)) observed = point.value
  }
  return observed
}

export function intradayForeignNet(points: readonly IntradayForeignPoint[]): IntradayValuePoint[] {
  return points
    .filter((point) => Number.isFinite(point.minute)
      && Number.isFinite(point.buy) && point.buy >= 0
      && Number.isFinite(point.sell) && point.sell >= 0)
    .map((point) => ({ minute: point.minute, value: point.buy - point.sell }))
}
