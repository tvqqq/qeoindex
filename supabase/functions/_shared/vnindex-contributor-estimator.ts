export interface VnindexContributorCandidate {
  ticker: string
  exchange: string | null
  marketCapBillion: number | null
  changePct: number | null
  price: number | null
}

export interface EstimatedVnindexContributor {
  ticker: string
  category: "index_up" | "index_down"
  rank: number
  price: number | null
  changePct: number
  estimatedIndexPoints: number
}

export type VnindexContributorEstimateStatus = "ready" | "invalid_index" | "insufficient_coverage"

export interface VnindexContributorEstimate {
  status: VnindexContributorEstimateStatus
  breadthCount: number
  validCandidateCount: number
  coverageRatio: number | null
  estimatedNetPoints: number | null
  contributors: EstimatedVnindexContributor[]
}

const MIN_COVERAGE_RATIO = 0.9

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value)
}

function round6(value: number) {
  return Number(value.toFixed(6))
}

export function estimateVnindexContributors({
  vnindexValue,
  vnindexChange,
  advances,
  declines,
  unchanged,
  candidates,
}: {
  vnindexValue: number | null
  vnindexChange: number | null
  advances: number
  declines: number
  unchanged: number
  candidates: readonly VnindexContributorCandidate[]
}): VnindexContributorEstimate {
  const breadthCount = Math.max(0, Math.trunc(advances)) + Math.max(0, Math.trunc(declines)) + Math.max(0, Math.trunc(unchanged))
  const referenceIndex = finite(vnindexValue) && finite(vnindexChange) ? vnindexValue - vnindexChange : null

  if (!finite(vnindexValue) || vnindexValue <= 0 || !finite(vnindexChange) || referenceIndex == null || referenceIndex <= 0 || breadthCount <= 0) {
    return { status: "invalid_index", breadthCount, validCandidateCount: 0, coverageRatio: null, estimatedNetPoints: null, contributors: [] }
  }

  const unique = new Map<string, VnindexContributorCandidate>()
  for (const candidate of candidates) {
    const ticker = String(candidate.ticker || "").trim().toUpperCase()
    if (!/^[A-Z0-9]{2,12}$/.test(ticker) || String(candidate.exchange || "").trim().toUpperCase() !== "HOSE") continue
    if (!finite(candidate.marketCapBillion) || candidate.marketCapBillion <= 0) continue
    if (!finite(candidate.changePct) || candidate.changePct <= -100) continue
    if (!unique.has(ticker)) unique.set(ticker, { ...candidate, ticker })
  }

  const valid = [...unique.values()]
  const validCandidateCount = valid.length
  const coverageRatio = validCandidateCount / breadthCount
  if (coverageRatio < MIN_COVERAGE_RATIO) {
    return { status: "insufficient_coverage", breadthCount, validCandidateCount, coverageRatio: round6(coverageRatio), estimatedNetPoints: null, contributors: [] }
  }

  const weighted = valid.flatMap((candidate) => {
    const marketCap = candidate.marketCapBillion as number
    const changePct = candidate.changePct as number
    const previousMarketCap = marketCap / (1 + changePct / 100)
    return Number.isFinite(previousMarketCap) && previousMarketCap > 0
      ? [{ candidate, changePct, previousMarketCap }]
      : []
  })
  const totalPreviousMarketCap = weighted.reduce((sum, item) => sum + item.previousMarketCap, 0)
  if (!Number.isFinite(totalPreviousMarketCap) || totalPreviousMarketCap <= 0) {
    return { status: "insufficient_coverage", breadthCount, validCandidateCount, coverageRatio: round6(coverageRatio), estimatedNetPoints: null, contributors: [] }
  }

  const allImpacts = weighted.map((item) => ({
    ticker: item.candidate.ticker,
    price: finite(item.candidate.price) ? item.candidate.price : null,
    changePct: item.changePct,
    estimatedIndexPoints: round6(referenceIndex * (item.previousMarketCap / totalPreviousMarketCap) * (item.changePct / 100)),
  }))
  const estimatedNetPoints = round6(allImpacts.reduce((sum, item) => sum + item.estimatedIndexPoints, 0))

  const pullers = allImpacts
    .filter((item) => item.estimatedIndexPoints > 0)
    .sort((a, b) => b.estimatedIndexPoints - a.estimatedIndexPoints)
    .slice(0, 10)
    .map((item, index) => ({ ...item, category: "index_up" as const, rank: index + 1 }))
  const draggers = allImpacts
    .filter((item) => item.estimatedIndexPoints < 0)
    .sort((a, b) => a.estimatedIndexPoints - b.estimatedIndexPoints)
    .slice(0, 10)
    .map((item, index) => ({ ...item, category: "index_down" as const, rank: index + 1 }))

  return {
    status: "ready",
    breadthCount,
    validCandidateCount,
    coverageRatio: round6(coverageRatio),
    estimatedNetPoints,
    contributors: [...pullers, ...draggers],
  }
}
