export const QEO_EX_VIC_VHM_CALCULATION_VERSION = "qeo-ex-vic-vhm-v1"
export const QEO_EX_VIC_VHM_EXCLUDED_TICKERS = ["VIC", "VHM"] as const

export type QeoValuationMetricMode = "all_signed" | "positive_subset" | "unavailable"

export interface QeoCandidateRow {
  asOfDate: string
  ticker: string
  exchange: string | null
  marketCapBillion: number | null
  price: number | null
  priceChangePct: number | null
  pe: number | null
  pb: number | null
  syncRunId: string
  fetchedAt: string
}

export interface QeoRatingRun {
  id: string
  asOfDate: string
  status: string
  providerRowCount: number
  contractVersion: number
  completedAt: string | null
}

export interface QeoPreviousEstimate {
  sessionDate: string
  status: "available" | "unavailable"
  estimatedVnindexValue: number | null
  baseSessionDate: string | null
  baseVnindexValue: number | null
  sourceHoseCount: number
}

export interface QeoEstimateMember {
  ticker: string
  includedInEstimate: boolean
  exclusionReason: string | null
  marketCapBillion: number | null
  price: number | null
  priceChangePct: number | null
  referenceMarketCapBillion: number | null
  pe: number | null
  pb: number | null
  syncRunId: string
  fetchedAt: string
}

export interface QeoMetricEstimate {
  value: number | null
  mode: QeoValuationMetricMode
  memberCount: number
  totalMemberCount: number
  marketCapCoveragePct: number | null
}

