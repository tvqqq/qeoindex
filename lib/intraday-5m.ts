export const FIVE_MINUTE_SECONDS = 300

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
