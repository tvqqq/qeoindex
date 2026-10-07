import { isVietnamSecuritiesTradingDateKey } from "../calendar.ts"

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

/** No forward extrapolation; compact charts can also reject stale points inside observed gaps. */
export function observedValueAtMinute(
  points: readonly IntradayValuePoint[], minute: number, maxAgeMinutes = Infinity,
): number | undefined {
  if (!points.length || !Number.isFinite(minute)) return undefined
  const first = vietnamSessionMinute(points[0].minute)
  const last = vietnamSessionMinute(points[points.length - 1].minute)
  if (minute < first || minute > last) return undefined
  let observed: number | undefined
  let observedMinute = -Infinity
  for (const point of points) {
    const clock = vietnamSessionMinute(point.minute)
    if (clock > minute) break
    if (Number.isFinite(point.value)) {
      observed = point.value
      observedMinute = clock
    }
  }
  return minute - observedMinute <= maxAgeMinutes ? observed : undefined
}

/** Pure SVG geometry from observed samples only: joining is visual, not a missing-minute backfill.
 * The area closes exactly at the first/last real sample, never at market open/close.
 */
export function observedAreaPaths(
  points: readonly IntradayValuePoint[],
  x: (vietnamMinute: number) => number,
  y: (value: number) => number,
  baselineY: number,
): { line: string; area: string } {
  const vertices = [...points]
    .filter((point) => Number.isFinite(point.minute) && Number.isFinite(point.value))
    .sort((a, b) => a.minute - b.minute)
    .map((point) => ({ x: x(vietnamSessionMinute(point.minute)), y: y(point.value) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (!vertices.length) return { line: "", area: "" }
  const coord = (point: { x: number; y: number }) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`
  const line = vertices.map((point, position) => `${position ? "L" : "M"}${coord(point)}`).join(" ")
  if (vertices.length < 2 || !Number.isFinite(baselineY)) return { line, area: "" }
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  return {
    line,
    area: `${line} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`,
  }
}

export function intradayForeignNet(points: readonly IntradayForeignPoint[]): IntradayValuePoint[] {
  return points
    .filter((point) => Number.isFinite(point.minute)
      && Number.isFinite(point.buy) && point.buy >= 0
      && Number.isFinite(point.sell) && point.sell >= 0)
    .map((point) => ({ minute: point.minute, value: point.buy - point.sell }))
}
