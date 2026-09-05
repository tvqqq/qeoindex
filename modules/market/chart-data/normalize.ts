import type {
  CanonicalBarSource,
  CanonicalChartResolution,
  CanonicalOhlcvBar,
  ChartDataGap,
  ChartDataIntegrityIssue,
  SourceTaggedBar,
} from "./contract"

const SOURCE_PRECEDENCE: Record<CanonicalBarSource, number> = {
  provider: 1,
  cold: 2,
  daily: 3,
  hot: 4,
}

function validBar(bar: CanonicalOhlcvBar) {
  if (!Number.isInteger(bar.time) || bar.time <= 0) return false
  if (![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) return false
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0 || bar.volume < 0) return false
  if (bar.high < Math.max(bar.open, bar.close, bar.low)) return false
  if (bar.low > Math.min(bar.open, bar.close, bar.high)) return false
  return true
}

function barsEqual(a: CanonicalOhlcvBar, b: CanonicalOhlcvBar) {
  return a.open === b.open
    && a.high === b.high
    && a.low === b.low
    && a.close === b.close
    && a.volume === b.volume
}

export function normalizeCanonicalBars(inputs: SourceTaggedBar[]) {
  const byTime = new Map<number, SourceTaggedBar>()
  const issueByKey = new Map<string, ChartDataIntegrityIssue>()

  for (const input of inputs) {
    if (!validBar(input.bar)) {
      const time = Number.isFinite(input.bar.time) ? input.bar.time : null
      issueByKey.set(`invalid:${input.source}:${String(time)}`, {
        kind: "INVALID_BAR",
        time,
        source: input.source,
      })
      continue
    }

    const existing = byTime.get(input.bar.time)
    if (!existing) {
      byTime.set(input.bar.time, input)
      continue
    }

    if (!barsEqual(existing.bar, input.bar)) {
      const sources = [...new Set([existing.source, input.source])].sort()
      issueByKey.set(`mismatch:${input.bar.time}`, {
        kind: "SOURCE_MISMATCH",
        time: input.bar.time,
        sources,
      })
    }

    if (SOURCE_PRECEDENCE[input.source] > SOURCE_PRECEDENCE[existing.source]) {
      byTime.set(input.bar.time, input)
    }
  }

  return {
    bars: [...byTime.values()].map((item) => item.bar).sort((a, b) => a.time - b.time),
    integrityIssues: [...issueByKey.values()],
  }
}

export function detectSequenceGaps(
  bars: CanonicalOhlcvBar[],
  resolution: CanonicalChartResolution,
): ChartDataGap[] {
  if (resolution !== "1m" || bars.length < 2) return []
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  const gaps: ChartDataGap[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    const delta = current.time - previous.time
    if (delta <= 60) continue
    const missingBars = Math.max(0, Math.floor(delta / 60) - 1)
    if (missingBars > 0) gaps.push({ fromTime: previous.time, toTime: current.time, missingBars })
  }
  return gaps
}

const VIETNAM_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function tradingSegment(time: number) {
  const parts = VIETNAM_PARTS.formatToParts(new Date(time * 1000))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  const date = `${value("year")}-${value("month")}-${value("day")}`
  const minutes = Number(value("hour")) * 60 + Number(value("minute"))
  const segment = minutes >= 9 * 60 && minutes <= 11 * 60 + 30
    ? "AM"
    : minutes >= 13 * 60 && minutes <= 14 * 60 + 45
      ? "PM"
      : null
  return { date, segment }
}

/**
 * Gap evidence for production 1m coverage. Expected overnight and lunch breaks
 * are ignored; QEO-93 owns the richer exchange-calendar/timeframe engine.
 */
export function detectTradingSessionGaps(bars: CanonicalOhlcvBar[]): ChartDataGap[] {
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  const gaps: ChartDataGap[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    const previousSegment = tradingSegment(previous.time)
    const currentSegment = tradingSegment(current.time)
    if (!previousSegment.segment || previousSegment.date !== currentSegment.date || previousSegment.segment !== currentSegment.segment) {
      continue
    }
    const delta = current.time - previous.time
    const missingBars = Math.max(0, Math.floor(delta / 60) - 1)
    if (missingBars > 0) gaps.push({ fromTime: previous.time, toTime: current.time, missingBars })
  }
  return gaps
}
