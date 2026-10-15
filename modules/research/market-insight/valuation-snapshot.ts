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


export type ValuationOverlayMetricMode = "all_signed" | "positive_subset" | "unavailable"

export interface ValuationOverlayMarketObservation {
  tradingDate: string
  price: number | null
  pe: number | null
  pb: number | null
  pe1StdUp: number | null
  pe1StdDown: number | null
  pe2StdUp: number | null
  pe2StdDown: number | null
  pb1StdUp: number | null
  pb1StdDown: number | null
  pb2StdUp: number | null
  pb2StdDown: number | null
}

export interface ValuationOverlayQeoObservation {
  tradingDate: string
  status: "available" | "unavailable"
  unavailableReason: string | null
  estimatedVnindexValue: number | null
  pe: number | null
  peMode: ValuationOverlayMetricMode
  peMemberCount: number
  peTotalMemberCount: number
  peMarketCapCoveragePct: number | null
  pb: number | null
  pbMode: ValuationOverlayMetricMode
  pbMemberCount: number
  pbTotalMemberCount: number
  pbMarketCapCoveragePct: number | null
  sourceHoseCount: number
  retainedMemberCount: number
  providerBreadthCount: number | null
  sourceObservedTo: string | null
  baseSessionDate: string | null
  baseVnindexValue: number | null
}

export type MergedValuationHistoryPoint = Omit<ValuationOverlayMarketObservation, "price"> & {
  vnindex: number | null
  qeoEstimatedVnindexValue: number | null
  qeoPe: number | null
  qeoPeMode: ValuationOverlayMetricMode | null
  qeoPeMemberCount: number | null
  qeoPeTotalMemberCount: number | null
  qeoPeMarketCapCoveragePct: number | null
  qeoPb: number | null
  qeoPbMode: ValuationOverlayMetricMode | null
  qeoPbMemberCount: number | null
  qeoPbTotalMemberCount: number | null
  qeoPbMarketCapCoveragePct: number | null
  qeoStatus: "available" | "unavailable" | null
  qeoUnavailableReason: string | null
  qeoSourceHoseCount: number | null
  qeoRetainedMemberCount: number | null
  qeoProviderBreadthCount: number | null
  qeoSourceObservedTo: string | null
  qeoBaseSessionDate: string | null
  qeoBaseVnindexValue: number | null
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

export function mergeValuationHistories(
  originalHistory: ValuationOverlayMarketObservation[],
  qeoHistory: ValuationOverlayQeoObservation[],
): MergedValuationHistoryPoint[] {
  const byDate = new Map<string, {
    original?: ValuationOverlayMarketObservation
    qeo?: ValuationOverlayQeoObservation
  }>()

  for (const item of originalHistory) {
    if (!parseIsoDate(item.tradingDate)) continue
    const entry = byDate.get(item.tradingDate) || {}
    entry.original = item
    byDate.set(item.tradingDate, entry)
  }
  for (const item of qeoHistory) {
    if (!parseIsoDate(item.tradingDate)) continue
    const entry = byDate.get(item.tradingDate) || {}
    entry.qeo = item
    byDate.set(item.tradingDate, entry)
  }

  return Array.from(byDate.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([tradingDate, { original, qeo }]) => ({
      tradingDate,
      vnindex: finiteOrNull(original?.price),
      pe: finiteOrNull(original?.pe),
      pb: finiteOrNull(original?.pb),
      pe1StdUp: finiteOrNull(original?.pe1StdUp),
      pe1StdDown: finiteOrNull(original?.pe1StdDown),
      pe2StdUp: finiteOrNull(original?.pe2StdUp),
      pe2StdDown: finiteOrNull(original?.pe2StdDown),
      pb1StdUp: finiteOrNull(original?.pb1StdUp),
      pb1StdDown: finiteOrNull(original?.pb1StdDown),
      pb2StdUp: finiteOrNull(original?.pb2StdUp),
      pb2StdDown: finiteOrNull(original?.pb2StdDown),
      qeoEstimatedVnindexValue: finiteOrNull(qeo?.estimatedVnindexValue),
      qeoPe: finiteOrNull(qeo?.pe),
      qeoPeMode: qeo?.peMode ?? null,
      qeoPeMemberCount: qeo == null ? null : finiteOrNull(qeo.peMemberCount),
      qeoPeTotalMemberCount: qeo == null ? null : finiteOrNull(qeo.peTotalMemberCount),
      qeoPeMarketCapCoveragePct: finiteOrNull(qeo?.peMarketCapCoveragePct),
      qeoPb: finiteOrNull(qeo?.pb),
      qeoPbMode: qeo?.pbMode ?? null,
      qeoPbMemberCount: qeo == null ? null : finiteOrNull(qeo.pbMemberCount),
      qeoPbTotalMemberCount: qeo == null ? null : finiteOrNull(qeo.pbTotalMemberCount),
      qeoPbMarketCapCoveragePct: finiteOrNull(qeo?.pbMarketCapCoveragePct),
      qeoStatus: qeo?.status ?? null,
      qeoUnavailableReason: qeo?.unavailableReason ?? null,
      qeoSourceHoseCount: qeo == null ? null : finiteOrNull(qeo.sourceHoseCount),
      qeoRetainedMemberCount: qeo == null ? null : finiteOrNull(qeo.retainedMemberCount),
      qeoProviderBreadthCount: finiteOrNull(qeo?.providerBreadthCount),
      qeoSourceObservedTo: qeo?.sourceObservedTo ?? null,
      qeoBaseSessionDate: qeo?.baseSessionDate ?? null,
      qeoBaseVnindexValue: finiteOrNull(qeo?.baseVnindexValue),
    }))
}


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
  anchorDate?: string,
): T[] {
  const ordered = history
    .filter((item) => parseIsoDate(item.tradingDate) != null)
    .slice()
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate))

  const latestDate = anchorDate && parseIsoDate(anchorDate)
    ? anchorDate
    : ordered.at(-1)?.tradingDate ?? null
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
