export type ValuationMetric = "PE" | "PB"
export type ValuationRangeYears = 0 | 1 | 3 | 5
export type ValuationInterpretation = "below_average" | "around_average" | "above_average" | "unknown"

export interface ValuationHistoryObservation {
  tradingDate: string
  pe: number | null
  pb: number | null
}

export interface ValuationSnapshotResult {
  metric: ValuationMetric
  current: number | null
  mean: number | null
  median: number | null
  percentile: number | null
  standardDeviation: number | null
  zScore: number | null
  sampleSize: number
  windowStartDate: string | null
  windowEndDate: string | null
  interpretation: ValuationInterpretation
}

const MIN_STATISTICAL_SAMPLE = 20

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return { year, month, day }
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function subtractCalendarYears(value: string, years: ValuationRangeYears): string | null {
  const parsed = parseIsoDate(value)
  if (!parsed) return null
  const targetYear = parsed.year - years
  const daysInTargetMonth = new Date(Date.UTC(targetYear, parsed.month, 0)).getUTCDate()
  return formatIsoDate(targetYear, parsed.month, Math.min(parsed.day, daysInTargetMonth))
}

function finiteMetricValue(point: ValuationHistoryObservation, metric: ValuationMetric): number | null {
  const value = metric === "PE" ? point.pe : point.pb
  return value != null && Number.isFinite(value) ? value : null
}

export function filterValuationHistoryByRange<T extends { tradingDate: string }>(
  history: T[],
  rangeYears: ValuationRangeYears,
): T[] {
  const ordered = history
    .filter((item) => parseIsoDate(item.tradingDate) != null)
    .slice()
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate))

  const latestDate = ordered.at(-1)?.tradingDate ?? null
  if (!latestDate || rangeYears === 0) return ordered

  const cutoff = subtractCalendarYears(latestDate, rangeYears)
  if (!cutoff) return ordered
  return ordered.filter((item) => item.tradingDate >= cutoff && item.tradingDate <= latestDate)
}

export function interpretValuationZScore(value: number | null | undefined): ValuationInterpretation {
  if (value == null || !Number.isFinite(value)) return "unknown"
  if (value <= -1) return "below_average"
  if (value >= 1) return "above_average"
  return "around_average"
}

export function buildValuationSnapshot(input: {
  metric: ValuationMetric
  history: ValuationHistoryObservation[]
  rangeYears: ValuationRangeYears
}): ValuationSnapshotResult {
  const datedHistory = input.history
    .filter((item) => parseIsoDate(item.tradingDate) != null)
    .slice()
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate))
  const windowEndDate = datedHistory.at(-1)?.tradingDate ?? null
  const windowStartDate = windowEndDate == null
    ? null
    : input.rangeYears === 0
      ? datedHistory[0]?.tradingDate ?? null
      : subtractCalendarYears(windowEndDate, input.rangeYears)
  const visibleHistory = filterValuationHistoryByRange(datedHistory, input.rangeYears)
  const values = visibleHistory.flatMap((item) => {
    const value = finiteMetricValue(item, input.metric)
    return value == null ? [] : [value]
  })
  const sampleSize = values.length
  const current = visibleHistory.reduce<number | null>((latest, item) => {
    const value = finiteMetricValue(item, input.metric)
    return value == null ? latest : value
  }, null)

  if (sampleSize === 0 || current == null) {
    return {
      metric: input.metric,
      current: null,
      mean: null,
      median: null,
      percentile: null,
      standardDeviation: null,
      zScore: null,
      sampleSize: 0,
      windowStartDate,
      windowEndDate,
      interpretation: "unknown",
    }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / sampleSize
  const sorted = values.slice().sort((a, b) => a - b)
  const midpoint = Math.floor(sampleSize / 2)
  const median = sampleSize % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint]
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sampleSize
  const standardDeviation = Math.sqrt(variance)

  const percentile = sampleSize >= MIN_STATISTICAL_SAMPLE
    ? ((values.filter((value) => value < current).length + 0.5 * values.filter((value) => value === current).length) / sampleSize) * 100
    : null
  const zScore = sampleSize >= MIN_STATISTICAL_SAMPLE && standardDeviation > 0
    ? (current - mean) / standardDeviation
    : null

  return {
    metric: input.metric,
    current,
    mean,
    median,
    percentile,
    standardDeviation,
    zScore,
    sampleSize,
    windowStartDate,
    windowEndDate,
    interpretation: interpretValuationZScore(zScore),
  }
}