export interface QeoExVnindexEstimate {
  sessionDate: string
  asOf: string | null
  calculationVersion: string
  status: "available" | "unavailable"
  unavailableReason: string | null
  sourceMarketSyncRunId: string | null
  sourceRatingSyncRunId: string | null
  sourceContractVersion: number | null
  sourceCandidateCount: number
  sourceHoseCount: number
  retainedMemberCount: number
  calculationInputHash: string | null
  retainedMemberHash: string | null
  sourceHoseHash: string | null
  sourceObservedFrom: string | null
  sourceObservedTo: string | null
  providerBreadthCount: number | null
  providerBreadthDifference: number | null
  baseSessionDate: string | null
  baseVnindexValue: number | null
  previousMarketSessionDate: string | null
  previousEstimateSessionDate: string | null
  previousEstimatedVnindexValue: number | null
  estimatedVnindexValue: number | null
  marketCapBillion: number | null
  referenceMarketCapBillion: number | null
  pe: QeoMetricEstimate
  pb: QeoMetricEstimate
  members: QeoEstimateMember[]
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

function afterMarketClose(value: string | null | undefined, sessionDate: string): boolean {
  if (!value) return false
  const observedDate = new Date(value)
  const observedAt = observedDate.getTime()
  const cutoff = new Date(`${sessionDate}T15:00:00+07:00`).getTime()
  const observedSessionDate = Number.isFinite(observedAt)
    ? new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(observedDate)
    : ""
  return observedSessionDate === sessionDate && Number.isFinite(cutoff) && observedAt >= cutoff
}

function roundedPct(value: number): number {
  return Math.round(value * 100) / 100
}

function metricEstimate(
  rows: QeoCandidateRow[],
  valueFor: (row: QeoCandidateRow) => number | null,
  totalCap: number,
): QeoMetricEstimate {
  // Keep one consistent cohort definition over time. Negative/zero/missing
  // multiples are excluded from every daily point and exposed in coverage.
  const positiveRows = rows.filter((row) => {
    const value = valueFor(row)
    return finite(value) && value > 0
  })
  if (positiveRows.length === 0) return emptyMetric(rows.length)
  const positiveCap = positiveRows.reduce((sum, row) => sum + row.marketCapBillion!, 0)
  const denominator = positiveRows.reduce((sum, row) => sum + row.marketCapBillion! / valueFor(row)!, 0)
  const value = denominator > 0 && Number.isFinite(denominator) ? positiveCap / denominator : null
  if (value == null || !Number.isFinite(value)) return emptyMetric(rows.length)
  return {
    value,
    mode: "positive_subset",
    memberCount: positiveRows.length,
    totalMemberCount: rows.length,
    marketCapCoveragePct: totalCap > 0 ? roundedPct((positiveCap / totalCap) * 100) : null,
  }
}

function emptyMetric(totalMemberCount = 0): QeoMetricEstimate {
  return { value: null, mode: "unavailable", memberCount: 0, totalMemberCount, marketCapCoveragePct: null }
}

function buildObservedMembers(rows: QeoCandidateRow[]): QeoEstimateMember[] {
  const byTicker = new Map<string, QeoCandidateRow>()
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase()
    if (row.exchange?.trim().toUpperCase() === "HOSE" && /^[A-Z0-9]{3}$/.test(ticker) && !byTicker.has(ticker)) {
      byTicker.set(ticker, row)
    }
  }
  return [...byTicker.values()]
    .map((row) => {
      const ticker = row.ticker.trim().toUpperCase()
      const includedInEstimate = !QEO_EX_VIC_VHM_EXCLUDED_TICKERS.includes(ticker as (typeof QEO_EX_VIC_VHM_EXCLUDED_TICKERS)[number])
      const changeRatio = finite(row.priceChangePct) ? 1 + row.priceChangePct / 100 : Number.NaN
      const referenceMarketCapBillion = includedInEstimate
        && finite(row.marketCapBillion)
        && row.marketCapBillion > 0
        && Number.isFinite(changeRatio)
        && changeRatio > 0
        ? row.marketCapBillion / changeRatio
        : null
      return {
        ticker,
        includedInEstimate,
        exclusionReason: includedInEstimate ? null : "excluded_vic_vhm",
        marketCapBillion: row.marketCapBillion,
        price: row.price,
        priceChangePct: row.priceChangePct,
        referenceMarketCapBillion,
        pe: row.pe,
        pb: row.pb,
        syncRunId: row.syncRunId,
        fetchedAt: row.fetchedAt,
      }
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
}

function unavailable(
  input: {
    sessionDate: string
    sourceRatingSyncRunId?: string | null
    sourceMarketSyncRunId?: string | null
    sourceContractVersion?: number | null
    candidateCount?: number
    hoseRows?: QeoCandidateRow[]
    providerBreadthCount?: number | null
    previousEstimate?: QeoPreviousEstimate | null
    previousMarketSessionDate?: string | null
  },
  reason: string,
  asOf?: string | null,
): QeoExVnindexEstimate {
  const members = buildObservedMembers(input.hoseRows || [])
  const included = members.filter((member) => member.includedInEstimate)
  const timestamps = members.map((member) => member.fetchedAt).filter(Boolean).sort()
  const sourceHoseCount = input.hoseRows?.length ?? 0
  const baseDate = input.previousEstimate?.baseSessionDate || null
  const baseValue = input.previousEstimate?.baseVnindexValue ?? null
  const breadth = finite(input.providerBreadthCount) ? input.providerBreadthCount : null
  return {
    sessionDate: input.sessionDate,
    asOf: asOf || null,
    calculationVersion: QEO_EX_VIC_VHM_CALCULATION_VERSION,
    status: "unavailable",
    unavailableReason: reason,
    sourceMarketSyncRunId: input.sourceMarketSyncRunId || null,
    sourceRatingSyncRunId: input.sourceRatingSyncRunId || null,
    sourceContractVersion: input.sourceContractVersion ?? null,
    sourceCandidateCount: input.candidateCount ?? 0,
    sourceHoseCount,
    retainedMemberCount: included.length,
    calculationInputHash: null,
    retainedMemberHash: null,
    sourceHoseHash: null,
    sourceObservedFrom: timestamps[0] || null,
    sourceObservedTo: timestamps.at(-1) || null,
    providerBreadthCount: breadth,
    providerBreadthDifference: breadth == null ? null : breadth - sourceHoseCount,
    baseSessionDate: baseDate,
    baseVnindexValue: baseValue,
    previousMarketSessionDate: input.previousMarketSessionDate || null,
    previousEstimateSessionDate: input.previousEstimate?.sessionDate || null,
    previousEstimatedVnindexValue: input.previousEstimate?.estimatedVnindexValue ?? null,
    estimatedVnindexValue: null,
    marketCapBillion: null,
    referenceMarketCapBillion: null,
    pe: emptyMetric(included.length),
    pb: emptyMetric(included.length),
    members,
  }
}

export function buildQeoExVnindexEstimate(input: {
  sessionDate: string
  ratingRun: QeoRatingRun | null
  candidates: QeoCandidateRow[]
  vnindexValue: number | null
  providerBreadthCount: number | null
  previousMarketSessionDate: string | null
  previousEstimate: QeoPreviousEstimate | null
  asOf?: string | null
  sourceMarketSyncRunId?: string | null
}): QeoExVnindexEstimate {
  const run = input.ratingRun
  const allRows = input.candidates
  const hoseRows = allRows.filter((row) => row.exchange?.trim().toUpperCase() === "HOSE")
  const metadata = {
    sessionDate: input.sessionDate,
    sourceRatingSyncRunId: run?.id || null,
    sourceContractVersion: run?.contractVersion ?? null,
    candidateCount: allRows.length,
    hoseRows,
    providerBreadthCount: input.providerBreadthCount,
    previousEstimate: input.previousEstimate,
    previousMarketSessionDate: input.previousMarketSessionDate,
    sourceMarketSyncRunId: input.sourceMarketSyncRunId,
  }

  if (!run || run.status !== "completed" || run.asOfDate !== input.sessionDate || !afterMarketClose(run.completedAt, input.sessionDate)) {
    return unavailable(metadata, "RATING_RUN_NOT_COMPLETED_AFTER_CLOSE", input.asOf)
  }
  if (!Number.isInteger(run.providerRowCount) || run.providerRowCount < 1 || run.providerRowCount !== allRows.length) {
    return unavailable(metadata, "CANDIDATE_FEED_COUNT_MISMATCH", input.asOf)
  }
  if (allRows.some((row) => row.asOfDate !== input.sessionDate || row.syncRunId !== run.id || !afterMarketClose(row.fetchedAt, input.sessionDate))) {
    return unavailable(metadata, "CANDIDATE_FEED_RUN_OR_FRESHNESS_MISMATCH", input.asOf)
  }
  if (new Set(allRows.map((row) => row.ticker.trim().toUpperCase())).size !== allRows.length) {
    return unavailable(metadata, "CANDIDATE_FEED_DUPLICATE_TICKER", input.asOf)
  }
  if (!finite(input.vnindexValue) || input.vnindexValue <= 0) {
    return unavailable(metadata, "PUBLISHED_VNINDEX_VALUE_MISSING", input.asOf)
  }
  if (!hoseRows.length || hoseRows.some((row) => !/^[A-Z0-9]{3}$/.test(row.ticker.trim().toUpperCase()))) {
    return unavailable(metadata, "HOSE_MEMBERSHIP_INVALID", input.asOf)
  }

  const hoseTickers = hoseRows.map((row) => row.ticker.trim().toUpperCase())
  if (!hoseTickers.includes("VIC") || !hoseTickers.includes("VHM")) {
    return unavailable(metadata, "VIC_VHM_MEMBERSHIP_MISSING", input.asOf)
  }
  const providerBreadthCount = finite(input.providerBreadthCount) && input.providerBreadthCount > 0
    ? input.providerBreadthCount
    : null
  const previousMinimum = input.previousEstimate?.sourceHoseCount ?? 0
  // The verified full feed has 413 HOSE rows. Keep a conservative floor rather
  // than hard-coding that observed membership size, and also compare against
  // the provider's breadth count as a lower bound when it is available.
  const minimumHoseCount = Math.max(
    350,
    Number.isFinite(previousMinimum) && previousMinimum > 0 ? Math.ceil(previousMinimum * 0.9) : 0,
    providerBreadthCount ?? 0,
  )
  if (hoseRows.length < minimumHoseCount) {
    return unavailable(metadata, "HOSE_SOURCE_COVERAGE_INCOMPLETE", input.asOf)
  }
  if (hoseRows.some((row) => !finite(row.marketCapBillion) || row.marketCapBillion <= 0
    || !finite(row.price) || row.price <= 0
    || !finite(row.priceChangePct) || row.priceChangePct <= -100)) {
    return unavailable(metadata, "HOSE_MARKET_CAP_OR_RETURN_INCOMPLETE", input.asOf)
  }

  const excluded = new Set<string>(QEO_EX_VIC_VHM_EXCLUDED_TICKERS)
  const retainedRows = hoseRows
    .filter((row) => !excluded.has(row.ticker.trim().toUpperCase()))
    .slice()
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
  const currentCap = retainedRows.reduce((sum, row) => sum + row.marketCapBillion!, 0)
  const referenceCap = retainedRows.reduce((sum, row) => sum + row.marketCapBillion! / (1 + row.priceChangePct! / 100), 0)
  if (!retainedRows.length || !Number.isFinite(currentCap) || currentCap <= 0 || !Number.isFinite(referenceCap) || referenceCap <= 0) {
    return unavailable(metadata, "HOSE_CAPITALIZATION_AGGREGATE_INVALID", input.asOf)
  }

  const pe = metricEstimate(retainedRows, (row) => row.pe, currentCap)
  const pb = metricEstimate(retainedRows, (row) => row.pb, currentCap)
  let baseSessionDate: string
  let baseVnindexValue: number
  let estimatedVnindexValue: number
  const previous = input.previousEstimate
  const previousHasAnchor = Boolean(previous?.baseSessionDate && finite(previous.baseVnindexValue))
  if (!previousHasAnchor) {
    baseSessionDate = input.sessionDate
    baseVnindexValue = input.vnindexValue
    estimatedVnindexValue = input.vnindexValue
  } else {
    if (!input.previousMarketSessionDate
      || !previous
      || previous.sessionDate !== input.previousMarketSessionDate
      || previous.status !== "available"
      || !finite(previous.estimatedVnindexValue)) {
      return {
        ...unavailable(metadata, "PREVIOUS_MARKET_SESSION_ESTIMATE_MISSING", input.asOf),
        pe,
        pb,
        marketCapBillion: currentCap,
        referenceMarketCapBillion: referenceCap,
      }
    }
    baseSessionDate = previous.baseSessionDate!
    baseVnindexValue = previous.baseVnindexValue!
    estimatedVnindexValue = previous.estimatedVnindexValue * (currentCap / referenceCap)
  }
  if (!Number.isFinite(estimatedVnindexValue) || estimatedVnindexValue <= 0) {
    return unavailable(metadata, "ESTIMATED_VNINDEX_VALUE_INVALID", input.asOf)
  }

  const members = buildObservedMembers(hoseRows)
  const observedTimestamps = hoseRows.map((row) => row.fetchedAt).sort()
  const breadth = finite(input.providerBreadthCount) ? input.providerBreadthCount : null
  return {
    sessionDate: input.sessionDate,
    asOf: input.asOf || null,
    calculationVersion: QEO_EX_VIC_VHM_CALCULATION_VERSION,
    status: "available",
    unavailableReason: null,
    sourceMarketSyncRunId: input.sourceMarketSyncRunId || null,
    sourceRatingSyncRunId: run.id,
    sourceContractVersion: run.contractVersion,
    sourceCandidateCount: allRows.length,
    sourceHoseCount: hoseRows.length,
    retainedMemberCount: retainedRows.length,
    calculationInputHash: null,
    retainedMemberHash: null,
    sourceHoseHash: null,
    sourceObservedFrom: observedTimestamps[0] || null,
    sourceObservedTo: observedTimestamps.at(-1) || null,
    providerBreadthCount: breadth,
    providerBreadthDifference: breadth == null ? null : breadth - hoseRows.length,
    baseSessionDate,
    baseVnindexValue,
    previousMarketSessionDate: input.previousMarketSessionDate,
    previousEstimateSessionDate: previous?.sessionDate || null,
    previousEstimatedVnindexValue: previous?.estimatedVnindexValue ?? null,
    estimatedVnindexValue,
    marketCapBillion: currentCap,
    referenceMarketCapBillion: referenceCap,
    pe,
    pb,
    members,
  }
}
