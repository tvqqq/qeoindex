export const FIVE_MINUTE_SECONDS = 300

export type FiveMinuteBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type IntradayPoint = {
  time: number
  close: number
}

export function selectLatestSession<T>(items: T[], preferredDate: string, dateOf: (item: T) => string) {
  const sessions = new Map<string, T[]>()
  for (const item of items) {
    const date = dateOf(item)
    const session = sessions.get(date) ?? []
    session.push(item)
    sessions.set(date, session)
  }
  const latestDate = [...sessions.keys()].filter((date) => date <= preferredDate).sort().at(-1)
  if (!latestDate) return null
  return { date: latestDate, items: sessions.get(latestDate) ?? [] }
}

export function fiveMinuteBucket(timestampSeconds: number) {
  return Math.floor(timestampSeconds / FIVE_MINUTE_SECONDS)
}

export function normalizeEpochSeconds(value: unknown, fallbackSeconds: number) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackSeconds
  return parsed > 10_000_000_000 ? parsed / 1000 : parsed
}

export function normalizeMarketPrice(value: unknown, anchor?: number | null) {
  const raw = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return null
  if (!anchor || !Number.isFinite(anchor) || anchor <= 0) return raw

  const candidates = [raw, raw * 1000, raw / 1000]
  const closest = candidates.reduce((best, candidate) => (
    Math.abs(candidate - anchor) < Math.abs(best - anchor) ? candidate : best
  ))
  return Math.abs(closest - anchor) / anchor <= 0.5 ? closest : null
}

export function mergeFiveMinuteClose(
  history: IntradayPoint[],
  close: number,
  timestampSeconds: number,
  limit = 90,
) {
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return history
  const time = fiveMinuteBucket(timestampSeconds) * FIVE_MINUTE_SECONDS
  const byTime = new Map(history
    .filter((point) => Number.isFinite(point.time) && point.time > 0 && Number.isFinite(point.close) && point.close > 0)
    .map((point) => [fiveMinuteBucket(point.time) * FIVE_MINUTE_SECONDS, point.close]))
  if (byTime.get(time) === close) return history
  byTime.set(time, close)
  return [...byTime]
    .sort(([a], [b]) => a - b)
    .slice(-limit)
    .map(([pointTime, pointClose]) => ({ time: pointTime, close: pointClose }))
}

export function intradaySnapshot(points: Array<{ open: number; close: number }>) {
  const reference = points.at(0)?.open ?? null
  const price = points.at(-1)?.close ?? null
  return {
    reference,
    price,
    change: price !== null && reference !== null ? price - reference : null,
    changePercent: price !== null && reference !== null ? ((price - reference) / reference) * 100 : null,
  }
}

export function normalizeFiveMinuteBars(input: FiveMinuteBar[], endTimeSeconds?: number): FiveMinuteBar[] {
  const validInput = input.filter((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0) && Number.isFinite(bar.volume) && bar.volume >= 0)
  if (!validInput.length) return []
  const byBucket = new Map<number, FiveMinuteBar>()
  for (const bar of [...validInput].sort((a, b) => a.time - b.time)) {
    const time = fiveMinuteBucket(bar.time) * FIVE_MINUTE_SECONDS
    const current = byBucket.get(time)
    byBucket.set(time, current ? {
      time,
      open: current.open,
      high: Math.max(current.high, bar.high),
      low: Math.min(current.low, bar.low),
      close: bar.close,
      volume: Math.max(current.volume, bar.volume),
    } : { ...bar, time })
  }

  const times = [...byBucket.keys()].sort((a, b) => a - b)
  const result: FiveMinuteBar[] = []
  let previous = byBucket.get(times[0])!
  const finalBucket = endTimeSeconds ? Math.max(times.at(-1)!, fiveMinuteBucket(endTimeSeconds) * FIVE_MINUTE_SECONDS) : times.at(-1)!
  for (let time = times[0]; time <= finalBucket; time += FIVE_MINUTE_SECONDS) {
    const observed = byBucket.get(time)
    if (observed) previous = observed
    else previous = { time, open: previous.close, high: previous.close, low: previous.close, close: previous.close, volume: 0 }
    result.push(previous)
  }
  return result
}
