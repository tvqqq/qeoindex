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
