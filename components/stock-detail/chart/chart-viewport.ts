export interface ChartTimeRange {
  from: number
  to: number
}

export interface ChartTimePoint {
  time: number
}

/**
 * Build an automatic/reset range from canonical timestamps rather than LWC's
 * logical indexes. A reused chart instance may retain a logical-index base
 * after a timeframe switch, while timestamps remain authoritative.
 */
export function chartTimeRangeForBars(
  bars: ReadonlyArray<ChartTimePoint>,
  futureTimes: ReadonlyArray<number>,
  visibleBars: number,
  rightOffset: number,
): ChartTimeRange | null {
  const first = bars[0]
  const latest = bars.at(-1)
  if (!first || !latest || !Number.isFinite(first.time) || !Number.isFinite(latest.time)) return null

  const count = Math.max(1, Math.floor(visibleBars))
  const startIndex = Math.max(0, bars.length - count)
  const from = bars[startIndex]?.time ?? first.time
  const futureIndex = Math.max(0, Math.min(futureTimes.length - 1, Math.floor(rightOffset) - 1))
  const to = futureTimes[futureIndex] ?? latest.time
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return { from, to: Math.max(from, to) }
}

export function shiftVisibleLogicalRange(
  range: ChartTimeRange,
  prependedBars: number,
): ChartTimeRange {
  const shift = Math.max(0, Math.floor(prependedBars))
  return {
    from: range.from + shift,
    to: range.to + shift,
  }
}
