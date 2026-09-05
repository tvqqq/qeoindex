import type {
  CanonicalChartResolution,
  CanonicalOhlcvBar,
  ChartResolution,
} from "./contract"

const VN_OFFSET_SECONDS = 7 * 60 * 60
const DAY_SECONDS = 86400
const MINUTE_SECONDS = 60
const THREE_DAY_ANCHOR_SECONDS = Math.floor(Date.UTC(2000, 0, 1, 0, 0, 0) / 1000) - VN_OFFSET_SECONDS

const INTRADAY_BUCKET_MINUTES: Partial<Record<ChartResolution, number>> = {
  "1m": 1,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
}

interface LocalParts {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
}

function localDate(time: number) {
  return new Date((time + VN_OFFSET_SECONDS) * 1000)
}

function localParts(time: number): LocalParts {
  const date = localDate(time)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  }
}

function localEpoch(year: number, month: number, day: number, hour = 0, minute = 0) {
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute, 0) / 1000) - VN_OFFSET_SECONDS
}

function canonicalSourceStart(time: number) {
  return Math.max(1, time)
}

function dateKey(parts: Pick<LocalParts, "year" | "month" | "day">) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
}

function intradayBucket(time: number, resolution: ChartResolution) {
  const bucketMinutes = INTRADAY_BUCKET_MINUTES[resolution]
  if (!bucketMinutes) return null

  const parts = localParts(time)
  const minutes = parts.hour * 60 + parts.minute
  let segmentStartMinutes: number | null = null

  if (minutes >= 9 * 60 && minutes < 11 * 60 + 30) {
    segmentStartMinutes = 9 * 60
  } else if (minutes >= 13 * 60 && minutes < 15 * 60) {
    segmentStartMinutes = 13 * 60
  }

  if (segmentStartMinutes == null) return null

  const offsetMinutes = minutes - segmentStartMinutes
  const bucketOffset = Math.floor(offsetMinutes / bucketMinutes) * bucketMinutes
  const bucketStartMinutes = segmentStartMinutes + bucketOffset
  const bucketHour = Math.floor(bucketStartMinutes / 60)
  const bucketMinute = bucketStartMinutes % 60
  const bucketStart = localEpoch(parts.year, parts.month, parts.day, bucketHour, bucketMinute)

  return {
    key: `${dateKey(parts)}:${segmentStartMinutes}:${bucketOffset}:${bucketMinutes}`,
    time: bucketStart,
  }
}

function mondayStart(time: number) {
  const parts = localParts(time)
  const daysSinceMonday = (parts.weekday + 6) % 7
  return localEpoch(parts.year, parts.month, parts.day - daysSinceMonday)
}

function calendarBucket(time: number, resolution: ChartResolution) {
  const parts = localParts(time)
  switch (resolution) {
    case "1W": {
      const monday = mondayStart(time)
      return { key: `W:${monday}`, time: monday }
    }
    case "1M":
      return { key: `M:${parts.year}-${parts.month}`, time: localEpoch(parts.year, parts.month, 1) }
    case "1Q": {
      const quarterStartMonth = Math.floor((parts.month - 1) / 3) * 3 + 1
      return { key: `Q:${parts.year}-${quarterStartMonth}`, time: localEpoch(parts.year, quarterStartMonth, 1) }
    }
    case "1Y":
      return { key: `Y:${parts.year}`, time: localEpoch(parts.year, 1, 1) }
    default:
      return null
  }
}

function reduceBars(bars: CanonicalOhlcvBar[], time: number): CanonicalOhlcvBar {
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  return {
    time,
    open: sorted[0].open,
    high: Math.max(...sorted.map((bar) => bar.high)),
    low: Math.min(...sorted.map((bar) => bar.low)),
    close: sorted.at(-1)!.close,
    volume: sorted.reduce((sum, bar) => sum + bar.volume, 0),
  }
}

