import { vietnamDateKey } from "../calendar.ts"
import { previousTradingSessionDateKey } from "./market-context-metrics.ts"
import type { IntradayForeignPoint, IntradayValuePoint } from "./market-context-metrics.ts"

export type MarketBoardMetricReplay = {
  day: string
  previousDay: string | null
  liquidity: { today: IntradayValuePoint[]; previous: IntradayValuePoint[] }
  foreign: { today: IntradayForeignPoint[]; previous: IntradayForeignPoint[] }
}

export type PersistedBoardMetric = {
  session_date: string
  minute_at: string
  source_as_of: string
  kind: string
  source: string
  traded_value: number | null
  volume: number | null
  buy_value: number | null
  sell_value: number | null
  covered_symbols: number | null
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function validRecordedMinute(row: PersistedBoardMetric, today: string, previous: string | null, nowMs: number) {
  if (row.session_date !== today && row.session_date !== previous) return false
  const minute = Date.parse(row.minute_at)
  const source = Date.parse(row.source_as_of)
  if (!Number.isFinite(minute) || !Number.isFinite(source) || minute > nowMs + 60_000
    || source > minute + 5_000 || minute - source > 120_000) return false
  const time = new Date(minute)
  const sourceTime = new Date(source)
  if (vietnamDateKey(time) !== row.session_date || vietnamDateKey(sourceTime) !== row.session_date) return false
  const clock = (Math.floor(minute / 60_000) + 7 * 60) % 1440
  return clock >= 9 * 60 + 15 && clock <= 14 * 60 + 50
}

/** Reject cross-session/source rows; no generated or forward-filled intraday bars. */
export function buildBoardMetricReplay(
  rows: readonly PersistedBoardMetric[],
  day: string,
  now: Date = new Date(),
): MarketBoardMetricReplay {
  const previousDay = previousTradingSessionDateKey(day)
  const result: MarketBoardMetricReplay = {
    day, previousDay,
    liquidity: { today: [], previous: [] },
    foreign: { today: [], previous: [] },
  }
  if (!day || !Number.isFinite(now.getTime())) return result
  const seen = new Set<string>()
  for (const row of [...rows].sort((a, b) => a.minute_at.localeCompare(b.minute_at))) {
    if (!validRecordedMinute(row, day, previousDay, now.getTime())) continue
    const slot = row.session_date === day ? "today" : "previous"
    const key = [row.session_date, row.kind, row.source, row.minute_at].join(":")
    if (seen.has(key)) continue
    if (row.kind === "liquidity" && row.source === "index-quote"
      && nonNegative(row.traded_value)) {
      result.liquidity[slot].push({ minute: Date.parse(row.minute_at), value: row.traded_value })
      seen.add(key)
    } else if (row.kind === "foreign" && row.source === "top200-partial"
      && nonNegative(row.buy_value) && nonNegative(row.sell_value)
      && typeof row.covered_symbols === "number"
      && Number.isSafeInteger(row.covered_symbols)
      && row.covered_symbols >= 1 && row.covered_symbols <= 200) {
      result.foreign[slot].push({
        minute: Date.parse(row.minute_at), buy: row.buy_value, sell: row.sell_value,
      })
      seen.add(key)
    }
  }
  return result
}

/** Browser points are optional, never merged across sources or invented. */
export function preferObservedReplay<T>(serverPoints: readonly T[], localPoints: readonly T[]): T[] {
  if (serverPoints.length >= 2) return [...serverPoints]
  return localPoints.length ? [...localPoints] : [...serverPoints]
}
