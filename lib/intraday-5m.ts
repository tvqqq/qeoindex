export const FIVE_MINUTE_SECONDS = 300

export type FiveMinuteBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function fiveMinuteBucket(timestampSeconds: number) {
  return Math.floor(timestampSeconds / FIVE_MINUTE_SECONDS)
}

export function normalizeEpochSeconds(value: unknown, fallbackSeconds: number) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackSeconds
  return parsed > 10_000_000_000 ? parsed / 1000 : parsed
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

export function normalizeFiveMinuteBars(input: FiveMinuteBar[]): FiveMinuteBar[] {
  if (!input.length) return []
  const byBucket = new Map<number, FiveMinuteBar>()
  for (const bar of [...input].sort((a, b) => a.time - b.time)) {
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
  for (let time = times[0]; time <= times.at(-1)!; time += FIVE_MINUTE_SECONDS) {
    const observed = byBucket.get(time)
    if (observed) previous = observed
    else previous = { time, open: previous.close, high: previous.close, low: previous.close, close: previous.close, volume: 0 }
    result.push(previous)
  }
  return result
}
