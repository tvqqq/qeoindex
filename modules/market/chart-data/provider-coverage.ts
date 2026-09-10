import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../calendar.ts"

export interface ProviderCoverageRange {
  from: number
  to: number
}

function normalizeRange(range: ProviderCoverageRange, request: ProviderCoverageRange) {
  const from = Math.max(request.from, Math.floor(range.from))
  const to = Math.min(request.to, Math.floor(range.to))
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? { from, to } : null
}

export function mergeProviderRanges(ranges: ProviderCoverageRange[]): ProviderCoverageRange[] {
  const normalized = ranges
    .filter((range) => Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from)
    .map((range) => ({ from: Math.floor(range.from), to: Math.floor(range.to) }))
    .sort((a, b) => a.from - b.from || a.to - b.to)

  const merged: ProviderCoverageRange[] = []
  for (const range of normalized) {
    const previous = merged.at(-1)
    if (!previous || range.from > previous.to) {
      merged.push({ ...range })
      continue
    }
    previous.to = Math.max(previous.to, range.to)
  }
  return merged
}

/**
 * Returns the parts of a canonical request that have never been covered by a
 * successful provider request. Boundaries intentionally overlap so the
 * subsequent merge can safely dedupe the seam candle.
 */
export function missingProviderRanges(
  request: ProviderCoverageRange,
  coveredRanges: ProviderCoverageRange[],
): ProviderCoverageRange[] {
  if (!Number.isFinite(request.from) || !Number.isFinite(request.to) || request.to <= request.from) return []

  const normalizedRequest = { from: Math.floor(request.from), to: Math.floor(request.to) }
  const covered = mergeProviderRanges(
    coveredRanges
      .map((range) => normalizeRange(range, normalizedRequest))
      .filter((range): range is ProviderCoverageRange => Boolean(range)),
  )

  const missing: ProviderCoverageRange[] = []
  let cursor = normalizedRequest.from

  for (const range of covered) {
    if (range.to < cursor) continue
    if (range.from > cursor) missing.push({ from: cursor, to: range.from })
    cursor = Math.max(cursor, range.to)
    if (cursor >= normalizedRequest.to) break
  }

  if (cursor < normalizedRequest.to) missing.push({ from: cursor, to: normalizedRequest.to })
  return missing.filter((range) => range.to > range.from)
}

function addVietnamCalendarDay(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + 1)
  return vietnamDateKey(date)
}

function sessionRange(dateKey: string, start: string, end: string): ProviderCoverageRange {
  return {
    from: Math.floor(Date.parse(`${dateKey}T${start}+07:00`) / 1000),
    to: Math.floor(Date.parse(`${dateKey}T${end}+07:00`) / 1000),
  }
}

function tradingSessionRanges(request: ProviderCoverageRange): ProviderCoverageRange[] {
  if (!Number.isFinite(request.from) || !Number.isFinite(request.to) || request.to <= request.from) return []

  const normalizedRequest = { from: Math.floor(request.from), to: Math.floor(request.to) }
  const lastDateKey = vietnamDateKey(normalizedRequest.to * 1000)
  let dateKey = vietnamDateKey(normalizedRequest.from * 1000)
  const ranges: ProviderCoverageRange[] = []

  for (let guard = 0; dateKey <= lastDateKey && guard < 3700; guard += 1) {
    if (isVietnamSecuritiesTradingDateKey(dateKey)) {
      for (const range of [
        sessionRange(dateKey, "09:00:00", "11:30:00"),
        sessionRange(dateKey, "13:00:00", "14:46:00"),
      ]) {
        const clipped = normalizeRange(range, normalizedRequest)
        if (clipped && clipped.to > clipped.from) ranges.push(clipped)
      }
    }
    dateKey = addVietnamCalendarDay(dateKey)
  }

  return ranges
}

/**
 * Provider recovery is only meaningful inside actual Vietnam securities
 * trading windows. Successful coverage can legitimately stop at session close;
 * overnight, lunch, weekends and after-close must never become blocking fetches.
 */
export function missingTradingProviderRanges(
  request: ProviderCoverageRange,
  coveredRanges: ProviderCoverageRange[],
): ProviderCoverageRange[] {
  return mergeProviderRanges(
    tradingSessionRanges(request).flatMap((range) => missingProviderRanges(range, coveredRanges)),
  )
}

/**
 * Filters detected storage gaps through successful provider-request coverage.
 * A sparse 1m interval already covered by a successful provider request is a
 * known no-trade/sparse interval, not evidence that another blocking refill is
 * required. Uncovered portions remain eligible for bounded provider repair.
 */
export function uncoveredProviderRanges(
  ranges: ProviderCoverageRange[],
  coveredRanges: ProviderCoverageRange[],
): ProviderCoverageRange[] {
  return mergeProviderRanges(
    ranges.flatMap((range) => missingProviderRanges(range, coveredRanges)),
  )
}