function aggregateByBucket(
  bars: CanonicalOhlcvBar[],
  bucketFor: (time: number) => { key: string; time: number } | null,
  useFirstSourceTime: boolean,
) {
  const groups = new Map<string, { nominalTime: number; bars: CanonicalOhlcvBar[] }>()
  for (const bar of [...bars].sort((a, b) => a.time - b.time)) {
    const bucket = bucketFor(bar.time)
    if (!bucket) continue
    const existing = groups.get(bucket.key)
    if (existing) {
      existing.bars.push(bar)
    } else {
      groups.set(bucket.key, { nominalTime: bucket.time, bars: [bar] })
    }
  }

  return [...groups.values()]
    .map((group) => reduceBars(group.bars, useFirstSourceTime ? group.bars[0].time : group.nominalTime))
    .sort((a, b) => a.time - b.time)
}

function aggregateThreeSessions(bars: CanonicalOhlcvBar[]) {
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  const result: CanonicalOhlcvBar[] = []
  for (let index = 0; index < sorted.length; index += 3) {
    const chunk = sorted.slice(index, index + 3)
    if (chunk.length) result.push(reduceBars(chunk, chunk[0].time))
  }
  return result
}

export function canonicalSourceResolution(resolution: ChartResolution): CanonicalChartResolution {
  return INTRADAY_BUCKET_MINUTES[resolution] ? "1m" : "1D"
}

export function aggregateChartTimeframe(
  bars: CanonicalOhlcvBar[],
  resolution: ChartResolution,
): CanonicalOhlcvBar[] {
  if (!bars.length) return []
  if (resolution === "1m" || resolution === "1D") return [...bars].sort((a, b) => a.time - b.time)
  if (resolution === "3D") return aggregateThreeSessions(bars)
  if (INTRADAY_BUCKET_MINUTES[resolution]) {
    return aggregateByBucket(bars, (time) => intradayBucket(time, resolution), false)
  }
  return aggregateByBucket(bars, (time) => calendarBucket(time, resolution), true)
}

export function sourceRangeForResolution(
  resolution: ChartResolution,
  from: number,
  to: number,
): { from: number; to: number } {
  if (resolution === "3D") return { from: THREE_DAY_ANCHOR_SECONDS, to }
  if (resolution === "1W") return { from: canonicalSourceStart(mondayStart(from)), to }

  const parts = localParts(from)
  if (resolution === "1M") return { from: canonicalSourceStart(localEpoch(parts.year, parts.month, 1)), to }
  if (resolution === "1Q") {
    const quarterStartMonth = Math.floor((parts.month - 1) / 3) * 3 + 1
    return { from: canonicalSourceStart(localEpoch(parts.year, quarterStartMonth, 1)), to }
  }
  if (resolution === "1Y") return { from: canonicalSourceStart(localEpoch(parts.year, 1, 1)), to }

  if (INTRADAY_BUCKET_MINUTES[resolution] && resolution !== "1m") {
    const bucket = intradayBucket(from, resolution)
    return { from: bucket?.time ?? from, to }
  }
  return { from, to }
}

export function splitCanonicalSourceRange(
  resolution: CanonicalChartResolution,
  from: number,
  to: number,
) {
  const maxSpan = resolution === "1m" ? 31 * DAY_SECONDS : 10 * 366 * DAY_SECONDS
  const ranges: Array<{ from: number; to: number }> = []
  let cursor = from
  while (cursor <= to) {
    const chunkTo = Math.min(to, cursor + maxSpan)
    ranges.push({ from: cursor, to: chunkTo })
    if (chunkTo >= to) break
    cursor = chunkTo + 1
  }
  return ranges
}

export function timeframeDurationSeconds(resolution: ChartResolution) {
  const minutes = INTRADAY_BUCKET_MINUTES[resolution]
  if (minutes) return minutes * MINUTE_SECONDS
  if (resolution === "1D") return DAY_SECONDS
  if (resolution === "3D") return 3 * DAY_SECONDS
  if (resolution === "1W") return 7 * DAY_SECONDS
  if (resolution === "1M") return 31 * DAY_SECONDS
  if (resolution === "1Q") return 93 * DAY_SECONDS
  return 366 * DAY_SECONDS
}