export type LeadershipConcentrationState = "broad" | "concentrated" | "unknown"

export interface LeadershipLiquidityCandidate {
  ticker: string
  tradedValueBillion: number | null
}

export interface LeadershipLiquidityItem {
  ticker: string
  tradedValueBillion: number
  sharePct: number
}

export interface LeadershipConcentrationContext {
  state: LeadershipConcentrationState
  vnindexTradedValueBillion: number | null
  candidateCount: number
  top5: LeadershipLiquidityItem[]
  top10: LeadershipLiquidityItem[]
  top5SharePct: number | null
  top10SharePct: number | null
}

const BROAD_TOP10_THRESHOLD_PCT = 35
const CONCENTRATED_TOP10_THRESHOLD_PCT = 50
const VNINDEX_MILLION_TO_BILLION = 1_000

function unknownContext(candidateCount: number, vnindexTradedValueBillion: number | null): LeadershipConcentrationContext {
  return {
    state: "unknown",
    vnindexTradedValueBillion,
    candidateCount,
    top5: [],
    top10: [],
    top5SharePct: null,
    top10SharePct: null,
  }
}

export function buildLeadershipConcentrationContext(input: {
  vnindexTradedValueMillion: number | null | undefined
  candidates: LeadershipLiquidityCandidate[]
}): LeadershipConcentrationContext {
  const candidateCount = input.candidates.length
  const rawDenominator = input.vnindexTradedValueMillion
  const denominatorMillion = rawDenominator == null ? null : Number(rawDenominator)
  const vnindexTradedValueBillion = denominatorMillion != null && Number.isFinite(denominatorMillion) && denominatorMillion > 0
    ? denominatorMillion / VNINDEX_MILLION_TO_BILLION
    : null

  if (vnindexTradedValueBillion == null || candidateCount < 10) {
    return unknownContext(candidateCount, vnindexTradedValueBillion)
  }

  const seen = new Set<string>()
  const normalized: Array<{ ticker: string; tradedValueBillion: number }> = []
  for (const candidate of input.candidates) {
    const ticker = String(candidate.ticker || "").trim().toUpperCase()
    const value = candidate.tradedValueBillion
    if (!ticker || seen.has(ticker) || value == null || !Number.isFinite(value) || value < 0) {
      return unknownContext(candidateCount, vnindexTradedValueBillion)
    }
    seen.add(ticker)
    normalized.push({ ticker, tradedValueBillion: value })
  }

  const candidateTotal = normalized.reduce((sum, item) => sum + item.tradedValueBillion, 0)
  if (candidateTotal > vnindexTradedValueBillion) {
    return unknownContext(candidateCount, vnindexTradedValueBillion)
  }

  const ranked = normalized
    .slice()
    .sort((a, b) => b.tradedValueBillion - a.tradedValueBillion || a.ticker.localeCompare(b.ticker))

  const withShare = (items: typeof ranked): LeadershipLiquidityItem[] => items.map((item) => ({
    ...item,
    sharePct: (item.tradedValueBillion / vnindexTradedValueBillion) * 100,
  }))
  const top5 = withShare(ranked.slice(0, 5))
  const top10 = withShare(ranked.slice(0, 10))
  const top5SharePct = top5.reduce((sum, item) => sum + item.sharePct, 0)
  const top10SharePct = top10.reduce((sum, item) => sum + item.sharePct, 0)
  const state: LeadershipConcentrationState = top10SharePct < BROAD_TOP10_THRESHOLD_PCT
    ? "broad"
    : top10SharePct >= CONCENTRATED_TOP10_THRESHOLD_PCT
      ? "concentrated"
      : "unknown"

  return {
    state,
    vnindexTradedValueBillion,
    candidateCount,
    top5,
    top10,
    top5SharePct,
    top10SharePct,
  }
}
