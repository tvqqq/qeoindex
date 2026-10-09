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

// Market Board chart coordinates represent *trading* minutes, not wall-clock minutes.
// These helpers affect display geometry only; raw source timestamps and values stay intact.
export const MARKET_SESSION_OPEN_MINUTE = 9 * 60
export const MARKET_LUNCH_START_MINUTE = 11 * 60 + 30
export const MARKET_AFTERNOON_OPEN_MINUTE = 13 * 60
export const MARKET_SESSION_CLOSE_MINUTE = 15 * 60
export const MARKET_COMPACT_DURATION_MINUTES =
  MARKET_LUNCH_START_MINUTE - MARKET_SESSION_OPEN_MINUTE
  + MARKET_SESSION_CLOSE_MINUTE - MARKET_AFTERNOON_OPEN_MINUTE

export function marketTradingSession(minute: number): "morning" | "afternoon" | null {
  if (!Number.isFinite(minute)) return null
  if (minute >= MARKET_SESSION_OPEN_MINUTE && minute < MARKET_LUNCH_START_MINUTE) return "morning"
  if (minute >= MARKET_AFTERNOON_OPEN_MINUTE && minute <= MARKET_SESSION_CLOSE_MINUTE) return "afternoon"
  return null
}

export function compactMarketMinute(minute: number): number {
  if (!Number.isFinite(minute)) return NaN
  const morning = Math.min(minute, MARKET_LUNCH_START_MINUTE) - MARKET_SESSION_OPEN_MINUTE
  const afternoon = Math.max(0, minute - MARKET_AFTERNOON_OPEN_MINUTE)
  return Math.max(0, Math.min(MARKET_COMPACT_DURATION_MINUTES, morning + afternoon))
}

/** Inverse of compactMarketMinute for pointer/crosshair hit testing; never returns a lunch minute. */
export function tradingMinuteAtCompactOffset(offset: number): number {
  if (!Number.isFinite(offset)) return NaN
  const elapsed = Math.max(0, Math.min(MARKET_COMPACT_DURATION_MINUTES, offset))
  const morningDuration = MARKET_LUNCH_START_MINUTE - MARKET_SESSION_OPEN_MINUTE
  return elapsed < morningDuration
    ? MARKET_SESSION_OPEN_MINUTE + elapsed
    : MARKET_AFTERNOON_OPEN_MINUTE + elapsed - morningDuration
}

/** Separate source observations by live session so no flat/interpolated line crosses lunch. */
export function splitTradingSessionObservations(points: readonly IntradayValuePoint[]): IntradayValuePoint[][] {
  const morning: IntradayValuePoint[] = []
  const afternoon: IntradayValuePoint[] = []
  for (const point of points) {
    if (!Number.isFinite(point.minute) || !Number.isFinite(point.value)) continue
    const session = marketTradingSession(vietnamSessionMinute(point.minute))
    if (session === "morning") morning.push(point)
    else if (session === "afternoon") afternoon.push(point)
  }
  return [morning, afternoon].filter((part) => part.length > 0)
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
