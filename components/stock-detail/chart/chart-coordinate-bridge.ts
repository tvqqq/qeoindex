export interface ChartCoordinatePoint {
  time: number
  coordinate: number
}

interface TimelineIndex {
  times: number[]
}

const timelineIndexes = new WeakMap<ReadonlyArray<number>, TimelineIndex>()

function timelineIndex(timeline: ReadonlyArray<number>): TimelineIndex {
  const cached = timelineIndexes.get(timeline)
  if (cached) return cached

  const times = [...timeline]
    .filter((time): time is number => Number.isFinite(time))
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || all[index - 1] !== time)
  const result = { times }
  timelineIndexes.set(timeline, result)
  return result
}

function lowerBound(values: ReadonlyArray<number>, value: number): number {
  let left = 0
  let right = values.length
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2)
    if (values[middle] < value) left = middle + 1
    else right = middle
  }
  return left
}

function finitePoint(time: number, coordinateForTime: (time: number) => number | null): ChartCoordinatePoint | null {
  const coordinate = coordinateForTime(time)
  return typeof coordinate === "number" && Number.isFinite(coordinate)
    ? { time, coordinate }
    : null
}

function interpolate(left: ChartCoordinatePoint, right: ChartCoordinatePoint, value: number, valueKey: "time" | "coordinate", resultKey: "time" | "coordinate"): number {
  const leftValue = left[valueKey]
  const rightValue = right[valueKey]
  if (rightValue === leftValue) return left[resultKey]
  const ratio = (value - leftValue) / (rightValue - leftValue)
  return left[resultKey] + (right[resultKey] - left[resultKey]) * ratio
}

/**
 * Resolve a canonical timestamp to a screen coordinate. LWC remains the
 * authority for exact timestamps; interpolation only bridges a persisted
 * anchor that is absent from an aggregated timeframe (for example 09:17 on
 * a 1h chart). The timestamp is never rewritten.
 */
export function bridgeTimeToCoordinate(
  time: number,
  timeline: ReadonlyArray<number>,
  coordinateForTime: (time: number) => number | null,
): number | null {
  if (!Number.isFinite(time) || timeline.length === 0) return null
  const sortedTimes = timelineIndex(timeline).times
  if (sortedTimes.length === 0 || time < sortedTimes[0] || time > sortedTimes[sortedTimes.length - 1]) return null

  const exact = finitePoint(time, coordinateForTime)
  if (exact) return exact.coordinate

  const rightIndex = lowerBound(sortedTimes, time)
  let leftIndex = Math.min(sortedTimes.length - 1, Math.max(0, rightIndex - 1))
  let right = rightIndex < sortedTimes.length ? finitePoint(sortedTimes[rightIndex], coordinateForTime) : null
  let left = finitePoint(sortedTimes[leftIndex], coordinateForTime)

  // A time scale can return null for an off-screen timestamp. Walk only as far
  // as needed to find the nearest mapped point; the common path is two calls.
  while (!left && leftIndex > 0) {
    leftIndex -= 1
    left = finitePoint(sortedTimes[leftIndex], coordinateForTime)
  }
  let rightCursor = rightIndex + 1
  while (!right && rightCursor < sortedTimes.length) {
    right = finitePoint(sortedTimes[rightCursor], coordinateForTime)
    rightCursor += 1
  }
  if (!left || !right || left.time === right.time) return null
  return interpolate(left, right, time, "time", "coordinate")
}

/**
 * Invert an LWC coordinate without inventing an anchor outside the known
 * real-plus-future timeline. Native coordinateToTime should be preferred by
 * callers; this helper handles only the null/unsupported case.
 */
export function bridgeCoordinateToTime(
  coordinate: number,
  timeline: ReadonlyArray<number>,
  coordinateForTime: (time: number) => number | null,
): number | null {
  if (!Number.isFinite(coordinate) || timeline.length === 0) return null
  const sortedTimes = timelineIndex(timeline).times
  if (sortedTimes.length === 0) return null

  const first = finitePoint(sortedTimes[0], coordinateForTime)
  const last = finitePoint(sortedTimes[sortedTimes.length - 1], coordinateForTime)
  if (!first || !last || first.coordinate === last.coordinate) return null

  const ascending = last.coordinate > first.coordinate
  const lowCoordinate = ascending ? first.coordinate : last.coordinate
  const highCoordinate = ascending ? last.coordinate : first.coordinate
  if (coordinate < lowCoordinate || coordinate > highCoordinate) return null

  // timeToCoordinate is monotonic for a Lightweight Charts time scale. A
  // binary search keeps crosshair/drawing pointer work logarithmic in the
  // number of real+future timestamps instead of scanning the full timeline.
  let leftIndex = 0
  let rightIndex = sortedTimes.length - 1
  let left = first
  let right = last
  while (rightIndex - leftIndex > 1) {
    const middleIndex = leftIndex + Math.floor((rightIndex - leftIndex) / 2)
    const middle = finitePoint(sortedTimes[middleIndex], coordinateForTime)
    if (!middle) break
    const before = ascending ? middle.coordinate <= coordinate : middle.coordinate >= coordinate
    if (before) {
      leftIndex = middleIndex
      left = middle
    } else {
      rightIndex = middleIndex
      right = middle
    }
  }

  if (left.coordinate === right.coordinate) return null
  const result = interpolate(left, right, coordinate, "coordinate", "time")
  return Math.max(sortedTimes[0], Math.min(sortedTimes[sortedTimes.length - 1], result))
}

/** Keep native coordinateToTime results inside the chart's real+future horizon. */
export function boundChartTimeToTimeline(time: number, timeline: ReadonlyArray<number>): number | null {
  if (!Number.isFinite(time) || timeline.length === 0) return null
  const sortedTimes = timelineIndex(timeline).times
  if (sortedTimes.length === 0 || time < sortedTimes[0] || time > sortedTimes[sortedTimes.length - 1]) return null
  return time
}
